import {
  AbiCoder,
  Interface,
  getAddress,
  id,
  isHexString,
  keccak256,
  recoverAddress,
  toUtf8Bytes,
} from "ethers";
import type { Provider } from "ethers";
import { epochId, milestoneHash, normalizeEpochConfig, normalizeMilestone, orderId, quoteDigest } from "./identity.ts";
import type { Address, EpochConfigV1, Hex, MilestoneTermsV1, OrderTermsV1 } from "./types.ts";

export const WORK_AUTHORIZATION_VERSION = "proofkey.work-treasury.work-authorization.v1" as const;
export const WORK_AUTHORIZATION_TYPE_HASH = id("ProofKeyWorkAuthorizationV1(bytes32 commercialTermsHash,bytes32 epochId,bytes32 orderTermsHash,bytes32 targetFundingHash,bytes32 sourceCapacityHash)") as Hex;
export const COMMERCIAL_TERMS_TYPE_HASH = id("ProofKeyCommercialTermsV1(bytes32 scopeHash,bytes32 acceptanceCriteriaHash,bytes32 revisionTermsHash,bytes32 deliveryRequirementsHash,bytes32 deliveryCommitmentFormatHash)") as Hex;
export const AUTHORIZATION_ORDER_TYPE_HASH = id("ProofKeyAuthorizationOrderV1(address worker,address claimOwner,address destination,address feeOwner,address feeDestination,bytes32 committeeHash,uint64 acceptBefore,uint64 nonce,bytes32 milestonesHash)") as Hex;
export const TARGET_FUNDING_TYPE_HASH = id("ProofKeyTargetFundingObservationV1(uint256 targetChainId,address targetTreasury,uint256 blockNumber,bytes32 blockHash,bytes32 finalityBasisHash,bytes32 epochId,uint256 cap,uint256 reserve,uint256 requiredMaximum)") as Hex;
export const SOURCE_CAPACITY_TYPE_HASH = id("ProofKeySourceCapacityObservationV1(uint256 sourceChainId,address sourceCoordinator,uint256 blockNumber,bytes32 blockHash,bytes32 finalityBasisHash,bytes32 epochId,uint8 phase,uint256 available,uint32 reservations,uint32 remainingMilestoneAdmissions,uint256 requiredMaximum)") as Hex;

const abi = AbiCoder.defaultAbiCoder();
const HALF_CURVE_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const MAX_TEXT_BYTES = 16_384;
const MAX_PACKAGE_BYTES = 131_072;
const EIP1271_MAGIC = "0x1626ba7e";

const EPOCH_TUPLE = "tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)";
const EPOCH_FIELDS = ["sourceChainId", "sourceChainKey", "sourceCoordinator", "sourceVersion", "targetChainId", "targetTreasury", "schemaVersion", "sourceSafe", "sponsor", "refundBeneficiary", "asset", "cap", "policyHash", "initializationCutoff", "admissionCutoff", "maxMilestones", "maxActiveReturns", "maxDrainingReturns", "treeDepth", "nonce"] as const;

const sourceInterface = new Interface([
  `function epochConfig(bytes32 epochId) view returns (${EPOCH_TUPLE})`,
  "function epochState(bytes32 epochId) view returns (tuple(bool initialized,bool expiredUninitialized,uint32 leafCount,bytes32 root,uint256 available,uint256 unresolved,uint256 earned,uint256 returned,uint8 phase,uint32 reservations,uint32 unresolvedMilestones,uint32 activeReturns,uint32 drainingReturns))",
  "function quoteNonceState(bytes32 epochId,address worker,uint64 nonce) view returns (uint8)",
]);
const targetInterface = new Interface([
  `function epochConfig(bytes32 epochId) view returns (${EPOCH_TUPLE})`,
  "function epochAccount(bytes32 epochId) view returns (tuple(uint256 reserve,uint256 recognized,bool funded))",
]);
const signatureInterface = new Interface(["function isValidSignature(bytes32 digest,bytes signature) view returns (bytes4)"]);

export type DecimalString = `${bigint}`;

export interface CommercialTermsV1 {
  scope: string;
  acceptanceCriteria: string;
  revisionTerms: string;
  deliveryRequirements: string;
  /** Describes how a later delivery is committed. It must not contain an unknown future delivery hash. */
  deliveryCommitmentFormat: string;
}

export interface SerializedEpochConfigV1 extends Omit<EpochConfigV1, "sourceChainId" | "sourceChainKey" | "targetChainId" | "cap" | "initializationCutoff" | "admissionCutoff" | "nonce"> {
  sourceChainId: DecimalString;
  sourceChainKey: DecimalString;
  targetChainId: DecimalString;
  cap: DecimalString;
  initializationCutoff: DecimalString;
  admissionCutoff: DecimalString;
  nonce: DecimalString;
}

export interface SerializedMilestoneTermsV1 extends Omit<MilestoneTermsV1, "work" | "fee" | "timeoutWork" | "deliverBefore" | "reviewBefore" | "ruleBefore"> {
  work: DecimalString;
  fee: DecimalString;
  timeoutWork: DecimalString;
  deliverBefore: DecimalString;
  reviewBefore: DecimalString;
  ruleBefore: DecimalString;
}

export interface AuthorizationOrderV1 {
  worker: Address;
  claimOwner: Address;
  destination: Address;
  feeOwner: Address;
  feeDestination: Address;
  committee: readonly [Address, Address, Address];
  acceptBefore: DecimalString;
  nonce: DecimalString;
  milestones: readonly SerializedMilestoneTermsV1[];
}

export interface TargetFundingObservationV1 {
  targetChainId: DecimalString;
  targetTreasury: Address;
  blockNumber: DecimalString;
  blockHash: Hex;
  finalityBasis: string;
  epochId: Hex;
  cap: DecimalString;
  reserve: DecimalString;
  requiredMaximum: DecimalString;
}

