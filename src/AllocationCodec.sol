// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WorkTypes} from "./WorkTypes.sol";

/// @notice Exact schema-v1.json encoding. The event is reconstructed from static topics AND data.
library AllocationCodec {
    bytes32 internal constant LEAF_TYPEHASH = keccak256("ProofKeyAllocationV1(bytes32 epochId,uint64 allocationId,uint32 treeIndex,uint8 kind,bytes32 orderId,uint32 milestoneId,uint8 role,address asset,uint256 amount,address claimOwner,address destination,bytes32 policyHash,bytes32 evidenceHash)");
    bytes32 internal constant NODE_TYPEHASH = keccak256("ProofKeyNodeV1(bytes32 left,bytes32 right)");
    bytes32 internal constant EMPTY_TYPEHASH = keccak256("ProofKeyEmptyLeafV1()");
    bytes32 internal constant OUTCOME_TYPEHASH = keccak256("ProofKeyOutcomeEvidenceV1(bytes32 epochId,bytes32 orderId,uint32 milestoneId,bytes32 termsHash,bytes32 deliveryHash,bytes32 decisionHash)");
    bytes32 internal constant RELEASE_TYPEHASH = keccak256("ProofKeyReleaseEvidenceV1(bytes32 epochId,uint8 releaseReason,uint256 amount,bytes32 authorizationHash)");
    bytes32 internal constant ALLOCATION_EVENT = keccak256("AllocationCreated(bytes32,uint64,uint32,uint8,bytes32,uint32,uint8,address,uint256,address,address,bytes32,bytes32)");
    bytes32 internal constant CHECKPOINT_EVENT = keccak256("CheckpointPublished(bytes32,bytes32,uint32,uint256,uint256,uint8)");
    error InvalidEncoding();

    function leafHash(WorkTypes.Allocation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(LEAF_TYPEHASH, a));
    }
    function nodeHash(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(abi.encode(NODE_TYPEHASH, left, right));
    }
    function emptyLeaf() internal pure returns (bytes32) { return keccak256(abi.encode(EMPTY_TYPEHASH)); }
    function emptyRoot() internal pure returns (bytes32 h) {
        h = emptyLeaf();
        for (uint256 i; i < WorkTypes.TREE_DEPTH; ++i) h = nodeHash(h, h);
    }
    function outcomeHash(bytes32 epoch, bytes32 order, uint32 milestone, bytes32 terms, bytes32 delivery, bytes32 decision) internal pure returns(bytes32) {
        return keccak256(abi.encode(OUTCOME_TYPEHASH, epoch, order, milestone, terms, delivery, decision));
    }
    function releaseHash(bytes32 epoch, uint8 reason, uint256 amount, bytes32 authorization) internal pure returns(bytes32) {
        return keccak256(abi.encode(RELEASE_TYPEHASH, epoch, reason, amount, authorization));
    }
    function decodeAllocation(bytes32[] memory topics, bytes memory data) internal pure returns (WorkTypes.Allocation memory a) {
        if (topics.length != 3 || data.length != 352 || topics[0] != ALLOCATION_EVENT) revert InvalidEncoding();
        bytes memory encoded = bytes.concat(topics[1], topics[2], data);
        a = abi.decode(encoded, (WorkTypes.Allocation));
        if (keccak256(encoded) != keccak256(abi.encode(a))) revert InvalidEncoding();
    }
    function decodeCheckpoint(bytes32[] memory topics, bytes memory data) internal pure returns (WorkTypes.Checkpoint memory c) {
        if (topics.length != 2 || data.length != 160 || topics[0] != CHECKPOINT_EVENT) revert InvalidEncoding();
        bytes memory encoded = bytes.concat(topics[1], data);
        c = abi.decode(encoded, (WorkTypes.Checkpoint));
        if (keccak256(encoded) != keccak256(abi.encode(c))) revert InvalidEncoding();
    }
}
