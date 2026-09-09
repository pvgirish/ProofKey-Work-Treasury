// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {NativeQueryVerifierLib} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {WorkTypes} from "../src/WorkTypes.sol";
import {AllocationCodec} from "../src/AllocationCodec.sol";
import {SourceCoordinator} from "../src/SourceCoordinator.sol";
import {NativeReceiptAuth} from "../src/NativeReceiptAuth.sol";
import {WorkTreasury} from "../src/WorkTreasury.sol";

/// @notice Hypothesis-driven source/target adversarial tests. The source and target deliberately
///         share Foundry's local chain id. Only the fixed 0x0FD2 native verifier is VM-mocked.
contract AdversarialIntegrationTest is Test {
    uint64 internal constant SOURCE_CHAIN_KEY = 1;
    bytes32 internal constant ALLOCATION_EVENT = keccak256(
        "AllocationCreated(bytes32,uint64,uint32,uint8,bytes32,uint32,uint8,address,uint256,address,address,bytes32,bytes32)"
    );
    bytes32 internal constant CHECKPOINT_EVENT =
        keccak256("CheckpointPublished(bytes32,bytes32,uint32,uint256,uint256,uint8)");

    uint256 internal constant BUYER_KEY = 0xB0A;
    uint256 internal constant WORKER_KEY = 0xA11CE;
    uint256 internal constant COMMITTEE_1_KEY = 0xC01;
    uint256 internal constant COMMITTEE_2_KEY = 0xC02;
    uint256 internal constant COMMITTEE_3_KEY = 0xC03;

    address internal buyer;
    address internal worker;
    address internal committee1;
    address internal committee2;
    address internal committee3;
    address internal sponsor = address(0x5000);
    address internal refund = address(0x6000);
    address internal feeOwner = address(0xFEE0);

    SourceCoordinator internal source;
    WorkTreasury internal treasury;

    function setUp() public {
        buyer = vm.addr(BUYER_KEY);
        worker = vm.addr(WORKER_KEY);
        committee1 = vm.addr(COMMITTEE_1_KEY);
        committee2 = vm.addr(COMMITTEE_2_KEY);
        committee3 = vm.addr(COMMITTEE_3_KEY);
        source = new SourceCoordinator();
        treasury = new WorkTreasury(block.chainid, SOURCE_CHAIN_KEY, address(source));
        vm.deal(sponsor, 1_000 ether);
        vm.mockCall(address(NativeQueryVerifierLib.getVerifier()), bytes(""), abi.encode(uint256(1)));
    }

    function test_exactDeadlinesSelectOnlyTheSpecifiedTerminalTransition() public {
        (bytes32 epochId,) = _initialize(200, 1, false);

        WorkTypes.OrderTerms memory pending = _terms(epochId, 1, 10, 1, 4);
        vm.prank(buyer);
        bytes32 pendingId = source.createOffer(pending);
        vm.roll(pending.acceptBefore);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(worker);
        source.acceptOffer(pendingId, "");
        source.expirePendingOrder(pendingId);
        assertEq(source.milestone(pendingId, 0).outcome, 2);

        WorkTypes.OrderTerms memory noDelivery = _terms(epochId, 2, 10, 1, 4);
        bytes32 noDeliveryId = _accept(noDelivery);
        vm.roll(noDelivery.milestones[0].deliverBefore);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(worker);
        source.deliver(noDeliveryId, 0, keccak256("too late"));
        source.finalizeNoDelivery(noDeliveryId, 0);
        assertEq(source.milestone(noDeliveryId, 0).outcome, 3);

        WorkTypes.OrderTerms memory monitored = _terms(epochId, 3, 10, 1, 4);
        bytes32 monitoredId = _accept(monitored);
        bytes32 delivery = keccak256("delivered");
        vm.prank(worker);
        source.deliver(monitoredId, 0, delivery);
        SourceCoordinator.MilestoneData memory delivered = source.milestone(monitoredId, 0);
        vm.roll(monitored.milestones[0].reviewBefore);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(buyer);
        source.approve(monitoredId, 0, delivered.deliveryHash, delivered.stateVersion);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(buyer);
        source.challenge(monitoredId, 0, delivered.deliveryHash, delivered.stateVersion);
        source.finalizeMonitoringDefault(monitoredId, 0);
        assertEq(source.milestone(monitoredId, 0).outcome, 5);

        WorkTypes.OrderTerms memory ruled = _terms(epochId, 4, 10, 1, 4);
        bytes32 ruledId = _accept(ruled);
        vm.prank(worker);
        source.deliver(ruledId, 0, keccak256("challenge"));
        SourceCoordinator.MilestoneData memory challengeable = source.milestone(ruledId, 0);
        vm.prank(buyer);
        source.challenge(ruledId, 0, challengeable.deliveryHash, challengeable.stateVersion);
        vm.roll(ruled.milestones[0].ruleBefore);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(committee1);
        source.submitRulingVote(ruledId, 0, 4, 7, committee1, "");
        source.finalizeCommitteeTimeout(ruledId, 0);
        assertEq(source.milestone(ruledId, 0).outcome, 7);
        assertTrue(source.conservationHolds(epochId));
    }

    function test_zeroSignerAndStaleMutualAuthorizationsAreRejected() public {
        (bytes32 epochId,) = _initialize(50, 2, false);
        bytes memory malformedZeroRecovery = abi.encodePacked(bytes32(0), bytes32(0), uint8(27));
        vm.expectRevert(SourceCoordinator.InvalidSignature.selector);
        source.revokeQuoteNonce(epochId, address(0), 77, malformedZeroRecovery);
        assertEq(source.quoteNonceState(epochId, address(0), 77), 0);

        WorkTypes.OrderTerms memory terms = _terms(epochId, 1, 10, 2, 3);
        bytes32 orderId = _accept(terms);
        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("delivery one"));
        bytes32 staleDigest = source.mutualDigest(orderId, 0, 5, 1);
        bytes memory staleBuyer = _sign(BUYER_KEY, staleDigest);
        bytes memory staleWorker = _sign(WORKER_KEY, staleDigest);

        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("delivery two"));
        vm.expectRevert(SourceCoordinator.InvalidSignature.selector);
        source.settleMutually(orderId, 0, 5, 1, staleBuyer, staleWorker);

        bytes32 currentDigest = source.mutualDigest(orderId, 0, 5, 1);
        bytes memory currentBuyer = _sign(BUYER_KEY, currentDigest);
        bytes memory currentWorker = _sign(WORKER_KEY, currentDigest);
        vm.prank(buyer);
        source.invalidateMutualProposals(orderId, 0, 2);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        source.settleMutually(orderId, 0, 5, 1, currentBuyer, currentWorker);

        bytes32 replacement = source.mutualDigest(orderId, 0, 5, 2);
        source.settleMutually(orderId, 0, 5, 2, _sign(BUYER_KEY, replacement), _sign(WORKER_KEY, replacement));
        assertEq(source.milestone(orderId, 0).finalWork, 5);
        assertTrue(source.conservationHolds(epochId));
    }

    function test_zeroAmountFinalityCreatesNoLeaf_thenReturnedCapacityIsRecognizable() public {
        (bytes32 epochId, WorkTypes.EpochConfig memory config) = _initialize(10, 3, true);
        WorkTypes.OrderTerms memory terms = _terms(epochId, 1, 10, 0, 0);
        bytes32 orderId = _accept(terms);
        bytes32 digest = source.mutualDigest(orderId, 0, 0, 1);

        vm.recordLogs();
        source.settleMutually(orderId, 0, 0, 1, _sign(BUYER_KEY, digest), _sign(WORKER_KEY, digest));
        Vm.Log[] memory zeroLogs = vm.getRecordedLogs();
        assertEq(_count(zeroLogs, address(source), ALLOCATION_EVENT), 0);
        assertEq(_count(zeroLogs, address(source), CHECKPOINT_EVENT), 0);
        SourceCoordinator.MilestoneData memory finalized = source.milestone(orderId, 0);
        assertEq(finalized.status, 5);
        assertEq(finalized.outcome, 8);
        assertEq(finalized.finalWork, 0);
        SourceCoordinator.EpochStateView memory restored = source.epochState(epochId);
        assertEq(restored.available, 10);
        assertEq(restored.unresolved, 0);
        assertEq(restored.earned, 0);
        assertEq(restored.leafCount, 0);

        vm.prank(buyer);
        source.startDraining(epochId);
        vm.recordLogs();
        source.sweepAvailable(epochId);
        Vm.Log[] memory sweepLogs = vm.getRecordedLogs();
        assertEq(_count(sweepLogs, address(source), ALLOCATION_EVENT), 1);
        WorkTypes.Allocation memory returned = source.allocationAt(epochId, 0);
        assertEq(returned.kind, WorkTypes.RETURN);
        assertEq(returned.amount, 10);

        bytes memory receipt = _encodedReceipt(sweepLogs);
        uint32 returnOrdinal = _ordinal(sweepLogs, address(source), ALLOCATION_EVENT, 0);
        treasury.authenticateAndRecognizeReceipt(_proof(100, receipt), returnOrdinal);
        assertEq(treasury.freeBalance(config.refundBeneficiary), 10);
        assertEq(treasury.epochAccount(epochId).reserve, 0);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        source.settleMutually(orderId, 0, 0, 1, "", "");
    }

    function test_sourceAmountCannotBeSubstitutedInCheckpointOrAuthenticatedReceipt() public {
        (bytes32 epochId,) = _initialize(20, 4, true);
        WorkTypes.OrderTerms memory terms = _terms(epochId, 1, 10, 3, 4);
        bytes32 orderId = _accept(terms);
        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("ruling delivery"));
        SourceCoordinator.MilestoneData memory delivered = source.milestone(orderId, 0);
        vm.prank(buyer);
        source.challenge(orderId, 0, delivered.deliveryHash, delivered.stateVersion);
        vm.prank(committee1);
        source.submitRulingVote(orderId, 0, 7, 9, committee1, "");

        vm.recordLogs();
        vm.prank(committee2);
        source.submitRulingVote(orderId, 0, 7, 9, committee2, "");
        Vm.Log[] memory rulingLogs = vm.getRecordedLogs();
        bytes memory genuineReceipt = _encodedReceipt(rulingLogs);
        (NativeReceiptAuth.SourcePosition memory position,) =
            treasury.authenticateTransaction(_proof(200, genuineReceipt));
        uint32 checkpointOrdinal = _ordinal(rulingLogs, address(source), CHECKPOINT_EVENT, 0);
        bytes32 checkpointId = treasury.importCheckpoint(position, genuineReceipt, checkpointOrdinal);

        WorkTypes.Allocation memory workAllocation = source.allocationAt(epochId, 0);
        bytes32[] memory workProof = _sourceProof(epochId, 0);
        WorkTypes.Allocation memory substituted = abi.decode(abi.encode(workAllocation), (WorkTypes.Allocation));
        substituted.amount = 8;
        vm.expectRevert(WorkTreasury.AllocationNotInCheckpoint.selector);
        treasury.recognizeFromCheckpoint(checkpointId, substituted, workProof);
        treasury.recognizeFromCheckpoint(checkpointId, workAllocation, workProof);

        uint32 feeOrdinal = _ordinal(rulingLogs, address(source), ALLOCATION_EVENT, 1);
        bytes memory alteredReceipt = _encodedReceiptWithChangedAmount(rulingLogs, feeOrdinal, 4);
        bytes32 alteredId = treasury.authenticationId(position, keccak256(alteredReceipt));
        vm.expectRevert(abi.encodeWithSelector(NativeReceiptAuth.AuthenticationNotFound.selector, alteredId));
        treasury.recognizeFromReceipt(position, alteredReceipt, feeOrdinal);
        treasury.recognizeFromReceipt(position, genuineReceipt, feeOrdinal);
        assertEq(treasury.claim(epochId, 1).allocation.amount, 7);
        assertEq(treasury.claim(epochId, 2).allocation.amount, 3);

        WorkTypes.Allocation memory feeAllocation = source.allocationAt(epochId, 1);
        bytes32[] memory feeProof = _sourceProof(epochId, 1);
        vm.expectRevert();
        treasury.recognizeFromCheckpoint(checkpointId, feeAllocation, feeProof);
        assertEq(treasury.epochAccount(epochId).recognized, 10);
    }

    function _initialize(uint256 cap, uint64 nonce, bool fundTarget)
        internal
        returns (bytes32 epochId, WorkTypes.EpochConfig memory config)
    {
        config = _config(cap, nonce);
        epochId = source.computeEpochId(config);
        if (fundTarget) {
            vm.prank(sponsor);
            treasury.fundEpoch{value: cap}(config);
        }
        vm.prank(buyer);
        source.initializeEpoch(config);
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
            sourceSafe: buyer,
            sponsor: sponsor,
            refundBeneficiary: refund,
            asset: address(0),
            cap: cap,
            policyHash: WorkTypes.POLICY_HASH,
            initializationCutoff: uint64(block.number + 100),
            admissionCutoff: uint64(block.number + 10_000),
            maxMilestones: WorkTypes.MAX_MILESTONES,
            maxActiveReturns: WorkTypes.MAX_ACTIVE_RETURNS,
            maxDrainingReturns: WorkTypes.MAX_DRAINING_RETURNS,
            treeDepth: WorkTypes.TREE_DEPTH,
            nonce: nonce
        });
    }

    function _terms(bytes32 epochId, uint64 nonce, uint256 workAmount, uint256 fee, uint256 timeoutWork)
        internal
        view
        returns (WorkTypes.OrderTerms memory t)
    {
        uint64 current = uint64(vm.getBlockNumber());
        WorkTypes.MilestoneTerms[] memory milestones = new WorkTypes.MilestoneTerms[](1);
        milestones[0] = WorkTypes.MilestoneTerms({
            work: workAmount,
            fee: fee,
            timeoutWork: timeoutWork,
            deliverBefore: current + 20,
            reviewBefore: current + 30,
            ruleBefore: current + 40
        });
        t = WorkTypes.OrderTerms({
            epochId: epochId,
            termsHash: keccak256(abi.encode("adversarial terms", epochId, nonce, workAmount, fee, timeoutWork)),
            worker: worker,
            claimOwner: worker,
            destination: worker,
            feeOwner: feeOwner,
            feeDestination: feeOwner,
            committee: [committee1, committee2, committee3],
            acceptBefore: current + 10,
            nonce: nonce,
            milestones: milestones
        });
    }

    function _accept(WorkTypes.OrderTerms memory terms) internal returns (bytes32 orderId) {
        vm.prank(buyer);
        orderId = source.createOffer(terms);
        vm.prank(worker);
        source.acceptOffer(orderId, "");
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _count(Vm.Log[] memory logs, address emitter, bytes32 signature) internal pure returns (uint256 count) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == emitter && logs[i].topics.length != 0 && logs[i].topics[0] == signature) ++count;
        }
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

    function _encodedReceipt(Vm.Log[] memory recorded) internal view returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](recorded.length);
        for (uint256 i; i < recorded.length; ++i) {
            logs[i] = EvmV1Decoder.LogEntryTuple({
                address_: recorded[i].emitter, topics: recorded[i].topics, data: recorded[i].data
            });
        }
        return _encodeTuples(logs);
    }

    function _encodedReceiptWithChangedAmount(Vm.Log[] memory recorded, uint32 ordinal, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](recorded.length);
        for (uint256 i; i < recorded.length; ++i) {
            bytes memory data = recorded[i].data;
            if (i == ordinal) {
                WorkTypes.Allocation memory a = AllocationCodec.decodeAllocation(recorded[i].topics, data);
                data = abi.encode(
                    a.treeIndex,
                    a.kind,
                    a.orderId,
                    a.milestoneId,
                    a.role,
                    a.asset,
                    amount,
                    a.claimOwner,
                    a.destination,
                    a.policyHash,
                    a.evidenceHash
                );
            }
            logs[i] =
                EvmV1Decoder.LogEntryTuple({address_: recorded[i].emitter, topics: recorded[i].topics, data: data});
        }
        return _encodeTuples(logs);
    }

    function _encodeTuples(EvmV1Decoder.LogEntryTuple[] memory logs) internal view returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(100_000), buyer, false, address(source), uint256(0), bytes(""));
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
        p.continuityProof.lowerEndpointDigest = keccak256("local VM verifier stub");
    }

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
