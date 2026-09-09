import { AbiCoder, TypedDataEncoder, getAddress, id, isHexString, keccak256 } from "ethers";
import type { Address, EpochConfigV1, Hex, MilestoneTermsV1, OrderTermsV1 } from "./types.ts";
import { ZERO_ADDRESS } from "./allocation.ts";

const abi = AbiCoder.defaultAbiCoder();

export const SOURCE_VERSION = id("ProofKeySourceCoordinatorV1") as Hex;
export const SCHEMA_VERSION = id("ProofKeyAllocationSchemaV1") as Hex;
export const POLICY_HASH = id("ProofKeyWorkPolicyV1") as Hex;
export const NATIVE_PROFILE = id("ProofKeyNativeProfile:asc-contracts:0.2.1:EvmV1Decoder") as Hex;
export const EPOCH_TYPE_HASH = id("ProofKeyEpochV1(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)") as Hex;
export const MILESTONE_TYPE_HASH = id("ProofKeyMilestoneV1(uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore)") as Hex;
export const ORDER_TYPE_HASH = id("ProofKeyOrderV1(bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,bytes32 committeeHash,uint64 acceptBefore,uint64 nonce,bytes32 milestonesHash)") as Hex;

const EPOCH_TUPLE = "tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)";

function assertUint(value: bigint, bits: number, label: string, nonzero = false): void {
  if (value < 0n || value >= (1n << BigInt(bits)) || (nonzero && value === 0n)) throw new Error(`${label} is outside uint${bits}`);
}

function address(value: string, label: string, nonzero = true): Address {
  const normalized = getAddress(value) as Address;
  if (nonzero && normalized === ZERO_ADDRESS) throw new Error(`${label} must be nonzero`);
  return normalized;
}

function bytes32(value: string, label: string): Hex {
  if (!isHexString(value, 32)) throw new Error(`${label} must be bytes32`);
  return value as Hex;
}

export function normalizeEpochConfig(value: EpochConfigV1): EpochConfigV1 {
  assertUint(BigInt(value.sourceChainId), 256, "sourceChainId", true);
  assertUint(BigInt(value.sourceChainKey), 64, "sourceChainKey", true);
  assertUint(BigInt(value.targetChainId), 256, "targetChainId", true);
  assertUint(BigInt(value.cap), 256, "cap", true);
  assertUint(BigInt(value.initializationCutoff), 64, "initializationCutoff", true);
  assertUint(BigInt(value.admissionCutoff), 64, "admissionCutoff", true);
  assertUint(BigInt(value.nonce), 64, "nonce");
  if (BigInt(value.admissionCutoff) <= BigInt(value.initializationCutoff)) throw new Error("admissionCutoff must follow initializationCutoff");
  if (value.maxMilestones !== 32 || value.maxActiveReturns !== 16 || value.maxDrainingReturns !== 33 || value.treeDepth !== 7) throw new Error("epoch capacity fields do not match Work Treasury V1");
  if (value.sourceVersion.toLowerCase() !== SOURCE_VERSION || value.schemaVersion.toLowerCase() !== SCHEMA_VERSION || value.policyHash.toLowerCase() !== POLICY_HASH) throw new Error("epoch version hashes do not match Work Treasury V1");
  const asset = address(value.asset, "asset", false);
  if (asset !== ZERO_ADDRESS) throw new Error("V1 supports native CTC only");
  return {
    ...value,
    sourceChainId: BigInt(value.sourceChainId),
    sourceChainKey: BigInt(value.sourceChainKey),
    sourceCoordinator: address(value.sourceCoordinator, "sourceCoordinator"),
    sourceVersion: bytes32(value.sourceVersion, "sourceVersion"),
    targetChainId: BigInt(value.targetChainId),
    targetTreasury: address(value.targetTreasury, "targetTreasury"),
    schemaVersion: bytes32(value.schemaVersion, "schemaVersion"),
    sourceSafe: address(value.sourceSafe, "sourceSafe"),
    sponsor: address(value.sponsor, "sponsor"),
    refundBeneficiary: address(value.refundBeneficiary, "refundBeneficiary"),
    asset,
    cap: BigInt(value.cap),
    policyHash: bytes32(value.policyHash, "policyHash"),
    initializationCutoff: BigInt(value.initializationCutoff),
    admissionCutoff: BigInt(value.admissionCutoff),
    nonce: BigInt(value.nonce),
  };
}