export interface SourceCapacityObservationV1 {
  sourceChainId: DecimalString;
  sourceCoordinator: Address;
  blockNumber: DecimalString;
  blockHash: Hex;
  finalityBasis: string;
  epochId: Hex;
  phase: 1;
  available: DecimalString;
  reservations: number;
  remainingMilestoneAdmissions: number;
  requiredMaximum: DecimalString;
}

export interface WorkAuthorizationContentV1 {
  commercialTerms: CommercialTermsV1;
  epochConfig: SerializedEpochConfigV1;
  order: AuthorizationOrderV1;
  targetFunding: TargetFundingObservationV1;
  sourceCapacity: SourceCapacityObservationV1;
}

export interface SerializedOrderTermsV1 extends Omit<OrderTermsV1, "acceptBefore" | "nonce" | "milestones"> {
  acceptBefore: DecimalString;
  nonce: DecimalString;
  milestones: readonly SerializedMilestoneTermsV1[];
}

export interface SignatureValidationBlockV1 {
  sourceChainId: DecimalString;
  sourceCoordinator: Address;
  blockNumber: DecimalString;
  blockHash: Hex;
}

export interface WorkAuthorizationPackageV1 {
  version: typeof WORK_AUTHORIZATION_VERSION;
  createdAt: string;
  authorization: WorkAuthorizationContentV1;
  termsHash: Hex;
  orderId: Hex;
  orderTerms: SerializedOrderTermsV1;
  workerSignature?: Hex;
  signatureValidation?: SignatureValidationBlockV1;
}

export interface PinnedBlock {
  number: number;
  hash: string | null;
}

export interface WorkAuthorizationProvider extends Pick<Provider, "getNetwork" | "getBlock" | "getCode" | "call"> {}

export interface CurrentAuthorizationVerification {
  sourceBlock: { number: number; hash: Hex };
  targetBlock: { number: number; hash: Hex };
  requiredMaximum: bigint;
  sourceAvailable: bigint;
  sourceRemainingMilestoneAdmissions: number;
  targetReserve: bigint;
  quoteNonceState: number;
}

function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const result = value as Record<string, unknown>;
  const extras = Object.keys(result).filter(key => !keys.includes(key));
  if (extras.length) throw new Error(`${label} has unsupported field ${extras[0]}`);
  return result;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a nonempty string`);
  if (value.normalize("NFC") !== value) throw new Error(`${label} must use NFC Unicode normalization`);
  if (toUtf8Bytes(value).length > MAX_TEXT_BYTES) throw new Error(`${label} exceeds ${MAX_TEXT_BYTES} UTF-8 bytes`);
  return value;
}

function decimal(value: unknown, label: string, bits = 256, nonzero = false): DecimalString {
  const rendered = typeof value === "bigint" ? value.toString() : value;
  if (typeof rendered !== "string" || !/^(0|[1-9][0-9]*)$/.test(rendered)) throw new Error(`${label} must be canonical unsigned decimal text`);
  const parsed = BigInt(rendered);
  if (parsed >= (1n << BigInt(bits)) || (nonzero && parsed === 0n)) throw new Error(`${label} is outside uint${bits}`);
  return rendered as DecimalString;
}

function integer(value: unknown, label: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be an integer from 0 through ${maximum}`);
  return value;
}

function address(value: unknown, label: string, allowZero = false): Address {
  if (typeof value !== "string") throw new Error(`${label} must be an address`);
  const normalized = getAddress(value) as Address;
  if (!allowZero && normalized === "0x0000000000000000000000000000000000000000") throw new Error(`${label} must be nonzero`);
  return normalized;
}

function bytes32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHexString(value, 32)) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase() as Hex;
}

function signature(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHexString(value) || value.length <= 2) throw new Error(`${label} must be nonempty hex bytes`);
  return value.toLowerCase() as Hex;
}

function isoDate(value: unknown, label: string): string {
  const result = text(value, label);
  if (Number.isNaN(Date.parse(result)) || new Date(result).toISOString() !== result) throw new Error(`${label} must be a canonical ISO timestamp`);
  return result;
}

function equalHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function hashText(value: string): Hex {
  return keccak256(toUtf8Bytes(value)) as Hex;
}

function parseCommercialTerms(value: unknown): CommercialTermsV1 {
  const v = object(value, "authorization.commercialTerms", ["scope", "acceptanceCriteria", "revisionTerms", "deliveryRequirements", "deliveryCommitmentFormat"]);
  return {
    scope: text(v.scope, "authorization.commercialTerms.scope"),
    acceptanceCriteria: text(v.acceptanceCriteria, "authorization.commercialTerms.acceptanceCriteria"),
    revisionTerms: text(v.revisionTerms, "authorization.commercialTerms.revisionTerms"),
    deliveryRequirements: text(v.deliveryRequirements, "authorization.commercialTerms.deliveryRequirements"),
    deliveryCommitmentFormat: text(v.deliveryCommitmentFormat, "authorization.commercialTerms.deliveryCommitmentFormat"),
  };
}

