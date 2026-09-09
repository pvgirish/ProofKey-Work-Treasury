// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {WorkTypes} from "../src/WorkTypes.sol";
import {AllocationCodec} from "../src/AllocationCodec.sol";
import {NativeReceiptAuth} from "../src/NativeReceiptAuth.sol";
import {WorkTreasury} from "../src/WorkTreasury.sol";
import {PaidInvoiceBook} from "../src/PaidInvoiceBook.sol";

/// @dev LOCAL MOCK tests. The production WorkTreasury remains hardwired to native verifier 0x0FD2;
///      Foundry intercepts calls at that fixed address rather than deploying a configurable verifier.
contract WorkTreasuryTargetTest is Test {
    uint256 constant SOURCE_CHAIN_ID = 11_155_111;
    uint64 constant SOURCE_CHAIN_KEY = 1;
    address constant SOURCE = address(0xC001);
    address constant SAFE = address(0x5AFE);
    address constant SPONSOR = address(0x5000);
    address constant REFUND = address(0x6000);
    address constant WORKER = address(0x7000);
    address constant DESTINATION = address(0x8000);
    address constant FOREIGN = address(0xBAD);
    bytes32 constant ORDER = keccak256("order");

    WorkTreasury treasury;

    function setUp() public {
        vm.mockCall(address(NativeQueryVerifierLib.getVerifier()), bytes(""), abi.encode(uint256(1)));
        treasury = new WorkTreasury(SOURCE_CHAIN_ID, SOURCE_CHAIN_KEY, SOURCE);
        vm.deal(SPONSOR, 1_000 ether);
    }

    function test_fundingUsesOwnDepositAndFree_andSuccessorUsesReturnedFree() public {
        WorkTypes.EpochConfig memory first = _config(1, 100 ether, SPONSOR, REFUND, SAFE);
        vm.prank(SPONSOR);
        bytes32 firstId = treasury.fundEpoch{value: 130 ether}(first);
        assertEq(treasury.freeBalance(SPONSOR), 30 ether);
        WorkTreasury.EpochAccount memory account = treasury.epochAccount(firstId);
        assertEq(account.reserve, 100 ether);
        assertEq(account.recognized, 0);
        assertTrue(account.funded);

        WorkTypes.Allocation memory refund = _allocation(firstId, 1, WorkTypes.RETURN, 40 ether, REFUND, REFUND);
        treasury.authenticateAndRecognizeReceipt(_proof(10, _encoded(1, _logs(_allocationLog(SOURCE, refund)))), 0);
        assertEq(treasury.freeBalance(REFUND), 40 ether);

        WorkTypes.EpochConfig memory successor = _config(2, 40 ether, REFUND, REFUND, SAFE);
        vm.prank(REFUND);
        bytes32 secondId = treasury.fundEpochFromFree(successor);
        account = treasury.epochAccount(secondId);
        assertEq(account.reserve, 40 ether);
        assertTrue(account.funded);
        assertEq(treasury.freeBalance(REFUND), 0);
        assertEq(treasury.liveLiabilities(), 130 ether);
        assertEq(treasury.totalCreditedDeposits(), 130 ether);
    }

    function test_cachedReceiptChecksExactBytesEmitterOrdinalAndSupportsTwoEpochs() public {
        bytes32 epochA = _fund(_config(10, 100 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.EpochConfig memory configB = _config(11, 100 ether, SPONSOR, REFUND, SAFE);
        bytes32 epochB = _fund(configB);
        WorkTypes.Allocation memory a = _allocation(epochA, 1, WorkTypes.WORK, 10 ether, WORKER, DESTINATION);
        WorkTypes.Allocation memory b = _allocation(epochB, 1, WorkTypes.WORK, 20 ether, WORKER, DESTINATION);

        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](4);
        logs[0] = _unrelated(FOREIGN);
        logs[1] = _allocationLog(FOREIGN, a);
        logs[2] = _allocationLog(SOURCE, a);
        logs[3] = _allocationLog(SOURCE, b);
        bytes memory exactBytes = _encoded(1, logs);
        (NativeReceiptAuth.SourcePosition memory position,) = treasury.authenticateTransaction(_proof(21, exactBytes));

        vm.expectRevert(abi.encodeWithSelector(NativeReceiptAuth.WrongLogEmitter.selector, FOREIGN, SOURCE));
        treasury.recognizeFromReceipt(position, exactBytes, 1);
        vm.expectRevert(abi.encodeWithSelector(NativeReceiptAuth.LogOrdinalOutOfRange.selector, uint256(4), uint256(4)));
        treasury.recognizeFromReceipt(position, exactBytes, 4);

        bytes memory changedBytes = bytes.concat(exactBytes, hex"00");
        vm.expectRevert();
        treasury.recognizeFromReceipt(position, changedBytes, 2);

        // Proof access is now unavailable. Both genuine source logs remain usable through the one
        // exact-byte authentication record; their own epoch identities cannot be caller-relabeled.
        vm.clearMockedCalls();
        treasury.recognizeFromReceipt(position, exactBytes, 3);
        treasury.recognizeFromReceipt(position, exactBytes, 2);
        assertEq(treasury.epochAccount(epochA).recognized, 10 ether);
        assertEq(treasury.epochAccount(epochB).recognized, 20 ether);
    }

    function test_returnBeforeUnseenWorkPreservesBothAndCrossRouteReplayFails() public {
        bytes32 epochId = _fund(_config(20, 100 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory work = _allocation(epochId, 1, WorkTypes.WORK, 60 ether, WORKER, DESTINATION);
        WorkTypes.Allocation memory refund = _allocation(epochId, 2, WorkTypes.RETURN, 40 ether, REFUND, REFUND);

        treasury.authenticateAndRecognizeReceipt(_proof(30, _encoded(1, _logs(_allocationLog(SOURCE, refund)))), 0);
        assertEq(treasury.freeBalance(REFUND), 40 ether);
        treasury.authenticateAndRecognizeReceipt(_proof(31, _encoded(1, _logs(_allocationLog(SOURCE, work)))), 0);
        WorkTreasury.EpochAccount memory account = treasury.epochAccount(epochId);
        assertEq(account.reserve, 0);
        assertEq(account.recognized, 100 ether);

        (bytes32 root, bytes32[] memory siblings) = _singleLeafRoot(work);
        WorkTypes.Checkpoint memory cp = WorkTypes.Checkpoint({
            epochId: epochId, root: root, leafCount: 1, earned: 60 ether, returned: 0, phase: WorkTypes.ACTIVE
        });
        bytes memory checkpointBytes = _encoded(1, _logs(_checkpointLog(SOURCE, cp)));
        (NativeReceiptAuth.SourcePosition memory position,) =
            treasury.authenticateTransaction(_proof(32, checkpointBytes));
        bytes32 checkpointId = treasury.importCheckpoint(position, checkpointBytes, 0);
        vm.expectRevert();
        treasury.recognizeFromCheckpoint(checkpointId, work, siblings);
    }

    function test_checkpointThenReceiptReplayFails_andBadCombinedClaimRollsBackNewCache() public {
        bytes32 epochId = _fund(_config(30, 100 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory work = _allocation(epochId, 1, WorkTypes.WORK, 50 ether, WORKER, DESTINATION);
        (bytes32 root, bytes32[] memory siblings) = _singleLeafRoot(work);
        WorkTypes.Checkpoint memory cp = WorkTypes.Checkpoint({
            epochId: epochId, root: root, leafCount: 1, earned: 50 ether, returned: 0, phase: WorkTypes.ACTIVE
        });
        NativeReceiptAuth.SingleProof memory checkpointProof =
            _proof(40, _encoded(1, _logs(_checkpointLog(SOURCE, cp))));
        (, bytes32 checkpointId) = treasury.authenticateAndRecognizeCheckpoint(checkpointProof, 0, work, siblings);
        vm.expectRevert();
        treasury.authenticateAndRecognizeReceipt(_proof(41, _encoded(1, _logs(_allocationLog(SOURCE, work)))), 0);

        bytes memory freshBytes = _encoded(1, _logs(_checkpointLog(SOURCE, cp)));
        NativeReceiptAuth.SingleProof memory fresh = _proof(99, freshBytes);
        NativeReceiptAuth.SourcePosition memory expected =
            NativeReceiptAuth.SourcePosition({blockHeight: 99, transactionIndex: 1});
        WorkTypes.Allocation memory altered = work;
        altered.amount = 51 ether;
        vm.expectRevert();
        treasury.authenticateAndRecognizeCheckpoint(fresh, 0, altered, siblings);
        assertFalse(treasury.isAuthenticated(expected, freshBytes));
        assertTrue(treasury.checkpoint(checkpointId).exists);
    }

    function test_batchAndSegmentedAuthenticate_thenCachedClaimsNeedNoVerifier() public {
        bytes32 epochA = _fund(_config(40, 30 ether, SPONSOR, REFUND, SAFE));
        bytes32 epochB = _fund(_config(41, 30 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory a = _allocation(epochA, 1, WorkTypes.WORK, 10 ether, WORKER, DESTINATION);
        WorkTypes.Allocation memory b = _allocation(epochB, 1, WorkTypes.WORK, 10 ether, WORKER, DESTINATION);
        bytes memory bytesA = _encoded(1, _logs(_allocationLog(SOURCE, a)));
        bytes memory bytesB = _encoded(1, _logs(_allocationLog(SOURCE, b)));

        uint64[] memory heights = new uint64[](1);
        heights[0] = 50;
        bytes[] memory txs = new bytes[](1);
        txs[0] = bytesA;
        INativeQueryVerifier.MerkleProof[] memory mps = new INativeQueryVerifier.MerkleProof[](1);
        (, bytes32[] memory batchIds) = treasury.authenticateBatch(heights, txs, mps, _continuity());
        assertTrue(batchIds[0] != bytes32(0));

        NativeReceiptAuth.SingleProof[] memory segmented = new NativeReceiptAuth.SingleProof[](1);
        segmented[0] = _proof(51, bytesB);
        (, bytes32[] memory segmentedIds) = treasury.authenticateSegmented(segmented);
        assertTrue(segmentedIds[0] != bytes32(0));

        vm.clearMockedCalls();
        treasury.recognizeFromReceipt(
            NativeReceiptAuth.SourcePosition({blockHeight: 50, transactionIndex: 1}), bytesA, 0
        );
        treasury.recognizeFromReceipt(
            NativeReceiptAuth.SourcePosition({blockHeight: 51, transactionIndex: 1}), bytesB, 0
        );
    }

    function test_rejectingFixedDestinationLeavesClaim_thenOwnerRedirects() public {
        RejectingReceiver rejecter = new RejectingReceiver();
        bytes32 epochId = _fund(_config(50, 10 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory work = _allocation(epochId, 1, WorkTypes.WORK, 10 ether, WORKER, address(rejecter));
        treasury.authenticateAndRecognizeReceipt(_proof(60, _encoded(1, _logs(_allocationLog(SOURCE, work)))), 0);

        vm.expectRevert(WorkTreasury.TransferFailed.selector);
        treasury.withdrawFor(epochId, 1);
        assertFalse(treasury.claim(epochId, 1).withdrawn);
        uint256 before = WORKER.balance;
        vm.prank(WORKER);
        treasury.ownerWithdrawTo(epochId, 1, payable(WORKER));
        assertEq(WORKER.balance, before + 10 ether);
        vm.expectRevert();
        treasury.withdrawFor(epochId, 1);
    }

    function test_unauthorizedClaimRedirectAndRejectingFreeWithdrawalPreserveBalances() public {
        RejectingReceiver rejecter = new RejectingReceiver();
        bytes32 epochId = _fund(_config(55, 20 ether, SPONSOR, address(rejecter), SAFE));
        WorkTypes.Allocation memory work = _allocation(epochId, 1, WorkTypes.WORK, 10 ether, WORKER, DESTINATION);
        WorkTypes.Allocation memory refund =
            _allocation(epochId, 2, WorkTypes.RETURN, 10 ether, address(rejecter), address(rejecter));
        treasury.authenticateAndRecognizeReceipt(_proof(65, _encoded(1, _logs(_allocationLog(SOURCE, work)))), 0);
        treasury.authenticateAndRecognizeReceipt(_proof(66, _encoded(1, _logs(_allocationLog(SOURCE, refund)))), 0);

        vm.prank(FOREIGN);
        vm.expectRevert(abi.encodeWithSelector(WorkTreasury.NotClaimOwner.selector, FOREIGN, WORKER));
        treasury.ownerWithdrawTo(epochId, 1, payable(FOREIGN));
        assertFalse(treasury.claim(epochId, 1).withdrawn);

        vm.expectRevert(WorkTreasury.TransferFailed.selector);
        treasury.withdrawFreeFor(payable(address(rejecter)), 10 ether);
        assertEq(treasury.freeBalance(address(rejecter)), 10 ether);
        vm.prank(address(rejecter));
        treasury.ownerWithdrawFreeTo(10 ether, payable(REFUND));
        assertEq(treasury.freeBalance(address(rejecter)), 0);
        assertEq(REFUND.balance, 10 ether);
    }

    function test_oldCheckpointImportedLaterDoesNotRewindLatest() public {
        bytes32 epochId = _fund(_config(56, 20 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory work = _allocation(epochId, 1, WorkTypes.WORK, 10 ether, WORKER, DESTINATION);
        (bytes32 root,) = _singleLeafRoot(work);
        WorkTypes.Checkpoint memory oldCp = WorkTypes.Checkpoint({
            epochId: epochId,
            root: AllocationCodec.emptyRoot(),
            leafCount: 0,
            earned: 0,
            returned: 0,
            phase: WorkTypes.ACTIVE
        });
        WorkTypes.Checkpoint memory newCp = WorkTypes.Checkpoint({
            epochId: epochId, root: root, leafCount: 1, earned: 10 ether, returned: 0, phase: WorkTypes.DRAINING
        });
        bytes memory newerBytes = _encoded(1, _logs(_checkpointLog(SOURCE, newCp)));
        (NativeReceiptAuth.SourcePosition memory newerPos,) = treasury.authenticateTransaction(_proof(91, newerBytes));
        bytes32 newerId = treasury.importCheckpoint(newerPos, newerBytes, 0);
        bytes memory olderBytes = _encoded(1, _logs(_checkpointLog(SOURCE, oldCp)));
        (NativeReceiptAuth.SourcePosition memory olderPos,) = treasury.authenticateTransaction(_proof(90, olderBytes));
        treasury.importCheckpoint(olderPos, olderBytes, 0);
        assertEq(treasury.latestCheckpointId(epochId), newerId);
    }

    function test_firstSuccessfulWithdrawalWinsBothOrderings_andConsumerRecordsActualDestination() public {
        AcceptingLock lock = new AcceptingLock();
        bytes32 epochA = _fund(_config(60, 10 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory a = _allocation(epochA, 1, WorkTypes.WORK, 10 ether, WORKER, address(lock));
        treasury.authenticateAndRecognizeReceipt(_proof(70, _encoded(1, _logs(_allocationLog(SOURCE, a)))), 0);
        treasury.withdrawFor(epochA, 1);
        assertEq(address(lock).balance, 10 ether);
        vm.prank(WORKER);
        vm.expectRevert();
        treasury.ownerWithdrawTo(epochA, 1, payable(WORKER));

        PaidInvoiceBook book = new PaidInvoiceBook(address(treasury), SAFE, ORDER, address(0), WorkTypes.POLICY_HASH);
        bytes32 invoiceId = book.recordPaidWork(epochA, 1);
        PaidInvoiceBook.Invoice memory invoice = book.invoice(epochA, 1);
        assertEq(invoiceId, treasury.economicId(epochA, 1));
        assertEq(invoice.entitlementOwner, WORKER);
        assertEq(invoice.paidDestination, address(lock));
        vm.expectRevert();
        book.recordPaidWork(epochA, 1);

        bytes32 epochB = _fund(_config(61, 10 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory b = _allocation(epochB, 1, WorkTypes.WORK, 10 ether, WORKER, address(lock));
        treasury.authenticateAndRecognizeReceipt(_proof(71, _encoded(1, _logs(_allocationLog(SOURCE, b)))), 0);
        uint256 before = WORKER.balance;
        vm.prank(WORKER);
        treasury.ownerWithdrawTo(epochB, 1, payable(WORKER));
        assertEq(WORKER.balance, before + 10 ether);
        vm.expectRevert();
        treasury.withdrawFor(epochB, 1);
    }

    function test_consumerRejectsPendingFeeReturnAndWrongBuyerOrderAssetPolicy() public {
        bytes32 epochId = _fund(_config(70, 20 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory fee = _allocation(epochId, 1, WorkTypes.FEE, 10 ether, WORKER, DESTINATION);
        treasury.authenticateAndRecognizeReceipt(_proof(80, _encoded(1, _logs(_allocationLog(SOURCE, fee)))), 0);
        PaidInvoiceBook book = new PaidInvoiceBook(address(treasury), SAFE, ORDER, address(0), WorkTypes.POLICY_HASH);
        vm.expectRevert(PaidInvoiceBook.WorkPaymentNotCompleted.selector);
        book.recordPaidWork(epochId, 1);
        treasury.withdrawFor(epochId, 1);
        vm.expectRevert(PaidInvoiceBook.WorkPaymentNotCompleted.selector);
        book.recordPaidWork(epochId, 1);

        bytes32 workEpoch = _fund(_config(71, 10 ether, SPONSOR, REFUND, SAFE));
        WorkTypes.Allocation memory work = _allocation(workEpoch, 1, WorkTypes.WORK, 10 ether, WORKER, DESTINATION);
        treasury.authenticateAndRecognizeReceipt(_proof(81, _encoded(1, _logs(_allocationLog(SOURCE, work)))), 0);
        treasury.withdrawFor(workEpoch, 1);
        PaidInvoiceBook wrongBuyer =
            new PaidInvoiceBook(address(treasury), FOREIGN, ORDER, address(0), WorkTypes.POLICY_HASH);
        vm.expectRevert();
        wrongBuyer.recordPaidWork(workEpoch, 1);
        PaidInvoiceBook wrongOrder =
            new PaidInvoiceBook(address(treasury), SAFE, keccak256("other"), address(0), WorkTypes.POLICY_HASH);
        vm.expectRevert();
        wrongOrder.recordPaidWork(workEpoch, 1);
        PaidInvoiceBook wrongAsset =
            new PaidInvoiceBook(address(treasury), SAFE, ORDER, address(1), WorkTypes.POLICY_HASH);
        vm.expectRevert();
        wrongAsset.recordPaidWork(workEpoch, 1);
        PaidInvoiceBook wrongPolicy =
            new PaidInvoiceBook(address(treasury), SAFE, ORDER, address(0), keccak256("other"));
        vm.expectRevert();
        wrongPolicy.recordPaidWork(workEpoch, 1);
    }

    function _fund(WorkTypes.EpochConfig memory config) internal returns (bytes32 id) {
        vm.prank(config.sponsor);
        id = treasury.fundEpoch{value: config.cap}(config);
    }

    function _config(uint64 nonce, uint256 cap, address sponsor, address refund, address buyer)
        internal
        view
        returns (WorkTypes.EpochConfig memory c)
    {
        c = WorkTypes.EpochConfig({
            sourceChainId: SOURCE_CHAIN_ID,
            sourceChainKey: SOURCE_CHAIN_KEY,
            sourceCoordinator: SOURCE,
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
            initializationCutoff: 100,
            admissionCutoff: 200,
            maxMilestones: WorkTypes.MAX_MILESTONES,
            maxActiveReturns: WorkTypes.MAX_ACTIVE_RETURNS,
            maxDrainingReturns: WorkTypes.MAX_DRAINING_RETURNS,
            treeDepth: WorkTypes.TREE_DEPTH,
            nonce: nonce
        });
    }

    function _allocation(bytes32 epochId, uint64 id, uint8 kind, uint256 amount, address owner, address destination)
        internal
        pure
        returns (WorkTypes.Allocation memory a)
    {
        a = WorkTypes.Allocation({
            epochId: epochId,
            allocationId: id,
            treeIndex: uint32(id - 1),
            kind: kind,
            orderId: kind == WorkTypes.RETURN ? bytes32(0) : ORDER,
            milestoneId: kind == WorkTypes.RETURN ? 0 : 1,
            role: kind == WorkTypes.WORK ? 1 : kind == WorkTypes.FEE ? 2 : 0,
            asset: address(0),
            amount: amount,
            claimOwner: owner,
            destination: destination,
            policyHash: WorkTypes.POLICY_HASH,
            evidenceHash: keccak256(abi.encode(kind, amount))
        });
    }

    function _allocationLog(address emitter, WorkTypes.Allocation memory a)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory l)
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = AllocationCodec.ALLOCATION_EVENT;
        topics[1] = a.epochId;
        topics[2] = bytes32(uint256(a.allocationId));
        l = EvmV1Decoder.LogEntryTuple({
            address_: emitter,
            topics: topics,
            data: abi.encode(
                a.treeIndex,
                a.kind,
                a.orderId,
                a.milestoneId,
                a.role,
                a.asset,
                a.amount,
                a.claimOwner,
                a.destination,
                a.policyHash,
                a.evidenceHash
            )
        });
    }

    function _checkpointLog(address emitter, WorkTypes.Checkpoint memory c)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory l)
    {
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = AllocationCodec.CHECKPOINT_EVENT;
        topics[1] = c.epochId;
        l = EvmV1Decoder.LogEntryTuple({
            address_: emitter, topics: topics, data: abi.encode(c.root, c.leafCount, c.earned, c.returned, c.phase)
        });
    }

    function _unrelated(address emitter) internal pure returns (EvmV1Decoder.LogEntryTuple memory l) {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = keccak256("Unrelated()");
        l = EvmV1Decoder.LogEntryTuple({address_: emitter, topics: topics, data: ""});
    }

    function _logs(EvmV1Decoder.LogEntryTuple memory one)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple[] memory logs)
    {
        logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = one;
    }

    function _encoded(uint8 status, EvmV1Decoder.LogEntryTuple[] memory logs) internal pure returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(100_000), address(1), false, address(2), uint256(0), bytes(""));
        chunks[1] = abi.encode(uint128(1), uint256(27), bytes32(0), bytes32(0));
        chunks[2] = abi.encode(status, uint64(42_000), logs, bytes(""));
        return abi.encode(uint8(0), chunks);
    }

    function _proof(uint64 height, bytes memory encodedTransaction)
        internal
        pure
        returns (NativeReceiptAuth.SingleProof memory p)
    {
        p.blockHeight = height;
        p.encodedTransaction = encodedTransaction;
        p.merkleProof.root = keccak256(abi.encode(height));
        p.continuityProof.lowerEndpointDigest = keccak256("lower");
    }

    function _continuity() internal pure returns (INativeQueryVerifier.ContinuityProof memory c) {
        c.lowerEndpointDigest = keccak256("lower");
    }

    function _singleLeafRoot(WorkTypes.Allocation memory a)
        internal
        pure
        returns (bytes32 root, bytes32[] memory siblings)
    {
        siblings = new bytes32[](WorkTypes.TREE_DEPTH);
        bytes32 node = AllocationCodec.leafHash(a);
        bytes32 zero = AllocationCodec.emptyLeaf();
        for (uint256 i; i < WorkTypes.TREE_DEPTH; ++i) {
            siblings[i] = zero;
            node = AllocationCodec.nodeHash(node, zero);
            zero = AllocationCodec.nodeHash(zero, zero);
        }
        root = node;
    }
}

contract RejectingReceiver {
    receive() external payable {
        revert("reject");
    }

    function redirectFree(WorkTreasury treasury, uint256 amount, address payable destination) external {
        treasury.ownerWithdrawFreeTo(amount, destination);
    }
}

contract AcceptingLock {
    receive() external payable {}
}
