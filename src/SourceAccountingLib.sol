// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WorkTypes} from "./WorkTypes.sol";
import {AllocationCodec} from "./AllocationCodec.sol";
import {AllocationTree} from "./AllocationTree.sol";
import {SourceStorage} from "./SourceStorage.sol";
import {SourcePolicyV1Lib} from "./SourcePolicyV1Lib.sol";

/// @notice Immutable linked accounting kernel for terminal WorkPolicyV1 outcomes.
library SourceAccountingLib {
    using AllocationTree for AllocationTree.Tree;

    uint8 private constant MILESTONE_FINAL = 5;

    error InvalidState();
    error CapacityExceeded();

    event AllocationCreated(bytes32 indexed epochId, uint64 indexed allocationId, uint32 treeIndex, uint8 kind,
        bytes32 orderId, uint32 milestoneId, uint8 role, address asset, uint256 amount,
        address claimOwner, address destination, bytes32 policyHash, bytes32 evidenceHash);
    event CheckpointPublished(bytes32 indexed epochId, bytes32 root, uint32 leafCount,
        uint256 earned, uint256 returned, uint8 phase);
    event MilestoneFinalized(bytes32 indexed epochId, bytes32 indexed orderId, uint32 indexed milestoneId, uint8 outcome,
        uint256 workAmount, uint256 feeAmount, bytes32 evidenceHash);

    function finalizeMilestone(
        SourceStorage.Epoch storage e,
        SourceStorage.Order storage o,
        SourceStorage.Milestone storage m,
        WorkTypes.EpochConfig storage c,
        bytes32 orderId,
        uint32 milestoneId,
        uint8 outcome,
        uint256 workAmount,
        uint256 feeAmount,
        uint64 proposalNonce
    ) public {
        if (m.status == MILESTONE_FINAL || workAmount > m.work || feeAmount > m.fee) revert InvalidState();
        uint256 reserve = m.work + m.fee;
        uint256 earned = workAmount + feeAmount;
        m.status = MILESTONE_FINAL;
        m.outcome = outcome;
        m.finalWork = workAmount;
        m.finalFee = feeAmount;
        m.decisionHash = SourcePolicyV1Lib.decisionHash(
            outcome, workAmount, feeAmount, m.stateVersion, proposalNonce
        );
        m.evidenceHash = AllocationCodec.outcomeHash(
            o.epochId, orderId, milestoneId, o.termsHash, m.deliveryHash, m.decisionHash
        );
        ++o.finalizedCount;
        --e.unresolvedMilestones;
        e.unresolved -= reserve;
        e.earned += earned;
        e.available += reserve - earned;

        if (workAmount != 0) {
            _append(e, WorkTypes.Allocation({
                epochId: o.epochId,
                allocationId: 0,
                treeIndex: 0,
                kind: WorkTypes.WORK,
                orderId: orderId,
                milestoneId: milestoneId,
                role: 1,
                asset: c.asset,
                amount: workAmount,
                claimOwner: o.claimOwner,
                destination: o.destination,
                policyHash: c.policyHash,
                evidenceHash: m.evidenceHash
            }));
        }
        if (feeAmount != 0) {
            _append(e, WorkTypes.Allocation({
                epochId: o.epochId,
                allocationId: 0,
                treeIndex: 0,
                kind: WorkTypes.FEE,
                orderId: orderId,
                milestoneId: milestoneId,
                role: 2,
                asset: c.asset,
                amount: feeAmount,
                claimOwner: o.feeOwner,
                destination: o.feeDestination,
                policyHash: c.policyHash,
                evidenceHash: m.evidenceHash
            }));
        }
        if (e.available == 0 && e.unresolved == 0) e.phase = WorkTypes.CLOSED;
        if (c.cap != e.available + e.unresolved + e.earned + e.returned) revert InvalidState();
        if (_slotRequirement(e) > WorkTypes.TREE_CAPACITY) revert CapacityExceeded();
        emit MilestoneFinalized(o.epochId, orderId, milestoneId, outcome, workAmount, feeAmount, m.evidenceHash);
        if (earned != 0) {
            emit CheckpointPublished(o.epochId, e.tree.root, e.tree.count, e.earned, e.returned, e.phase);
        }
    }

    function _append(SourceStorage.Epoch storage e, WorkTypes.Allocation memory proposed) private {
        WorkTypes.Allocation memory a = e.tree.append(proposed);
        emit AllocationCreated(a.epochId, a.allocationId, a.treeIndex, a.kind, a.orderId, a.milestoneId,
            a.role, a.asset, a.amount, a.claimOwner, a.destination, a.policyHash, a.evidenceHash);
    }

    function _slotRequirement(SourceStorage.Epoch storage e) private view returns (uint256 required) {
        required = uint256(e.tree.count) + uint256(e.unresolvedMilestones) * 2 + 1;
        if (e.phase == WorkTypes.ACTIVE) required += WorkTypes.MAX_ACTIVE_RETURNS - e.activeReturns;
        if (e.phase != WorkTypes.CLOSED) required += WorkTypes.MAX_DRAINING_RETURNS - e.drainingReturns;
    }
}
