// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Versioned application commitments. Source policy and target evidence share these exact types.
library WorkTypes {
    uint8 internal constant WORK = 1;
    uint8 internal constant FEE = 2;
    uint8 internal constant RETURN = 3;
    uint8 internal constant ACTIVE = 1;
    uint8 internal constant DRAINING = 2;
    uint8 internal constant CLOSED = 3;
    uint32 internal constant MAX_MILESTONES = 32;
    uint32 internal constant MAX_ACTIVE_RETURNS = 16;
    uint32 internal constant MAX_DRAINING_RETURNS = 33;
    uint32 internal constant TREE_CAPACITY = 128;
    uint8 internal constant TREE_DEPTH = 7;
    bytes32 internal constant SOURCE_VERSION = keccak256("ProofKeySourceCoordinatorV1");
    bytes32 internal constant SCHEMA_VERSION = keccak256("ProofKeyAllocationSchemaV1");
    bytes32 internal constant POLICY_HASH = keccak256("ProofKeyWorkPolicyV1");
    bytes32 internal constant NATIVE_PROFILE = keccak256("ProofKeyNativeProfile:asc-contracts:0.2.1:EvmV1Decoder");

    struct Allocation {
        bytes32 epochId;
        uint64 allocationId;
        uint32 treeIndex;
        uint8 kind;
        bytes32 orderId;
        uint32 milestoneId;
        uint8 role;
        address asset;
        uint256 amount;
        address claimOwner;
        address destination;
        bytes32 policyHash;
        bytes32 evidenceHash;
    }

    struct Checkpoint {
        bytes32 epochId;
        bytes32 root;
        uint32 leafCount;
        uint256 earned;
        uint256 returned;
        uint8 phase;
    }

    struct EpochConfig {
        uint256 sourceChainId;
        uint64 sourceChainKey;
        address sourceCoordinator;
        bytes32 sourceVersion;
        uint256 targetChainId;
        address targetTreasury;
        bytes32 schemaVersion;
        address sourceSafe;
        address sponsor;
        address refundBeneficiary;
        address asset;
        uint256 cap;
        bytes32 policyHash;
        uint64 initializationCutoff;
        uint64 admissionCutoff;
        uint32 maxMilestones;
        uint32 maxActiveReturns;
        uint32 maxDrainingReturns;
        uint8 treeDepth;
        uint64 nonce;
    }

    struct MilestoneTerms {
        uint256 work;
        uint256 fee;
        uint256 timeoutWork;
        uint64 deliverBefore;
        uint64 reviewBefore;
        uint64 ruleBefore;
    }

    struct OrderTerms {
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
        MilestoneTerms[] milestones;
    }

    bytes32 internal constant EPOCH_TYPEHASH = keccak256("ProofKeyEpochV1(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)");
    bytes32 internal constant MILESTONE_TYPEHASH = keccak256("ProofKeyMilestoneV1(uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore)");
    bytes32 internal constant ORDER_TYPEHASH = keccak256("ProofKeyOrderV1(bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,bytes32 committeeHash,uint64 acceptBefore,uint64 nonce,bytes32 milestonesHash)");

    error InvalidConfiguration();

    function epochId(EpochConfig memory c) public pure returns (bytes32) {
        return keccak256(abi.encode(EPOCH_TYPEHASH, c));
    }

    function milestoneHash(MilestoneTerms memory m) internal pure returns (bytes32) {
        return keccak256(abi.encode(MILESTONE_TYPEHASH, m));
    }

    function orderId(OrderTerms memory t) public pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](t.milestones.length);
        for (uint256 i; i < hashes.length; ++i) hashes[i] = milestoneHash(t.milestones[i]);
        // abi.encode(bytes32[]) includes length; no packed dynamic concatenation ambiguity.
        return keccak256(abi.encode(ORDER_TYPEHASH, t.epochId, t.termsHash, t.worker, t.claimOwner,
            t.destination, t.feeOwner, t.feeDestination, keccak256(abi.encode(t.committee)),
            t.acceptBefore, t.nonce, keccak256(abi.encode(hashes))));
    }

    function validateConfig(EpochConfig memory c) public pure {
        if (c.sourceChainId == 0 || c.targetChainId == 0 || c.sourceChainKey == 0
            || c.sourceCoordinator == address(0) || c.targetTreasury == address(0)
            || c.sourceSafe == address(0) || c.sponsor == address(0) || c.refundBeneficiary == address(0)
            || c.asset != address(0) || c.cap == 0 || c.sourceVersion != SOURCE_VERSION
            || c.schemaVersion != SCHEMA_VERSION || c.policyHash != POLICY_HASH
            || c.initializationCutoff == 0 || c.admissionCutoff <= c.initializationCutoff
            || c.maxMilestones != MAX_MILESTONES || c.maxActiveReturns != MAX_ACTIVE_RETURNS
            || c.maxDrainingReturns != MAX_DRAINING_RETURNS || c.treeDepth != TREE_DEPTH) {
            revert InvalidConfiguration();
        }
    }
}