function parseEpochConfig(value: unknown): SerializedEpochConfigV1 {
  const v = object(value, "authorization.epochConfig", EPOCH_FIELDS);
  const runtime = normalizeEpochConfig({
    sourceChainId: BigInt(decimal(v.sourceChainId, "authorization.epochConfig.sourceChainId", 256, true)),
    sourceChainKey: BigInt(decimal(v.sourceChainKey, "authorization.epochConfig.sourceChainKey", 64, true)),
    sourceCoordinator: address(v.sourceCoordinator, "authorization.epochConfig.sourceCoordinator"),
    sourceVersion: bytes32(v.sourceVersion, "authorization.epochConfig.sourceVersion"),
    targetChainId: BigInt(decimal(v.targetChainId, "authorization.epochConfig.targetChainId", 256, true)),
    targetTreasury: address(v.targetTreasury, "authorization.epochConfig.targetTreasury"),
    schemaVersion: bytes32(v.schemaVersion, "authorization.epochConfig.schemaVersion"),
    sourceSafe: address(v.sourceSafe, "authorization.epochConfig.sourceSafe"),
    sponsor: address(v.sponsor, "authorization.epochConfig.sponsor"),
    refundBeneficiary: address(v.refundBeneficiary, "authorization.epochConfig.refundBeneficiary"),
    asset: address(v.asset, "authorization.epochConfig.asset", true),
    cap: BigInt(decimal(v.cap, "authorization.epochConfig.cap", 256, true)),
    policyHash: bytes32(v.policyHash, "authorization.epochConfig.policyHash"),
    initializationCutoff: BigInt(decimal(v.initializationCutoff, "authorization.epochConfig.initializationCutoff", 64, true)),
    admissionCutoff: BigInt(decimal(v.admissionCutoff, "authorization.epochConfig.admissionCutoff", 64, true)),
    maxMilestones: integer(v.maxMilestones, "authorization.epochConfig.maxMilestones", 0xffffffff),
    maxActiveReturns: integer(v.maxActiveReturns, "authorization.epochConfig.maxActiveReturns", 0xffffffff),
    maxDrainingReturns: integer(v.maxDrainingReturns, "authorization.epochConfig.maxDrainingReturns", 0xffffffff),
    treeDepth: integer(v.treeDepth, "authorization.epochConfig.treeDepth", 0xff),
    nonce: BigInt(decimal(v.nonce, "authorization.epochConfig.nonce", 64)),
  });
  return serializeEpochConfig(runtime);
}

function parseMilestone(value: unknown, index: number): SerializedMilestoneTermsV1 {
  const label = `authorization.order.milestones[${index}]`;
  const v = object(value, label, ["work", "fee", "timeoutWork", "deliverBefore", "reviewBefore", "ruleBefore"]);
  const normalized = normalizeMilestone({
    work: BigInt(decimal(v.work, `${label}.work`, 256, true)),
    fee: BigInt(decimal(v.fee, `${label}.fee`)),
    timeoutWork: BigInt(decimal(v.timeoutWork, `${label}.timeoutWork`)),
    deliverBefore: BigInt(decimal(v.deliverBefore, `${label}.deliverBefore`, 64, true)),
    reviewBefore: BigInt(decimal(v.reviewBefore, `${label}.reviewBefore`, 64, true)),
    ruleBefore: BigInt(decimal(v.ruleBefore, `${label}.ruleBefore`, 64, true)),
  });
  return serializeMilestone(normalized);
}

function parseAuthorizationOrder(value: unknown): AuthorizationOrderV1 {
  const v = object(value, "authorization.order", ["worker", "claimOwner", "destination", "feeOwner", "feeDestination", "committee", "acceptBefore", "nonce", "milestones"]);
  if (!Array.isArray(v.committee) || v.committee.length !== 3) throw new Error("authorization.order.committee must contain exactly three addresses");
  const committee = v.committee.map((item, index) => address(item, `authorization.order.committee[${index}]`)) as [Address, Address, Address];
  if (new Set(committee.map(item => item.toLowerCase())).size !== 3) throw new Error("authorization.order.committee addresses must be distinct");
  if (!Array.isArray(v.milestones) || v.milestones.length === 0 || v.milestones.length > 32) throw new Error("authorization.order.milestones must contain 1 through 32 entries");
  const milestones = v.milestones.map(parseMilestone);
  const acceptBefore = decimal(v.acceptBefore, "authorization.order.acceptBefore", 64, true);
  for (const [index, milestone] of milestones.entries()) {
    if (BigInt(acceptBefore) >= BigInt(milestone.deliverBefore)) throw new Error(`authorization.order.acceptBefore must precede milestone ${index} delivery`);
  }
  return {
    worker: address(v.worker, "authorization.order.worker"),
    claimOwner: address(v.claimOwner, "authorization.order.claimOwner"),
    destination: address(v.destination, "authorization.order.destination"),
    feeOwner: address(v.feeOwner, "authorization.order.feeOwner"),
    feeDestination: address(v.feeDestination, "authorization.order.feeDestination"),
    committee,
    acceptBefore,
    nonce: decimal(v.nonce, "authorization.order.nonce", 64),
    milestones,
  };
}

function parseTargetFunding(value: unknown): TargetFundingObservationV1 {
  const v = object(value, "authorization.targetFunding", ["targetChainId", "targetTreasury", "blockNumber", "blockHash", "finalityBasis", "epochId", "cap", "reserve", "requiredMaximum"]);
  const result: TargetFundingObservationV1 = {
    targetChainId: decimal(v.targetChainId, "authorization.targetFunding.targetChainId", 256, true),
    targetTreasury: address(v.targetTreasury, "authorization.targetFunding.targetTreasury"),
    blockNumber: decimal(v.blockNumber, "authorization.targetFunding.blockNumber", 256),
    blockHash: bytes32(v.blockHash, "authorization.targetFunding.blockHash"),
    finalityBasis: text(v.finalityBasis, "authorization.targetFunding.finalityBasis"),
    epochId: bytes32(v.epochId, "authorization.targetFunding.epochId"),
    cap: decimal(v.cap, "authorization.targetFunding.cap", 256, true),
    reserve: decimal(v.reserve, "authorization.targetFunding.reserve"),
    requiredMaximum: decimal(v.requiredMaximum, "authorization.targetFunding.requiredMaximum", 256, true),
  };
  if (result.finalityBasis !== "rpc-finalized-tag") throw new Error("authorization.targetFunding.finalityBasis must be rpc-finalized-tag");
  return result;
}

