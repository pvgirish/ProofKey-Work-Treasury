// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AllocationTree} from "./AllocationTree.sol";

/// @notice Storage types shared by the coordinator and its immutable linked accounting library.
library SourceStorage {
    struct Epoch {
        bool exists;
        bool expiredUninitialized;
        uint8 phase;
        uint32 reservations;
        uint32 unresolvedMilestones;
        uint32 activeReturns;
        uint32 drainingReturns;
        uint256 available;
        uint256 unresolved;
        uint256 earned;
        uint256 returned;
        AllocationTree.Tree tree;
    }

    struct Order {
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

    struct Milestone {
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
}
