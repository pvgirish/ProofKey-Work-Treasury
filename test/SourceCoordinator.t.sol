// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {SourceCoordinator} from "../src/SourceCoordinator.sol";
import {WorkTypes} from "../src/WorkTypes.sol";
import {AllocationCodec} from "../src/AllocationCodec.sol";

contract Mock1271Signer {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    mapping(bytes32 => bool) public approved;

    function approve(bytes32 digest) external { approved[digest] = true; }

    function isValidSignature(bytes32 digest, bytes calldata) external view returns (bytes4) {
        return approved[digest] ? MAGIC : bytes4(0xffffffff);
    }

    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        (bool ok, bytes memory returned) = target.call(data);
        if (!ok) assembly { revert(add(returned, 32), mload(returned)) }
        return returned;
    }
}

contract SourceCoordinatorTest is Test {
    SourceCoordinator internal source;

    uint256 internal constant BUYER_KEY = 0xA11CE;
    uint256 internal constant WORKER_KEY = 0xB0B;
    uint256 internal constant COMMITTEE_1_KEY = 0xC01;
    uint256 internal constant COMMITTEE_2_KEY = 0xC02;
    uint256 internal constant COMMITTEE_3_KEY = 0xC03;

    address internal buyer;
    address internal worker;
    address internal committee1;
    address internal committee2;
    address internal committee3;
    address internal claimOwner = address(0xCA11);
    address internal destination = address(0xD357);
    address internal feeOwner = address(0xFEE0);
    address internal feeDestination = address(0xFEE1);

    WorkTypes.EpochConfig internal config;
    bytes32 internal epochId;

    function setUp() public {
        source = new SourceCoordinator();
        buyer = vm.addr(BUYER_KEY);
        worker = vm.addr(WORKER_KEY);
        committee1 = vm.addr(COMMITTEE_1_KEY);
        committee2 = vm.addr(COMMITTEE_2_KEY);
        committee3 = vm.addr(COMMITTEE_3_KEY);
        config = _makeConfig(1_000, buyer, 1);
        epochId = source.computeEpochId(config);
        vm.prank(buyer);
        source.initializeEpoch(config);
    }

    function testInitializationAndUninitializedExpiryAreExclusive() public {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        assertTrue(state.initialized);
        assertEq(state.available, 1_000);
        assertEq(state.root, AllocationCodec.emptyRoot());
        assertTrue(source.conservationHolds(epochId));

        WorkTypes.EpochConfig memory expiring = _makeConfig(77, buyer, 22);
        bytes32 expiringId = source.computeEpochId(expiring);
        vm.roll(expiring.initializationCutoff);
        source.expireUninitializedEpoch(expiring);
        SourceCoordinator.EpochStateView memory expired = source.epochState(expiringId);
        assertFalse(expired.initialized);
        assertTrue(expired.expiredUninitialized);
        assertEq(expired.returned, 77);
        assertEq(expired.leafCount, 1);
        assertEq(expired.phase, 3);
        WorkTypes.Allocation memory allocation = source.allocationAt(expiringId, 0);
        assertEq(allocation.kind, 3);
        assertEq(allocation.claimOwner, expiring.refundBeneficiary);
        vm.expectRevert(SourceCoordinator.Unauthorized.selector);
        vm.prank(buyer);
        source.initializeEpoch(expiring);
    }

    function testPendingOfferAcceptDeclineExpiryAndReservationCapPersistence() public {
        WorkTypes.OrderTerms memory accepted = _terms(epochId, 10, 2, 1, 0);
        vm.prank(buyer);
        bytes32 acceptedId = source.createOffer(accepted);
        vm.prank(worker);
        source.acceptOffer(acceptedId, "");
        SourceCoordinator.MilestoneData memory acceptedMilestone = source.milestone(acceptedId, 0);
        assertEq(acceptedMilestone.status, 2);

        WorkTypes.OrderTerms memory declined = _terms(epochId, 11, 3, 1, 0);
        vm.prank(buyer);
        bytes32 declinedId = source.createOffer(declined);
        vm.prank(worker);
        source.declinePendingOrder(declinedId);

        WorkTypes.OrderTerms memory expired = _terms(epochId, 12, 4, 1, 0);
        vm.prank(buyer);
        bytes32 expiredId = source.createOffer(expired);
        vm.roll(expired.acceptBefore);
        source.expirePendingOrder(expiredId);

        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        assertEq(state.reservations, 3);
        assertEq(state.unresolvedMilestones, 1);
        assertEq(state.unresolved, 3);
        assertEq(state.available, 997);
        assertTrue(source.conservationHolds(epochId));
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(worker);
        source.acceptOffer(expiredId, "");
    }

    function testQuoteSignatureReplayAndRevocationIncluding1271() public {
        WorkTypes.OrderTerms memory quote = _terms(epochId, 20, 5, 1, 0);
        bytes memory signature = _sign(WORKER_KEY, source.quoteDigest(quote));
        vm.prank(buyer);
        source.acceptQuote(quote, signature);
        vm.expectRevert(SourceCoordinator.InvalidNonce.selector);
        vm.prank(buyer);
        source.acceptQuote(quote, signature);

        WorkTypes.OrderTerms memory revoked = _terms(epochId, 21, 6, 1, 0);
        bytes memory revokeSignature = _sign(
            WORKER_KEY, source.quoteRevocationDigest(epochId, worker, revoked.nonce)
        );
        source.revokeQuoteNonce(epochId, worker, revoked.nonce, revokeSignature);
        bytes memory revokedQuoteSig = _sign(WORKER_KEY, source.quoteDigest(revoked));
        vm.expectRevert(SourceCoordinator.InvalidNonce.selector);
        vm.prank(buyer);
        source.acceptQuote(revoked, revokedQuoteSig);

        Mock1271Signer contractWorker = new Mock1271Signer();
        WorkTypes.OrderTerms memory contractQuote = _terms(epochId, 22, 7, 1, 0);
        contractQuote.worker = address(contractWorker);
        bytes32 digest = source.quoteDigest(contractQuote);
        contractWorker.approve(digest);
        vm.prank(buyer);
        bytes32 orderId = source.acceptQuote(contractQuote, hex"01");
        assertTrue(source.order(orderId).agreed);
    }

    function testWorkerRevokesPendingOfferAndReleasesReservation() public {
        WorkTypes.OrderTerms memory terms = _terms(epochId, 23, 40, 5, 10);
        vm.prank(buyer);
        bytes32 orderId = source.createOffer(terms);
        SourceCoordinator.EpochStateView memory reserved = source.epochState(epochId);
        assertEq(reserved.unresolved, 45);
        bytes32 digest = source.quoteRevocationDigest(epochId, worker, terms.nonce);
        source.revokeQuoteNonce(epochId, worker, terms.nonce, _sign(WORKER_KEY, digest));
        SourceCoordinator.EpochStateView memory released = source.epochState(epochId);
        assertEq(released.unresolved, 0);
        assertEq(released.available, 1_000);
        assertEq(released.reservations, 1);
        assertEq(source.milestone(orderId, 0).outcome, 1);
        assertEq(source.quoteNonceState(epochId, worker, terms.nonce), 3);
    }

    function testDeliveryRevisionMakesOldMutualSignaturesStale() public {
        (bytes32 orderId,) = _acceptedOffer(_terms(epochId, 30, 10, 2, 1));
        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("delivery-one"));
        bytes32 oldDigest = source.mutualDigest(orderId, 0, 5, 1);
        bytes memory buyerSig = _sign(BUYER_KEY, oldDigest);
        bytes memory workerSig = _sign(WORKER_KEY, oldDigest);
        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("delivery-two"));
        vm.expectRevert(SourceCoordinator.InvalidSignature.selector);
        source.settleMutually(orderId, 0, 5, 1, buyerSig, workerSig);
        bytes32 currentDigest = source.mutualDigest(orderId, 0, 5, 1);
        bytes memory currentBuyerSig = _sign(BUYER_KEY, currentDigest);
        bytes memory currentWorkerSig = _sign(WORKER_KEY, currentDigest);
        vm.prank(worker);
        source.invalidateMutualProposals(orderId, 0, 2);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        source.settleMutually(orderId, 0, 5, 1, currentBuyerSig, currentWorkerSig);
        bytes32 replacementDigest = source.mutualDigest(orderId, 0, 5, 2);
        source.settleMutually(orderId, 0, 5, 2,
            _sign(BUYER_KEY, replacementDigest), _sign(WORKER_KEY, replacementDigest));
        SourceCoordinator.MilestoneData memory m = source.milestone(orderId, 0);
        assertEq(m.finalWork, 5);
        assertEq(m.finalFee, 0);
    }

    function testApprovalCalldataBindsExactCurrentDeliveryAndVersion() public {
        (bytes32 orderId,) = _acceptedOffer(_terms(epochId, 31, 10, 2, 1));
        bytes32 first = keccak256("first-review");
        vm.prank(worker);
        source.deliver(orderId, 0, first);
        uint64 firstVersion = source.milestone(orderId, 0).stateVersion;
        bytes32 revision = keccak256("revised-after-queued-approval");
        vm.prank(worker);
        source.deliver(orderId, 0, revision);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(buyer);
        source.approve(orderId, 0, first, firstVersion);
        SourceCoordinator.MilestoneData memory currentMilestone = source.milestone(orderId, 0);
        vm.prank(buyer);
        source.approve(orderId, 0, currentMilestone.deliveryHash, currentMilestone.stateVersion);
        assertEq(source.milestone(orderId, 0).outcome, 4);
    }

    function testApprovalNoDeliveryAndMonitoringDefaultAtExactBoundaries() public {
        (bytes32 approved,) = _acceptedOffer(_terms(epochId, 40, 10, 3, 2));
        vm.prank(worker);
        source.deliver(approved, 0, keccak256("approved"));
        _approveCurrent(source, approved, 0, buyer);
        assertEq(source.milestone(approved, 0).outcome, 4);

        WorkTypes.OrderTerms memory noDeliveryTerms = _terms(epochId, 41, 7, 2, 1);
        (bytes32 noDelivery,) = _acceptedOffer(noDeliveryTerms);
        vm.roll(noDeliveryTerms.milestones[0].deliverBefore);
        source.finalizeNoDelivery(noDelivery, 0);
        assertEq(source.milestone(noDelivery, 0).finalWork, 0);

        WorkTypes.OrderTerms memory defaultTerms = _terms(epochId, 42, 8, 2, 1);
        uint64 current = uint64(vm.getBlockNumber());
        defaultTerms.acceptBefore = current + 5;
        defaultTerms.milestones[0].deliverBefore = current + 10;
        defaultTerms.milestones[0].reviewBefore = current + 15;
        defaultTerms.milestones[0].ruleBefore = current + 20;
        (bytes32 defaulted,) = _acceptedOffer(defaultTerms);
        vm.prank(worker);
        source.deliver(defaulted, 0, keccak256("default"));
        vm.roll(defaultTerms.milestones[0].reviewBefore);
        source.finalizeMonitoringDefault(defaulted, 0);
        assertEq(source.milestone(defaulted, 0).outcome, 5);
        assertTrue(source.conservationHolds(epochId));
    }

    function testCommitteeVotesDoNotPoolAcrossProposalsAndDuplicateFails() public {
        WorkTypes.OrderTerms memory terms = _terms(epochId, 50, 10, 3, 4);
        (bytes32 orderId,) = _acceptedOffer(terms);
        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("challenged"));
        _challengeCurrent(source, orderId, 0, buyer);

        vm.prank(committee1);
        source.submitRulingVote(orderId, 0, 4, 1, committee1, "");
        vm.expectRevert(SourceCoordinator.DuplicateVote.selector);
        vm.prank(committee1);
        source.submitRulingVote(orderId, 0, 4, 1, committee1, "");
        vm.prank(committee2);
        source.submitRulingVote(orderId, 0, 5, 2, committee2, "");
        assertEq(source.milestone(orderId, 0).status, 4);
        vm.prank(committee1);
        source.invalidateOwnRulingVotesBefore(orderId, 0, 2);
        vm.prank(committee3);
        source.submitRulingVote(orderId, 0, 4, 1, committee3, "");
        assertEq(source.milestone(orderId, 0).status, 4);
        vm.prank(committee1);
        source.submitRulingVote(orderId, 0, 4, 2, committee1, "");
        vm.prank(committee3);
        source.submitRulingVote(orderId, 0, 4, 2, committee3, "");
        SourceCoordinator.MilestoneData memory m = source.milestone(orderId, 0);
        assertEq(m.outcome, 6);
        assertEq(m.finalWork, 4);
        assertEq(m.finalFee, 3);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(committee2);
        source.submitRulingVote(orderId, 0, 4, 1, committee2, "");
    }

    function testCommitteeTimeoutAndMutualDefaultFirstWriterWins() public {
        WorkTypes.OrderTerms memory timeoutTerms = _terms(epochId, 60, 10, 3, 4);
        (bytes32 timeoutId,) = _acceptedOffer(timeoutTerms);
        vm.prank(worker);
        source.deliver(timeoutId, 0, keccak256("timeout"));
        _challengeCurrent(source, timeoutId, 0, buyer);
        vm.roll(timeoutTerms.milestones[0].ruleBefore);
        source.finalizeCommitteeTimeout(timeoutId, 0);
        assertEq(source.milestone(timeoutId, 0).finalWork, 4);
        assertEq(source.milestone(timeoutId, 0).finalFee, 0);

        WorkTypes.OrderTerms memory mutualTerms = _terms(epochId, 61, 9, 1, 2);
        uint64 current = uint64(vm.getBlockNumber());
        mutualTerms.acceptBefore = current + 5;
        mutualTerms.milestones[0].deliverBefore = current + 10;
        mutualTerms.milestones[0].reviewBefore = current + 15;
        mutualTerms.milestones[0].ruleBefore = current + 20;
        (bytes32 mutualId,) = _acceptedOffer(mutualTerms);
        vm.prank(worker);
        source.deliver(mutualId, 0, keccak256("mutual-after-cutoff"));
        vm.roll(mutualTerms.milestones[0].reviewBefore);
        bytes32 digest = source.mutualDigest(mutualId, 0, 6, 1);
        source.settleMutually(mutualId, 0, 6, 1, _sign(BUYER_KEY, digest), _sign(WORKER_KEY, digest));
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        source.finalizeMonitoringDefault(mutualId, 0);

        WorkTypes.OrderTerms memory firstDefaultTerms = _terms(epochId, 62, 9, 1, 2);
        current = uint64(vm.getBlockNumber());
        firstDefaultTerms.acceptBefore = current + 5;
        firstDefaultTerms.milestones[0].deliverBefore = current + 10;
        firstDefaultTerms.milestones[0].reviewBefore = current + 15;
        firstDefaultTerms.milestones[0].ruleBefore = current + 20;
        (bytes32 firstDefault,) = _acceptedOffer(firstDefaultTerms);
        vm.prank(worker);
        source.deliver(firstDefault, 0, keccak256("default-first"));
        bytes32 staleMutual = source.mutualDigest(firstDefault, 0, 6, 1);
        bytes memory safeSig = _sign(BUYER_KEY, staleMutual);
        bytes memory workSig = _sign(WORKER_KEY, staleMutual);
        vm.roll(firstDefaultTerms.milestones[0].reviewBefore);
        source.finalizeMonitoringDefault(firstDefault, 0);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        source.settleMutually(firstDefault, 0, 6, 1, safeSig, workSig);
    }

    function testActiveReturnDrainSweepAndNoEmptyLeaf() public {
        vm.prank(buyer);
        source.releaseFree(epochId, 100, keccak256("safe authorization"));
        _acceptedOffer(_terms(epochId, 69, 100, 0, 0));
        vm.prank(buyer);
        source.startDraining(epochId);
        uint256 swept = source.sweepAvailable(epochId);
        assertEq(swept, 800);
        assertEq(source.sweepAvailable(epochId), 0);
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        assertEq(state.leafCount, 2);
        assertEq(state.returned, 900);
        assertEq(state.phase, 2);
        assertTrue(source.conservationHolds(epochId));
    }

    function testAdmissionCutoffAllowsPermissionlessDrainAndRepublishDoesNotMutate() public {
        vm.recordLogs();
        vm.prank(buyer);
        source.releaseFree(epochId, 100, keccak256("republish changed state"));
        Vm.Log[] memory changedStateLogs = vm.getRecordedLogs();
        assertEq(changedStateLogs.length, 2);
        assertEq(changedStateLogs[1].topics[0], AllocationCodec.CHECKPOINT_EVENT);
        SourceCoordinator.EpochStateView memory beforeState = source.epochState(epochId);
        bytes32 beforeConfig = keccak256(abi.encode(source.epochConfig(epochId)));
        vm.recordLogs();
        source.republishCheckpoint(epochId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], AllocationCodec.CHECKPOINT_EVENT);
        assertEq(
            keccak256(abi.encode(logs[0].topics, logs[0].data)),
            keccak256(abi.encode(changedStateLogs[1].topics, changedStateLogs[1].data))
        );
        SourceCoordinator.EpochStateView memory afterRepublish = source.epochState(epochId);
        assertEq(keccak256(abi.encode(afterRepublish)), keccak256(abi.encode(beforeState)));
        assertEq(keccak256(abi.encode(source.epochConfig(epochId))), beforeConfig);

        vm.roll(config.admissionCutoff);
        vm.prank(address(0x1234));
        vm.recordLogs();
        source.startDraining(epochId);
        Vm.Log[] memory phaseLogs = vm.getRecordedLogs();
        assertEq(phaseLogs.length, 2);
        assertEq(phaseLogs[1].topics[0], AllocationCodec.CHECKPOINT_EVENT);
        WorkTypes.Checkpoint memory phaseCheckpoint = AllocationCodec.decodeCheckpoint(
            phaseLogs[1].topics, phaseLogs[1].data
        );
        SourceCoordinator.EpochStateView memory phaseState = source.epochState(epochId);
        assertEq(phaseState.phase, 2);
        assertEq(phaseCheckpoint.epochId, epochId);
        assertEq(phaseCheckpoint.root, phaseState.root);
        assertEq(phaseCheckpoint.leafCount, phaseState.leafCount);
        assertEq(phaseCheckpoint.earned, phaseState.earned);
        assertEq(phaseCheckpoint.returned, phaseState.returned);
        assertEq(phaseCheckpoint.phase, phaseState.phase);

        vm.recordLogs();
        vm.prank(address(0x4567));
        source.republishCheckpoint(epochId);
        Vm.Log[] memory phaseRepublishLogs = vm.getRecordedLogs();
        assertEq(phaseRepublishLogs.length, 1);
        assertEq(
            keccak256(abi.encode(phaseRepublishLogs[0].topics, phaseRepublishLogs[0].data)),
            keccak256(abi.encode(phaseLogs[1].topics, phaseLogs[1].data))
        );
        assertEq(keccak256(abi.encode(source.epochState(epochId))), keccak256(abi.encode(phaseState)));
        assertEq(keccak256(abi.encode(source.epochConfig(epochId))), beforeConfig);
        vm.expectRevert(SourceCoordinator.InvalidState.selector);
        vm.prank(buyer);
        source.createOffer(_terms(epochId, 24, 1, 0, 0));
    }

    function testAllocationEventRoundTripAndAtomicWorkFeeCheckpoint() public {
        WorkTypes.OrderTerms memory terms = _terms(epochId, 70, 10, 3, 5);
        (bytes32 orderId,) = _acceptedOffer(terms);
        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("event"));
        _challengeCurrent(source, orderId, 0, buyer);
        vm.prank(committee1);
        source.submitRulingVote(orderId, 0, 5, 3, committee1, "");
        vm.recordLogs();
        vm.prank(committee2);
        source.submitRulingVote(orderId, 0, 5, 3, committee2, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 5); // ruling vote, WORK, FEE, milestone finalization, final checkpoint
        uint256 allocationLogs;
        uint256 checkpointLogs;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == AllocationCodec.ALLOCATION_EVENT) {
                ++allocationLogs;
                assertEq(logs[i].topics.length, 3);
                assertEq(logs[i].data.length, 352);
                bytes32[] memory topics = logs[i].topics;
                WorkTypes.Allocation memory decoded = AllocationCodec.decodeAllocation(topics, logs[i].data);
                assertEq(AllocationCodec.leafHash(decoded), source.leafHashAt(epochId, decoded.treeIndex));
            }
            if (logs[i].topics[0] == AllocationCodec.CHECKPOINT_EVENT) ++checkpointLogs;
        }
        assertEq(allocationLogs, 2);
        assertEq(checkpointLogs, 1);
        assertEq(logs[logs.length - 1].topics[0], AllocationCodec.CHECKPOINT_EVENT);
    }

    function testReachable113LeafTraceAndIndependentRootRebuild() public {
        SourceCoordinator traceSource = new SourceCoordinator();
        WorkTypes.EpochConfig memory traceConfig = _makeConfig(120, buyer, 99);
        traceConfig.sourceCoordinator = address(traceSource);
        bytes32 traceEpoch = traceSource.computeEpochId(traceConfig);
        vm.prank(buyer);
        traceSource.initializeEpoch(traceConfig);
        SourceCoordinator.EpochStateView memory traceState = traceSource.epochState(traceEpoch);
        bytes32 observedRoot = traceState.root;
        uint32 observedCount = traceState.leafCount;
        assertEq(_rebuild(traceSource, traceEpoch), observedRoot);

        WorkTypes.OrderTerms memory terms = _manyTerms(traceEpoch, 32, 2, 1, 1);
        vm.prank(buyer);
        bytes32 orderId = traceSource.createOffer(terms);
        _assertTreeUnchanged(traceSource, traceEpoch, observedRoot, observedCount);
        SourceCoordinator.EpochStateView memory atCapacity = traceSource.epochState(traceEpoch);
        assertEq(atCapacity.reservations, 32);
        assertEq(atCapacity.available, 24);
        assertEq(atCapacity.unresolved, 96);
        WorkTypes.OrderTerms memory overflow = _terms(traceEpoch, 100, 1, 0, 0);
        vm.recordLogs();
        vm.expectRevert(SourceCoordinator.CapacityExceeded.selector);
        vm.prank(buyer);
        traceSource.createOffer(overflow);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(
            keccak256(abi.encode(traceSource.epochState(traceEpoch))),
            keccak256(abi.encode(atCapacity))
        );
        assertEq(traceSource.quoteNonceState(traceEpoch, worker, overflow.nonce), 0);
        vm.prank(worker);
        traceSource.acceptOffer(orderId, "");
        _assertTreeUnchanged(traceSource, traceEpoch, observedRoot, observedCount);
        for (uint32 i; i < 32; ++i) {
            vm.prank(worker);
            traceSource.deliver(orderId, i, keccak256(abi.encode("delivery", i)));
            _assertTreeUnchanged(traceSource, traceEpoch, observedRoot, observedCount);
            _challengeCurrent(traceSource, orderId, i, buyer);
            _assertTreeUnchanged(traceSource, traceEpoch, observedRoot, observedCount);
        }
        for (uint256 i; i < 16; ++i) {
            vm.recordLogs();
            vm.prank(buyer);
            traceSource.releaseFree(traceEpoch, 1, keccak256(abi.encode("return", i)));
            (observedRoot, observedCount) = _assertAllocationCall(
                traceSource, traceEpoch, vm.getRecordedLogs(), 1
            );
        }
        vm.prank(buyer);
        traceSource.startDraining(traceEpoch);
        _assertTreeUnchanged(traceSource, traceEpoch, observedRoot, observedCount);
        vm.recordLogs();
        assertEq(traceSource.sweepAvailable(traceEpoch), 8);
        (observedRoot, observedCount) = _assertAllocationCall(
            traceSource, traceEpoch, vm.getRecordedLogs(), 1
        );
        for (uint32 i; i < 32; ++i) {
            vm.prank(committee1);
            traceSource.submitRulingVote(orderId, i, 1, 1, committee1, "");
            _assertTreeUnchanged(traceSource, traceEpoch, observedRoot, observedCount);
            vm.recordLogs();
            vm.prank(committee2);
            traceSource.submitRulingVote(orderId, i, 1, 1, committee2, "");
            (observedRoot, observedCount) = _assertAllocationCall(
                traceSource, traceEpoch, vm.getRecordedLogs(), 2
            );
            vm.recordLogs();
            assertEq(traceSource.sweepAvailable(traceEpoch), 1);
            (observedRoot, observedCount) = _assertAllocationCall(
                traceSource, traceEpoch, vm.getRecordedLogs(), 1
            );
        }
        SourceCoordinator.EpochStateView memory state = traceSource.epochState(traceEpoch);
        assertEq(state.leafCount, 113);
        assertEq(state.earned, 64);
        assertEq(state.returned, 56);
        assertEq(state.available, 0);
        assertEq(state.unresolved, 0);
        assertEq(state.phase, 3);
        assertTrue(traceSource.conservationHolds(traceEpoch));
        assertTrue(traceSource.slotSafetyHolds(traceEpoch));
        assertEq(_rebuild(traceSource, traceEpoch), state.root);
    }

    function testEIP1271BuyerAndWorkerMutualAuthorization() public {
        Mock1271Signer contractBuyer = new Mock1271Signer();
        Mock1271Signer contractWorker = new Mock1271Signer();
        SourceCoordinator contractSource = new SourceCoordinator();
        WorkTypes.EpochConfig memory c = _makeConfig(50, address(contractBuyer), 777);
        c.sourceCoordinator = address(contractSource);
        bytes32 id = contractSource.computeEpochId(c);
        contractBuyer.execute(address(contractSource), abi.encodeCall(contractSource.initializeEpoch, (c)));
        WorkTypes.OrderTerms memory terms = _terms(id, 90, 10, 2, 3);
        terms.worker = address(contractWorker);
        bytes memory create = abi.encodeCall(contractSource.createOffer, (terms));
        bytes32 orderId = abi.decode(contractBuyer.execute(address(contractSource), create), (bytes32));
        bytes32 acceptDigest = contractSource.offerAcceptanceDigest(orderId);
        contractWorker.approve(acceptDigest);
        contractSource.acceptOffer(orderId, hex"01");
        bytes32 mutual = contractSource.mutualDigest(orderId, 0, 3, 1);
        contractBuyer.approve(mutual);
        contractWorker.approve(mutual);
        contractSource.settleMutually(orderId, 0, 3, 1, hex"01", hex"02");
        assertEq(contractSource.milestone(orderId, 0).finalWork, 3);
    }

    function _acceptedOffer(WorkTypes.OrderTerms memory terms) internal returns (bytes32 orderId, WorkTypes.OrderTerms memory) {
        vm.prank(buyer);
        orderId = source.createOffer(terms);
        vm.prank(worker);
        source.acceptOffer(orderId, "");
        return (orderId, terms);
    }

    function _approveCurrent(SourceCoordinator coordinator, bytes32 orderId, uint32 milestoneId, address safe) internal {
        SourceCoordinator.MilestoneData memory m = coordinator.milestone(orderId, milestoneId);
        vm.prank(safe);
        coordinator.approve(orderId, milestoneId, m.deliveryHash, m.stateVersion);
    }

    function _challengeCurrent(SourceCoordinator coordinator, bytes32 orderId, uint32 milestoneId, address safe) internal {
        SourceCoordinator.MilestoneData memory m = coordinator.milestone(orderId, milestoneId);
        vm.prank(safe);
        coordinator.challenge(orderId, milestoneId, m.deliveryHash, m.stateVersion);
    }

    function _makeConfig(uint256 cap, address safe, uint64 nonce) internal view returns (WorkTypes.EpochConfig memory c) {
        c = WorkTypes.EpochConfig({
            sourceChainId: block.chainid,
            sourceChainKey: 1,
            sourceCoordinator: address(source),
            sourceVersion: WorkTypes.SOURCE_VERSION,
            targetChainId: 102031,
            targetTreasury: address(0x7777),
            schemaVersion: WorkTypes.SCHEMA_VERSION,
            sourceSafe: safe,
            sponsor: address(0x5000),
            refundBeneficiary: address(0xBEEF),
            asset: address(0),
            cap: cap,
            policyHash: WorkTypes.POLICY_HASH,
            initializationCutoff: uint64(block.number + 10),
            admissionCutoff: uint64(block.number + 1_000),
            maxMilestones: WorkTypes.MAX_MILESTONES,
            maxActiveReturns: WorkTypes.MAX_ACTIVE_RETURNS,
            maxDrainingReturns: WorkTypes.MAX_DRAINING_RETURNS,
            treeDepth: WorkTypes.TREE_DEPTH,
            nonce: nonce
        });
    }

    function _terms(bytes32 id, uint64 nonce, uint256 workAmount, uint256 fee, uint256 timeoutWork)
        internal view returns (WorkTypes.OrderTerms memory t)
    {
        t = _manyTerms(id, 1, workAmount, fee, timeoutWork);
        t.nonce = nonce;
    }

    function _manyTerms(bytes32 id, uint256 count, uint256 workAmount, uint256 fee, uint256 timeoutWork)
        internal view returns (WorkTypes.OrderTerms memory t)
    {
        WorkTypes.MilestoneTerms[] memory milestones = new WorkTypes.MilestoneTerms[](count);
        for (uint256 i; i < count; ++i) {
            milestones[i] = WorkTypes.MilestoneTerms({
                work: workAmount,
                fee: fee,
                timeoutWork: timeoutWork,
                deliverBefore: uint64(block.number + 20),
                reviewBefore: uint64(block.number + 30),
                ruleBefore: uint64(block.number + 500)
            });
        }
        t = WorkTypes.OrderTerms({
            epochId: id,
            termsHash: keccak256(abi.encode("terms", id, count, workAmount, fee)),
            worker: worker,
            claimOwner: claimOwner,
            destination: destination,
            feeOwner: feeOwner,
            feeDestination: feeDestination,
            committee: [committee1, committee2, committee3],
            acceptBefore: uint64(block.number + 10),
            nonce: 1,
            milestones: milestones
        });
    }

    function _sign(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _rebuild(SourceCoordinator coordinator, bytes32 id) internal view returns (bytes32) {
        SourceCoordinator.EpochStateView memory state = coordinator.epochState(id);
        bytes32[] memory nodes = new bytes32[](128);
        bytes32 empty = AllocationCodec.emptyLeaf();
        for (uint256 i; i < 128; ++i) {
            nodes[i] = i < state.leafCount
                ? AllocationCodec.leafHash(coordinator.allocationAt(id, uint32(i)))
                : empty;
        }
        uint256 width = 128;
        while (width > 1) {
            for (uint256 i; i < width; i += 2) nodes[i / 2] = AllocationCodec.nodeHash(nodes[i], nodes[i + 1]);
            width /= 2;
        }
        return nodes[0];
    }

    function _assertTreeUnchanged(
        SourceCoordinator coordinator,
        bytes32 id,
        bytes32 expectedRoot,
        uint32 expectedCount
    ) internal view {
        SourceCoordinator.EpochStateView memory state = coordinator.epochState(id);
        assertEq(state.root, expectedRoot);
        assertEq(state.leafCount, expectedCount);
    }

    function _assertAllocationCall(
        SourceCoordinator coordinator,
        bytes32 id,
        Vm.Log[] memory logs,
        uint32 expectedAllocations
    ) internal view returns (bytes32 root, uint32 count) {
        SourceCoordinator.EpochStateView memory state = coordinator.epochState(id);
        uint32 allocations;
        uint32 checkpoints;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(coordinator) || logs[i].topics.length == 0) continue;
            if (logs[i].topics[0] == AllocationCodec.ALLOCATION_EVENT) {
                WorkTypes.Allocation memory decoded = AllocationCodec.decodeAllocation(logs[i].topics, logs[i].data);
                assertEq(decoded.epochId, id);
                assertEq(decoded.treeIndex, state.leafCount - expectedAllocations + allocations);
                assertEq(decoded.allocationId, uint64(decoded.treeIndex) + 1);
                assertEq(
                    keccak256(abi.encode(decoded)),
                    keccak256(abi.encode(coordinator.allocationAt(id, decoded.treeIndex)))
                );
                assertEq(AllocationCodec.leafHash(decoded), coordinator.leafHashAt(id, decoded.treeIndex));
                ++allocations;
            } else if (logs[i].topics[0] == AllocationCodec.CHECKPOINT_EVENT) {
                WorkTypes.Checkpoint memory checkpoint = AllocationCodec.decodeCheckpoint(logs[i].topics, logs[i].data);
                assertEq(checkpoint.epochId, id);
                assertEq(checkpoint.root, state.root);
                assertEq(checkpoint.leafCount, state.leafCount);
                assertEq(checkpoint.earned, state.earned);
                assertEq(checkpoint.returned, state.returned);
                assertEq(checkpoint.phase, state.phase);
                ++checkpoints;
            }
        }
        assertEq(allocations, expectedAllocations);
        assertEq(checkpoints, 1);
        assertEq(logs[logs.length - 1].topics[0], AllocationCodec.CHECKPOINT_EVENT);
        assertEq(_rebuild(coordinator, id), state.root);
        return (state.root, state.leafCount);
    }
}
