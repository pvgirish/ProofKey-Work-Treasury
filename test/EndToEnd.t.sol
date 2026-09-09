// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {ISafe, ISafeProxyFactory} from "./safe/ISafe.sol";
import {WorkTypes} from "../src/WorkTypes.sol";
import {AllocationCodec} from "../src/AllocationCodec.sol";
import {SourceCoordinator} from "../src/SourceCoordinator.sol";
import {NativeReceiptAuth} from "../src/NativeReceiptAuth.sol";
import {WorkTreasury} from "../src/WorkTreasury.sol";
import {PaidInvoiceBook} from "../src/PaidInvoiceBook.sol";

/// @title Complete local architecture integration
/// @notice Actual SourceCoordinator policy transitions, actual Safe v1.4.1 2-of-3 execution and
///         exact emitted source logs are used. Only the cross-chain native verifier is VM-mocked at
///         its fixed production address. Source and target intentionally share this local chain id;
///         this is not presented as a live two-chain or native-proof result.
contract EndToEndTest is Test {
    uint64 constant SOURCE_CHAIN_KEY = 1;
    bytes32 constant CHECKPOINT_EVENT = keccak256("CheckpointPublished(bytes32,bytes32,uint32,uint256,uint256,uint8)");
    bytes32 constant ALLOCATION_EVENT = keccak256(
        "AllocationCreated(bytes32,uint64,uint32,uint8,bytes32,uint32,uint8,address,uint256,address,address,bytes32,bytes32)"
    );

    uint256 constant X_KEY = 0xA1;
    uint256 constant Y_KEY = 0xB2;
    uint256 constant Z_KEY = 0xC3;
    uint256 constant W_KEY = 0xD4;
    uint256 constant WORKER_A_KEY = 0xA01;
    uint256 constant WORKER_B_KEY = 0xB01;
    uint256 constant WORKER_C_KEY = 0xC01;
    uint256 constant COMMITTEE_1_KEY = 0xDD1;
    uint256 constant COMMITTEE_2_KEY = 0xDD2;
    uint256 constant COMMITTEE_3_KEY = 0xDD3;

    address X;
    address Y;
    address Z;
    address W;
    address workerA;
    address workerB;
    address workerC;
    address committee1;
    address committee2;
    address committee3;
    address sponsor = address(0x5000);
    address refund = address(0x6000);
    address feeOwner = address(0xFEE0);

    SourceCoordinator source;
    WorkTreasury treasury;
    ISafe safe;

    function setUp() public {
        X = vm.addr(X_KEY);
        Y = vm.addr(Y_KEY);
        Z = vm.addr(Z_KEY);
        W = vm.addr(W_KEY);
        workerA = vm.addr(WORKER_A_KEY);
        workerB = vm.addr(WORKER_B_KEY);
        workerC = vm.addr(WORKER_C_KEY);
        committee1 = vm.addr(COMMITTEE_1_KEY);
        committee2 = vm.addr(COMMITTEE_2_KEY);
        committee3 = vm.addr(COMMITTEE_3_KEY);
        source = new SourceCoordinator();
        treasury = new WorkTreasury(block.chainid, SOURCE_CHAIN_KEY, address(source));
        safe = _deploySafe();
        vm.deal(sponsor, 1_000);
        _mockNativeVerifier();
    }

    function test_locked120Journey_realSourceSafeRotation_cachedRootAndCrossRouteReplay() public {
        WorkTypes.EpochConfig memory config = _config(120, 1);
        bytes32 epochId = source.computeEpochId(config);
        vm.prank(sponsor);
        treasury.fundEpoch{value: 120}(config);
        _safeExec(address(source), abi.encodeCall(source.initializeEpoch, (config)), _keys(X_KEY, Y_KEY));

        WorkTypes.OrderTerms memory aTerms = _terms(epochId, workerA, 30, 0, 1);
        bytes32 orderA = source.computeOrderId(aTerms);
        _safeExec(address(source), abi.encodeCall(source.createOffer, (aTerms)), _keys(X_KEY, Y_KEY));
        vm.prank(workerA);
        source.acceptOffer(orderA, "");

        WorkTypes.OrderTerms memory bTerms = _terms(epochId, workerB, 40, 0, 2);
        bytes32 orderB = source.computeOrderId(bTerms);
        _safeExec(address(source), abi.encodeCall(source.createOffer, (bTerms)), _keys(X_KEY, Y_KEY));
        vm.prank(workerB);
        source.acceptOffer(orderB, "");
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        assertEq(state.available, 50);
        assertEq(state.unresolved, 70);

        vm.prank(workerA);
        source.deliver(orderA, 0, keccak256("A delivery"));
        SourceCoordinator.MilestoneData memory milestoneA = source.milestone(orderA, 0);
        vm.recordLogs();
        _safeExec(
            address(source),
            abi.encodeCall(source.approve, (orderA, 0, milestoneA.deliveryHash, milestoneA.stateVersion)),
            _keys(X_KEY, Y_KEY)
        );
        Vm.Log[] memory aApprovalLogs = vm.getRecordedLogs();
        WorkTypes.Allocation memory workA = source.allocationAt(epochId, 0);
        assertEq(workA.amount, 30);

        // Return 50 while B is still unresolved, then authenticate that exact emitted checkpoint
        // and recognize only the RETURN. A's already-earned WORK remains unseen on the target.
        vm.recordLogs();
        _safeExec(
            address(source),
            abi.encodeCall(source.releaseFree, (epochId, 50, keccak256("authorized free release"))),
            _keys(X_KEY, Y_KEY)
        );
        Vm.Log[] memory releaseLogs = vm.getRecordedLogs();
        state = source.epochState(epochId);
        assertEq(state.earned, 30);
        assertEq(state.returned, 50);
        assertEq(state.unresolved, 40);
        bytes32[] memory return50Proof = _sourceProof(epochId, 1);
        bytes memory releaseReceipt = _encodedReceipt(releaseLogs);
        uint32 releaseCheckpointOrdinal = _ordinal(releaseLogs, address(source), CHECKPOINT_EVENT, 0);
        (, bytes32 prefixCheckpointId) = treasury.authenticateAndRecognizeCheckpoint(
            _proof(100, releaseReceipt), releaseCheckpointOrdinal, source.allocationAt(epochId, 1), return50Proof
        );
        assertTrue(prefixCheckpointId != bytes32(0));
        assertEq(treasury.freeBalance(refund), 50);
        assertFalse(treasury.recognizedEconomicId(treasury.economicId(epochId, 1)));

        // B mutually earns 25; its other 15 becomes source purchasing capacity again.
        bytes32 mutual = source.mutualDigest(orderB, 0, 25, 1);
        bytes memory workerBSig = _signDigest(WORKER_B_KEY, mutual);
        _safeExec(
            address(source),
            abi.encodeCall(source.settleMutually, (orderB, 0, 25, 1, bytes(""), workerBSig)),
            _keys(X_KEY, Y_KEY)
        );
        WorkTypes.Allocation memory workB = source.allocationAt(epochId, 2);
        assertEq(workB.amount, 25);
        state = source.epochState(epochId);
        assertEq(state.available, 15);
        assertEq(state.earned, 55);

        // Rotate the real Safe owner set. A signature set containing removed owner Z fails at the
        // current nonce; the new X+W set can commission C. The epoch still names the same Safe.
        bytes memory rotate = abi.encodeCall(ISafe.swapOwner, (_prevOwnerOf(Z), Z, W));
        _safeExec(address(safe), rotate, _keys(X_KEY, Y_KEY));
        assertFalse(safe.isOwner(Z));
        assertTrue(safe.isOwner(W));
        assertEq(source.epochConfig(epochId).sourceSafe, address(safe));

        WorkTypes.OrderTerms memory cTerms = _terms(epochId, workerC, 15, 0, 3);
        bytes memory createC = abi.encodeCall(source.createOffer, (cTerms));
        bytes memory removedOwnerSignatures = _safeSign(address(source), createC, _keys(X_KEY, Z_KEY));
        vm.expectRevert(bytes("GS026"));
        _safeExecWithSignatures(address(source), createC, removedOwnerSignatures);
        bytes32 orderC = source.computeOrderId(cTerms);
        _safeExec(address(source), createC, _keys(X_KEY, W_KEY));
        vm.prank(workerC);
        source.acceptOffer(orderC, "");

        // C creates no earning leaf. No target funding transaction is needed to reuse the restored
        // 15. After no-delivery, draining returns the same 15 and closes the source epoch.
        vm.roll(cTerms.milestones[0].deliverBefore);
        source.finalizeNoDelivery(orderC, 0);
        _safeExec(address(source), abi.encodeCall(source.startDraining, (epochId)), _keys(X_KEY, W_KEY));
        vm.recordLogs();
        source.sweepAvailable(epochId);
        Vm.Log[] memory finalSweepLogs = vm.getRecordedLogs();
        state = source.epochState(epochId);
        assertEq(state.available, 0);
        assertEq(state.unresolved, 0);
        assertEq(state.earned, 55);
        assertEq(state.returned, 65);
        assertEq(state.phase, WorkTypes.CLOSED);
        assertEq(state.leafCount, 4);

        bytes memory finalReceipt = _encodedReceipt(finalSweepLogs);
        uint32 finalCheckpointOrdinal = _ordinal(finalSweepLogs, address(source), CHECKPOINT_EVENT, 0);
        bytes32[] memory return15Proof = _sourceProof(epochId, 3);
        (, bytes32 finalCheckpointId) = treasury.authenticateAndRecognizeCheckpoint(
            _proof(101, finalReceipt), finalCheckpointOrdinal, source.allocationAt(epochId, 3), return15Proof
        );
        assertEq(treasury.freeBalance(refund), 65);

        // Native proof access is deliberately disabled. Exported allocation + siblings under the
        // already cached final root still recognize both delayed workers for exactly 55.
        vm.clearMockedCalls();
        treasury.recognizeFromCheckpoint(finalCheckpointId, workA, _sourceProof(epochId, 0));
        treasury.recognizeFromCheckpoint(finalCheckpointId, workB, _sourceProof(epochId, 2));
        assertEq(treasury.claim(epochId, 1).allocation.amount, 30);
        assertEq(treasury.claim(epochId, 3).allocation.amount, 25);
        assertEq(treasury.epochAccount(epochId).reserve, 0);
        treasury.withdrawFor(epochId, 1);
        treasury.withdrawFor(epochId, 3);
        assertEq(workerA.balance, 30);
        assertEq(workerB.balance, 25);

        // Root -> receipt replay remains an economic replay even after proof access returns and the
        // exact source AllocationCreated log from A's real approval is authenticated.
        _mockNativeVerifier();
        bytes memory aReceipt = _encodedReceipt(aApprovalLogs);
        uint32 aAllocationOrdinal = _ordinal(aApprovalLogs, address(source), ALLOCATION_EVENT, 0);
        vm.expectRevert();
        treasury.authenticateAndRecognizeReceipt(_proof(102, aReceipt), aAllocationOrdinal);
        assertEq(treasury.totalCreditedDeposits(), 120);
        assertEq(treasury.liveLiabilities() + treasury.cumulativeWithdrawals(), 120);
    }

    function test_actualSourceWorkFeeReceiptNeedsNoSiblings_andReceiptToRootReplayFails() public {
        WorkTypes.EpochConfig memory config = _config(20, 2);
        bytes32 epochId = source.computeEpochId(config);
        vm.prank(sponsor);
        treasury.fundEpoch{value: 20}(config);
        _safeExec(address(source), abi.encodeCall(source.initializeEpoch, (config)), _keys(X_KEY, Y_KEY));

        WorkTypes.OrderTerms memory terms = _terms(epochId, workerA, 10, 3, 10);
        bytes32 orderId = source.computeOrderId(terms);
        _safeExec(address(source), abi.encodeCall(source.createOffer, (terms)), _keys(X_KEY, Y_KEY));
        vm.prank(workerA);
        source.acceptOffer(orderId, "");
        vm.prank(workerA);
        source.deliver(orderId, 0, keccak256("challenged delivery"));
        SourceCoordinator.MilestoneData memory delivered = source.milestone(orderId, 0);
        _safeExec(
            address(source),
            abi.encodeCall(source.challenge, (orderId, 0, delivered.deliveryHash, delivered.stateVersion)),
            _keys(X_KEY, Y_KEY)
        );

        vm.prank(committee1);
        source.submitRulingVote(orderId, 0, 7, 9, committee1, "");
        vm.recordLogs();
        vm.prank(committee2);
        source.submitRulingVote(orderId, 0, 7, 9, committee2, "");
        Vm.Log[] memory rulingLogs = vm.getRecordedLogs();
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        assertEq(state.leafCount, 2);
        assertEq(state.earned, 10);

        bytes memory receipt = _encodedReceipt(rulingLogs);
        (NativeReceiptAuth.SourcePosition memory position,) = treasury.authenticateTransaction(_proof(200, receipt));
        uint32 workOrdinal = _ordinal(rulingLogs, address(source), ALLOCATION_EVENT, 0);
        uint32 feeOrdinal = _ordinal(rulingLogs, address(source), ALLOCATION_EVENT, 1);
        treasury.recognizeFromReceipt(position, receipt, workOrdinal);
        treasury.recognizeFromReceipt(position, receipt, feeOrdinal);
        assertEq(treasury.claim(epochId, 1).allocation.kind, WorkTypes.WORK);
        assertEq(treasury.claim(epochId, 2).allocation.kind, WorkTypes.FEE);

        uint32 checkpointOrdinal = _ordinal(rulingLogs, address(source), CHECKPOINT_EVENT, 0);
        bytes32 checkpointId = treasury.importCheckpoint(position, receipt, checkpointOrdinal);
        WorkTypes.Allocation memory replayedWork = source.allocationAt(epochId, 0);
        bytes32[] memory replayedWorkProof = _sourceProof(epochId, 0);
        vm.expectRevert();
        treasury.recognizeFromCheckpoint(checkpointId, replayedWork, replayedWorkProof);
    }

    function _config(uint256 cap, uint64 nonce) internal view returns (WorkTypes.EpochConfig memory c) {
        c = WorkTypes.EpochConfig({
            sourceChainId: block.chainid,
            sourceChainKey: SOURCE_CHAIN_KEY,
            sourceCoordinator: address(source),
            sourceVersion: WorkTypes.SOURCE_VERSION,
            targetChainId: block.chainid,
            targetTreasury: address(treasury),
            schemaVersion: WorkTypes.SCHEMA_VERSION,
            sourceSafe: address(safe),
            sponsor: sponsor,
            refundBeneficiary: refund,
            asset: address(0),
            cap: cap,
            policyHash: WorkTypes.POLICY_HASH,
            initializationCutoff: uint64(block.number + 100),
            admissionCutoff: uint64(block.number + 1_000),
            maxMilestones: WorkTypes.MAX_MILESTONES,
            maxActiveReturns: WorkTypes.MAX_ACTIVE_RETURNS,
            maxDrainingReturns: WorkTypes.MAX_DRAINING_RETURNS,
            treeDepth: WorkTypes.TREE_DEPTH,
            nonce: nonce
        });
    }

    function _terms(bytes32 epochId, address worker, uint256 work, uint256 fee, uint64 nonce)
        internal
        view
        returns (WorkTypes.OrderTerms memory t)
    {
        WorkTypes.MilestoneTerms[] memory milestones = new WorkTypes.MilestoneTerms[](1);
        milestones[0] = WorkTypes.MilestoneTerms({
            work: work,
            fee: fee,
            timeoutWork: 0,
            deliverBefore: uint64(block.number + 40),
            reviewBefore: uint64(block.number + 60),
            ruleBefore: uint64(block.number + 80)
        });
        t = WorkTypes.OrderTerms({
            epochId: epochId,
            termsHash: keccak256(abi.encode("terms", epochId, worker, work, fee, nonce)),
            worker: worker,
            claimOwner: worker,
            destination: worker,
            feeOwner: feeOwner,
            feeDestination: feeOwner,
            committee: [committee1, committee2, committee3],
            acceptBefore: uint64(block.number + 20),
            nonce: nonce,
            milestones: milestones
        });
    }

    function _deploySafe() internal returns (ISafe deployed) {
        address singleton = _deployArtifact("vendor/safe/Safe.json");
        ISafeProxyFactory factory = ISafeProxyFactory(_deployArtifact("vendor/safe/SafeProxyFactory.json"));
        address[] memory owners = new address[](3);
        owners[0] = X;
        owners[1] = Y;
        owners[2] = Z;
        bytes memory initializer = abi.encodeCall(
            ISafe.setup, (owners, 2, address(0), bytes(""), address(0), address(0), 0, payable(address(0)))
        );
        deployed = ISafe(factory.createProxyWithNonce(singleton, initializer, 1));
        assertEq(deployed.VERSION(), "1.4.1");
        assertEq(deployed.getThreshold(), 2);
    }

    function _deployArtifact(string memory path) internal returns (address deployed) {
        bytes memory code = vm.parseJsonBytes(vm.readFile(path), ".bytecode");
        assembly {
            deployed := create(0, add(code, 32), mload(code))
        }
        require(deployed != address(0), "artifact deployment failed");
    }

    function _keys(uint256 first, uint256 second) internal pure returns (uint256[] memory keys) {
        keys = new uint256[](2);
        keys[0] = first;
        keys[1] = second;
    }

    function _safeSign(address to, bytes memory data, uint256[] memory keys)
        internal
        view
        returns (bytes memory signatures)
    {
        bytes32 digest = safe.getTransactionHash(
            to, 0, data, ISafe.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        if (vm.addr(keys[0]) > vm.addr(keys[1])) (keys[0], keys[1]) = (keys[1], keys[0]);
        for (uint256 i; i < keys.length; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], digest);
            signatures = abi.encodePacked(signatures, r, s, v);
        }
    }

    function _safeExec(address to, bytes memory data, uint256[] memory keys) internal {
        bytes memory signatures = _safeSign(to, data, keys);
        assertTrue(_safeExecWithSignatures(to, data, signatures), "Safe execution returned false");
    }

    function _safeExecWithSignatures(address to, bytes memory data, bytes memory signatures) internal returns (bool) {
        return
            safe.execTransaction(
                to, 0, data, ISafe.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
            );
    }

    function _prevOwnerOf(address owner) internal view returns (address previous) {
        address[] memory owners = safe.getOwners();
        previous = address(0x1);
        for (uint256 i; i < owners.length; ++i) {
            if (owners[i] == owner) return previous;
            previous = owners[i];
        }
        revert("owner not found");
    }

    function _signDigest(uint256 key, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _mockNativeVerifier() internal {
        vm.mockCall(address(NativeQueryVerifierLib.getVerifier()), bytes(""), abi.encode(uint256(1)));
    }

    function _encodedReceipt(Vm.Log[] memory recorded) internal view returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](recorded.length);
        for (uint256 i; i < recorded.length; ++i) {
            logs[i] = EvmV1Decoder.LogEntryTuple({
                address_: recorded[i].emitter, topics: recorded[i].topics, data: recorded[i].data
            });
        }
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(100_000), address(safe), false, address(source), uint256(0), bytes(""));
        chunks[1] = abi.encode(uint128(1), uint256(27), bytes32(0), bytes32(0));
        chunks[2] = abi.encode(uint8(1), uint64(42_000), logs, bytes(""));
        return abi.encode(uint8(0), chunks);
    }

    function _proof(uint64 height, bytes memory receipt)
        internal
        pure
        returns (NativeReceiptAuth.SingleProof memory p)
    {
        p.blockHeight = height;
        p.encodedTransaction = receipt;
        p.merkleProof.root = keccak256(abi.encode(height));
        p.continuityProof.lowerEndpointDigest = keccak256("local-only");
    }

    function _ordinal(Vm.Log[] memory logs, address emitter, bytes32 signature, uint256 occurrence)
        internal
        pure
        returns (uint32)
    {
        uint256 seen;
        for (uint32 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics.length != 0 && logs[i].topics[0] == signature) {
                if (seen == occurrence) return i;
                ++seen;
            }
        }
        revert("log not found");
    }

    /// @dev Independent full-tree reconstruction from the actual source getters. It does not call
    ///      AllocationTree.verify or the frontier updater.
    function _sourceProof(bytes32 epochId, uint32 leafIndex) internal view returns (bytes32[] memory siblings) {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        require(leafIndex < state.leafCount, "proof index");
        bytes32[] memory nodes = new bytes32[](WorkTypes.TREE_CAPACITY);
        bytes32 empty = AllocationCodec.emptyLeaf();
        for (uint32 i; i < WorkTypes.TREE_CAPACITY; ++i) {
            nodes[i] = i < state.leafCount ? AllocationCodec.leafHash(source.allocationAt(epochId, i)) : empty;
        }
        siblings = new bytes32[](WorkTypes.TREE_DEPTH);
        uint256 index = leafIndex;
        uint256 width = WorkTypes.TREE_CAPACITY;
        for (uint256 level; level < WorkTypes.TREE_DEPTH; ++level) {
            siblings[level] = nodes[index ^ 1];
            for (uint256 i; i < width; i += 2) {
                nodes[i / 2] = AllocationCodec.nodeHash(nodes[i], nodes[i + 1]);
            }
            index >>= 1;
            width >>= 1;
        }
        assertEq(nodes[0], state.root);
    }
}
