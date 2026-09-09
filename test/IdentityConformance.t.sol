// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {WorkTypes} from "../src/WorkTypes.sol";

/// @dev Cross-language vectors are produced by the released TypeScript SDK, then decoded and hashed by Solidity.
contract IdentityConformanceTest is Test {
    function testSdkEncodedEpochAndOrderedMilestonesMatchSolidity() public view {
        string memory json = vm.readFile("schema/identity-v1-vectors.json");
        WorkTypes.EpochConfig memory c = abi.decode(vm.parseJsonBytes(json, ".epochAbi"), (WorkTypes.EpochConfig));
        WorkTypes.OrderTerms memory t = abi.decode(vm.parseJsonBytes(json, ".orderAbi"), (WorkTypes.OrderTerms));
        WorkTypes.validateConfig(c);
        assertEq(WorkTypes.epochId(c), vm.parseJsonBytes32(json, ".epochId"));
        assertEq(WorkTypes.orderId(t), vm.parseJsonBytes32(json, ".orderId"));
        assertEq(WorkTypes.milestoneHash(t.milestones[0]), vm.parseJsonBytes32(json, ".milestoneHashes[0]"));
        assertEq(WorkTypes.milestoneHash(t.milestones[1]), vm.parseJsonBytes32(json, ".milestoneHashes[1]"));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("ProofKey Source Coordinator"), keccak256("1"), c.sourceChainId, c.sourceCoordinator
        ));
        bytes32 structHash = keccak256(abi.encode(keccak256("ProofKeyQuoteV1(bytes32 orderId)"), WorkTypes.orderId(t)));
        assertEq(keccak256(abi.encodePacked(hex"1901", domain, structHash)), vm.parseJsonBytes32(json, ".quoteDigest"));
        bytes32 original = WorkTypes.orderId(t);
        t.milestones[1].fee = 1;
        assertNotEq(WorkTypes.orderId(t), original, "fee substitution must invalidate worker authority");
        c.targetTreasury = address(0xBEEF);
        assertNotEq(WorkTypes.epochId(c), t.epochId, "target substitution must invalidate epoch domain");
    }
}
