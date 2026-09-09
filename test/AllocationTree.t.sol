// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {WorkTypes} from "../src/WorkTypes.sol";
import {AllocationCodec} from "../src/AllocationCodec.sol";
import {AllocationTree} from "../src/AllocationTree.sol";

contract TreeHarness {
    using AllocationTree for AllocationTree.Tree;
    AllocationTree.Tree private tree;
    constructor() { tree.initialize(); }
    function append(WorkTypes.Allocation memory a) external returns(WorkTypes.Allocation memory) { return tree.append(a); }
    function appendThenRevert(WorkTypes.Allocation memory a) external { tree.append(a); revert("rollback"); }
    function root() external view returns(bytes32) { return tree.root; }
    function count() external view returns(uint32) { return tree.count; }
    function at(uint32 i) external view returns(WorkTypes.Allocation memory) { return tree.at(i); }
    function reinitialize() external { tree.initialize(); }
    function decode(bytes32[] memory topics, bytes memory data) external pure returns(WorkTypes.Allocation memory) { return AllocationCodec.decodeAllocation(topics,data); }
    function decodeCheckpoint(bytes32[] memory topics, bytes memory data) external pure returns(WorkTypes.Checkpoint memory) { return AllocationCodec.decodeCheckpoint(topics,data); }
    function verify(WorkTypes.Allocation memory a, bytes32[] memory proof, uint32 count_, bytes32 root_) external pure returns(bool) { return AllocationTree.verify(a,proof,count_,root_); }
}

