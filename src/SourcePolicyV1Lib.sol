// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WorkTypes} from "./WorkTypes.sol";

/// @notice Pure validation and policy hashing for the one fixed source policy.
library SourcePolicyV1Lib {
    bytes32 private constant DECISION_TYPEHASH = keccak256(
        "ProofKeyDecisionV1(uint8 outcome,uint256 workAmount,uint256 feeAmount,uint64 stateVersion,uint64 proposalNonce)"
    );

    error InvalidTerms();
    error InvalidDeadline();

    function validateTerms(
        WorkTypes.OrderTerms memory terms,
        WorkTypes.EpochConfig memory config,
        uint256 currentBlock
    ) public pure returns (uint256 totalReserve) {
        uint256 count = terms.milestones.length;
        if (terms.epochId == bytes32(0) || terms.termsHash == bytes32(0) || terms.worker == address(0)
            || terms.claimOwner == address(0) || terms.destination == address(0) || terms.feeOwner == address(0)
            || terms.feeDestination == address(0) || count == 0 || count > WorkTypes.MAX_MILESTONES
            || currentBlock >= terms.acceptBefore || terms.epochId != WorkTypes.epochId(config)) {
            revert InvalidTerms();
        }
        if (terms.committee[0] == address(0) || terms.committee[1] == address(0) || terms.committee[2] == address(0)
            || terms.committee[0] == terms.committee[1] || terms.committee[0] == terms.committee[2]
            || terms.committee[1] == terms.committee[2]) revert InvalidTerms();
        for (uint256 i; i < count; ++i) {
            WorkTypes.MilestoneTerms memory m = terms.milestones[i];
            if (m.work == 0 || m.timeoutWork > m.work || terms.acceptBefore >= m.deliverBefore
                || m.deliverBefore >= m.reviewBefore || m.reviewBefore >= m.ruleBefore) revert InvalidDeadline();
            totalReserve += m.work + m.fee;
        }
    }

    function decisionHash(
        uint8 outcome,
        uint256 workAmount,
        uint256 feeAmount,
        uint64 stateVersion,
        uint64 proposalNonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(
            DECISION_TYPEHASH, outcome, workAmount, feeAmount, stateVersion, proposalNonce
        ));
    }
}
