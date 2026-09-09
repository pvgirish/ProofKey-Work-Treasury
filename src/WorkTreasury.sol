// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {WorkTypes} from "./WorkTypes.sol";
import {AllocationCodec} from "./AllocationCodec.sol";
import {AllocationTree} from "./AllocationTree.sol";
import {NativeReceiptAuth} from "./NativeReceiptAuth.sol";

/// @title WorkTreasury
/// @notice Exact funded-epoch treasury and sole target recognizer for ProofKey allocation V1.
contract WorkTreasury is NativeReceiptAuth, ReentrancyGuard {
    bytes32 internal constant SELECTED_LOG_TYPEHASH =
        keccak256("ProofKeySelectedLogV1(bytes32 authenticationId,uint256 receiptLogOrdinal,address emitter)");

    struct EpochAccount {
        uint256 reserve;
        uint256 recognized;
        bool funded;
    }

    struct Claim {
        WorkTypes.Allocation allocation;
        bool withdrawn;
        address paidDestination;
    }

    struct CheckpointRecord {
        WorkTypes.Checkpoint checkpoint;
        SourcePosition position;
        uint32 logOrdinal;
        bytes32 authenticationId;
        bool exists;
    }

    uint256 public immutable SOURCE_CHAIN_ID;

    mapping(bytes32 epochId => WorkTypes.EpochConfig) private _epochConfigs;
    mapping(bytes32 epochId => EpochAccount) private _epochs;
    mapping(address owner => uint256) public freeBalance;
    mapping(bytes32 economicId => bool) public recognizedEconomicId;
    mapping(bytes32 economicId => Claim) private _claims;
    mapping(bytes32 economicId => WorkTypes.Allocation) private _recognizedAllocations;
    mapping(bytes32 checkpointId => CheckpointRecord) private _checkpoints;
    mapping(bytes32 epochId => bytes32 checkpointId) public latestCheckpointId;

    uint256 public totalCreditedDeposits;
    uint256 public totalFreeLiability;
    uint256 public totalReserveLiability;
    uint256 public totalClaimLiability;
    uint256 public cumulativeWithdrawals;

    error EpochAlreadyFunded(bytes32 epochId);
    error EpochNotFunded(bytes32 epochId);
    error NotSponsor(address caller, address sponsor);
    error InsufficientFreeBalance(uint256 required, uint256 available);
    error InvalidAllocation();
    error InvalidCheckpoint();
    error EconomicRightAlreadyRecognized(bytes32 economicId);
    error EpochCapExceeded(uint256 attempted, uint256 cap);
    error CheckpointNotFound(bytes32 checkpointId);
    error AllocationNotInCheckpoint();
    error ClaimNotFound(bytes32 economicId);
    error ClaimAlreadyWithdrawn(bytes32 economicId);
    error NotClaimOwner(address caller, address owner);
    error ZeroDestination();
    error TransferFailed();
    error ZeroAmount();

    event FreeBalanceDeposited(address indexed owner, uint256 amount);
    event EpochFunded(bytes32 indexed epochId, address indexed sponsor, uint256 cap);
    event CheckpointImported(
        bytes32 indexed checkpointId,
        bytes32 indexed epochId,
        bytes32 root,
        uint32 leafCount,
        uint256 earned,
        uint256 returned,
        uint8 phase,
        bytes32 authenticationId,
        uint32 receiptLogOrdinal
    );
    event AllocationRecognized(
        bytes32 indexed epochId,
        uint64 indexed allocationId,
        bytes32 indexed economicId,
        uint8 kind,
        uint256 amount,
        address claimOwner,
        address destination,
        bytes32 leafHash
    );
    event ClaimWithdrawn(
        bytes32 indexed epochId,
        uint64 indexed allocationId,
        uint8 kind,
        address indexed claimOwner,
        address destination,
        uint256 amount
    );
    event FreeBalanceWithdrawn(address indexed owner, address indexed destination, uint256 amount);

    constructor(uint256 sourceChainId, uint64 sourceChainKey, address sourceCoordinator)
        NativeReceiptAuth(sourceChainKey, sourceCoordinator)
    {
        if (sourceChainId == 0) revert WorkTypes.InvalidConfiguration();
        SOURCE_CHAIN_ID = sourceChainId;
    }

    receive() external payable {
        _creditDeposit(msg.sender, msg.value);
    }

    function deposit() external payable {
        _creditDeposit(msg.sender, msg.value);
    }

    /// @notice Credits this call's deposit to the sponsor, then reserves the exact immutable cap.
    ///         Existing sponsor free balance may supply the remainder; excess stays free.
    function fundEpoch(WorkTypes.EpochConfig calldata config) public payable nonReentrant returns (bytes32 epochId_) {
        WorkTypes.validateConfig(config);
        if (
            config.sourceChainId != SOURCE_CHAIN_ID || config.sourceChainKey != SOURCE_CHAIN_KEY
                || config.sourceCoordinator != SOURCE_COORDINATOR || config.targetChainId != block.chainid
                || config.targetTreasury != address(this)
        ) revert WorkTypes.InvalidConfiguration();
        if (msg.sender != config.sponsor) revert NotSponsor(msg.sender, config.sponsor);

        epochId_ = WorkTypes.epochId(config);
        if (_epochs[epochId_].funded) revert EpochAlreadyFunded(epochId_);
        if (msg.value != 0) _creditDeposit(msg.sender, msg.value);
        uint256 available = freeBalance[msg.sender];
        if (available < config.cap) revert InsufficientFreeBalance(config.cap, available);

        freeBalance[msg.sender] = available - config.cap;
        totalFreeLiability -= config.cap;
        totalReserveLiability += config.cap;
        _epochConfigs[epochId_] = config;
        _epochs[epochId_] = EpochAccount({reserve: config.cap, recognized: 0, funded: true});
        emit EpochFunded(epochId_, msg.sender, config.cap);
    }

    function fundEpochFromFree(WorkTypes.EpochConfig calldata config) external nonReentrant returns (bytes32 epochId_) {
        epochId_ = _fundEpochFromFree(config);
    }

    function _fundEpochFromFree(WorkTypes.EpochConfig calldata config) private returns (bytes32 epochId_) {
        WorkTypes.validateConfig(config);
        if (
            config.sourceChainId != SOURCE_CHAIN_ID || config.sourceChainKey != SOURCE_CHAIN_KEY
                || config.sourceCoordinator != SOURCE_COORDINATOR || config.targetChainId != block.chainid
                || config.targetTreasury != address(this)
        ) revert WorkTypes.InvalidConfiguration();
        if (msg.sender != config.sponsor) revert NotSponsor(msg.sender, config.sponsor);
        epochId_ = WorkTypes.epochId(config);
        if (_epochs[epochId_].funded) revert EpochAlreadyFunded(epochId_);
        uint256 available = freeBalance[msg.sender];
        if (available < config.cap) revert InsufficientFreeBalance(config.cap, available);
        freeBalance[msg.sender] = available - config.cap;
        totalFreeLiability -= config.cap;
        totalReserveLiability += config.cap;
        _epochConfigs[epochId_] = config;
        _epochs[epochId_] = EpochAccount({reserve: config.cap, recognized: 0, funded: true});
        emit EpochFunded(epochId_, msg.sender, config.cap);
    }

    function epochConfig(bytes32 epochId_) external view returns (WorkTypes.EpochConfig memory) {
        if (!_epochs[epochId_].funded) revert EpochNotFunded(epochId_);
        return _epochConfigs[epochId_];
    }

    function epochAccount(bytes32 epochId_) external view returns (EpochAccount memory) {
        return _epochs[epochId_];
    }

    function economicId(bytes32 epochId_, uint64 allocationId_) public pure returns (bytes32) {
        return keccak256(abi.encode(epochId_, allocationId_));
    }

    function recognizedAllocation(bytes32 epochId_, uint64 allocationId_)
        external
        view
        returns (WorkTypes.Allocation memory)
    {
        return _recognizedAllocations[economicId(epochId_, allocationId_)];
    }

    function claim(bytes32 epochId_, uint64 allocationId_) external view returns (Claim memory) {
        return _claims[economicId(epochId_, allocationId_)];
    }

    function completedClaim(bytes32 epochId_, uint64 allocationId_)
        external
        view
        returns (WorkTypes.Allocation memory allocation, bool withdrawn, address paidDestination)
    {
        Claim storage c = _claims[economicId(epochId_, allocationId_)];
        return (c.allocation, c.withdrawn, c.paidDestination);
    }

    function checkpoint(bytes32 checkpointId_) external view returns (CheckpointRecord memory) {
        return _checkpoints[checkpointId_];
    }

    function selectedLogId(bytes32 authenticationId_, uint32 receiptLogOrdinal) public view returns (bytes32) {
        return keccak256(abi.encode(SELECTED_LOG_TYPEHASH, authenticationId_, receiptLogOrdinal, SOURCE_COORDINATOR));
    }

    function liveLiabilities() public view returns (uint256) {
        return totalFreeLiability + totalReserveLiability + totalClaimLiability;
    }

    function forcedSurplus() external view returns (uint256) {
        uint256 liabilities = liveLiabilities();
        return address(this).balance > liabilities ? address(this).balance - liabilities : 0;
    }

    function authenticateTransaction(SingleProof calldata proof)
        external
        returns (SourcePosition memory position, bytes32 authenticationId_)
    {
        return _authenticateSingle(proof);
    }

    function authenticateBatch(
        uint64[] calldata blockHeights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external returns (SourcePosition[] memory positions, bytes32[] memory authenticationIds) {
        return _authenticateBatch(blockHeights, encodedTransactions, merkleProofs, sharedContinuityProof);
    }

    function authenticateSegmented(SingleProof[] calldata proofs)
        external
        returns (SourcePosition[] memory positions, bytes32[] memory authenticationIds)
    {
        return _authenticateSegmented(proofs);
    }

    function importCheckpoint(
        SourcePosition calldata position,
        bytes calldata encodedTransaction,
        uint32 receiptLogOrdinal
    ) public returns (bytes32 checkpointId_) {
        (EvmV1Decoder.LogEntry memory log, bytes32 authId) =
            _selectAuthenticatedLog(position, encodedTransaction, receiptLogOrdinal);
        checkpointId_ = _storeCheckpoint(log, position, receiptLogOrdinal, authId);
    }

    function authenticateCheckpoint(SingleProof calldata proof, uint32 receiptLogOrdinal)
        external
        returns (bytes32 checkpointId_)
    {
        (SourcePosition memory position, bytes32 authId) = _authenticateSingle(proof);
        EvmV1Decoder.LogEntry memory log;
        (log,) = _selectAuthenticatedLog(position, proof.encodedTransaction, receiptLogOrdinal);
        checkpointId_ = _storeCheckpoint(log, position, receiptLogOrdinal, authId);
    }

    function recognizeFromCheckpoint(
        bytes32 checkpointId_,
        WorkTypes.Allocation calldata allocation,
        bytes32[] calldata siblings
    ) external returns (bytes32 economicId_) {
        economicId_ = _recognizeFromCheckpoint(checkpointId_, allocation, siblings);
    }

    /// @notice Authenticates and saves a checkpoint only if this same call's claim succeeds.
    /// @dev Any invalid allocation or witness reverts the newly written authentication/checkpoint.
    ///      An authentication committed by an earlier transaction survives a later failed claim.
    function authenticateAndRecognizeCheckpoint(
        SingleProof calldata proof,
        uint32 checkpointLogOrdinal,
        WorkTypes.Allocation calldata allocation,
        bytes32[] calldata siblings
    ) external returns (bytes32 economicId_, bytes32 checkpointId_) {
        (SourcePosition memory position, bytes32 authId) = _authenticateSingle(proof);
        EvmV1Decoder.LogEntry memory log;
        (log,) = _selectAuthenticatedLog(position, proof.encodedTransaction, checkpointLogOrdinal);
        checkpointId_ = _storeCheckpoint(log, position, checkpointLogOrdinal, authId);
        economicId_ = _recognizeFromCheckpoint(checkpointId_, allocation, siblings);
    }

    function recognizeFromReceipt(
        SourcePosition calldata position,
        bytes calldata encodedTransaction,
        uint32 receiptLogOrdinal
    ) external returns (bytes32 economicId_) {
        EvmV1Decoder.LogEntry memory log;
        (log,) = _selectAuthenticatedLog(position, encodedTransaction, receiptLogOrdinal);
        WorkTypes.Allocation memory allocation = AllocationCodec.decodeAllocation(log.topics, log.data);
        economicId_ = _recognize(allocation);
    }

    /// @notice Authenticates a receipt and recognizes its selected canonical allocation atomically.
    ///         If recognition fails, this call does not leave a new authentication behind.
    function authenticateAndRecognizeReceipt(SingleProof calldata proof, uint32 receiptLogOrdinal)
        external
        returns (bytes32 economicId_)
    {
        (SourcePosition memory position,) = _authenticateSingle(proof);
        EvmV1Decoder.LogEntry memory log;
        (log,) = _selectAuthenticatedLog(position, proof.encodedTransaction, receiptLogOrdinal);
        WorkTypes.Allocation memory allocation = AllocationCodec.decodeAllocation(log.topics, log.data);
        economicId_ = _recognize(allocation);
    }

    function withdrawFor(bytes32 epochId_, uint64 allocationId_) external nonReentrant {
        bytes32 id = economicId(epochId_, allocationId_);
        Claim storage c = _openClaim(id);
        _completeClaim(c, c.allocation.destination);
    }

    function ownerWithdrawTo(bytes32 epochId_, uint64 allocationId_, address payable destination)
        external
        nonReentrant
    {
        if (destination == address(0)) revert ZeroDestination();
        bytes32 id = economicId(epochId_, allocationId_);
        Claim storage c = _openClaim(id);
        if (msg.sender != c.allocation.claimOwner) revert NotClaimOwner(msg.sender, c.allocation.claimOwner);
        _completeClaim(c, destination);
    }

    function withdrawFreeFor(address payable owner, uint256 amount) external nonReentrant {
        _withdrawFree(owner, owner, amount);
    }

    function ownerWithdrawFreeTo(uint256 amount, address payable destination) external nonReentrant {
        _withdrawFree(payable(msg.sender), destination, amount);
    }

    function _creditDeposit(address owner, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        freeBalance[owner] += amount;
        totalCreditedDeposits += amount;
        totalFreeLiability += amount;
        emit FreeBalanceDeposited(owner, amount);
    }

    function _storeCheckpoint(
        EvmV1Decoder.LogEntry memory log,
        SourcePosition memory position,
        uint32 receiptLogOrdinal,
        bytes32 authId
    ) private returns (bytes32 checkpointId_) {
        WorkTypes.Checkpoint memory c = AllocationCodec.decodeCheckpoint(log.topics, log.data);
        EpochAccount storage epoch = _epochs[c.epochId];
        if (!epoch.funded) revert EpochNotFunded(c.epochId);
        WorkTypes.EpochConfig storage config = _epochConfigs[c.epochId];
        if (
            c.leafCount > WorkTypes.TREE_CAPACITY || c.earned + c.returned > config.cap || c.phase < WorkTypes.ACTIVE
                || c.phase > WorkTypes.CLOSED || (c.phase == WorkTypes.CLOSED && c.earned + c.returned != config.cap)
        ) revert InvalidCheckpoint();

        checkpointId_ = selectedLogId(authId, receiptLogOrdinal);
        CheckpointRecord storage prior = _checkpoints[checkpointId_];
        if (prior.exists) {
            if (keccak256(abi.encode(prior.checkpoint)) != keccak256(abi.encode(c))) revert InvalidCheckpoint();
            return checkpointId_;
        }
        _checkpoints[checkpointId_] = CheckpointRecord({
            checkpoint: c, position: position, logOrdinal: receiptLogOrdinal, authenticationId: authId, exists: true
        });
        bytes32 latestId = latestCheckpointId[c.epochId];
        if (latestId == bytes32(0) || _isLater(position, receiptLogOrdinal, _checkpoints[latestId])) {
            latestCheckpointId[c.epochId] = checkpointId_;
        }
        emit CheckpointImported(
            checkpointId_, c.epochId, c.root, c.leafCount, c.earned, c.returned, c.phase, authId, receiptLogOrdinal
        );
    }

    function _isLater(SourcePosition memory position, uint32 ordinal, CheckpointRecord storage prior)
        private
        view
        returns (bool)
    {
        return position.blockHeight > prior.position.blockHeight
            || (position.blockHeight == prior.position.blockHeight
                && (position.transactionIndex > prior.position.transactionIndex
                    || (position.transactionIndex == prior.position.transactionIndex && ordinal > prior.logOrdinal)));
    }

    function _recognizeFromCheckpoint(
        bytes32 checkpointId_,
        WorkTypes.Allocation memory allocation,
        bytes32[] memory siblings
    ) private returns (bytes32 economicId_) {
        CheckpointRecord storage r = _checkpoints[checkpointId_];
        if (!r.exists) revert CheckpointNotFound(checkpointId_);
        if (allocation.epochId != r.checkpoint.epochId) revert InvalidAllocation();
        if (!AllocationTree.verify(allocation, siblings, r.checkpoint.leafCount, r.checkpoint.root)) {
            revert AllocationNotInCheckpoint();
        }
        economicId_ = _recognize(allocation);
    }

    function _recognize(WorkTypes.Allocation memory allocation) private returns (bytes32 id) {
        EpochAccount storage epoch = _epochs[allocation.epochId];
        if (!epoch.funded) revert EpochNotFunded(allocation.epochId);
        WorkTypes.EpochConfig storage config = _epochConfigs[allocation.epochId];
        if (
            allocation.allocationId == 0 || allocation.treeIndex >= WorkTypes.TREE_CAPACITY
                || allocation.allocationId != uint64(allocation.treeIndex) + 1 || allocation.asset != config.asset
                || allocation.policyHash != config.policyHash || allocation.amount == 0
                || allocation.claimOwner == address(0) || allocation.destination == address(0)
        ) revert InvalidAllocation();

        bool isClaim = allocation.kind == WorkTypes.WORK || allocation.kind == WorkTypes.FEE;
        if (isClaim) {
            uint8 expectedRole = allocation.kind == WorkTypes.WORK ? 1 : 2;
            if (allocation.role != expectedRole || allocation.orderId == bytes32(0)) revert InvalidAllocation();
        } else if (
            allocation.kind != WorkTypes.RETURN || allocation.role != 0 || allocation.orderId != bytes32(0)
                || allocation.milestoneId != 0 || allocation.claimOwner != config.refundBeneficiary
                || allocation.destination != config.refundBeneficiary
        ) {
            revert InvalidAllocation();
        }

        id = economicId(allocation.epochId, allocation.allocationId);
        if (recognizedEconomicId[id]) revert EconomicRightAlreadyRecognized(id);
        uint256 nextRecognized = epoch.recognized + allocation.amount;
        if (nextRecognized > config.cap) revert EpochCapExceeded(nextRecognized, config.cap);

        recognizedEconomicId[id] = true;
        _recognizedAllocations[id] = allocation;
        epoch.recognized = nextRecognized;
        epoch.reserve -= allocation.amount;
        totalReserveLiability -= allocation.amount;
        if (isClaim) {
            _claims[id].allocation = allocation;
            totalClaimLiability += allocation.amount;
        } else {
            freeBalance[config.refundBeneficiary] += allocation.amount;
            totalFreeLiability += allocation.amount;
        }
        emit AllocationRecognized(
            allocation.epochId,
            allocation.allocationId,
            id,
            allocation.kind,
            allocation.amount,
            allocation.claimOwner,
            allocation.destination,
            AllocationCodec.leafHash(allocation)
        );
    }

    function _openClaim(bytes32 id) private view returns (Claim storage c) {
        c = _claims[id];
        if (c.allocation.amount == 0) revert ClaimNotFound(id);
        if (c.withdrawn) revert ClaimAlreadyWithdrawn(id);
    }

    function _completeClaim(Claim storage c, address destination) private {
        uint256 amount = c.allocation.amount;
        c.withdrawn = true;
        c.paidDestination = destination;
        totalClaimLiability -= amount;
        cumulativeWithdrawals += amount;
        emit ClaimWithdrawn(
            c.allocation.epochId,
            c.allocation.allocationId,
            c.allocation.kind,
            c.allocation.claimOwner,
            destination,
            amount
        );
        (bool ok,) = payable(destination).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _withdrawFree(address payable owner, address payable destination, uint256 amount) private {
        if (destination == address(0)) revert ZeroDestination();
        if (amount == 0) revert ZeroAmount();
        uint256 available = freeBalance[owner];
        if (available < amount) revert InsufficientFreeBalance(amount, available);
        freeBalance[owner] = available - amount;
        totalFreeLiability -= amount;
        cumulativeWithdrawals += amount;
        emit FreeBalanceWithdrawn(owner, destination, amount);
        (bool ok,) = destination.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
