// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {WorkTypes} from "./WorkTypes.sol";
import {AllocationCodec} from "./AllocationCodec.sol";

/// @notice Bounded ordered tree. Only append writes existing-epoch tree state.
library AllocationTree {
    struct Tree {
        bytes32 root;
        uint32 count;
        bool initialized;
        bytes32[7] frontier;
        WorkTypes.Allocation[] allocations;
    }
    error TreeFull();
    error InvalidIndex();
    error AlreadyInitialized();
    error Uninitialized();

    function initialize(Tree storage t) public {
        if (t.initialized) revert AlreadyInitialized();
        t.initialized = true;
        t.root = AllocationCodec.emptyRoot();
    }
    function append(Tree storage t, WorkTypes.Allocation memory a) public returns (WorkTypes.Allocation memory) {
        if (!t.initialized) revert Uninitialized();
        if (t.count >= WorkTypes.TREE_CAPACITY) revert TreeFull();
        a.treeIndex = t.count;
        a.allocationId = uint64(t.count) + 1;
        bytes32 node = AllocationCodec.leafHash(a);
        bytes32 zero = AllocationCodec.emptyLeaf();
        uint256 index = t.count;
        for (uint256 level; level < WorkTypes.TREE_DEPTH; ++level) {
            if ((index & 1) == 0) {
                t.frontier[level] = node;
                node = AllocationCodec.nodeHash(node, zero);
            } else {
                node = AllocationCodec.nodeHash(t.frontier[level], node);
            }
            zero = AllocationCodec.nodeHash(zero, zero);
            index >>= 1;
        }
        t.root = node;
        t.allocations.push(a);
        ++t.count;
        return a;
    }
    function at(Tree storage t, uint32 index) public view returns (WorkTypes.Allocation memory) {
        if (index >= t.count) revert InvalidIndex();
        return t.allocations[index];
    }
    function verify(WorkTypes.Allocation memory a, bytes32[] memory siblings, uint32 count, bytes32 root) public pure returns (bool) {
        if (count > WorkTypes.TREE_CAPACITY || a.treeIndex >= count || siblings.length != WorkTypes.TREE_DEPTH
            || a.allocationId != uint64(a.treeIndex) + 1) return false;
        bytes32 node = AllocationCodec.leafHash(a);
        uint256 index = a.treeIndex;
        for (uint256 level; level < WorkTypes.TREE_DEPTH; ++level) {
            node = ((index >> level) & 1) == 0
                ? AllocationCodec.nodeHash(node, siblings[level])
                : AllocationCodec.nodeHash(siblings[level], node);
        }
        return node == root;
    }
}
