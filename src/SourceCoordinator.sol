// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WorkTypes} from "./WorkTypes.sol";
import {AllocationCodec} from "./AllocationCodec.sol";
import {AllocationTree} from "./AllocationTree.sol";
import {SourceSignatureLib} from "./SourceSignatureLib.sol";
import {SourcePolicyV1Lib} from "./SourcePolicyV1Lib.sol";
import {SourceStorage} from "./SourceStorage.sol";
import {SourceAccountingLib} from "./SourceAccountingLib.sol";

/// @notice Ethereum source ledger for the immutable ProofKey WorkPolicyV1.
/// @dev The coordinator authenticates source decisions; it does not claim that the target epoch is funded.
contract SourceCoordinator {
    using AllocationTree for AllocationTree.Tree;

    uint8 internal constant PHASE_ACTIVE = 1;
    uint8 internal constant PHASE_DRAINING = 2;
    uint8 internal constant PHASE_CLOSED = 3;

    uint8 internal constant MILESTONE_PENDING = 1;
    uint8 internal constant MILESTONE_AGREED = 2;
    uint8 internal constant MILESTONE_DELIVERED = 3;
    uint8 internal constant MILESTONE_CHALLENGED = 4;
    uint8 internal constant MILESTONE_FINAL = 5;

    uint8 internal constant OUTCOME_DECLINED = 1;
    uint8 internal constant OUTCOME_PENDING_EXPIRED = 2;
    uint8 internal constant OUTCOME_NO_DELIVERY = 3;
    uint8 internal constant OUTCOME_APPROVED = 4;
    uint8 internal constant OUTCOME_MONITORING_DEFAULT = 5;
    uint8 internal constant OUTCOME_COMMITTEE = 6;
    uint8 internal constant OUTCOME_COMMITTEE_TIMEOUT = 7;
    uint8 internal constant OUTCOME_MUTUAL = 8;

    uint8 internal constant RELEASE_AUTHORIZED_FREE = 1;
    uint8 internal constant RELEASE_DRAINING_SWEEP = 2;
    uint8 internal constant RELEASE_NEVER_INITIALIZED = 3;

    uint8 private constant NONCE_UNUSED = 0;
    uint8 private constant NONCE_OFFER = 1;
    uint8 private constant NONCE_CONSUMED = 2;
    uint8 private constant NONCE_REVOKED = 3;

    struct OrderData {
        bool exists;
        bool agreed;
        bytes32 epochId;
        bytes32 termsHash;
        address worker;
        address claimOwner;
        address destination;
        address feeOwner;
        address feeDestination;
        address[3] committee;
        uint64 acceptBefore;
        uint64 nonce;
        uint32 milestoneCount;
        uint32 finalizedCount;
    }

    struct MilestoneData {
        uint8 status;
        uint8 outcome;
        uint64 stateVersion;
        bytes32 deliveryHash;
        uint256 work;
        uint256 fee;
        uint256 timeoutWork;
        uint64 deliverBefore;
        uint64 reviewBefore;
        uint64 ruleBefore;
        uint64 mutualNonce;
        uint256 finalWork;
        uint256 finalFee;
        bytes32 decisionHash;
        bytes32 evidenceHash;
    }

    struct EpochStateView {
        bool initialized;
        bool expiredUninitialized;
        uint32 leafCount;
        bytes32 root;
        uint256 available;
        uint256 unresolved;
        uint256 earned;
        uint256 returned;
        uint8 phase;
        uint32 reservations;
        uint32 unresolvedMilestones;
        uint32 activeReturns;
        uint32 drainingReturns;
    }

    mapping(bytes32 => WorkTypes.EpochConfig) private _epochConfigs;
    mapping(bytes32 => SourceStorage.Epoch) private _epochs;
    mapping(bytes32 => SourceStorage.Order) private _orders;
    mapping(bytes32 => mapping(uint32 => SourceStorage.Milestone)) private _milestones;
    mapping(bytes32 => mapping(address => mapping(uint64 => uint8))) private _nonceState;
    mapping(bytes32 => mapping(address => mapping(uint64 => bytes32))) private _offerForNonce;
    mapping(bytes32 => uint8) private _rulingVotes;
    mapping(bytes32 => mapping(uint32 => mapping(address => uint64))) private _rulingNonceFloor;

    error Unauthorized();
    error InvalidState();
    error InvalidTerms();
    error InvalidDeadline();
    error InvalidSignature();
    error InvalidNonce();
    error DuplicateVote();
    error InsufficientAvailable();
    error CapacityExceeded();
    error UnknownEpoch();
    error UnknownOrder();
    error ZeroAmount();

    event EpochInitialized(bytes32 indexed epochId, address indexed sourceSafe, uint256 cap);
    event NeverInitializedEpochExpired(bytes32 indexed epochId);
    event OrderReserved(bytes32 indexed epochId, bytes32 indexed orderId, address indexed worker, bool agreed);
    event OrderAgreed(bytes32 indexed epochId, bytes32 indexed orderId);
    event PendingOrderFinalized(bytes32 indexed epochId, bytes32 indexed orderId, uint8 outcome);
    event DeliveryUpdated(bytes32 indexed orderId, uint32 indexed milestoneId, bytes32 deliveryHash, uint64 stateVersion);
    event MilestoneChallenged(bytes32 indexed orderId, uint32 indexed milestoneId, bytes32 deliveryHash, uint64 stateVersion);
    event RulingVote(bytes32 indexed orderId, uint32 indexed milestoneId, bytes32 indexed proposalHash, address voter, uint8 voteCount);
    event MutualProposalsInvalidated(bytes32 indexed orderId, uint32 indexed milestoneId, uint64 newNonce, address by);
    event RulingVotesInvalidated(bytes32 indexed orderId, uint32 indexed milestoneId, address indexed voter, uint64 newFloor);
    event MilestoneFinalized(bytes32 indexed epochId, bytes32 indexed orderId, uint32 indexed milestoneId, uint8 outcome,
        uint256 workAmount, uint256 feeAmount, bytes32 evidenceHash);
    event DrainingStarted(bytes32 indexed epochId);
    event QuoteNonceRevoked(bytes32 indexed epochId, address indexed worker, uint64 indexed nonce);

    // Frozen allocation/checkpoint events. Keep indexing and field order identical to schema-v1.json.
    event AllocationCreated(bytes32 indexed epochId, uint64 indexed allocationId, uint32 treeIndex, uint8 kind,
        bytes32 orderId, uint32 milestoneId, uint8 role, address asset, uint256 amount,
        address claimOwner, address destination, bytes32 policyHash, bytes32 evidenceHash);
    event CheckpointPublished(bytes32 indexed epochId, bytes32 root, uint32 leafCount,
        uint256 earned, uint256 returned, uint8 phase);

    function domainSeparator() public view returns (bytes32) {
        return SourceSignatureLib.domainSeparator(address(this));
    }

    function computeEpochId(WorkTypes.EpochConfig calldata config) external pure returns (bytes32) {
        return WorkTypes.epochId(config);
    }

    function computeOrderId(WorkTypes.OrderTerms calldata terms) external pure returns (bytes32) {
        return WorkTypes.orderId(terms);
    }

    function quoteDigest(WorkTypes.OrderTerms calldata terms) public view returns (bytes32) {
        return SourceSignatureLib.quoteDigest(address(this), WorkTypes.orderId(terms));
    }

    function offerAcceptanceDigest(bytes32 orderId) public view returns (bytes32) {
        return SourceSignatureLib.acceptanceDigest(address(this), orderId);
    }

    function quoteRevocationDigest(bytes32 epochId, address worker, uint64 nonce) public view returns (bytes32) {
        return SourceSignatureLib.revocationDigest(address(this), epochId, worker, nonce);
    }

    function mutualDigest(bytes32 orderId, uint32 milestoneId, uint256 workAmount, uint64 proposalNonce)
        public view returns (bytes32)
    {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        return _mutualDigest(o, m, orderId, milestoneId, workAmount, proposalNonce);
    }

    function rulingDigest(bytes32 orderId, uint32 milestoneId, uint256 workAmount, uint64 proposalNonce)
        public view returns (bytes32)
    {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        return _rulingDigest(o, m, orderId, milestoneId, workAmount, proposalNonce);
    }

    function initializeEpoch(WorkTypes.EpochConfig calldata config) external returns (bytes32 epochId) {
        WorkTypes.validateConfig(config);
        if (config.sourceChainId != block.chainid || config.sourceCoordinator != address(this)) revert InvalidTerms();
        if (block.number >= config.initializationCutoff || msg.sender != config.sourceSafe) revert Unauthorized();
        epochId = WorkTypes.epochId(config);
        SourceStorage.Epoch storage e = _epochs[epochId];
        if (e.exists) revert InvalidState();
        _epochConfigs[epochId] = config;
        e.exists = true;
        e.phase = WorkTypes.ACTIVE;
        e.available = config.cap;
        e.tree.initialize();
        emit EpochInitialized(epochId, config.sourceSafe, config.cap);
        emit CheckpointPublished(epochId, e.tree.root, 0, 0, 0, e.phase);
    }

    function expireUninitializedEpoch(WorkTypes.EpochConfig calldata config) external returns (bytes32 epochId) {
        WorkTypes.validateConfig(config);
        if (config.sourceChainId != block.chainid || config.sourceCoordinator != address(this)) revert InvalidTerms();
        if (block.number < config.initializationCutoff) revert InvalidDeadline();
        epochId = WorkTypes.epochId(config);
        SourceStorage.Epoch storage e = _epochs[epochId];
        if (e.exists) revert InvalidState();
        _epochConfigs[epochId] = config;
        e.exists = true;
        e.expiredUninitialized = true;
        e.phase = WorkTypes.CLOSED;
        e.returned = config.cap;
        e.tree.initialize();
        bytes32 evidence = AllocationCodec.releaseHash(epochId, RELEASE_NEVER_INITIALIZED, config.cap, bytes32(0));
        _appendReturn(epochId, e, config.cap, evidence);
        emit NeverInitializedEpochExpired(epochId);
        _publish(epochId, e);
    }

    function createOffer(WorkTypes.OrderTerms calldata terms) external returns (bytes32 orderId) {
        SourceStorage.Epoch storage e = _activeEpoch(terms.epochId);
        WorkTypes.EpochConfig storage c = _epochConfigs[terms.epochId];
        if (msg.sender != c.sourceSafe) revert Unauthorized();
        if (_nonceState[terms.epochId][terms.worker][terms.nonce] != NONCE_UNUSED) revert InvalidNonce();
        orderId = WorkTypes.orderId(terms);
        _reserveOrder(terms, orderId, e, false);
        _nonceState[terms.epochId][terms.worker][terms.nonce] = NONCE_OFFER;
        _offerForNonce[terms.epochId][terms.worker][terms.nonce] = orderId;
    }

    function acceptOffer(bytes32 orderId, bytes calldata workerSignature) external {
        SourceStorage.Order storage o = _order(orderId);
        if (o.agreed || block.number >= o.acceptBefore) revert InvalidState();
        if (_nonceState[o.epochId][o.worker][o.nonce] != NONCE_OFFER) revert InvalidNonce();
        _requireAuthorization(o.worker, offerAcceptanceDigest(orderId), workerSignature);
        _nonceState[o.epochId][o.worker][o.nonce] = NONCE_CONSUMED;
        o.agreed = true;
        for (uint32 i; i < o.milestoneCount; ++i) {
            SourceStorage.Milestone storage m = _milestones[orderId][i];
            if (m.status != MILESTONE_PENDING) revert InvalidState();
            m.status = MILESTONE_AGREED;
            m.stateVersion = 1;
        }
        emit OrderAgreed(o.epochId, orderId);
    }

    function acceptQuote(WorkTypes.OrderTerms calldata terms, bytes calldata workerSignature)
        external returns (bytes32 orderId)
    {
        SourceStorage.Epoch storage e = _activeEpoch(terms.epochId);
        WorkTypes.EpochConfig storage c = _epochConfigs[terms.epochId];
        if (msg.sender != c.sourceSafe) revert Unauthorized();
        if (_nonceState[terms.epochId][terms.worker][terms.nonce] != NONCE_UNUSED) revert InvalidNonce();
        orderId = WorkTypes.orderId(terms);
        _requireAuthorization(terms.worker, quoteDigest(terms), workerSignature);
        _nonceState[terms.epochId][terms.worker][terms.nonce] = NONCE_CONSUMED;
        _reserveOrder(terms, orderId, e, true);
    }

    function revokeQuoteNonce(bytes32 epochId, address worker, uint64 nonce, bytes calldata signature) external {
        SourceStorage.Epoch storage e = _epoch(epochId);
        uint8 state = _nonceState[epochId][worker][nonce];
        if (state == NONCE_CONSUMED || state == NONCE_REVOKED) revert InvalidNonce();
        _requireAuthorization(worker, quoteRevocationDigest(epochId, worker, nonce), signature);
        _nonceState[epochId][worker][nonce] = NONCE_REVOKED;
        if (state == NONCE_OFFER) {
            bytes32 orderId = _offerForNonce[epochId][worker][nonce];
            _finalizePendingOrder(orderId, e, OUTCOME_DECLINED);
        }
        emit QuoteNonceRevoked(epochId, worker, nonce);
    }

    function declinePendingOrder(bytes32 orderId) external {
        SourceStorage.Order storage o = _order(orderId);
        WorkTypes.EpochConfig storage c = _epochConfigs[o.epochId];
        if (msg.sender != c.sourceSafe && msg.sender != o.worker) revert Unauthorized();
        if (_nonceState[o.epochId][o.worker][o.nonce] != NONCE_OFFER) revert InvalidNonce();
        _nonceState[o.epochId][o.worker][o.nonce] = NONCE_CONSUMED;
        _finalizePendingOrder(orderId, _epochs[o.epochId], OUTCOME_DECLINED);
    }

    function expirePendingOrder(bytes32 orderId) external {
        SourceStorage.Order storage o = _order(orderId);
        if (o.agreed || block.number < o.acceptBefore) revert InvalidDeadline();
        if (_nonceState[o.epochId][o.worker][o.nonce] != NONCE_OFFER) revert InvalidNonce();
        _nonceState[o.epochId][o.worker][o.nonce] = NONCE_CONSUMED;
        _finalizePendingOrder(orderId, _epochs[o.epochId], OUTCOME_PENDING_EXPIRED);
    }

    function deliver(bytes32 orderId, uint32 milestoneId, bytes32 deliveryHash) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (msg.sender != o.worker || deliveryHash == bytes32(0)) revert Unauthorized();
        if (!o.agreed || block.number >= m.deliverBefore
            || (m.status != MILESTONE_AGREED && m.status != MILESTONE_DELIVERED)) revert InvalidState();
        m.deliveryHash = deliveryHash;
        m.status = MILESTONE_DELIVERED;
        ++m.stateVersion;
        emit DeliveryUpdated(orderId, milestoneId, deliveryHash, m.stateVersion);
    }

    function approve(bytes32 orderId, uint32 milestoneId, bytes32 expectedDeliveryHash, uint64 expectedStateVersion) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (msg.sender != _epochConfigs[o.epochId].sourceSafe) revert Unauthorized();
        if (m.status != MILESTONE_DELIVERED || block.number >= m.reviewBefore
            || m.deliveryHash != expectedDeliveryHash || m.stateVersion != expectedStateVersion) revert InvalidState();
        _finalizeMilestone(o, m, orderId, milestoneId, OUTCOME_APPROVED, m.work, 0, 0);
    }

    function challenge(bytes32 orderId, uint32 milestoneId, bytes32 expectedDeliveryHash, uint64 expectedStateVersion) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (msg.sender != _epochConfigs[o.epochId].sourceSafe) revert Unauthorized();
        if (m.status != MILESTONE_DELIVERED || block.number >= m.reviewBefore
            || m.deliveryHash != expectedDeliveryHash || m.stateVersion != expectedStateVersion) revert InvalidState();
        m.status = MILESTONE_CHALLENGED;
        ++m.stateVersion;
        emit MilestoneChallenged(orderId, milestoneId, m.deliveryHash, m.stateVersion);
    }

    function finalizeNoDelivery(bytes32 orderId, uint32 milestoneId) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (!o.agreed || m.status != MILESTONE_AGREED || block.number < m.deliverBefore) revert InvalidState();
        _finalizeMilestone(o, m, orderId, milestoneId, OUTCOME_NO_DELIVERY, 0, 0, 0);
    }

    function finalizeMonitoringDefault(bytes32 orderId, uint32 milestoneId) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (m.status != MILESTONE_DELIVERED || block.number < m.reviewBefore) revert InvalidState();
        _finalizeMilestone(o, m, orderId, milestoneId, OUTCOME_MONITORING_DEFAULT, m.work, 0, 0);
    }

    function submitRulingVote(bytes32 orderId, uint32 milestoneId, uint256 workAmount, uint64 proposalNonce,
        address voter, bytes calldata signature) external
    {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (m.status != MILESTONE_CHALLENGED || block.number >= m.ruleBefore || workAmount > m.work) revert InvalidState();
        uint8 committeeBit = _committeeBit(o, voter);
        bytes32 digest = _rulingDigest(o, m, orderId, milestoneId, workAmount, proposalNonce);
        _requireAuthorization(voter, digest, signature);
        if (proposalNonce < _rulingNonceFloor[orderId][milestoneId][voter]) revert InvalidNonce();
        uint8 votes = _validRulingVotes(orderId, milestoneId, o, proposalNonce, _rulingVotes[digest]);
        if ((votes & committeeBit) != 0) revert DuplicateVote();
        votes |= committeeBit;
        _rulingVotes[digest] = votes;
        uint8 count = _bitCount(votes);
        emit RulingVote(orderId, milestoneId, digest, voter, count);
        if (count >= 2) _finalizeMilestone(o, m, orderId, milestoneId, OUTCOME_COMMITTEE, workAmount, m.fee, proposalNonce);
    }

    /// @notice A committee member revokes only its own older ruling votes, preventing unilateral quorum reset.
    function invalidateOwnRulingVotesBefore(bytes32 orderId, uint32 milestoneId, uint64 newFloor) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (m.status != MILESTONE_CHALLENGED) revert InvalidState();
        _committeeBit(o, msg.sender);
        uint64 oldFloor = _rulingNonceFloor[orderId][milestoneId][msg.sender];
        if (newFloor <= oldFloor) revert InvalidNonce();
        _rulingNonceFloor[orderId][milestoneId][msg.sender] = newFloor;
        emit RulingVotesInvalidated(orderId, milestoneId, msg.sender, newFloor);
    }

    function finalizeCommitteeTimeout(bytes32 orderId, uint32 milestoneId) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (m.status != MILESTONE_CHALLENGED || block.number < m.ruleBefore) revert InvalidState();
        _finalizeMilestone(o, m, orderId, milestoneId, OUTCOME_COMMITTEE_TIMEOUT, m.timeoutWork, 0, 0);
    }

    function settleMutually(bytes32 orderId, uint32 milestoneId, uint256 workAmount, uint64 proposalNonce,
        bytes calldata buyerSignature, bytes calldata workerSignature) external
    {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (!o.agreed || workAmount > m.work || proposalNonce != m.mutualNonce) revert InvalidState();
        bytes32 digest = _mutualDigest(o, m, orderId, milestoneId, workAmount, proposalNonce);
        _requireAuthorization(_epochConfigs[o.epochId].sourceSafe, digest, buyerSignature);
        _requireAuthorization(o.worker, digest, workerSignature);
        _finalizeMilestone(o, m, orderId, milestoneId, OUTCOME_MUTUAL, workAmount, 0, proposalNonce);
    }

    /// @notice Either source party may revoke its prior mutual consent by advancing the exact proposal nonce.
    function invalidateMutualProposals(bytes32 orderId, uint32 milestoneId, uint64 newNonce) external {
        (SourceStorage.Order storage o, SourceStorage.Milestone storage m) = _liveMilestone(orderId, milestoneId);
        if (msg.sender != o.worker && msg.sender != _epochConfigs[o.epochId].sourceSafe) revert Unauthorized();
        if (newNonce <= m.mutualNonce) revert InvalidNonce();
        m.mutualNonce = newNonce;
        emit MutualProposalsInvalidated(orderId, milestoneId, newNonce, msg.sender);
    }

    function releaseFree(bytes32 epochId, uint256 amount, bytes32 authorizationHash) external {
        SourceStorage.Epoch storage e = _activeEpoch(epochId);
        if (msg.sender != _epochConfigs[epochId].sourceSafe) revert Unauthorized();
        if (amount == 0) revert ZeroAmount();
        if (amount > e.available) revert InsufficientAvailable();
        if (e.activeReturns >= WorkTypes.MAX_ACTIVE_RETURNS) revert CapacityExceeded();
        ++e.activeReturns;
        e.available -= amount;
        e.returned += amount;
        bytes32 evidence = AllocationCodec.releaseHash(epochId, RELEASE_AUTHORIZED_FREE, amount, authorizationHash);
        _appendReturn(epochId, e, amount, evidence);
        _maybeClose(e);
        _assertSlotSafety(e);
        _publish(epochId, e);
    }

    function startDraining(bytes32 epochId) external {
        SourceStorage.Epoch storage e = _epoch(epochId);
        if (e.phase != WorkTypes.ACTIVE) revert InvalidState();
        WorkTypes.EpochConfig storage c = _epochConfigs[epochId];
        if (msg.sender != c.sourceSafe && block.number < c.admissionCutoff) revert Unauthorized();
        e.phase = WorkTypes.DRAINING;
        _maybeClose(e);
        emit DrainingStarted(epochId);
        _publish(epochId, e);
    }

    function sweepAvailable(bytes32 epochId) external returns (uint256 amount) {
        SourceStorage.Epoch storage e = _epoch(epochId);
        if (e.phase != WorkTypes.DRAINING) revert InvalidState();
        amount = e.available;
        if (amount == 0) {
            _maybeClose(e);
            return 0;
        }
        if (e.drainingReturns >= WorkTypes.MAX_DRAINING_RETURNS) revert CapacityExceeded();
        ++e.drainingReturns;
        e.available = 0;
        e.returned += amount;
        bytes32 evidence = AllocationCodec.releaseHash(epochId, RELEASE_DRAINING_SWEEP, amount, bytes32(0));
        _appendReturn(epochId, e, amount, evidence);
        _maybeClose(e);
        _assertSlotSafety(e);
        _publish(epochId, e);
    }

    function republishCheckpoint(bytes32 epochId) external {
        SourceStorage.Epoch storage e = _epoch(epochId);
        _publish(epochId, e);
    }

    function epochConfig(bytes32 epochId) external view returns (WorkTypes.EpochConfig memory) {
        _epoch(epochId);
        return _epochConfigs[epochId];
    }

    function epochState(bytes32 epochId) external view returns (EpochStateView memory v) {
        SourceStorage.Epoch storage e = _epoch(epochId);
        v = EpochStateView(e.exists && !e.expiredUninitialized, e.expiredUninitialized, e.tree.count, e.tree.root,
            e.available, e.unresolved, e.earned, e.returned, e.phase, e.reservations,
            e.unresolvedMilestones, e.activeReturns, e.drainingReturns);
    }

    function order(bytes32 orderId) external view returns (OrderData memory v) {
        SourceStorage.Order storage o = _order(orderId);
        v = OrderData(o.exists, o.agreed, o.epochId, o.termsHash, o.worker, o.claimOwner, o.destination,
            o.feeOwner, o.feeDestination, o.committee, o.acceptBefore, o.nonce, o.milestoneCount, o.finalizedCount);
    }

    function milestone(bytes32 orderId, uint32 milestoneId) external view returns (MilestoneData memory v) {
        SourceStorage.Order storage o = _order(orderId);
        if (milestoneId >= o.milestoneCount) revert InvalidTerms();
        SourceStorage.Milestone storage m = _milestones[orderId][milestoneId];
        v = MilestoneData(m.status, m.outcome, m.stateVersion, m.deliveryHash, m.work, m.fee,
            m.timeoutWork, m.deliverBefore, m.reviewBefore, m.ruleBefore, m.mutualNonce,
            m.finalWork, m.finalFee, m.decisionHash, m.evidenceHash);
    }

    function allocationAt(bytes32 epochId, uint32 treeIndex) external view returns (WorkTypes.Allocation memory) {
        return _epoch(epochId).tree.at(treeIndex);
    }

    function leafHashAt(bytes32 epochId, uint32 treeIndex) external view returns (bytes32) {
        return AllocationCodec.leafHash(_epoch(epochId).tree.at(treeIndex));
    }

    function quoteNonceState(bytes32 epochId, address worker, uint64 nonce) external view returns (uint8) {
        return _nonceState[epochId][worker][nonce];
    }

    function rulingVoteMask(bytes32 proposalDigest) external view returns (uint8) { return _rulingVotes[proposalDigest]; }

    function conservationHolds(bytes32 epochId) external view returns (bool) {
        SourceStorage.Epoch storage e = _epoch(epochId);
        return _epochConfigs[epochId].cap == e.available + e.unresolved + e.earned + e.returned;
    }

    function slotSafetyHolds(bytes32 epochId) external view returns (bool) {
        SourceStorage.Epoch storage e = _epoch(epochId);
        return _slotRequirement(e) <= WorkTypes.TREE_CAPACITY;
    }

    function _reserveOrder(WorkTypes.OrderTerms calldata terms, bytes32 orderId, SourceStorage.Epoch storage e, bool agreed) internal {
        if (_orders[orderId].exists) revert InvalidState();
        uint32 count = uint32(terms.milestones.length);
        if (e.reservations + count > WorkTypes.MAX_MILESTONES) revert CapacityExceeded();
        uint256 total = SourcePolicyV1Lib.validateTerms(terms, _epochConfigs[terms.epochId], block.number);
        if (total > e.available) revert InsufficientAvailable();
        e.reservations += count;
        e.unresolvedMilestones += count;
        e.available -= total;
        e.unresolved += total;

        SourceStorage.Order storage o = _orders[orderId];
        o.exists = true;
        o.agreed = agreed;
        o.epochId = terms.epochId;
        o.termsHash = terms.termsHash;
        o.worker = terms.worker;
        o.claimOwner = terms.claimOwner;
        o.destination = terms.destination;
        o.feeOwner = terms.feeOwner;
        o.feeDestination = terms.feeDestination;
        o.committee = terms.committee;
        o.acceptBefore = terms.acceptBefore;
        o.nonce = terms.nonce;
        o.milestoneCount = count;
        for (uint32 i; i < count; ++i) {
            WorkTypes.MilestoneTerms calldata mt = terms.milestones[i];
            SourceStorage.Milestone storage m = _milestones[orderId][i];
            m.status = agreed ? MILESTONE_AGREED : MILESTONE_PENDING;
            m.stateVersion = agreed ? 1 : 0;
            m.work = mt.work;
            m.fee = mt.fee;
            m.timeoutWork = mt.timeoutWork;
            m.deliverBefore = mt.deliverBefore;
            m.reviewBefore = mt.reviewBefore;
            m.ruleBefore = mt.ruleBefore;
            m.mutualNonce = 1;
        }
        _assertConservation(terms.epochId, e);
        _assertSlotSafety(e);
        emit OrderReserved(terms.epochId, orderId, terms.worker, agreed);
        if (agreed) emit OrderAgreed(terms.epochId, orderId);
    }

    function _finalizePendingOrder(bytes32 orderId, SourceStorage.Epoch storage e, uint8 outcome) internal {
        SourceStorage.Order storage o = _order(orderId);
        if (o.agreed) revert InvalidState();
        uint256 restored;
        for (uint32 i; i < o.milestoneCount; ++i) {
            SourceStorage.Milestone storage m = _milestones[orderId][i];
            if (m.status != MILESTONE_PENDING) revert InvalidState();
            m.status = MILESTONE_FINAL;
            m.outcome = outcome;
            restored += m.work + m.fee;
        }
        o.finalizedCount = o.milestoneCount;
        e.unresolvedMilestones -= o.milestoneCount;
        e.unresolved -= restored;
        e.available += restored;
        _maybeClose(e);
        _assertConservation(o.epochId, e);
        _assertSlotSafety(e);
        emit PendingOrderFinalized(o.epochId, orderId, outcome);
    }

    function _finalizeMilestone(SourceStorage.Order storage o, SourceStorage.Milestone storage m, bytes32 orderId, uint32 milestoneId,
        uint8 outcome, uint256 workAmount, uint256 feeAmount, uint64 proposalNonce) internal
    {
        SourceAccountingLib.finalizeMilestone(_epochs[o.epochId], o, m, _epochConfigs[o.epochId],
            orderId, milestoneId, outcome, workAmount, feeAmount, proposalNonce);
    }

    function _appendReturn(bytes32 epochId, SourceStorage.Epoch storage e, uint256 amount, bytes32 evidenceHash) internal {
        WorkTypes.EpochConfig storage c = _epochConfigs[epochId];
        _append(epochId, e, WorkTypes.Allocation({epochId: epochId, allocationId: 0, treeIndex: 0,
            kind: WorkTypes.RETURN, orderId: bytes32(0), milestoneId: 0, role: 0, asset: c.asset,
            amount: amount, claimOwner: c.refundBeneficiary, destination: c.refundBeneficiary,
            policyHash: c.policyHash, evidenceHash: evidenceHash}));
    }

    function _append(bytes32, SourceStorage.Epoch storage e, WorkTypes.Allocation memory proposed) internal {
        WorkTypes.Allocation memory a = e.tree.append(proposed);
        emit AllocationCreated(a.epochId, a.allocationId, a.treeIndex, a.kind, a.orderId, a.milestoneId,
            a.role, a.asset, a.amount, a.claimOwner, a.destination, a.policyHash, a.evidenceHash);
    }

    function _publish(bytes32 epochId, SourceStorage.Epoch storage e) internal {
        emit CheckpointPublished(epochId, e.tree.root, e.tree.count, e.earned, e.returned, e.phase);
    }

    function _maybeClose(SourceStorage.Epoch storage e) internal {
        if (e.available == 0 && e.unresolved == 0) e.phase = WorkTypes.CLOSED;
    }

    function _assertConservation(bytes32 epochId, SourceStorage.Epoch storage e) internal view {
        if (_epochConfigs[epochId].cap != e.available + e.unresolved + e.earned + e.returned) revert InvalidState();
    }

    function _assertSlotSafety(SourceStorage.Epoch storage e) internal view {
        if (_slotRequirement(e) > WorkTypes.TREE_CAPACITY) revert CapacityExceeded();
    }

    function _slotRequirement(SourceStorage.Epoch storage e) internal view returns (uint256 required) {
        required = uint256(e.tree.count) + uint256(e.unresolvedMilestones) * 2 + 1;
        if (e.phase == WorkTypes.ACTIVE) required += WorkTypes.MAX_ACTIVE_RETURNS - e.activeReturns;
        if (e.phase != WorkTypes.CLOSED) required += WorkTypes.MAX_DRAINING_RETURNS - e.drainingReturns;
    }

    function _committeeBit(SourceStorage.Order storage o, address voter) internal view returns (uint8) {
        if (voter == o.committee[0]) return 1;
        if (voter == o.committee[1]) return 2;
        if (voter == o.committee[2]) return 4;
        revert Unauthorized();
    }

    function _bitCount(uint8 value) internal pure returns (uint8 count) {
        if ((value & 1) != 0) ++count;
        if ((value & 2) != 0) ++count;
        if ((value & 4) != 0) ++count;
    }

    function _validRulingVotes(
        bytes32 orderId,
        uint32 milestoneId,
        SourceStorage.Order storage o,
        uint64 proposalNonce,
        uint8 votes
    ) internal view returns (uint8 valid) {
        if ((votes & 1) != 0 && proposalNonce >= _rulingNonceFloor[orderId][milestoneId][o.committee[0]]) valid |= 1;
        if ((votes & 2) != 0 && proposalNonce >= _rulingNonceFloor[orderId][milestoneId][o.committee[1]]) valid |= 2;
        if ((votes & 4) != 0 && proposalNonce >= _rulingNonceFloor[orderId][milestoneId][o.committee[2]]) valid |= 4;
    }

    function _mutualDigest(SourceStorage.Order storage o, SourceStorage.Milestone storage m, bytes32 orderId, uint32 milestoneId,
        uint256 workAmount, uint64 proposalNonce) internal view returns (bytes32)
    {
        return SourceSignatureLib.proposalDigest(address(this), true, o.epochId, orderId, milestoneId,
            m.deliveryHash, m.stateVersion, workAmount, proposalNonce);
    }

    function _rulingDigest(SourceStorage.Order storage o, SourceStorage.Milestone storage m, bytes32 orderId, uint32 milestoneId,
        uint256 workAmount, uint64 proposalNonce) internal view returns (bytes32)
    {
        return SourceSignatureLib.proposalDigest(address(this), false, o.epochId, orderId, milestoneId,
            m.deliveryHash, m.stateVersion, workAmount, proposalNonce);
    }

    function _requireAuthorization(address signer, bytes32 digest, bytes calldata signature) internal view {
        SourceSignatureLib.requireAuthorization(signer, msg.sender, digest, signature);
    }

    function _epoch(bytes32 epochId) internal view returns (SourceStorage.Epoch storage e) {
        e = _epochs[epochId];
        if (!e.exists) revert UnknownEpoch();
    }

    function _activeEpoch(bytes32 epochId) internal view returns (SourceStorage.Epoch storage e) {
        e = _epoch(epochId);
        if (e.phase != WorkTypes.ACTIVE || block.number >= _epochConfigs[epochId].admissionCutoff) revert InvalidState();
    }

    function _order(bytes32 orderId) internal view returns (SourceStorage.Order storage o) {
        o = _orders[orderId];
        if (!o.exists) revert UnknownOrder();
    }

    function _liveMilestone(bytes32 orderId, uint32 milestoneId)
        internal view returns (SourceStorage.Order storage o, SourceStorage.Milestone storage m)
    {
        o = _order(orderId);
        if (milestoneId >= o.milestoneCount) revert InvalidTerms();
        m = _milestones[orderId][milestoneId];
        if (m.status == MILESTONE_FINAL || m.status == MILESTONE_PENDING) revert InvalidState();
    }
}