function parseSourceCapacity(value: unknown): SourceCapacityObservationV1 {
  const v = object(value, "authorization.sourceCapacity", ["sourceChainId", "sourceCoordinator", "blockNumber", "blockHash", "finalityBasis", "epochId", "phase", "available", "reservations", "remainingMilestoneAdmissions", "requiredMaximum"]);
  const phase = integer(v.phase, "authorization.sourceCapacity.phase", 0xff);
  if (phase !== 1) throw new Error("authorization.sourceCapacity.phase must be ACTIVE (1)");
  const reservations = integer(v.reservations, "authorization.sourceCapacity.reservations", 32);
  const remaining = integer(v.remainingMilestoneAdmissions, "authorization.sourceCapacity.remainingMilestoneAdmissions", 32);
  if (remaining !== 32 - reservations) throw new Error("authorization.sourceCapacity remaining milestone admissions do not match reservations");
  const result: SourceCapacityObservationV1 = {
    sourceChainId: decimal(v.sourceChainId, "authorization.sourceCapacity.sourceChainId", 256, true),
    sourceCoordinator: address(v.sourceCoordinator, "authorization.sourceCapacity.sourceCoordinator"),
    blockNumber: decimal(v.blockNumber, "authorization.sourceCapacity.blockNumber", 256),
    blockHash: bytes32(v.blockHash, "authorization.sourceCapacity.blockHash"),
    finalityBasis: text(v.finalityBasis, "authorization.sourceCapacity.finalityBasis"),
    epochId: bytes32(v.epochId, "authorization.sourceCapacity.epochId"),
    phase: 1,
    available: decimal(v.available, "authorization.sourceCapacity.available"),
    reservations,
    remainingMilestoneAdmissions: remaining,
    requiredMaximum: decimal(v.requiredMaximum, "authorization.sourceCapacity.requiredMaximum", 256, true),
  };
  if (result.finalityBasis !== "rpc-finalized-tag") throw new Error("authorization.sourceCapacity.finalityBasis must be rpc-finalized-tag");
  return result;
}

function parseContent(value: unknown): WorkAuthorizationContentV1 {
  const v = object(value, "authorization", ["commercialTerms", "epochConfig", "order", "targetFunding", "sourceCapacity"]);
  const result = {
    commercialTerms: parseCommercialTerms(v.commercialTerms),
    epochConfig: parseEpochConfig(v.epochConfig),
    order: parseAuthorizationOrder(v.order),
    targetFunding: parseTargetFunding(v.targetFunding),
    sourceCapacity: parseSourceCapacity(v.sourceCapacity),
  };
  const config = deserializeEpochConfig(result.epochConfig);
  const expectedEpoch = epochId(config);
  const required = requiredMaximum(result.order.milestones);
  if (!equalHex(result.targetFunding.epochId, expectedEpoch) || !equalHex(result.sourceCapacity.epochId, expectedEpoch)) throw new Error("authorization observations do not identify the derived epoch");
  if (BigInt(result.targetFunding.targetChainId) !== config.targetChainId || !equalHex(result.targetFunding.targetTreasury, config.targetTreasury)) throw new Error("target funding observation domain differs from epoch configuration");
  if (BigInt(result.sourceCapacity.sourceChainId) !== config.sourceChainId || !equalHex(result.sourceCapacity.sourceCoordinator, config.sourceCoordinator)) throw new Error("source capacity observation domain differs from epoch configuration");
  if (BigInt(result.targetFunding.cap) !== config.cap) throw new Error("target funding observation cap differs from epoch configuration");
  if (BigInt(result.targetFunding.requiredMaximum) !== required || BigInt(result.sourceCapacity.requiredMaximum) !== required) throw new Error("observation requiredMaximum differs from the complete milestone reserve");
  if (BigInt(result.targetFunding.reserve) < required) throw new Error("observed target reserve is below requiredMaximum");
  if (BigInt(result.targetFunding.reserve) > config.cap) throw new Error("observed target reserve exceeds epoch cap");
  if (BigInt(result.sourceCapacity.available) < required) throw new Error("observed source capacity is below requiredMaximum");
  if (BigInt(result.sourceCapacity.available) > config.cap) throw new Error("observed source capacity exceeds epoch cap");
  if (result.sourceCapacity.remainingMilestoneAdmissions < result.order.milestones.length) throw new Error("observed source milestone admission capacity is insufficient");
  return result;
}

function serializeEpochConfig(value: EpochConfigV1): SerializedEpochConfigV1 {
  const c = normalizeEpochConfig(value);
  return { ...c, sourceChainId: c.sourceChainId.toString() as DecimalString, sourceChainKey: c.sourceChainKey.toString() as DecimalString, targetChainId: c.targetChainId.toString() as DecimalString, cap: c.cap.toString() as DecimalString, initializationCutoff: c.initializationCutoff.toString() as DecimalString, admissionCutoff: c.admissionCutoff.toString() as DecimalString, nonce: c.nonce.toString() as DecimalString };
}

function deserializeEpochConfig(value: SerializedEpochConfigV1): EpochConfigV1 {
  return normalizeEpochConfig({ ...value, sourceChainId: BigInt(value.sourceChainId), sourceChainKey: BigInt(value.sourceChainKey), targetChainId: BigInt(value.targetChainId), cap: BigInt(value.cap), initializationCutoff: BigInt(value.initializationCutoff), admissionCutoff: BigInt(value.admissionCutoff), nonce: BigInt(value.nonce) });
}

function serializeMilestone(value: MilestoneTermsV1): SerializedMilestoneTermsV1 {
  const m = normalizeMilestone(value);
  return { work: m.work.toString() as DecimalString, fee: m.fee.toString() as DecimalString, timeoutWork: m.timeoutWork.toString() as DecimalString, deliverBefore: m.deliverBefore.toString() as DecimalString, reviewBefore: m.reviewBefore.toString() as DecimalString, ruleBefore: m.ruleBefore.toString() as DecimalString };
}

function deserializeMilestone(value: SerializedMilestoneTermsV1): MilestoneTermsV1 {
  return normalizeMilestone({ work: BigInt(value.work), fee: BigInt(value.fee), timeoutWork: BigInt(value.timeoutWork), deliverBefore: BigInt(value.deliverBefore), reviewBefore: BigInt(value.reviewBefore), ruleBefore: BigInt(value.ruleBefore) });
}

function serializeOrderTerms(value: OrderTermsV1): SerializedOrderTermsV1 {
  return { ...value, acceptBefore: value.acceptBefore.toString() as DecimalString, nonce: value.nonce.toString() as DecimalString, milestones: value.milestones.map(serializeMilestone) };
}

