// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {SourceCoordinator} from "../src/SourceCoordinator.sol";
import {WorkTypes} from "../src/WorkTypes.sol";

/// @dev Stateful action handler with an accounting model independent from SourceCoordinator storage.
contract SourceLifecycleHandler is Test {
    uint256 public constant CAP = 100 ether;
    uint256 internal constant WORKER_KEY = 0xB0B;

    uint8 internal constant PENDING = 1;
    uint8 internal constant AGREED = 2;
    uint8 internal constant FINAL = 5;

    struct TrackedOrder {
        bytes32 orderId;
        uint256 work;
        uint256 fee;
        uint64 acceptBefore;
        uint64 deliverBefore;
        uint8 status;
    }

    SourceCoordinator public immutable source;
    bytes32 public immutable epochId;
    address public immutable worker;

    uint256 public ghostAvailable = CAP;
    uint256 public ghostUnresolved;
    uint256 public ghostEarned;
    uint256 public ghostReturned;
    uint32 public ghostReservations;
    uint32 public ghostUnresolvedMilestones;
    uint32 public ghostLeaves;
    uint32 public ghostActiveReturns;
    uint32 public ghostDrainingReturns;

    uint64 internal nextNonce = 1;
    TrackedOrder[] internal tracked;

    constructor() {
        source = new SourceCoordinator();
        worker = vm.addr(WORKER_KEY);
        WorkTypes.EpochConfig memory config = WorkTypes.EpochConfig({
            sourceChainId: block.chainid,
            sourceChainKey: 1,
            sourceCoordinator: address(source),
            sourceVersion: WorkTypes.SOURCE_VERSION,
            targetChainId: block.chainid,
            targetTreasury: address(0x7000),
            schemaVersion: WorkTypes.SCHEMA_VERSION,
            sourceSafe: address(this),
            sponsor: address(0x5000),
            refundBeneficiary: address(0x6000),
            asset: address(0),
            cap: CAP,
            policyHash: WorkTypes.POLICY_HASH,
            initializationCutoff: uint64(block.number + 100),
            admissionCutoff: uint64(block.number + 1_000_000),
            maxMilestones: WorkTypes.MAX_MILESTONES,
            maxActiveReturns: WorkTypes.MAX_ACTIVE_RETURNS,
            maxDrainingReturns: WorkTypes.MAX_DRAINING_RETURNS,
            treeDepth: WorkTypes.TREE_DEPTH,
            nonce: 1
        });
        epochId = source.initializeEpoch(config);
    }

    function reservePending(uint96 amountSeed, uint64) external {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        if (state.phase != WorkTypes.ACTIVE || state.reservations == WorkTypes.MAX_MILESTONES
            || state.available == 0) return;
        uint256 reserve = bound(uint256(amountSeed), 1, _min(state.available, 20 ether));
        uint256 fee = reserve / 5;
        uint256 work = reserve - fee;
        uint64 nonce = nextNonce++;
        WorkTypes.OrderTerms memory terms = _terms(nonce, work, fee);
        bytes32 orderId = source.createOffer(terms);
        tracked.push(TrackedOrder({
            orderId: orderId,
            work: work,
            fee: fee,
            acceptBefore: terms.acceptBefore,
            deliverBefore: terms.milestones[0].deliverBefore,
            status: PENDING
        }));
        ghostAvailable -= reserve;
        ghostUnresolved += reserve;
        ++ghostReservations;
        ++ghostUnresolvedMilestones;
    }

    function decline(uint256 seed, bool workerDeclines) external {
        (bool found, uint256 index) = _pick(PENDING, seed);
        if (!found) return;
        TrackedOrder storage item = tracked[index];
        if (workerDeclines) vm.prank(worker);
        source.declinePendingOrder(item.orderId);
        _restore(item);
    }

    function expire(uint256 seed) external {
        (bool found, uint256 index) = _pick(PENDING, seed);
        if (!found) return;
        TrackedOrder storage item = tracked[index];
        if (block.number < item.acceptBefore) vm.roll(item.acceptBefore);
        source.expirePendingOrder(item.orderId);
        _restore(item);
    }

    function accept(uint256 seed) external {
        (bool found, uint256 index) = _pick(PENDING, seed);
        if (!found) return;
        TrackedOrder storage item = tracked[index];
        if (block.number >= item.acceptBefore) return;
        vm.prank(worker);
        source.acceptOffer(item.orderId, "");
        item.status = AGREED;
    }

    function finalizeNoDelivery(uint256 seed) external {
        (bool found, uint256 index) = _pick(AGREED, seed);
        if (!found) return;
        TrackedOrder storage item = tracked[index];
        if (block.number < item.deliverBefore) vm.roll(item.deliverBefore);
        source.finalizeNoDelivery(item.orderId, 0);
        _restore(item);
    }

    function deliverAndApprove(uint256 seed, bytes32 deliverySeed) external {
        (bool found, uint256 index) = _pick(AGREED, seed);
        if (!found) return;
        TrackedOrder storage item = tracked[index];
        if (block.number >= item.deliverBefore) return;
        bytes32 deliveryHash = keccak256(abi.encode("invariant delivery", deliverySeed, item.orderId));
        vm.prank(worker);
        source.deliver(item.orderId, 0, deliveryHash);
        SourceCoordinator.MilestoneData memory milestone = source.milestone(item.orderId, 0);
        source.approve(item.orderId, 0, milestone.deliveryHash, milestone.stateVersion);
        item.status = FINAL;
        ghostUnresolved -= item.work + item.fee;
        ghostEarned += item.work;
        ghostAvailable += item.fee;
        --ghostUnresolvedMilestones;
        ++ghostLeaves;
    }

    function mutuallySettle(uint256 seed, uint96 workSeed) external {
        (bool found, uint256 index) = _pick(AGREED, seed);
        if (!found) return;
        TrackedOrder storage item = tracked[index];
        uint256 finalWork = bound(uint256(workSeed), 0, item.work);
        bytes32 digest = source.mutualDigest(item.orderId, 0, finalWork, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(WORKER_KEY, digest);
        source.settleMutually(item.orderId, 0, finalWork, 1, "", abi.encodePacked(r, s, v));
        item.status = FINAL;
        ghostUnresolved -= item.work + item.fee;
        ghostEarned += finalWork;
        ghostAvailable += item.work + item.fee - finalWork;
        --ghostUnresolvedMilestones;
        if (finalWork != 0) ++ghostLeaves;
    }

    function releaseFree(uint96 amountSeed) external {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        if (state.phase != WorkTypes.ACTIVE || state.available == 0
            || state.activeReturns == WorkTypes.MAX_ACTIVE_RETURNS) return;
        uint256 amount = bound(uint256(amountSeed), 1, state.available);
        source.releaseFree(epochId, amount, keccak256(abi.encode("invariant release", ghostActiveReturns)));
        ghostAvailable -= amount;
        ghostReturned += amount;
        ++ghostActiveReturns;
        ++ghostLeaves;
    }

    function startDraining() external {
        if (source.epochState(epochId).phase != WorkTypes.ACTIVE) return;
        source.startDraining(epochId);
    }

    function sweepAvailable() external {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        if (state.phase != WorkTypes.DRAINING) return;
        uint256 swept = source.sweepAvailable(epochId);
        if (swept == 0) return;
        ghostAvailable -= swept;
        ghostReturned += swept;
        ++ghostDrainingReturns;
        ++ghostLeaves;
    }

    function trackedLength() external view returns (uint256) {
        return tracked.length;
    }

    function openReserveTotal() external view returns (uint256 total, uint32 count) {
        for (uint256 i; i < tracked.length; ++i) {
            if (tracked[i].status != FINAL) {
                total += tracked[i].work + tracked[i].fee;
                ++count;
            }
        }
    }

    function _restore(TrackedOrder storage item) internal {
        item.status = FINAL;
        uint256 reserve = item.work + item.fee;
        ghostUnresolved -= reserve;
        ghostAvailable += reserve;
        --ghostUnresolvedMilestones;
    }

    function _pick(uint8 status, uint256 seed) internal view returns (bool found, uint256 index) {
        uint256 length = tracked.length;
        if (length == 0) return (false, 0);
        uint256 start = seed % length;
        for (uint256 offset; offset < length; ++offset) {
            index = (start + offset) % length;
            if (tracked[index].status == status) return (true, index);
        }
        return (false, 0);
    }

    function _terms(uint64 nonce, uint256 work, uint256 fee)
        internal view returns (WorkTypes.OrderTerms memory terms)
    {
        uint64 current = uint64(block.number);
        WorkTypes.MilestoneTerms[] memory milestones = new WorkTypes.MilestoneTerms[](1);
        milestones[0] = WorkTypes.MilestoneTerms({
            work: work,
            fee: fee,
            timeoutWork: work / 2,
            deliverBefore: current + 8,
            reviewBefore: current + 12,
            ruleBefore: current + 16
        });
        terms = WorkTypes.OrderTerms({
            epochId: epochId,
            termsHash: keccak256(abi.encode("source invariant terms", nonce, work, fee)),
            worker: worker,
            claimOwner: worker,
            destination: worker,
            feeOwner: address(0xFEE0),
            feeDestination: address(0xFEE1),
            committee: [address(0xC01), address(0xC02), address(0xC03)],
            acceptBefore: current + 4,
            nonce: nonce,
            milestones: milestones
        });
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

contract SourceAccountingInvariantTest is StdInvariant, Test {
    SourceLifecycleHandler internal handler;
    SourceCoordinator internal source;
    bytes32 internal epochId;

    function setUp() public {
        handler = new SourceLifecycleHandler();
        source = handler.source();
        epochId = handler.epochId();
        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = handler.reservePending.selector;
        selectors[1] = handler.decline.selector;
        selectors[2] = handler.expire.selector;
        selectors[3] = handler.accept.selector;
        selectors[4] = handler.finalizeNoDelivery.selector;
        selectors[5] = handler.deliverAndApprove.selector;
        selectors[6] = handler.mutuallySettle.selector;
        selectors[7] = handler.releaseFree.selector;
        selectors[8] = handler.startDraining.selector;
        selectors[9] = handler.sweepAvailable.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_sourceAccountingMatchesIndependentGhostModel() public view {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        assertEq(state.available, handler.ghostAvailable());
        assertEq(state.unresolved, handler.ghostUnresolved());
        assertEq(state.earned, handler.ghostEarned());
        assertEq(state.returned, handler.ghostReturned());
        assertEq(state.available + state.unresolved + state.earned + state.returned, handler.CAP());
        assertTrue(source.conservationHolds(epochId));
    }

    function invariant_irreversibleTotalsEqualCanonicalAllocations() public view {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        uint256 earned;
        uint256 returned;
        for (uint32 i; i < state.leafCount; ++i) {
            WorkTypes.Allocation memory allocation = source.allocationAt(epochId, i);
            assertEq(allocation.treeIndex, i);
            assertEq(allocation.allocationId, uint64(i) + 1);
            if (allocation.kind == WorkTypes.RETURN) returned += allocation.amount;
            else earned += allocation.amount;
        }
        assertEq(earned, state.earned);
        assertEq(returned, state.returned);
        assertEq(state.leafCount, handler.ghostLeaves());
    }

    function invariant_reservationPartitionAndCapacityRemainBounded() public view {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        (uint256 trackedReserve, uint32 trackedCount) = handler.openReserveTotal();
        assertEq(trackedReserve, state.unresolved);
        assertEq(trackedCount, state.unresolvedMilestones);
        assertEq(state.unresolvedMilestones, handler.ghostUnresolvedMilestones());
        assertEq(state.reservations, handler.ghostReservations());
        assertLe(state.reservations, WorkTypes.MAX_MILESTONES);
        assertLe(state.leafCount, WorkTypes.TREE_CAPACITY);
        assertEq(state.activeReturns, handler.ghostActiveReturns());
        assertEq(state.drainingReturns, handler.ghostDrainingReturns());
        assertTrue(source.slotSafetyHolds(epochId));
    }

    function invariant_closedEpochHasNoReusableCapacityOrCommitment() public view {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        if (state.phase == WorkTypes.CLOSED) {
            assertEq(state.available, 0);
            assertEq(state.unresolved, 0);
            assertEq(state.unresolvedMilestones, 0);
        }
    }
}

contract SourceCapacityReuseFuzzTest is Test {
    uint256 internal constant CAP = 100 ether;

    function testFuzz_returnDoesNotBecomeReusableCapacityInTheSameEpoch(
        uint96 returnSeed,
        uint96 reserveSeed
    ) public {
        SourceLifecycleHandler handler = new SourceLifecycleHandler();
        SourceCoordinator source = handler.source();
        bytes32 epochId = handler.epochId();

        handler.releaseFree(returnSeed);
        SourceCoordinator.EpochStateView memory afterReturn = source.epochState(epochId);
        assertGt(afterReturn.returned, 0);
        assertEq(afterReturn.available + afterReturn.returned, CAP);

        handler.reservePending(reserveSeed, 1);
        SourceCoordinator.EpochStateView memory afterReserve = source.epochState(epochId);
        assertEq(afterReserve.returned, afterReturn.returned);
        assertEq(afterReserve.available + afterReserve.unresolved, CAP - afterReturn.returned);

        handler.decline(0, false);
        SourceCoordinator.EpochStateView memory afterRestore = source.epochState(epochId);
        assertEq(afterRestore.returned, afterReturn.returned);
        assertEq(afterRestore.available, CAP - afterReturn.returned);
        assertEq(afterRestore.unresolved, 0);
    }

    function testFuzz_declineExpiryAndNoDeliveryRestoreCapacityForNewReservations(
        uint96 first,
        uint96 second,
        uint96 third,
        uint96 fourth
    ) public {
        SourceLifecycleHandler handler = new SourceLifecycleHandler();
        SourceCoordinator source = handler.source();
        bytes32 epochId = handler.epochId();

        handler.reservePending(first, 1);
        handler.decline(0, true);
        _assertFullyReusable(source, epochId, 1);

        handler.reservePending(second, 2);
        handler.expire(0);
        _assertFullyReusable(source, epochId, 2);

        handler.reservePending(third, 3);
        handler.accept(0);
        handler.finalizeNoDelivery(0);
        _assertFullyReusable(source, epochId, 3);

        handler.reservePending(fourth, 4);
        SourceCoordinator.EpochStateView memory reused = source.epochState(epochId);
        assertEq(reused.available + reused.unresolved, CAP);
        assertGt(reused.unresolved, 0);
        assertEq(reused.reservations, 4);
        assertTrue(source.conservationHolds(epochId));
        assertTrue(source.slotSafetyHolds(epochId));
    }

    function _assertFullyReusable(SourceCoordinator source, bytes32 epochId, uint32 reservations) internal view {
        SourceCoordinator.EpochStateView memory state = source.epochState(epochId);
        assertEq(state.available, CAP);
        assertEq(state.unresolved, 0);
        assertEq(state.earned, 0);
        assertEq(state.returned, 0);
        assertEq(state.reservations, reservations);
        assertEq(state.unresolvedMilestones, 0);
    }
}
