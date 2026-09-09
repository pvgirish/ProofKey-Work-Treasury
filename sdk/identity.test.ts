import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, getAddress, id, keccak256 } from "ethers";
import type { Address, EpochConfigV1, Hex, OrderTermsV1 } from "./types.ts";
import {
  EPOCH_TYPE_HASH,
  MILESTONE_TYPE_HASH,
  ORDER_TYPE_HASH,
  POLICY_HASH,
  SCHEMA_VERSION,
  SOURCE_VERSION,
  epochId,
  milestoneHash,
  orderId,
} from "./identity.ts";

const address = (byte: string) => getAddress(`0x${byte.repeat(40)}`) as Address;
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex;
const abi = AbiCoder.defaultAbiCoder();

test("domain constants are the literal WorkTypes domains", () => {
  assert.equal(EPOCH_TYPE_HASH, id("ProofKeyEpochV1(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)"));
  assert.equal(MILESTONE_TYPE_HASH, id("ProofKeyMilestoneV1(uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore)"));
  assert.equal(ORDER_TYPE_HASH, id("ProofKeyOrderV1(bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,bytes32 committeeHash,uint64 acceptBefore,uint64 nonce,bytes32 milestonesHash)"));
});

test("hashes the exact EpochConfig tuple used by WorkTypes", () => {
  const config: EpochConfigV1 = {
    sourceChainId: 11155111n,
    sourceChainKey: 42n,
    sourceCoordinator: address("1"),
    sourceVersion: SOURCE_VERSION,
    targetChainId: 102031n,
    targetTreasury: address("2"),
    schemaVersion: SCHEMA_VERSION,
    sourceSafe: address("3"),
    sponsor: address("4"),
    refundBeneficiary: address("5"),
    asset: address("0"),
    cap: 120n,
    policyHash: POLICY_HASH,
    initializationCutoff: 100n,
    admissionCutoff: 200n,
    maxMilestones: 32,
    maxActiveReturns: 16,
    maxDrainingReturns: 33,
    treeDepth: 7,
    nonce: 9n,
  };
  const tuple = "tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)";
  assert.equal(epochId(config), keccak256(abi.encode(["bytes32", tuple], [EPOCH_TYPE_HASH, config])));
});

test("order hash commits the ordered milestone list and committee", () => {
  const terms: OrderTermsV1 = {
    epochId: hash("1"), termsHash: hash("2"), worker: address("3"), claimOwner: address("4"), destination: address("5"), feeOwner: address("6"), feeDestination: address("7"),
    committee: [address("8"), address("9"), address("a")], acceptBefore: 99n, nonce: 3n,
    milestones: [
      { work: 30n, fee: 2n, timeoutWork: 10n, deliverBefore: 110n, reviewBefore: 120n, ruleBefore: 130n },
      { work: 40n, fee: 0n, timeoutWork: 15n, deliverBefore: 210n, reviewBefore: 220n, ruleBefore: 230n },
    ],
  };
  const first = orderId(terms);
  assert.notEqual(first, orderId({ ...terms, milestones: [...terms.milestones].reverse() }));
  assert.notEqual(first, orderId({ ...terms, committee: [terms.committee[1], terms.committee[0], terms.committee[2]] }));
  assert.equal(milestoneHash(terms.milestones[0]), keccak256(abi.encode(["bytes32", "uint256", "uint256", "uint256", "uint64", "uint64", "uint64"], [MILESTONE_TYPE_HASH, 30n, 2n, 10n, 110n, 120n, 130n])));
});