function parseSerializedOrderTerms(value: unknown): SerializedOrderTermsV1 {
  const v = object(value, "orderTerms", ["epochId", "termsHash", "worker", "claimOwner", "destination", "feeOwner", "feeDestination", "committee", "acceptBefore", "nonce", "milestones"]);
  const order = parseAuthorizationOrder({ worker: v.worker, claimOwner: v.claimOwner, destination: v.destination, feeOwner: v.feeOwner, feeDestination: v.feeDestination, committee: v.committee, acceptBefore: v.acceptBefore, nonce: v.nonce, milestones: v.milestones });
  return { epochId: bytes32(v.epochId, "orderTerms.epochId"), termsHash: bytes32(v.termsHash, "orderTerms.termsHash"), ...order };
}

function runtimeOrderTerms(value: SerializedOrderTermsV1): OrderTermsV1 {
  return { ...value, acceptBefore: BigInt(value.acceptBefore), nonce: BigInt(value.nonce), milestones: value.milestones.map(deserializeMilestone) };
}

function requiredMaximum(milestones: readonly SerializedMilestoneTermsV1[]): bigint {
  return milestones.reduce((sum, item) => sum + BigInt(item.work) + BigInt(item.fee), 0n);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commercialTermsHash(value: CommercialTermsV1): Hex {
  return keccak256(abi.encode(["bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"], [COMMERCIAL_TERMS_TYPE_HASH, hashText(value.scope), hashText(value.acceptanceCriteria), hashText(value.revisionTerms), hashText(value.deliveryRequirements), hashText(value.deliveryCommitmentFormat)])) as Hex;
}

function authorizationOrderHash(value: AuthorizationOrderV1): Hex {
  const committeeHash = keccak256(abi.encode(["address[3]"], [value.committee]));
  const milestonesHash = keccak256(abi.encode(["bytes32[]"], [value.milestones.map(item => milestoneHash(deserializeMilestone(item)))]));
  return keccak256(abi.encode(["bytes32", "address", "address", "address", "address", "address", "bytes32", "uint64", "uint64", "bytes32"], [AUTHORIZATION_ORDER_TYPE_HASH, value.worker, value.claimOwner, value.destination, value.feeOwner, value.feeDestination, committeeHash, value.acceptBefore, value.nonce, milestonesHash])) as Hex;
}

function targetFundingHash(value: TargetFundingObservationV1): Hex {
  return keccak256(abi.encode(["bytes32", "uint256", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "uint256", "uint256"], [TARGET_FUNDING_TYPE_HASH, value.targetChainId, value.targetTreasury, value.blockNumber, value.blockHash, hashText(value.finalityBasis), value.epochId, value.cap, value.reserve, value.requiredMaximum])) as Hex;
}

function sourceCapacityHash(value: SourceCapacityObservationV1): Hex {
  return keccak256(abi.encode(["bytes32", "uint256", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint8", "uint256", "uint32", "uint32", "uint256"], [SOURCE_CAPACITY_TYPE_HASH, value.sourceChainId, value.sourceCoordinator, value.blockNumber, value.blockHash, hashText(value.finalityBasis), value.epochId, value.phase, value.available, value.reservations, value.remainingMilestoneAdmissions, value.requiredMaximum])) as Hex;
}

/** Hashes every reviewed authorization field. orderId, signatures and future delivery hashes are deliberately absent. */
export function workAuthorizationTermsHash(value: WorkAuthorizationContentV1): Hex {
  const content = parseContent(value);
  return keccak256(abi.encode(["bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"], [WORK_AUTHORIZATION_TYPE_HASH, commercialTermsHash(content.commercialTerms), epochId(deserializeEpochConfig(content.epochConfig)), authorizationOrderHash(content.order), targetFundingHash(content.targetFunding), sourceCapacityHash(content.sourceCapacity)])) as Hex;
}

export function deriveWorkAuthorizationOrderTerms(value: WorkAuthorizationContentV1): OrderTermsV1 {
  const content = parseContent(value);
  return {
    epochId: epochId(deserializeEpochConfig(content.epochConfig)),
    termsHash: workAuthorizationTermsHash(content),
    worker: content.order.worker,
    claimOwner: content.order.claimOwner,
    destination: content.order.destination,
    feeOwner: content.order.feeOwner,
    feeDestination: content.order.feeDestination,
    committee: content.order.committee,
    acceptBefore: BigInt(content.order.acceptBefore),
    nonce: BigInt(content.order.nonce),
    milestones: content.order.milestones.map(deserializeMilestone),
  };
}

export function createWorkAuthorizationDraft(options: { authorization: WorkAuthorizationContentV1; createdAt?: string }): WorkAuthorizationPackageV1 {
  const authorization = parseContent(options.authorization);
  const orderTerms = deriveWorkAuthorizationOrderTerms(authorization);
  return {
    version: WORK_AUTHORIZATION_VERSION,
    createdAt: options.createdAt === undefined ? new Date().toISOString() : isoDate(options.createdAt, "createdAt"),
    authorization,
    termsHash: orderTerms.termsHash,
    orderId: orderId(orderTerms),
    orderTerms: serializeOrderTerms(orderTerms),
  };
}

export function attachWorkerQuoteSignature(value: WorkAuthorizationPackageV1, options: { workerSignature: Hex; signatureValidation: SignatureValidationBlockV1 }): WorkAuthorizationPackageV1 {
  const parsed = parseWorkAuthorizationPackage(value);
  if (parsed.workerSignature) throw new Error("work authorization already has a worker signature");
  return parseWorkAuthorizationPackage({ ...parsed, workerSignature: signature(options.workerSignature, "workerSignature"), signatureValidation: options.signatureValidation });
}

/** Parses untrusted JSON and recomputes commitments. It does not import or trust a verification verdict. */
export function parseWorkAuthorizationPackage(input: string | unknown): WorkAuthorizationPackageV1 {
  if (typeof input === "string" && toUtf8Bytes(input).length > MAX_PACKAGE_BYTES) throw new Error(`work authorization exceeds ${MAX_PACKAGE_BYTES} UTF-8 bytes`);
  let decoded: unknown;
  try { decoded = typeof input === "string" ? JSON.parse(input) : input; } catch { throw new Error("work authorization is not valid JSON"); }
  const root = object(decoded, "work authorization", ["version", "createdAt", "authorization", "termsHash", "orderId", "orderTerms", "workerSignature", "signatureValidation"]);
  if (root.version !== WORK_AUTHORIZATION_VERSION) throw new Error(`unsupported work-authorization version: ${String(root.version)}`);
  const authorization = parseContent(root.authorization);
  const derivedTerms = deriveWorkAuthorizationOrderTerms(authorization);
  const derivedOrderId = orderId(derivedTerms);
  const suppliedTermsHash = bytes32(root.termsHash, "termsHash");
  const suppliedOrderId = bytes32(root.orderId, "orderId");
  const suppliedTerms = parseSerializedOrderTerms(root.orderTerms);
  const expectedTerms = serializeOrderTerms(derivedTerms);
  if (!equalHex(suppliedTermsHash, derivedTerms.termsHash)) throw new Error("termsHash does not match the canonical authorization");
  if (!equalHex(suppliedOrderId, derivedOrderId)) throw new Error("orderId does not match the canonical authorization and termsHash");
  if (!sameJson(suppliedTerms, expectedTerms)) throw new Error("orderTerms do not exactly match the canonical authorization");
  const hasSignature = root.workerSignature !== undefined;
  const hasValidation = root.signatureValidation !== undefined;
  if (hasSignature !== hasValidation) throw new Error("workerSignature and signatureValidation must be supplied together");
  let validation: SignatureValidationBlockV1 | undefined;
  if (hasValidation) {
    const v = object(root.signatureValidation, "signatureValidation", ["sourceChainId", "sourceCoordinator", "blockNumber", "blockHash"]);
    validation = {
      sourceChainId: decimal(v.sourceChainId, "signatureValidation.sourceChainId", 256, true),
      sourceCoordinator: address(v.sourceCoordinator, "signatureValidation.sourceCoordinator"),
      blockNumber: decimal(v.blockNumber, "signatureValidation.blockNumber", 256),
      blockHash: bytes32(v.blockHash, "signatureValidation.blockHash"),
    };
    const config = deserializeEpochConfig(authorization.epochConfig);
    if (BigInt(validation.sourceChainId) !== config.sourceChainId || !equalHex(validation.sourceCoordinator, config.sourceCoordinator)) throw new Error("signature validation domain differs from epoch configuration");
  }
  return {
    version: WORK_AUTHORIZATION_VERSION,
    createdAt: isoDate(root.createdAt, "createdAt"),
    authorization,
    termsHash: suppliedTermsHash,
    orderId: suppliedOrderId,
    orderTerms: suppliedTerms,
    ...(hasSignature ? { workerSignature: signature(root.workerSignature, "workerSignature"), signatureValidation: validation! } : {}),
  };
}

export function stringifyWorkAuthorizationPackage(value: WorkAuthorizationPackageV1): string {
  return JSON.stringify(parseWorkAuthorizationPackage(value), null, 2);
}

function requireSigned(value: WorkAuthorizationPackageV1): WorkAuthorizationPackageV1 & Required<Pick<WorkAuthorizationPackageV1, "workerSignature" | "signatureValidation">> {
  const parsed = parseWorkAuthorizationPackage(value);
  if (!parsed.workerSignature || !parsed.signatureValidation) throw new Error("work authorization is unsigned");
  return parsed as WorkAuthorizationPackageV1 & Required<Pick<WorkAuthorizationPackageV1, "workerSignature" | "signatureValidation">>;
}

/** Verifies the exact EOA rule in SourceSignatureLib. The caller is responsible for establishing that the worker had no code. */
export function verifyEoaWorkerQuoteOffline(value: WorkAuthorizationPackageV1): { digest: Hex; recoveredWorker: Address } {
  const parsed = requireSigned(value);
  const raw = parsed.workerSignature.slice(2);
  if (raw.length !== 130) throw new Error("EOA signature must be exactly 65 bytes");
  const r = `0x${raw.slice(0, 64)}` as Hex;
  const s = `0x${raw.slice(64, 128)}` as Hex;
  const v = Number.parseInt(raw.slice(128, 130), 16);
  if (v !== 27 && v !== 28) throw new Error("EOA signature v must be 27 or 28");
  if (BigInt(s) > HALF_CURVE_ORDER) throw new Error("EOA signature s is not low-s");
  const config = deserializeEpochConfig(parsed.authorization.epochConfig);
  const digest = quoteDigest({ chainId: config.sourceChainId, coordinator: config.sourceCoordinator, orderId: parsed.orderId });
  let recovered: Address;
  try { recovered = getAddress(recoverAddress(digest, { r, s, v })) as Address; } catch { throw new Error("EOA signature is malformed"); }
  if (!equalHex(recovered, parsed.orderTerms.worker)) throw new Error("EOA signature does not recover the named worker");
  return { digest, recoveredWorker: recovered };
}

async function checkedBlock(provider: WorkAuthorizationProvider, blockNumber: DecimalString, expectedHash: Hex, label: string): Promise<{ number: number; hash: Hex }> {
  const number = Number(BigInt(blockNumber));
  if (!Number.isSafeInteger(number)) throw new Error(`${label} block number is not safely queryable`);
  const block = await provider.getBlock(number);
  if (!block || block.hash === null || !equalHex(block.hash, expectedHash)) throw new Error(`${label} block hash does not match the package`);
  return { number, hash: bytes32(block.hash, `${label} block hash`) };
}

async function checkedNetwork(provider: WorkAuthorizationProvider, chainId: bigint, label: string): Promise<void> {
  const network = await provider.getNetwork();
  if (network.chainId !== chainId) throw new Error(`${label} provider reports chain ${network.chainId}; expected ${chainId}`);
}

async function rpcCall(provider: WorkAuthorizationProvider, iface: Interface, addressValue: Address, functionName: string, args: readonly unknown[], blockNumber: number): Promise<any> {
  const data = iface.encodeFunctionData(functionName, [...args]);
  const result = await provider.call({ to: addressValue, data, blockTag: blockNumber });
  return iface.decodeFunctionResult(functionName, result)[0];
}

export async function verifyWorkerQuoteSignatureAtSource(value: WorkAuthorizationPackageV1, provider: WorkAuthorizationProvider): Promise<{ kind: "eoa" | "erc1271"; digest: Hex; blockNumber: number; blockHash: Hex }> {
  const parsed = requireSigned(value);
  const validation = parsed.signatureValidation;
  await checkedNetwork(provider, BigInt(validation.sourceChainId), "source");
  const [finalized, block] = await Promise.all([
    resolvedFreshBlock(provider, "finalized", "source"),
    checkedBlock(provider, validation.blockNumber, validation.blockHash, "signature validation"),
  ]);
  if (block.number > finalized.number) throw new Error("signature validation block is outside the current finalized prefix");
  const code = await provider.getCode(parsed.orderTerms.worker, block.number);
  const config = deserializeEpochConfig(parsed.authorization.epochConfig);
  const digest = quoteDigest({ chainId: config.sourceChainId, coordinator: config.sourceCoordinator, orderId: parsed.orderId });
  if (code === "0x") {
    verifyEoaWorkerQuoteOffline(parsed);
    await checkedBlock(provider, validation.blockNumber, validation.blockHash, "signature validation after reads");
    return { kind: "eoa", digest, blockNumber: block.number, blockHash: block.hash };
  }
  const data = signatureInterface.encodeFunctionData("isValidSignature", [digest, parsed.workerSignature]);
  let result: string;
  try { result = await provider.call({ to: parsed.orderTerms.worker, data, blockTag: block.number }); } catch { throw new Error("ERC-1271 signature check reverted at the identified source block"); }
  if (!isHexString(result) || (result.length - 2) / 2 < 32 || result.slice(0, 10).toLowerCase() !== EIP1271_MAGIC) throw new Error("ERC-1271 worker did not return the required magic value at the identified source block");
  await checkedBlock(provider, validation.blockNumber, validation.blockHash, "signature validation after reads");
  return { kind: "erc1271", digest, blockNumber: block.number, blockHash: block.hash };
}

/** Rechecks the quote under the worker's current source-chain code at a fresh finalized block. */
export async function verifyWorkerQuoteSignatureCurrent(value: WorkAuthorizationPackageV1, provider: WorkAuthorizationProvider): Promise<{ kind: "eoa" | "erc1271"; digest: Hex; blockNumber: number; blockHash: Hex }> {
  const parsed = requireSigned(value);
  const config = deserializeEpochConfig(parsed.authorization.epochConfig);
  await checkedNetwork(provider, config.sourceChainId, "source");
  const block = await resolvedFreshBlock(provider, "finalized", "source");
  const code = await provider.getCode(parsed.orderTerms.worker, block.number);
  const digest = quoteDigest({ chainId: config.sourceChainId, coordinator: config.sourceCoordinator, orderId: parsed.orderId });
  if (code === "0x") {
    verifyEoaWorkerQuoteOffline(parsed);
    await checkedBlock(provider, block.number.toString() as DecimalString, block.hash, "current signature validation after reads");
    return { kind: "eoa", digest, blockNumber: block.number, blockHash: block.hash };
  }
  const data = signatureInterface.encodeFunctionData("isValidSignature", [digest, parsed.workerSignature]);
  let result: string;
  try { result = await provider.call({ to: parsed.orderTerms.worker, data, blockTag: block.number }); } catch { throw new Error("ERC-1271 signature check reverted at the current finalized source block"); }
  if (!isHexString(result) || (result.length - 2) / 2 < 32 || result.slice(0, 10).toLowerCase() !== EIP1271_MAGIC) throw new Error("ERC-1271 worker did not return the required magic value at the current finalized source block");
  await checkedBlock(provider, block.number.toString() as DecimalString, block.hash, "current signature validation after reads");
  return { kind: "erc1271", digest, blockNumber: block.number, blockHash: block.hash };
}

function epochFromDecoded(value: any): EpochConfigV1 {
  const decoded = Object.fromEntries(EPOCH_FIELDS.map((field, index) => [field, value[field] ?? value[index]])) as Record<string, unknown>;
  for (const field of ["maxMilestones", "maxActiveReturns", "maxDrainingReturns", "treeDepth"] as const) decoded[field] = Number(decoded[field]);
  return normalizeEpochConfig(decoded as unknown as EpochConfigV1);
}

function assertEpochEqual(actual: EpochConfigV1, expected: SerializedEpochConfigV1, label: string): void {
  if (!sameJson(serializeEpochConfig(actual), expected)) throw new Error(`${label} epoch configuration differs from the authorization`);
}

/** Replays the committed historical observations. A success says nothing about current funding or eligibility. */
export async function verifyCommittedChainObservations(value: WorkAuthorizationPackageV1, providers: { source: WorkAuthorizationProvider; target: WorkAuthorizationProvider }): Promise<{ sourceBlock: { number: number; hash: Hex }; targetBlock: { number: number; hash: Hex } }> {
  const parsed = parseWorkAuthorizationPackage(value);
  const config = deserializeEpochConfig(parsed.authorization.epochConfig);
  const targetObservation = parsed.authorization.targetFunding;
  const sourceObservation = parsed.authorization.sourceCapacity;
  await Promise.all([checkedNetwork(providers.source, config.sourceChainId, "source"), checkedNetwork(providers.target, config.targetChainId, "target")]);
  const [sourceFinalized, targetFinalized, sourceBlock, targetBlock] = await Promise.all([
    resolvedFreshBlock(providers.source, "finalized", "source"),
    resolvedFreshBlock(providers.target, "finalized", "target"),
    checkedBlock(providers.source, sourceObservation.blockNumber, sourceObservation.blockHash, "source observation"),
    checkedBlock(providers.target, targetObservation.blockNumber, targetObservation.blockHash, "target observation"),
  ]);
  if (sourceBlock.number > sourceFinalized.number) throw new Error("source observation is outside the current finalized prefix");
  if (targetBlock.number > targetFinalized.number) throw new Error("target observation is outside the current finalized prefix");
  const [sourceConfig, sourceState, targetConfig, targetAccount] = await Promise.all([
    rpcCall(providers.source, sourceInterface, config.sourceCoordinator, "epochConfig", [sourceObservation.epochId], sourceBlock.number),
    rpcCall(providers.source, sourceInterface, config.sourceCoordinator, "epochState", [sourceObservation.epochId], sourceBlock.number),
    rpcCall(providers.target, targetInterface, config.targetTreasury, "epochConfig", [targetObservation.epochId], targetBlock.number),
    rpcCall(providers.target, targetInterface, config.targetTreasury, "epochAccount", [targetObservation.epochId], targetBlock.number),
  ]);
  assertEpochEqual(epochFromDecoded(sourceConfig), parsed.authorization.epochConfig, "source observation");
  assertEpochEqual(epochFromDecoded(targetConfig), parsed.authorization.epochConfig, "target observation");
  if (!sourceState.initialized || Number(sourceState.phase) !== sourceObservation.phase || BigInt(sourceState.available) !== BigInt(sourceObservation.available) || Number(sourceState.reservations) !== sourceObservation.reservations) throw new Error("historical source capacity state differs from the committed observation");
  if (!targetAccount.funded || BigInt(targetAccount.reserve) !== BigInt(targetObservation.reserve) || config.cap !== BigInt(targetObservation.cap)) throw new Error("historical target funding state differs from the committed observation");
  await Promise.all([
    checkedBlock(providers.source, sourceObservation.blockNumber, sourceObservation.blockHash, "source observation after reads"),
    checkedBlock(providers.target, targetObservation.blockNumber, targetObservation.blockHash, "target observation after reads"),
  ]);
  return { sourceBlock, targetBlock };
}

async function resolvedFreshBlock(provider: WorkAuthorizationProvider, requested: number | "finalized" | "latest", label: string): Promise<{ number: number; hash: Hex }> {
  const block = await provider.getBlock(requested);
  if (!block || block.hash === null) throw new Error(`${label} ${requested} block is unavailable`);
  return { number: block.number, hash: bytes32(block.hash, `${label} block hash`) };
}

/** Performs fresh application checks. Results are point-in-time observations, not a future funding guarantee. */
export async function verifyCurrentWorkAuthorization(value: WorkAuthorizationPackageV1, providers: { source: WorkAuthorizationProvider; target: WorkAuthorizationProvider }): Promise<CurrentAuthorizationVerification> {
  const parsed = parseWorkAuthorizationPackage(value);
  const config = deserializeEpochConfig(parsed.authorization.epochConfig);
  await Promise.all([checkedNetwork(providers.source, config.sourceChainId, "source"), checkedNetwork(providers.target, config.targetChainId, "target")]);
  const [sourceBlock, targetBlock] = await Promise.all([
    resolvedFreshBlock(providers.source, "finalized", "source"),
    resolvedFreshBlock(providers.target, "finalized", "target"),
  ]);
  const [sourceConfig, sourceState, nonceState, targetConfig, targetAccount] = await Promise.all([
    rpcCall(providers.source, sourceInterface, config.sourceCoordinator, "epochConfig", [parsed.orderTerms.epochId], sourceBlock.number),
    rpcCall(providers.source, sourceInterface, config.sourceCoordinator, "epochState", [parsed.orderTerms.epochId], sourceBlock.number),
    rpcCall(providers.source, sourceInterface, config.sourceCoordinator, "quoteNonceState", [parsed.orderTerms.epochId, parsed.orderTerms.worker, parsed.orderTerms.nonce], sourceBlock.number),
    rpcCall(providers.target, targetInterface, config.targetTreasury, "epochConfig", [parsed.orderTerms.epochId], targetBlock.number),
    rpcCall(providers.target, targetInterface, config.targetTreasury, "epochAccount", [parsed.orderTerms.epochId], targetBlock.number),
  ]);
  assertEpochEqual(epochFromDecoded(sourceConfig), parsed.authorization.epochConfig, "current source");
  assertEpochEqual(epochFromDecoded(targetConfig), parsed.authorization.epochConfig, "current target");
  const required = requiredMaximum(parsed.orderTerms.milestones);
  const remaining = 32 - Number(sourceState.reservations);
  if (!sourceState.initialized || Number(sourceState.phase) !== 1) throw new Error("source epoch is not active for a new quote");
  if (BigInt(sourceState.available) < required) throw new Error("current source capacity is below requiredMaximum");
  if (remaining < parsed.orderTerms.milestones.length) throw new Error("current source milestone admission capacity is insufficient");
  if (Number(nonceState) !== 0) throw new Error("worker quote nonce is no longer unused");
  if (BigInt(sourceBlock.number) >= BigInt(parsed.orderTerms.acceptBefore)) throw new Error("worker quote acceptance deadline has passed at the checked source block");
  if (BigInt(sourceBlock.number) >= config.admissionCutoff) throw new Error("epoch admission cutoff has passed at the checked source block");
  if (!targetAccount.funded) throw new Error("target epoch is not funded");
  if (BigInt(targetAccount.reserve) < required) throw new Error("current target reserve is below requiredMaximum");
  await Promise.all([
    checkedBlock(providers.source, sourceBlock.number.toString() as DecimalString, sourceBlock.hash, "current source after reads"),
    checkedBlock(providers.target, targetBlock.number.toString() as DecimalString, targetBlock.hash, "current target after reads"),
  ]);
  return { sourceBlock, targetBlock, requiredMaximum: required, sourceAvailable: BigInt(sourceState.available), sourceRemainingMilestoneAdmissions: remaining, targetReserve: BigInt(targetAccount.reserve), quoteNonceState: Number(nonceState) };
}
