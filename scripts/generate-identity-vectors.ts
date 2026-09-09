import { writeFile } from "node:fs/promises";
import { AbiCoder, id } from "ethers";
import { epochId, orderId, milestoneHash, quoteDigest, SOURCE_VERSION, SCHEMA_VERSION, POLICY_HASH } from "../sdk/identity.ts";
import type { Address, Hex, EpochConfigV1, OrderTermsV1 } from "../sdk/types.ts";

const address = (digit: string) => `0x${digit.repeat(40)}` as Address;
const config: EpochConfigV1 = {
  sourceChainId: 11155111n, sourceChainKey: 1n, sourceCoordinator: address("1"), sourceVersion: SOURCE_VERSION,
  targetChainId: 102031n, targetTreasury: address("2"), schemaVersion: SCHEMA_VERSION, sourceSafe: address("3"),
  sponsor: address("4"), refundBeneficiary: address("5"), asset: address("0"), cap: 120000000000000000000n,
  policyHash: POLICY_HASH, initializationCutoff: 1800000100n, admissionCutoff: 1800000200n,
  maxMilestones: 32, maxActiveReturns: 16, maxDrainingReturns: 33, treeDepth: 7, nonce: 9n,
};
const terms: OrderTermsV1 = {
  epochId: epochId(config), termsHash: id("Golden order: two independently priced milestones") as Hex,
  worker: address("6"), claimOwner: address("7"), destination: address("8"), feeOwner: address("9"), feeDestination: address("a"),
  committee: [address("b"), address("c"), address("d")], acceptBefore: 1800000300n, nonce: 11n,
  milestones: [
    {work: 30n, fee: 2n, timeoutWork: 10n, deliverBefore: 1800000400n, reviewBefore: 1800000500n, ruleBefore: 1800000600n},
    {work: 40n, fee: 0n, timeoutWork: 15n, deliverBefore: 1800000700n, reviewBefore: 1800000800n, ruleBefore: 1800000900n},
  ],
};
const epochTuple = "tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)";
const orderTuple = "tuple(bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,address[3] committee,uint64 acceptBefore,uint64 nonce,tuple(uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore)[] milestones)";
const abi = AbiCoder.defaultAbiCoder();
const result = {
  version: "ProofKeyWorkTreasuryIdentityVectorsV1", config, terms,
  epochAbi: abi.encode([epochTuple], [config]), orderAbi: abi.encode([orderTuple], [terms]),
  epochId: epochId(config), orderId: orderId(terms), milestoneHashes: terms.milestones.map(milestoneHash),
  quoteDigest: quoteDigest({chainId: config.sourceChainId, coordinator: config.sourceCoordinator, orderId: orderId(terms)}),
};
await writeFile(new URL("../schema/identity-v1-vectors.json", import.meta.url), JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
