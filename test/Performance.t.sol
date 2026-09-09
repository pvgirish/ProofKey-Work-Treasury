// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {NativeQueryVerifierLib} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {WorkTypes} from "../src/WorkTypes.sol";
import {AllocationCodec} from "../src/AllocationCodec.sol";
import {SourceCoordinator} from "../src/SourceCoordinator.sol";
import {NativeReceiptAuth} from "../src/NativeReceiptAuth.sol";
import {WorkTreasury} from "../src/WorkTreasury.sol";

/// @notice Local EVM measurements. Native verification is measured separately on the real chain;
///         target measurements in this file use a clearly identified VM stub at fixed 0x0FD2.
contract PerformanceTest is Test {
    address internal buyer = address(0xB0A);
    address internal worker = address(0xA11CE);
    address internal sponsor = address(0x5000);
    address internal refund = address(0x6000);
    address internal feeOwner = address(0xFEE0);
    address internal committee1 = address(0xC01);
    address internal committee2 = address(0xC02);
    address internal committee3 = address(0xC03);

    function test_sourceLargestOrderAndAllocationGas() public {
        SourceCoordinator source = new SourceCoordinator();
        WorkTreasury target = new WorkTreasury(block.chainid, 1, address(source));
        WorkTypes.EpochConfig memory config = _config(source, target, 64, 1);
        bytes32 epochId = source.computeEpochId(config);
        vm.prank(buyer);
        source.initializeEpoch(config);
        WorkTypes.OrderTerms memory terms = _terms32(epochId);

        vm.prank(buyer);
        uint256 beforeGas = gasleft();
        bytes32 orderId = source.createOffer(terms);
        uint256 createOfferGas = beforeGas - gasleft();
        console2.log("PERF source.createOffer.32_milestones.local_evm", createOfferGas);

        vm.prank(worker);
        beforeGas = gasleft();
        source.acceptOffer(orderId, "");
        uint256 acceptOfferGas = beforeGas - gasleft();
        console2.log("PERF source.acceptOffer.32_milestones.local_evm", acceptOfferGas);

        for (uint32 i; i < 32; ++i) {
            vm.prank(worker);
            source.deliver(orderId, i, keccak256(abi.encode("delivery", i)));
        }

        uint256 firstGas;
        uint256 carryGas;
        uint256 lateGas;
        uint256 maximumGas;
        uint32 maximumIndex;
        for (uint32 i; i < 32; ++i) {
            SourceCoordinator.MilestoneData memory m = source.milestone(orderId, i);
            vm.prank(buyer);
            beforeGas = gasleft();
            source.approve(orderId, i, m.deliveryHash, m.stateVersion);
            uint256 used = beforeGas - gasleft();
            if (i == 0) firstGas = used;
            if (i == 1) carryGas = used;
            if (i == 31) lateGas = used;
            if (used > maximumGas) {
                maximumGas = used;
                maximumIndex = i;
            }
        }
        console2.log("PERF source.approve.allocation_index_0.first_plus_checkpoint", firstGas);
        console2.log("PERF source.approve.allocation_index_1.carry_plus_checkpoint", carryGas);
        console2.log("PERF source.approve.allocation_index_31.late_plus_checkpoint", lateGas);
        console2.log("PERF source.approve.maximum_32_run.local_evm", maximumGas);
        console2.log("PERF source.approve.maximum_tree_index", uint256(maximumIndex));
        console2.log("SIZE SourceCoordinator.runtime_bytes", address(source).code.length);
        console2.log("SIZE WorkTreasury.runtime_bytes", address(target).code.length);
        assertLt(address(source).code.length, 24_576);
        assertLt(address(target).code.length, 24_576);
        assertTrue(source.conservationHolds(epochId));
        assertEq(source.epochState(epochId).leafCount, 32);
    }

    function test_targetCheckpointAndReceiptClaimGas_localNativeStubExcluded() public {
        vm.deal(sponsor, 1_000 ether);
        vm.mockCall(address(NativeQueryVerifierLib.getVerifier()), bytes(""), abi.encode(uint256(1)));
        SourceCoordinator source = new SourceCoordinator();
        uint256[4] memory counts = [uint256(1), 4, 16, 32];
        for (uint256 i; i < counts.length; ++i) {
            uint256 checkpointGas = _measureCheckpointClaims(source, counts[i], uint64(100 + i));
            uint256 receiptGas = _measureReceiptClaims(source, counts[i], uint64(200 + i));
            _logCheckpoint(counts[i], checkpointGas);
            _logReceipt(counts[i], receiptGas);
        }
    }

    function test_sourceLateCarryBoundaryWorkFeeGas() public {
        SourceCoordinator source = new SourceCoordinator();
        WorkTreasury target = new WorkTreasury(block.chainid, 1, address(source));
        WorkTypes.EpochConfig memory config = _config(source, target, 33, 2);
        bytes32 epochId = source.computeEpochId(config);
        vm.prank(buyer);
        source.initializeEpoch(config);

        WorkTypes.OrderTerms memory prefix = _termsN(epochId, 31, 1, 0, 1);
        vm.prank(buyer);
        bytes32 prefixId = source.createOffer(prefix);
        vm.prank(worker);
        source.acceptOffer(prefixId, "");
        for (uint32 i; i < 31; ++i) {
            vm.prank(worker);
            source.deliver(prefixId, i, keccak256(abi.encode("prefix delivery", i)));
            SourceCoordinator.MilestoneData memory m = source.milestone(prefixId, i);
            vm.prank(buyer);
            source.approve(prefixId, i, m.deliveryHash, m.stateVersion);
        }

        WorkTypes.OrderTerms memory finalTerms = _termsN(epochId, 1, 1, 1, 2);
        vm.prank(buyer);
        bytes32 finalId = source.createOffer(finalTerms);
        vm.prank(worker);
        source.acceptOffer(finalId, "");
        vm.prank(worker);
        source.deliver(finalId, 0, keccak256("late work fee delivery"));
        SourceCoordinator.MilestoneData memory delivered = source.milestone(finalId, 0);
        vm.prank(buyer);
        source.challenge(finalId, 0, delivered.deliveryHash, delivered.stateVersion);
        vm.prank(committee1);
        source.submitRulingVote(finalId, 0, 1, 1, committee1, "");
        vm.prank(committee2);
        uint256 beforeGas = gasleft();
        source.submitRulingVote(finalId, 0, 1, 1, committee2, "");
        uint256 workFeeGas = beforeGas - gasleft();
        console2.log("PERF source.committee_work_fee.indices_31_32_plus_checkpoint", workFeeGas);
        assertEq(source.epochState(epochId).leafCount, 33);
        assertTrue(source.conservationHolds(epochId));
    }

    function _measureCheckpointClaims(SourceCoordinator source, uint256 count, uint64 nonce)
        internal
        returns (uint256 used)
    {
        WorkTreasury target = new WorkTreasury(block.chainid, 1, address(source));
        WorkTypes.EpochConfig memory config = _config(source, target, count, nonce);
        vm.prank(sponsor);
        bytes32 epochId = target.fundEpoch{value: count}(config);
        WorkTypes.Allocation[] memory allocations = _allocations(epochId, count, nonce);
        WorkTypes.Checkpoint memory checkpoint = WorkTypes.Checkpoint({
            epochId: epochId,
            root: _root(allocations),
            leafCount: uint32(count),
            earned: count,
            returned: 0,
            phase: WorkTypes.ACTIVE
        });
        EvmV1Decoder.LogEntryTuple[] memory checkpointLogs = new EvmV1Decoder.LogEntryTuple[](1);
        checkpointLogs[0] = _checkpointLog(address(source), checkpoint);
        bytes memory receipt = _encodedReceipt(address(source), checkpointLogs);
        (NativeReceiptAuth.SourcePosition memory position,) =
            target.authenticateTransaction(_proof(uint64(1_000 + nonce), receipt));
        bytes32 checkpointId = target.importCheckpoint(position, receipt, 0);
        bytes32[][] memory proofs = new bytes32[][](count);
        for (uint32 i; i < count; ++i) {
            proofs[i] = _proofFor(allocations, i);
        }

        uint256 beforeGas = gasleft();
        for (uint32 i; i < count; ++i) {
            target.recognizeFromCheckpoint(checkpointId, allocations[i], proofs[i]);
        }
        used = beforeGas - gasleft();
        assertEq(target.epochAccount(epochId).recognized, count);
    }

    function _measureReceiptClaims(SourceCoordinator source, uint256 count, uint64 nonce)
        internal
        returns (uint256 used)
    {
        WorkTreasury target = new WorkTreasury(block.chainid, 1, address(source));
        WorkTypes.EpochConfig memory config = _config(source, target, count, nonce);
        vm.prank(sponsor);
        bytes32 epochId = target.fundEpoch{value: count}(config);
        WorkTypes.Allocation[] memory allocations = _allocations(epochId, count, nonce);
        EvmV1Decoder.LogEntryTuple[] memory allocationLogs = new EvmV1Decoder.LogEntryTuple[](count);
        for (uint256 i; i < count; ++i) {
            allocationLogs[i] = _allocationLog(address(source), allocations[i]);
        }
        bytes memory receipt = _encodedReceipt(address(source), allocationLogs);
        (NativeReceiptAuth.SourcePosition memory position,) =
            target.authenticateTransaction(_proof(uint64(2_000 + nonce), receipt));

        uint256 beforeGas = gasleft();
        for (uint32 i; i < count; ++i) {
            target.recognizeFromReceipt(position, receipt, i);
        }
        used = beforeGas - gasleft();
        assertEq(target.epochAccount(epochId).recognized, count);
    }

    function _logCheckpoint(uint256 count, uint256 used) internal pure {
        if (count == 1) console2.log("PERF target.checkpoint.recognize_1.local_evm", used);
        else if (count == 4) console2.log("PERF target.checkpoint.recognize_4.local_evm", used);
        else if (count == 16) console2.log("PERF target.checkpoint.recognize_16.local_evm", used);
        else console2.log("PERF target.checkpoint.recognize_32.local_evm", used);
    }

    function _logReceipt(uint256 count, uint256 used) internal pure {
        if (count == 1) console2.log("PERF target.receipt.recognize_1.cached.local_evm", used);
        else if (count == 4) console2.log("PERF target.receipt.recognize_4.cached.local_evm", used);
        else if (count == 16) console2.log("PERF target.receipt.recognize_16.cached.local_evm", used);
        else console2.log("PERF target.receipt.recognize_32.cached.local_evm", used);
    }

    function _config(SourceCoordinator source, WorkTreasury target, uint256 cap, uint64 nonce)
        internal
        view
        returns (WorkTypes.EpochConfig memory c)
    {
        c = WorkTypes.EpochConfig({
            sourceChainId: block.chainid,
            sourceChainKey: 1,
            sourceCoordinator: address(source),
            sourceVersion: WorkTypes.SOURCE_VERSION,
            targetChainId: block.chainid,
            targetTreasury: address(target),
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

    function _terms32(bytes32 epochId) internal view returns (WorkTypes.OrderTerms memory t) {
        return _termsN(epochId, 32, 1, 1, 1);
    }

    function _termsN(bytes32 epochId, uint256 count, uint256 workAmount, uint256 fee, uint64 nonce)
        internal
        view
        returns (WorkTypes.OrderTerms memory t)
    {
        WorkTypes.MilestoneTerms[] memory milestones = new WorkTypes.MilestoneTerms[](count);
        for (uint256 i; i < count; ++i) {
            milestones[i] = WorkTypes.MilestoneTerms({
                work: workAmount,
                fee: fee,
                timeoutWork: 0,
                deliverBefore: uint64(block.number + 100),
                reviewBefore: uint64(block.number + 200),
                ruleBefore: uint64(block.number + 300)
            });
        }
        t = WorkTypes.OrderTerms({
            epochId: epochId,
            termsHash: keccak256(abi.encode("performance source order", count, workAmount, fee, nonce)),
            worker: worker,
            claimOwner: worker,
            destination: worker,
            feeOwner: feeOwner,
            feeDestination: feeOwner,
            committee: [committee1, committee2, committee3],
            acceptBefore: uint64(block.number + 50),
            nonce: nonce,
            milestones: milestones
        });
    }

    function _allocations(bytes32 epochId, uint256 count, uint64 nonce)
        internal
        view
        returns (WorkTypes.Allocation[] memory allocations)
    {
        allocations = new WorkTypes.Allocation[](count);
        for (uint32 i; i < count; ++i) {
            allocations[i] = WorkTypes.Allocation({
                epochId: epochId,
                allocationId: uint64(i) + 1,
                treeIndex: i,
                kind: WorkTypes.WORK,
                orderId: keccak256(abi.encode("performance claim", nonce, i)),
                milestoneId: i,
                role: 1,
                asset: address(0),
                amount: 1,
                claimOwner: worker,
                destination: worker,
                policyHash: WorkTypes.POLICY_HASH,
                evidenceHash: keccak256(abi.encode("performance evidence", nonce, i))
            });
        }
    }

    function _root(WorkTypes.Allocation[] memory allocations) internal pure returns (bytes32) {
        bytes32[] memory nodes = _nodes(allocations);
        uint256 width = WorkTypes.TREE_CAPACITY;
        while (width > 1) {
            for (uint256 i; i < width; i += 2) {
                nodes[i / 2] = AllocationCodec.nodeHash(nodes[i], nodes[i + 1]);
            }
            width /= 2;
        }
        return nodes[0];
    }

    function _proofFor(WorkTypes.Allocation[] memory allocations, uint32 leafIndex)
        internal
        pure
        returns (bytes32[] memory siblings)
    {
        bytes32[] memory nodes = _nodes(allocations);
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
    }

    function _nodes(WorkTypes.Allocation[] memory allocations) internal pure returns (bytes32[] memory nodes) {
        nodes = new bytes32[](WorkTypes.TREE_CAPACITY);
        bytes32 empty = AllocationCodec.emptyLeaf();
        for (uint256 i; i < WorkTypes.TREE_CAPACITY; ++i) {
            nodes[i] = i < allocations.length ? AllocationCodec.leafHash(allocations[i]) : empty;
        }
    }

    function _allocationLog(address emitter, WorkTypes.Allocation memory a)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory log)
    {
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = AllocationCodec.ALLOCATION_EVENT;
        topics[1] = a.epochId;
        topics[2] = bytes32(uint256(a.allocationId));
        bytes memory data = abi.encode(
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
        );
        return EvmV1Decoder.LogEntryTuple({address_: emitter, topics: topics, data: data});
    }

    function _checkpointLog(address emitter, WorkTypes.Checkpoint memory c)
        internal
        pure
        returns (EvmV1Decoder.LogEntryTuple memory log)
    {
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = AllocationCodec.CHECKPOINT_EVENT;
        topics[1] = c.epochId;
        return EvmV1Decoder.LogEntryTuple({
            address_: emitter, topics: topics, data: abi.encode(c.root, c.leafCount, c.earned, c.returned, c.phase)
        });
    }

    function _encodedReceipt(address source, EvmV1Decoder.LogEntryTuple[] memory logs)
        internal
        view
        returns (bytes memory)
    {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(30_000_000), buyer, false, source, uint256(0), bytes(""));
        chunks[1] = abi.encode(uint128(1), uint256(27), bytes32(0), bytes32(0));
        chunks[2] = abi.encode(uint8(1), uint64(20_000_000), logs, bytes(""));
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
        p.continuityProof.lowerEndpointDigest = keccak256("local native VM stub; native cost excluded");
    }
}