export function epochId(value: EpochConfigV1): Hex {
  const c = normalizeEpochConfig(value);
  return keccak256(abi.encode(["bytes32", EPOCH_TUPLE], [EPOCH_TYPE_HASH, c])) as Hex;
}

export function normalizeMilestone(value: MilestoneTermsV1): MilestoneTermsV1 {
  const result = { ...value, work: BigInt(value.work), fee: BigInt(value.fee), timeoutWork: BigInt(value.timeoutWork), deliverBefore: BigInt(value.deliverBefore), reviewBefore: BigInt(value.reviewBefore), ruleBefore: BigInt(value.ruleBefore) };
  assertUint(result.work, 256, "work");
  assertUint(result.fee, 256, "fee");
  assertUint(result.timeoutWork, 256, "timeoutWork");
  assertUint(result.deliverBefore, 64, "deliverBefore", true);
  assertUint(result.reviewBefore, 64, "reviewBefore", true);
  assertUint(result.ruleBefore, 64, "ruleBefore", true);
  if (result.timeoutWork > result.work) throw new Error("timeoutWork exceeds work");
  if (!(result.deliverBefore < result.reviewBefore && result.reviewBefore < result.ruleBefore)) throw new Error("milestone cutoffs must increase");
  return result;
}

export function milestoneHash(value: MilestoneTermsV1): Hex {
  const m = normalizeMilestone(value);
  return keccak256(abi.encode(["bytes32", "uint256", "uint256", "uint256", "uint64", "uint64", "uint64"], [MILESTONE_TYPE_HASH, m.work, m.fee, m.timeoutWork, m.deliverBefore, m.reviewBefore, m.ruleBefore])) as Hex;
}

export function orderId(value: OrderTermsV1): Hex {
  if (value.milestones.length === 0 || value.milestones.length > 32) throw new Error("order requires 1–32 milestones");
  assertUint(BigInt(value.acceptBefore), 64, "acceptBefore", true);
  assertUint(BigInt(value.nonce), 64, "nonce");
  const committee = value.committee.map((item, i) => address(item, `committee[${i}]`)) as [Address, Address, Address];
  if (new Set(committee.map(item => item.toLowerCase())).size !== 3) throw new Error("committee addresses must be distinct");
  const hashes = value.milestones.map(milestoneHash);
  const committeeHash = keccak256(abi.encode(["address[3]"], [committee]));
  const milestonesHash = keccak256(abi.encode(["bytes32[]"], [hashes]));
  return keccak256(abi.encode(
    ["bytes32", "bytes32", "bytes32", "address", "address", "address", "address", "address", "bytes32", "uint64", "uint64", "bytes32"],
    [ORDER_TYPE_HASH, bytes32(value.epochId, "epochId"), bytes32(value.termsHash, "termsHash"), address(value.worker, "worker"), address(value.claimOwner, "claimOwner"), address(value.destination, "destination"), address(value.feeOwner, "feeOwner"), address(value.feeDestination, "feeDestination"), committeeHash, value.acceptBefore, value.nonce, milestonesHash],
  )) as Hex;
}

export const QUOTE_EIP712_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  ProofKeyQuoteV1: [{ name: "orderId", type: "bytes32" }],
};

export function quoteTypedData(options: { chainId: bigint; coordinator: Address; orderId: Hex }) {
  return {
    domain: {
      name: "ProofKey Source Coordinator",
      version: "1",
      chainId: BigInt(options.chainId),
      verifyingContract: address(options.coordinator, "coordinator"),
    },
    types: QUOTE_EIP712_TYPES,
    value: { orderId: bytes32(options.orderId, "orderId") },
  } as const;
}

export function quoteDigest(options: { chainId: bigint; coordinator: Address; orderId: Hex }): Hex {
  const typed = quoteTypedData(options);
  return TypedDataEncoder.hash(typed.domain, typed.types, typed.value) as Hex;
}
