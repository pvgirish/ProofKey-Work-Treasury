// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// DISPOSABLE G0 GATE HARNESS - 2026-09-10.
// Lives outside the canonical repository. src/ lib/ node_modules/ are symlinks to the
// inspected revision da0495d + Participant Product overlay. No canonical file is modified.
// Purpose: decide the source-cap <-> target-funding guarantee from executed behaviour.

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
import {SourceCoordinator} from "../src/SourceCoordinator.sol";

contract G0CapFundingTest is Test {
    uint64 constant SOURCE_CHAIN_KEY = 1;
    uint256 constant BUYER_KEY = 0xB0FFEE;
    uint256 constant WORKER_KEY = 0xB0B;

    SourceCoordinator source;
    WorkTreasury treasury;

    address buyer;
    address worker;
    address sponsor = address(0x5000);
    address refund = address(0x6000);
    address destination = address(0x8000);
    address[3] committee = [address(0xC1), address(0xC2), address(0xC3)];

    function setUp() public {
        vm.mockCall(address(NativeQueryVerifierLib.getVerifier()), bytes(""), abi.encode(uint256(1)));
        source = new SourceCoordinator();
        treasury = new WorkTreasury(block.chainid, SOURCE_CHAIN_KEY, address(source));
        buyer = vm.addr(BUYER_KEY);
        worker = vm.addr(WORKER_KEY);
        vm.deal(sponsor, 1_000 ether);
    }

    // ---------------------------------------------------------------------
    // A. Can the SOURCE accept and earn on work with ZERO target funding?
    // ---------------------------------------------------------------------
    function test_G0A_sourceAcceptsAndEarnsWithZeroTargetFunding() public {
        WorkTypes.EpochConfig memory c = _config(1, 10 ether);
        vm.prank(buyer);
        bytes32 epochId = source.initializeEpoch(c);

        // Target has never been funded for this epoch.
        assertFalse(treasury.epochAccount(epochId).funded, "target must be unfunded");
        assertEq(address(treasury).balance, 0, "treasury holds no value");

        // Source nevertheless admits a worker-signed order and drives it to an earned allocation.
        WorkTypes.OrderTerms memory terms = _terms(epochId, 10 ether);
        bytes memory sig = _sign(WORKER_KEY, source.quoteDigest(terms));
        vm.prank(buyer);
        bytes32 orderId = source.acceptQuote(terms, sig);

        vm.prank(worker);
        source.deliver(orderId, 0, keccak256("delivered"));
        SourceCoordinator.MilestoneData memory md = source.milestone(orderId, 0);
        vm.prank(buyer);
        source.approve(orderId, 0, md.deliveryHash, md.stateVersion);

        SourceCoordinator.EpochStateView memory st = source.epochState(epochId);
        assertEq(st.earned, 10 ether, "source recorded earned work with no funding anywhere");
        assertTrue(source.conservationHolds(epochId), "source conservation still holds");

        // The REAL allocation the coordinator produced.
        WorkTypes.Allocation memory a = source.allocationAt(epochId, 0);
        assertEq(a.kind, WorkTypes.WORK);
        assertEq(a.amount, 10 ether);
        assertEq(a.allocationId, 1);

        // The target refuses to recognise it: no funded reserve backs this epoch.
        vm.expectRevert(abi.encodeWithSelector(WorkTreasury.EpochNotFunded.selector, epochId));
        treasury.authenticateAndRecognizeReceipt(_proof(31, _encoded(1, _logs(_allocationLog(address(source), a)))), 0);

        // Nothing was paid and nothing was promised on the target.
        assertEq(address(treasury).balance, 0);
        assertEq(treasury.liveLiabilities(), 0);
        assertEq(treasury.totalClaimLiability(), 0);
        assertFalse(treasury.recognizedEconomicId(treasury.economicId(epochId, 1)));
    }

    // ---------------------------------------------------------------------
    // B. Missing / insufficient target funding.
    // ---------------------------------------------------------------------
    function test_G0B_insufficientTargetFundingRejected() public {
        WorkTypes.EpochConfig memory c = _config(2, 10 ether);
        vm.prank(sponsor);
        vm.expectRevert(
            abi.encodeWithSelector(WorkTreasury.InsufficientFreeBalance.selector, 10 ether, 10 ether - 1)
        );
        treasury.fundEpoch{value: 10 ether - 1}(c);

        bytes32 epochId = WorkTypes.epochId(c);
        assertFalse(treasury.epochAccount(epochId).funded);
        assertEq(treasury.epochAccount(epochId).reserve, 0);
        assertEq(address(treasury).balance, 0, "reverted funding left no value");
    }

    function test_G0B2_fundingReservesExactlyCapAndNothingElse() public {
        WorkTypes.EpochConfig memory c = _config(3, 10 ether);
        vm.prank(sponsor);
        bytes32 epochId = treasury.fundEpoch{value: 13 ether}(c);
        WorkTreasury.EpochAccount memory acct = treasury.epochAccount(epochId);
        assertEq(acct.reserve, 10 ether, "reserve == cap exactly");
        assertEq(acct.recognized, 0);
        assertTrue(acct.funded);
        assertEq(treasury.freeBalance(sponsor), 3 ether, "excess stays free, not reserved");
        assertEq(address(treasury).balance, 13 ether);
        assertGe(address(treasury).balance, treasury.liveLiabilities());
    }

    // ---------------------------------------------------------------------
    // C. Mismatched cap / epoch / target binding.
    // ---------------------------------------------------------------------
    function test_G0C_allocationCannotDrawOnAnotherEpochsFunding() public {
        WorkTypes.EpochConfig memory funded = _config(4, 10 ether);
        vm.prank(sponsor);
        bytes32 fundedId = treasury.fundEpoch{value: 10 ether}(funded);

        // A different epoch (nonce differs => different epochId), never funded.
        WorkTypes.EpochConfig memory other = _config(5, 10 ether);
        bytes32 otherId = WorkTypes.epochId(other);
        assertNotEq(otherId, fundedId);

        WorkTypes.Allocation memory a = _alloc(otherId, 1, WorkTypes.WORK, 10 ether, worker, destination);
        vm.expectRevert(abi.encodeWithSelector(WorkTreasury.EpochNotFunded.selector, otherId));
        treasury.authenticateAndRecognizeReceipt(_proof(32, _encoded(1, _logs(_allocationLog(address(source), a)))), 0);

        assertEq(treasury.epochAccount(fundedId).reserve, 10 ether, "funded epoch untouched");
    }

    function test_G0C2_foreignTargetTreasuryBindingRejected() public {
        WorkTypes.EpochConfig memory c = _config(6, 10 ether);
        c.targetTreasury = address(0xDEAD);
        vm.prank(sponsor);
        vm.expectRevert(WorkTypes.InvalidConfiguration.selector);
        treasury.fundEpoch{value: 10 ether}(c);
    }

    // ---------------------------------------------------------------------
    // D. Recognition exceeding or reusing available capacity.
    // ---------------------------------------------------------------------
    function test_G0D_capExceededAndDuplicateRecognitionRejected() public {
        WorkTypes.EpochConfig memory c = _config(7, 10 ether);
        vm.prank(sponsor);
        bytes32 epochId = treasury.fundEpoch{value: 10 ether}(c);

        WorkTypes.Allocation memory first = _alloc(epochId, 1, WorkTypes.WORK, 10 ether, worker, destination);
        bytes memory firstTx = _encoded(1, _logs(_allocationLog(address(source), first)));
        treasury.authenticateAndRecognizeReceipt(_proof(33, firstTx), 0);
        assertEq(treasury.epochAccount(epochId).recognized, 10 ether);
        assertEq(treasury.epochAccount(epochId).reserve, 0);

        // Same economic right again.
        vm.expectRevert(
            abi.encodeWithSelector(
                WorkTreasury.EconomicRightAlreadyRecognized.selector, treasury.economicId(epochId, 1)
            )
        );
        treasury.authenticateAndRecognizeReceipt(_proof(33, firstTx), 0);

        // A fresh, distinct allocation beyond the cap - even by one wei.
        WorkTypes.Allocation memory second = _alloc(epochId, 2, WorkTypes.WORK, 1, worker, destination);
        vm.expectRevert(
            abi.encodeWithSelector(WorkTreasury.EpochCapExceeded.selector, 10 ether + 1, 10 ether)
        );
        treasury.authenticateAndRecognizeReceipt(
            _proof(34, _encoded(1, _logs(_allocationLog(address(source), second)))), 0
        );

        assertEq(treasury.epochAccount(epochId).recognized, 10 ether, "recognition never exceeds cap");
        assertGe(address(treasury).balance, treasury.liveLiabilities());
    }

    // ---------------------------------------------------------------------
    // E. Solvency across the funded lifecycle.
    // ---------------------------------------------------------------------
    function test_G0E_recognisedClaimIsBackedByEscrowedValueThroughWithdrawal() public {
        WorkTypes.EpochConfig memory c = _config(8, 10 ether);
        vm.prank(sponsor);
        bytes32 epochId = treasury.fundEpoch{value: 10 ether}(c);
        assertGe(address(treasury).balance, treasury.liveLiabilities());

        WorkTypes.Allocation memory a = _alloc(epochId, 1, WorkTypes.WORK, 6 ether, worker, destination);
        treasury.authenticateAndRecognizeReceipt(
            _proof(35, _encoded(1, _logs(_allocationLog(address(source), a)))), 0
        );
        assertEq(treasury.totalClaimLiability(), 6 ether);
        assertGe(address(treasury).balance, treasury.liveLiabilities());

        uint256 before = destination.balance;
        treasury.withdrawFor(epochId, 1);
        assertEq(destination.balance - before, 6 ether, "claim paid from escrowed value");
        assertEq(treasury.totalClaimLiability(), 0);
        assertGe(address(treasury).balance, treasury.liveLiabilities(), "solvent after payout");
        assertEq(address(treasury).balance, 4 ether, "unrecognised reserve remains escrowed");
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------
    function _config(uint64 nonce, uint256 cap) internal view returns (WorkTypes.EpochConfig memory c) {
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
            initializationCutoff: 1000,
            admissionCutoff: 2000,
            maxMilestones: WorkTypes.MAX_MILESTONES,
            maxActiveReturns: WorkTypes.MAX_ACTIVE_RETURNS,
            maxDrainingReturns: WorkTypes.MAX_DRAINING_RETURNS,
            treeDepth: WorkTypes.TREE_DEPTH,
            nonce: nonce
        });
    }

    function _terms(bytes32 epochId, uint256 work) internal view returns (WorkTypes.OrderTerms memory t) {
        WorkTypes.MilestoneTerms[] memory ms = new WorkTypes.MilestoneTerms[](1);
        ms[0] = WorkTypes.MilestoneTerms({
            work: work, fee: 0, timeoutWork: 0, deliverBefore: 100, reviewBefore: 200, ruleBefore: 300
        });
        t = WorkTypes.OrderTerms({
            epochId: epochId,
            termsHash: keccak256("terms"),
            worker: worker,
            claimOwner: worker,
            destination: destination,
            feeOwner: worker,
            feeDestination: destination,
            committee: committee,
            acceptBefore: 50,
            nonce: 1,
            milestones: ms
        });
    }

    function _alloc(bytes32 epochId, uint64 id, uint8 kind, uint256 amount, address owner, address dest)
        internal
        pure
        returns (WorkTypes.Allocation memory)
    {
        return WorkTypes.Allocation({
            epochId: epochId,
            allocationId: id,
            treeIndex: uint32(id - 1),
            kind: kind,
            orderId: kind == WorkTypes.RETURN ? bytes32(0) : keccak256("order"),
            milestoneId: kind == WorkTypes.RETURN ? 0 : 1,
            role: kind == WorkTypes.WORK ? 1 : kind == WorkTypes.FEE ? 2 : 0,
            asset: address(0),
            amount: amount,
            claimOwner: owner,
            destination: dest,
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
                a.treeIndex, a.kind, a.orderId, a.milestoneId, a.role, a.asset,
                a.amount, a.claimOwner, a.destination, a.policyHash, a.evidenceHash
            )
        });
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

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