contract AllocationTreeTest is Test {
    TreeHarness h;
    bytes32 constant LEAF = keccak256("ProofKeyAllocationV1(bytes32 epochId,uint64 allocationId,uint32 treeIndex,uint8 kind,bytes32 orderId,uint32 milestoneId,uint8 role,address asset,uint256 amount,address claimOwner,address destination,bytes32 policyHash,bytes32 evidenceHash)");
    bytes32 constant NODE = keccak256("ProofKeyNodeV1(bytes32 left,bytes32 right)");
    bytes32 constant EMPTY = keccak256("ProofKeyEmptyLeafV1()");
    function setUp() public { h = new TreeHarness(); }

    /// @dev Full bottom-up rebuild. Does not call the production frontier or codec hash functions.
    function independentRoot() internal view returns(bytes32) {
        bytes32[] memory nodes = new bytes32[](128);
        for (uint32 i; i<128; ++i) {
            if (i<h.count()) {
                WorkTypes.Allocation memory a=h.at(i);
                nodes[i]=keccak256(abi.encode(LEAF,a.epochId,a.allocationId,a.treeIndex,a.kind,a.orderId,a.milestoneId,a.role,a.asset,a.amount,a.claimOwner,a.destination,a.policyHash,a.evidenceHash));
            } else nodes[i]=keccak256(abi.encode(EMPTY));
        }
        for (uint256 width=128; width>1; width/=2)
            for (uint256 i; i<width/2; ++i) nodes[i]=keccak256(abi.encode(NODE,nodes[2*i],nodes[2*i+1]));
        return nodes[0];
    }

    function sample(uint32 i) internal pure returns(WorkTypes.Allocation memory a) {
        a=WorkTypes.Allocation({epochId:bytes32(uint256(11)),allocationId:999,treeIndex:999,kind:uint8(i%3+1),orderId:bytes32(uint256(8)),milestoneId:i,role:1,asset:address(0),amount:uint256(i)+1,claimOwner:address(0x123),destination:address(0x456),policyHash:bytes32(uint256(7)),evidenceHash:bytes32(uint256(i)+17)});
    }

    function test_productionTreeAll128AppendsMatchIndependentFullRebuild() public {
        assertEq(h.root(),independentRoot());
        for (uint32 i; i<128; ++i) {
            WorkTypes.Allocation memory a=h.append(sample(i));
            assertEq(a.treeIndex,i);
            assertEq(a.allocationId,uint64(i)+1);
            assertEq(h.count(),i+1);
            assertEq(h.root(),independentRoot(),"incremental root diverged");
            assertEq(keccak256(abi.encode(h.at(i))),keccak256(abi.encode(a)));
        }
        bytes32 beforeRoot=h.root();
        vm.expectRevert(AllocationTree.TreeFull.selector); h.append(sample(129));
        assertEq(h.count(),128); assertEq(h.root(),beforeRoot);
        vm.expectRevert(AllocationTree.InvalidIndex.selector); h.at(128);
    }

    function test_failedAppendAndInitializationCannotChangeTree() public {
        h.append(sample(0)); bytes32 root=h.root();
        vm.expectRevert("rollback"); h.appendThenRevert(sample(1));
        assertEq(h.count(),1); assertEq(h.root(),root);
        vm.expectRevert(AllocationTree.AlreadyInitialized.selector); h.reinitialize();
        assertEq(h.count(),1); assertEq(h.root(),root);
    }

    function test_frozenGoldenEventsDecodeToExactHashesAndOrderedProofs() public {
        string memory json=vm.readFile("schema/schema-v1-vectors.json");
        assertEq(h.root(),vm.parseJsonBytes32(json,".tree.emptyRoot"));
        bytes32 root=vm.parseJsonBytes32(json,".tree.root");
        for (uint32 i; i<3; ++i) {
            string memory prefix=string.concat(".allocations[",vm.toString(i),"]");
            bytes32[] memory topics=vm.parseJsonBytes32Array(json,string.concat(prefix,".event.topics"));
            bytes memory data=vm.parseJsonBytes(json,string.concat(prefix,".event.data"));
            WorkTypes.Allocation memory a=h.decode(topics,data);
            assertEq(AllocationCodec.leafHash(a),vm.parseJsonBytes32(json,string.concat(prefix,".leafHash")));
            bytes32[] memory proof=vm.parseJsonBytes32Array(json,string.concat(prefix,".inclusionProof"));
            assertTrue(h.verify(a,proof,3,root));
            h.append(a);
            ++a.amount; assertFalse(h.verify(a,proof,3,root)); --a.amount;
            a.treeIndex=(i+1)%3; a.allocationId=uint64(a.treeIndex)+1;
            assertFalse(h.verify(a,proof,3,root));
        }
        assertEq(h.root(),root); assertEq(h.root(),independentRoot());
        bytes32[] memory cpTopics=vm.parseJsonBytes32Array(json,".checkpoint.event.topics");
        bytes memory cpData=vm.parseJsonBytes(json,".checkpoint.event.data");
        WorkTypes.Checkpoint memory c=h.decodeCheckpoint(cpTopics,cpData);
        assertEq(c.root,root); assertEq(c.leafCount,3); assertEq(c.earned,55); assertEq(c.returned,65); assertEq(c.phase,3);
    }

    function test_codecRejectsTruncationExtraDataAndDirtyStaticPadding() public {
        string memory json=vm.readFile("schema/schema-v1-vectors.json");
        bytes32[] memory topics=vm.parseJsonBytes32Array(json,".allocations[0].event.topics");
        bytes memory data=vm.parseJsonBytes(json,".allocations[0].event.data");
        vm.expectRevert(AllocationCodec.InvalidEncoding.selector); h.decode(topics,bytes.concat(data,hex"00"));
        bytes32 saved=topics[2]; topics[2]=bytes32(uint256(saved) | (uint256(1)<<200));
        vm.expectRevert(); h.decode(topics,data); topics[2]=saved;
        data[0]=0x80; vm.expectRevert(); h.decode(topics,data);
    }

    function testFuzz_treeRejectsProofWrongLength(uint8 length) public {
        vm.assume(length!=7); WorkTypes.Allocation memory a=sample(0); a.treeIndex=0; a.allocationId=1;
        assertFalse(h.verify(a,new bytes32[](length),1,h.root()));
    }
}
