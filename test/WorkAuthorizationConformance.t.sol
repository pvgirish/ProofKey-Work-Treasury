// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {WorkTypes} from "../src/WorkTypes.sol";

/// @dev Independently reconstructs the new off-chain commitment in Solidity and
/// checks that it remains compatible with the unchanged production order codec.
contract WorkAuthorizationConformanceTest is Test {
    function testPortableAuthorizationMatchesSolidityAndFrozenQuoteDomain() public view {
        string memory json = vm.readFile("schema/work-authorization-v1-vectors.json");
        string memory conformance = vm.readFile("schema/work-authorization-conformance-v1.json");
        assertEq(keccak256(bytes(json)), vm.parseJsonBytes32(conformance, ".sourceVectorHash"));
        WorkTypes.EpochConfig memory c = abi.decode(vm.parseJsonBytes(conformance, ".epochAbi"), (WorkTypes.EpochConfig));
        WorkTypes.OrderTerms memory t = abi.decode(vm.parseJsonBytes(conformance, ".orderAbi"), (WorkTypes.OrderTerms));
        WorkTypes.validateConfig(c);
        bytes32 epoch = WorkTypes.epochId(c);
        assertEq(epoch, t.epochId);
        bytes32 committed = _authorization(json, c, t, 0);
        assertEq(committed, vm.parseJsonBytes32(json, ".termsHash"));
        assertEq(committed, t.termsHash);
        assertEq(WorkTypes.orderId(t), vm.parseJsonBytes32(json, ".orderId"));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("ProofKey Source Coordinator"), keccak256("1"), c.sourceChainId, c.sourceCoordinator
        ));
        assertEq(keccak256(abi.encodePacked(hex"1901", domain,
            keccak256(abi.encode(keccak256("ProofKeyQuoteV1(bytes32 orderId)"), WorkTypes.orderId(t))))),
            vm.parseJsonBytes32(conformance, ".quoteDigest"));
        assertNotEq(_authorization(json, c, t, 1), committed, "funding observation substitution changes consent");
    }

    function _authorization(string memory json, WorkTypes.EpochConfig memory c, WorkTypes.OrderTerms memory t, uint256 blockDelta)
        private view returns (bytes32)
    {
        return keccak256(abi.encode(
            keccak256("ProofKeyWorkAuthorizationV1(bytes32 commercialTermsHash,bytes32 epochId,bytes32 orderTermsHash,bytes32 targetFundingHash,bytes32 sourceCapacityHash)"),
            _commercial(json), WorkTypes.epochId(c), _order(t), _funding(json, c, t.epochId, blockDelta), _capacity(json, c, t.epochId)
        ));
    }

    function _commercial(string memory json) private view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("ProofKeyCommercialTermsV1(bytes32 scopeHash,bytes32 acceptanceCriteriaHash,bytes32 revisionTermsHash,bytes32 deliveryRequirementsHash,bytes32 deliveryCommitmentFormatHash)"),
            _textHash(json, ".authorization.commercialTerms.scope"),
            _textHash(json, ".authorization.commercialTerms.acceptanceCriteria"),
            _textHash(json, ".authorization.commercialTerms.revisionTerms"),
            _textHash(json, ".authorization.commercialTerms.deliveryRequirements"),
            _textHash(json, ".authorization.commercialTerms.deliveryCommitmentFormat")
        ));
    }

    function _order(WorkTypes.OrderTerms memory t) private pure returns (bytes32) {
        bytes32[] memory milestones = new bytes32[](t.milestones.length);
        for (uint256 i; i < milestones.length; ++i) milestones[i] = WorkTypes.milestoneHash(t.milestones[i]);
        return keccak256(abi.encode(
            keccak256("ProofKeyAuthorizationOrderV1(address worker,address claimOwner,address destination,address feeOwner,address feeDestination,bytes32 committeeHash,uint64 acceptBefore,uint64 nonce,bytes32 milestonesHash)"),
            t.worker, t.claimOwner, t.destination, t.feeOwner, t.feeDestination,
            keccak256(abi.encode(t.committee)), t.acceptBefore, t.nonce, keccak256(abi.encode(milestones))
        ));
    }

    function _funding(string memory json, WorkTypes.EpochConfig memory c, bytes32 epoch, uint256 blockDelta)
        private view returns (bytes32)
    {
        return keccak256(abi.encode(
            keccak256("ProofKeyTargetFundingObservationV1(uint256 targetChainId,address targetTreasury,uint256 blockNumber,bytes32 blockHash,bytes32 finalityBasisHash,bytes32 epochId,uint256 cap,uint256 reserve,uint256 requiredMaximum)"),
            c.targetChainId, c.targetTreasury, _decimal(json, ".authorization.targetFunding.blockNumber") + blockDelta,
            vm.parseJsonBytes32(json, ".authorization.targetFunding.blockHash"),
            _textHash(json, ".authorization.targetFunding.finalityBasis"), epoch, c.cap,
            _decimal(json, ".authorization.targetFunding.reserve"), _decimal(json, ".authorization.targetFunding.requiredMaximum")
        ));
    }

    function _capacity(string memory json, WorkTypes.EpochConfig memory c, bytes32 epoch) private view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("ProofKeySourceCapacityObservationV1(uint256 sourceChainId,address sourceCoordinator,uint256 blockNumber,bytes32 blockHash,bytes32 finalityBasisHash,bytes32 epochId,uint8 phase,uint256 available,uint32 reservations,uint32 remainingMilestoneAdmissions,uint256 requiredMaximum)"),
            c.sourceChainId, c.sourceCoordinator, _decimal(json, ".authorization.sourceCapacity.blockNumber"),
            vm.parseJsonBytes32(json, ".authorization.sourceCapacity.blockHash"),
            _textHash(json, ".authorization.sourceCapacity.finalityBasis"), epoch,
            uint8(vm.parseJsonUint(json, ".authorization.sourceCapacity.phase")), _decimal(json, ".authorization.sourceCapacity.available"),
            uint32(vm.parseJsonUint(json, ".authorization.sourceCapacity.reservations")),
            uint32(vm.parseJsonUint(json, ".authorization.sourceCapacity.remainingMilestoneAdmissions")),
            _decimal(json, ".authorization.sourceCapacity.requiredMaximum")
        ));
    }

    function _decimal(string memory json, string memory path) private view returns (uint256) {
        return vm.parseUint(vm.parseJsonString(json, path));
    }

    function _textHash(string memory json, string memory path) private view returns (bytes32) {
        return keccak256(bytes(vm.parseJsonString(json, path)));
    }
}
