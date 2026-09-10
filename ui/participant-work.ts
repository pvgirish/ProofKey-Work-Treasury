import { Interface, getAddress, id, isHexString, keccak256, toUtf8Bytes } from "ethers";
import { quoteTypedData } from "../sdk/identity.ts";
import type { Address, Hex } from "../sdk/types.ts";
import {
  attachWorkerQuoteSignature,
  parseWorkAuthorizationPackage,
  stringifyWorkAuthorizationPackage,
  verifyCommittedChainObservations,
  verifyCurrentWorkAuthorization,
  verifyWorkerQuoteSignatureAtSource,
  verifyWorkerQuoteSignatureCurrent,
} from "../sdk/work-authorization.ts";
import type {
  CurrentAuthorizationVerification,
  DecimalString,
  WorkAuthorizationPackageV1,
  WorkAuthorizationProvider,
} from "../sdk/work-authorization.ts";

export const PARTICIPANT_WORK_STORE_VERSION = "proofkey.work-treasury.participant-work-store.v1" as const;
export const PARTICIPANT_WORK_STORE_LIMIT = 64;

const STORE_MAX_BYTES = 9_000_000;
const DELIVERY_MAX_BYTES = 16_384;
const ZERO32 = `0x${"00".repeat(32)}`;
const UNKNOWN_ORDER_SELECTOR = id("UnknownOrder()").slice(0, 10).toLowerCase();

const sourceInterface = new Interface([
  "function order(bytes32 orderId) view returns (tuple(bool exists,bool agreed,bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,address[3] committee,uint64 acceptBefore,uint64 nonce,uint32 milestoneCount,uint32 finalizedCount))",
  "function milestone(bytes32 orderId,uint32 milestoneId) view returns (tuple(uint8 status,uint8 outcome,uint64 stateVersion,bytes32 deliveryHash,uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore,uint64 mutualNonce,uint256 finalWork,uint256 finalFee,bytes32 decisionHash,bytes32 evidenceHash))",
  "function deliver(bytes32 orderId,uint32 milestoneId,bytes32 deliveryHash)",
]);

export interface TrustedParticipantDomain {
  sourceChainId: DecimalString;
  sourceChainKey: DecimalString;
  sourceCoordinator: Address;
  targetChainId: DecimalString;
  targetTreasury: Address;
  sourceRuntimeHash: Hex;
  sourceDeploymentBlock: DecimalString;
  targetRuntimeHash: Hex;
  targetDeploymentBlock: DecimalString;
}

export interface ParticipantOfferSummary {
  orderId: Hex;
  epochId: Hex;
  worker: Address;
  claimOwner: Address;
  destination: Address;
  feeOwner: Address;
  feeDestination: Address;
  sourceSafe: Address;
  sponsor: Address;
  committee: readonly [Address, Address, Address];
  acceptBefore: DecimalString;
  scope: string;
  acceptanceCriteria: string;
  revisionTerms: string;
  deliveryRequirements: string;
  deliveryCommitmentFormat: string;
  requiredMaximum: DecimalString;
  milestones: WorkAuthorizationPackageV1["orderTerms"]["milestones"];
  testAsset: "native-ctc";
  fundingCreatesPrivateReservation: false;
}

export interface ParticipantOfferReview {
  packet: WorkAuthorizationPackageV1;
  summary: ParticipantOfferSummary;
  verification: CurrentAuthorizationVerification & {
    committedSourceBlock: { number: number; hash: Hex };
    committedTargetBlock: { number: number; hash: Hex };
  };
}

type WorkerSignatureVerification = Awaited<ReturnType<typeof verifyWorkerQuoteSignatureAtSource>>;

export interface SignedParticipantWorkReview {
  packet: WorkAuthorizationPackageV1;
  summary: ParticipantOfferSummary;
  work: ParticipantWorkRead;
  verification: {
    committedSourceBlock: { number: number; hash: Hex };
    committedTargetBlock: { number: number; hash: Hex };
    currentSourceBlock: { number: number; hash: Hex };
    currentTargetBlock: { number: number; hash: Hex };
    historicalSignature: WorkerSignatureVerification;
    currentSignature?: WorkerSignatureVerification;
    acceptanceReady: boolean;
    acceptanceBlockingReason?: string;
  };
}

export interface ParticipantSignatureRequest {
  expectedWorker: Address;
  domain: ReturnType<typeof quoteTypedData>["domain"];
  types: ReturnType<typeof quoteTypedData>["types"];
  value: ReturnType<typeof quoteTypedData>["value"];
}

export interface ParticipantSignatureResult {
  signature: Hex;
  account: Address;
  chainId: bigint;
}

export interface ParticipantWorkRecordV1 {
  orderId: Hex;
  packet: WorkAuthorizationPackageV1;
  savedAt: string;
  lastMilestoneId: number;
}

export interface ParticipantWorkStoreV1 {
  version: typeof PARTICIPANT_WORK_STORE_VERSION;
  records: ParticipantWorkRecordV1[];
}

export type ParticipantWorkStage =
  | "unsigned-review"
  | "awaiting-acceptance"
  | "acceptance-blocked"
  | "acceptance-expired"
  | "ready-to-deliver"
  | "ready-to-revise"
  | "awaiting-buyer-review"
  | "awaiting-committee"
  | "awaiting-source-finalization"
  | "source-final";

export interface ParticipantPaymentLocator {
  epochId: Hex;
  orderId: Hex;
  milestoneId: number;
  worker: Address;
  claimOwner: Address;
  destination: Address;
  expectedWorkAmount: DecimalString;
}

export interface ParticipantWorkRead {
  packet: WorkAuthorizationPackageV1;
  milestoneId: number;
  stage: ParticipantWorkStage;
  nextActor: "worker" | "buyer-safe" | "buyer-safe-or-worker" | "committee" | "anyone" | "payment-operator" | "none";
  sourceBlock: { number: number; hash: Hex };
  orderExists: boolean;
  agreed: boolean;
  status: number | null;
  outcome: number | null;
  stateVersion: DecimalString | null;
  deliveryHash: Hex | null;
  finalWork: DecimalString | null;
  finalFee: DecimalString | null;
  workerAction: "deliver" | "revise" | null;
  acceptanceEligibility: "eligible" | "blocked" | "not-applicable";
  blockingReason?: string;
  sourceGasRequired: boolean;
  sourceExecutionAccount: Address;
  sourceExecutionNote: string;
  deadlines: { acceptBefore: DecimalString; deliverBefore: DecimalString; reviewBefore: DecimalString; ruleBefore: DecimalString };
  payment: ParticipantPaymentLocator;
}

export interface ParticipantDeliveryPlan {
  kind: "deliver" | "revise";
  sourceChainId: DecimalString;
  sourceCoordinator: Address;
  requiredAccount: Address;
  sourceGasRequired: true;
  orderId: Hex;
  milestoneId: number;
  deliveryHash: Hex;
  content: string;
  transaction: { to: Address; value: "0"; data: Hex };
  basedOn: { blockNumber: number; blockHash: Hex; stateVersion: DecimalString | null };
}

export interface ParticipantJourneyCallbacks<T> {
  onDelivery(read: ParticipantWorkRead): T;
  onPayment(locator: ParticipantPaymentLocator, read: ParticipantWorkRead): T;
  onWaiting(read: ParticipantWorkRead): T;
}

type Guard = (() => void) | undefined;

function guard(assertFresh: Guard): void { assertFresh?.(); }
function same(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function canonicalAddress(value: string, label: string): Address {
  try { return getAddress(value) as Address; } catch { throw new Error(`${label} is not a valid address`); }
}
function canonicalHex32(value: string, label: string): Hex {
  if (!isHexString(value, 32)) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase() as Hex;
}
function canonicalDate(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp`);
  return value;
}
function canonicalIndex(value: unknown, label: string, maximum = 31): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} must be an integer from 0 through ${maximum}`);
  return value;
}
function exactObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  const extra = Object.keys(item).find(key => !keys.includes(key));
  if (extra) throw new Error(`${label} has unsupported field ${extra}`);
  return item;
}
function field(value: any, name: string, index: number): any { return value?.[name] ?? value?.[index]; }
function errorData(error: any): string | undefined { return error?.data ?? error?.info?.error?.data ?? error?.error?.data; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function assertTrustedParticipantDomain(packetValue: WorkAuthorizationPackageV1, trusted: TrustedParticipantDomain): void {
  const packet = parseWorkAuthorizationPackage(packetValue);
  const config = packet.authorization.epochConfig;
  if (BigInt(config.sourceChainId) !== BigInt(trusted.sourceChainId)
    || BigInt(config.sourceChainKey) !== BigInt(trusted.sourceChainKey)
    || !same(config.sourceCoordinator, canonicalAddress(trusted.sourceCoordinator, "trusted source coordinator"))
    || BigInt(config.targetChainId) !== BigInt(trusted.targetChainId)
    || !same(config.targetTreasury, canonicalAddress(trusted.targetTreasury, "trusted target treasury"))) {
    throw new Error("participant offer domain does not match the trusted deployment");
  }
}

async function assertPinnedRuntime(provider: WorkAuthorizationProvider, address: Address, blockNumber: number, expectedHash: Hex, deploymentBlock: DecimalString, label: string): Promise<void> {
  if (BigInt(blockNumber) < BigInt(deploymentBlock)) throw new Error(`${label} block predates the trusted deployment`);
  const code = await provider.getCode(address, blockNumber);
  if (!isHexString(code) || code === "0x" || !same(keccak256(code), canonicalHex32(expectedHash, `${label} runtime hash`))) throw new Error(`${label} runtime differs from the trusted deployment`);
}

async function assertOfferRuntimes(packet: WorkAuthorizationPackageV1, trusted: TrustedParticipantDomain, providers: { source: WorkAuthorizationProvider; target: WorkAuthorizationProvider }, blocks: { committedSource: number; committedTarget: number; currentSource: number; currentTarget: number; currentSourceHash: Hex; currentTargetHash: Hex }): Promise<void> {
  await Promise.all([
    assertPinnedRuntime(providers.source, packet.authorization.epochConfig.sourceCoordinator, blocks.committedSource, trusted.sourceRuntimeHash, trusted.sourceDeploymentBlock, "committed source"),
    assertPinnedRuntime(providers.target, packet.authorization.epochConfig.targetTreasury, blocks.committedTarget, trusted.targetRuntimeHash, trusted.targetDeploymentBlock, "committed target"),
    assertPinnedRuntime(providers.source, packet.authorization.epochConfig.sourceCoordinator, blocks.currentSource, trusted.sourceRuntimeHash, trusted.sourceDeploymentBlock, "current source"),
    assertPinnedRuntime(providers.target, packet.authorization.epochConfig.targetTreasury, blocks.currentTarget, trusted.targetRuntimeHash, trusted.targetDeploymentBlock, "current target"),
  ]);
  const [sourceCommitted, targetCommitted, sourceCurrent, targetCurrent] = await Promise.all([
    providers.source.getBlock(blocks.committedSource), providers.target.getBlock(blocks.committedTarget),
    providers.source.getBlock(blocks.currentSource), providers.target.getBlock(blocks.currentTarget),
  ]);
  const expected = [packet.authorization.sourceCapacity.blockHash, packet.authorization.targetFunding.blockHash, blocks.currentSourceHash, blocks.currentTargetHash];
  if (!sourceCommitted?.hash || !same(sourceCommitted.hash, expected[0]!) || !targetCommitted?.hash || !same(targetCommitted.hash, expected[1]!) || !sourceCurrent?.hash || !same(sourceCurrent.hash, expected[2]!) || !targetCurrent?.hash || !same(targetCurrent.hash, expected[3]!)) throw new Error("participant offer block changed during trusted runtime checks");
}

async function pinnedFinalizedRuntime(provider: WorkAuthorizationProvider, chainId: DecimalString, address: Address, expectedHash: Hex, deploymentBlock: DecimalString, label: string): Promise<{ number: number; hash: Hex }> {
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error(`${label} provider is on the wrong chain`);
  const block = await provider.getBlock("finalized");
  if (!block || block.hash === null || !Number.isSafeInteger(block.number)) throw new Error(`${label} RPC did not return a finalized block with its hash`);
  const hash = canonicalHex32(block.hash, `${label} finalized block hash`);
  await assertPinnedRuntime(provider, address, block.number, expectedHash, deploymentBlock, label);
  const blockAgain = await provider.getBlock(block.number);
  if (!blockAgain?.hash || !same(blockAgain.hash, hash)) throw new Error(`${label} finalized block changed during runtime checks`);
  return { number: block.number, hash };
}

async function assertCommittedOfferRuntimes(packet: WorkAuthorizationPackageV1, trusted: TrustedParticipantDomain, providers: { source: WorkAuthorizationProvider; target: WorkAuthorizationProvider }, committed: { sourceBlock: { number: number; hash: Hex }; targetBlock: { number: number; hash: Hex } }): Promise<void> {
  await Promise.all([
    assertPinnedRuntime(providers.source, packet.authorization.epochConfig.sourceCoordinator, committed.sourceBlock.number, trusted.sourceRuntimeHash, trusted.sourceDeploymentBlock, "committed source"),
    assertPinnedRuntime(providers.target, packet.authorization.epochConfig.targetTreasury, committed.targetBlock.number, trusted.targetRuntimeHash, trusted.targetDeploymentBlock, "committed target"),
  ]);
  const [sourceAgain, targetAgain] = await Promise.all([
    providers.source.getBlock(committed.sourceBlock.number),
    providers.target.getBlock(committed.targetBlock.number),
  ]);
  if (!sourceAgain?.hash || !same(sourceAgain.hash, committed.sourceBlock.hash) || !targetAgain?.hash || !same(targetAgain.hash, committed.targetBlock.hash)) throw new Error("participant committed observation block changed during runtime checks");
}

export function summarizeParticipantOffer(packetValue: WorkAuthorizationPackageV1): ParticipantOfferSummary {
  const packet = parseWorkAuthorizationPackage(packetValue);
  const requiredMaximum = packet.orderTerms.milestones.reduce((total, item) => total + BigInt(item.work) + BigInt(item.fee), 0n);
  return {
    orderId: packet.orderId,
    epochId: packet.orderTerms.epochId,
    worker: packet.orderTerms.worker,
    claimOwner: packet.orderTerms.claimOwner,
    destination: packet.orderTerms.destination,
    feeOwner: packet.orderTerms.feeOwner,
    feeDestination: packet.orderTerms.feeDestination,
    sourceSafe: packet.authorization.epochConfig.sourceSafe,
    sponsor: packet.authorization.epochConfig.sponsor,
    committee: packet.orderTerms.committee,
    acceptBefore: packet.orderTerms.acceptBefore,
    ...packet.authorization.commercialTerms,
    requiredMaximum: requiredMaximum.toString() as DecimalString,
    milestones: packet.orderTerms.milestones,
    testAsset: "native-ctc",
    fundingCreatesPrivateReservation: false,
  };
}

export async function reviewUnsignedParticipantOffer(input: string | unknown, options: {
  trusted: TrustedParticipantDomain;
  source: WorkAuthorizationProvider;
  target: WorkAuthorizationProvider;
  assertFresh?: () => void;
}): Promise<ParticipantOfferReview> {
  const packet = parseWorkAuthorizationPackage(input);
  if (packet.workerSignature || packet.signatureValidation) throw new Error("participant offer review requires an unsigned packet");
  assertTrustedParticipantDomain(packet, options.trusted);
  guard(options.assertFresh);
  const committed = await verifyCommittedChainObservations(packet, { source: options.source, target: options.target });
  guard(options.assertFresh);
  const current = await verifyCurrentWorkAuthorization(packet, { source: options.source, target: options.target });
  guard(options.assertFresh);
  await assertOfferRuntimes(packet, options.trusted, { source: options.source, target: options.target }, { committedSource: committed.sourceBlock.number, committedTarget: committed.targetBlock.number, currentSource: current.sourceBlock.number, currentTarget: current.targetBlock.number, currentSourceHash: current.sourceBlock.hash, currentTargetHash: current.targetBlock.hash });
  guard(options.assertFresh);
  return {
    packet,
    summary: summarizeParticipantOffer(packet),
    verification: { ...current, committedSourceBlock: committed.sourceBlock, committedTargetBlock: committed.targetBlock },
  };
}

export async function signReviewedParticipantOffer(reviewValue: ParticipantOfferReview, options: {
  trusted: TrustedParticipantDomain;
  source: WorkAuthorizationProvider;
  target: WorkAuthorizationProvider;
  requestSignature(request: ParticipantSignatureRequest): Promise<ParticipantSignatureResult>;
  assertFresh?: () => void;
}): Promise<WorkAuthorizationPackageV1> {
  const packet = parseWorkAuthorizationPackage(reviewValue.packet);
  if (packet.workerSignature || packet.signatureValidation) throw new Error("participant offer is already signed");
  if (JSON.stringify(reviewValue.summary) !== JSON.stringify(summarizeParticipantOffer(packet))) throw new Error("participant offer changed after review");
  assertTrustedParticipantDomain(packet, options.trusted);
  guard(options.assertFresh);
  await reviewUnsignedParticipantOffer(packet, { trusted: options.trusted, source: options.source, target: options.target, assertFresh: options.assertFresh });
  guard(options.assertFresh);
  const typed = quoteTypedData({ chainId: BigInt(packet.authorization.epochConfig.sourceChainId), coordinator: packet.authorization.epochConfig.sourceCoordinator, orderId: packet.orderId });
  const returned = await options.requestSignature({ expectedWorker: packet.orderTerms.worker, ...typed });
  guard(options.assertFresh);
  if (BigInt(returned.chainId) !== BigInt(packet.authorization.epochConfig.sourceChainId)) throw new Error("worker wallet is on the wrong source chain");
  if (!same(canonicalAddress(returned.account, "worker wallet account"), packet.orderTerms.worker)) throw new Error("worker wallet account does not match the participant offer");
  const finalized = await options.source.getBlock("finalized");
  guard(options.assertFresh);
  if (!finalized || finalized.hash === null || !Number.isSafeInteger(finalized.number)) throw new Error("source RPC did not return a finalized signature-validation block");
  await assertPinnedRuntime(options.source, packet.authorization.epochConfig.sourceCoordinator, finalized.number, options.trusted.sourceRuntimeHash, options.trusted.sourceDeploymentBlock, "signature source");
  guard(options.assertFresh);
  const signed = attachWorkerQuoteSignature(packet, {
    workerSignature: returned.signature,
    signatureValidation: {
      sourceChainId: packet.authorization.epochConfig.sourceChainId,
      sourceCoordinator: packet.authorization.epochConfig.sourceCoordinator,
      blockNumber: finalized.number.toString() as DecimalString,
      blockHash: canonicalHex32(finalized.hash, "signature-validation block hash"),
    },
  });
  await verifyWorkerQuoteSignatureCurrent(signed, options.source);
  guard(options.assertFresh);
  const blockAgain = await options.source.getBlock(finalized.number);
  guard(options.assertFresh);
  if (!blockAgain?.hash || !same(blockAgain.hash, finalized.hash)) throw new Error("signature-validation block changed after signing");
  return signed;
}

/**
 * Reopens a signed packet without treating its exported status as a verdict.
 * Historical acceptance remains inspectable after an ERC-1271 policy change;
 * a still-unaccepted quote is separately marked ready only when its current
 * signature policy and current eligibility both remain valid.
 */
export async function reviewSignedParticipantWork(input: string | unknown, options: {
  trusted: TrustedParticipantDomain;
  source: WorkAuthorizationProvider;
  target: WorkAuthorizationProvider;
  milestoneId?: number;
  assertFresh?: () => void;
}): Promise<SignedParticipantWorkReview> {
  const packet = parseWorkAuthorizationPackage(input);
  if (!packet.workerSignature || !packet.signatureValidation) throw new Error("participant signed-work review requires a signed packet");
  assertTrustedParticipantDomain(packet, options.trusted);
  guard(options.assertFresh);
  const committed = await verifyCommittedChainObservations(packet, { source: options.source, target: options.target });
  guard(options.assertFresh);
  const historicalSignature = await verifyWorkerQuoteSignatureAtSource(packet, options.source);
  guard(options.assertFresh);
  await assertCommittedOfferRuntimes(packet, options.trusted, { source: options.source, target: options.target }, committed);
  guard(options.assertFresh);
  const [currentSourceBlock, currentTargetBlock] = await Promise.all([
    pinnedFinalizedRuntime(options.source, options.trusted.sourceChainId, packet.authorization.epochConfig.sourceCoordinator, options.trusted.sourceRuntimeHash, options.trusted.sourceDeploymentBlock, "current source"),
    pinnedFinalizedRuntime(options.target, options.trusted.targetChainId, packet.authorization.epochConfig.targetTreasury, options.trusted.targetRuntimeHash, options.trusted.targetDeploymentBlock, "current target"),
  ]);
  guard(options.assertFresh);
  const work = await readParticipantWork(packet, options);
  guard(options.assertFresh);
  let currentSignature: WorkerSignatureVerification | undefined;
  let acceptanceReady = false;
  let acceptanceBlockingReason = work.blockingReason;
  if (!work.orderExists && work.acceptanceEligibility === "eligible") {
    try {
      currentSignature = await verifyWorkerQuoteSignatureCurrent(packet, options.source);
      guard(options.assertFresh);
      acceptanceReady = true;
    } catch (error) {
      guard(options.assertFresh);
      acceptanceBlockingReason = `current worker signature policy: ${errorMessage(error)}`;
    }
  } else if (work.orderExists) {
    acceptanceBlockingReason = work.agreed ? "the exact order is already accepted" : "the exact order already exists on the source chain";
  }
  return {
    packet,
    summary: summarizeParticipantOffer(packet),
    work,
    verification: {
      committedSourceBlock: committed.sourceBlock,
      committedTargetBlock: committed.targetBlock,
      currentSourceBlock,
      currentTargetBlock,
      historicalSignature,
      ...(currentSignature ? { currentSignature } : {}),
      acceptanceReady,
      ...(acceptanceBlockingReason ? { acceptanceBlockingReason } : {}),
    },
  };
}

export function emptyParticipantWorkStore(): ParticipantWorkStoreV1 {
  return { version: PARTICIPANT_WORK_STORE_VERSION, records: [] };
}

export function parseParticipantWorkStore(input: string | unknown): ParticipantWorkStoreV1 {
  if (typeof input === "string" && toUtf8Bytes(input).length > STORE_MAX_BYTES) throw new Error(`participant work store exceeds ${STORE_MAX_BYTES} UTF-8 bytes`);
  let decoded: unknown;
  try { decoded = typeof input === "string" ? JSON.parse(input) : input; } catch { throw new Error("participant work store is not valid JSON"); }
  const root = exactObject(decoded, "participant work store", ["version", "records"]);
  if (root.version !== PARTICIPANT_WORK_STORE_VERSION) throw new Error(`unsupported participant work store version: ${String(root.version)}`);
  if (!Array.isArray(root.records) || root.records.length > PARTICIPANT_WORK_STORE_LIMIT) throw new Error(`participant work store requires at most ${PARTICIPANT_WORK_STORE_LIMIT} records`);
  const seen = new Set<string>();
  const records = root.records.map((recordValue, index): ParticipantWorkRecordV1 => {
    const record = exactObject(recordValue, `participant work record ${index}`, ["orderId", "packet", "savedAt", "lastMilestoneId"]);
    const packet = parseWorkAuthorizationPackage(record.packet);
    const orderId = canonicalHex32(String(record.orderId), `participant work record ${index} orderId`);
    if (!same(orderId, packet.orderId)) throw new Error(`participant work record ${index} orderId differs from its packet`);
    if (seen.has(orderId)) throw new Error(`participant work store repeats order ${orderId}`);
    seen.add(orderId);
    const lastMilestoneId = canonicalIndex(record.lastMilestoneId, `participant work record ${index} lastMilestoneId`, packet.orderTerms.milestones.length - 1);
    return { orderId, packet, savedAt: canonicalDate(record.savedAt, `participant work record ${index} savedAt`), lastMilestoneId };
  });
  return { version: PARTICIPANT_WORK_STORE_VERSION, records };
}

export function stringifyParticipantWorkStore(value: ParticipantWorkStoreV1): string {
  return JSON.stringify(parseParticipantWorkStore(value), null, 2);
}

export function upsertParticipantWork(storeValue: ParticipantWorkStoreV1, packetValue: WorkAuthorizationPackageV1, options: { savedAt?: string; lastMilestoneId?: number } = {}): ParticipantWorkStoreV1 {
  const store = parseParticipantWorkStore(storeValue);
  const packet = parseWorkAuthorizationPackage(packetValue);
  const existing = store.records.find(item => same(item.orderId, packet.orderId));
  const lastMilestoneId = canonicalIndex(options.lastMilestoneId ?? existing?.lastMilestoneId ?? 0, "lastMilestoneId", packet.orderTerms.milestones.length - 1);
  const savedAt = canonicalDate(options.savedAt ?? new Date().toISOString(), "savedAt");
  const retainedPacket = existing?.packet.workerSignature && !packet.workerSignature ? existing.packet : packet;
  const record = { orderId: retainedPacket.orderId, packet: retainedPacket, savedAt, lastMilestoneId };
  const records = [record, ...store.records.filter(item => !same(item.orderId, packet.orderId))];
  if (records.length > PARTICIPANT_WORK_STORE_LIMIT) records.pop();
  return { version: PARTICIPANT_WORK_STORE_VERSION, records };
}

export function removeParticipantWork(storeValue: ParticipantWorkStoreV1, orderIdValue: Hex): ParticipantWorkStoreV1 {
  const store = parseParticipantWorkStore(storeValue);
  const orderId = canonicalHex32(orderIdValue, "orderId");
  return { ...store, records: store.records.filter(item => !same(item.orderId, orderId)) };
}

async function pinnedLatestSource(provider: WorkAuthorizationProvider, expectedChainId: bigint): Promise<{ number: number; hash: Hex }> {
  if ((await provider.getNetwork()).chainId !== expectedChainId) throw new Error("participant source provider is on the wrong chain");
  const block = await provider.getBlock("latest");
  if (!block || block.hash === null || !Number.isSafeInteger(block.number)) throw new Error("participant source RPC did not return a latest block with its hash");
  return { number: block.number, hash: canonicalHex32(block.hash, "participant source latest block hash") };
}

async function sourceCall(provider: WorkAuthorizationProvider, coordinator: Address, name: "order" | "milestone", args: readonly unknown[], blockNumber: number): Promise<any> {
  const data = sourceInterface.encodeFunctionData(name, [...args]);
  const result = await provider.call({ to: coordinator, data, blockTag: blockNumber });
  return sourceInterface.decodeFunctionResult(name, result)[0];
}

function assertOrderMatches(packet: WorkAuthorizationPackageV1, order: any): void {
  const expected = packet.orderTerms;
  const addressFields: Array<[string, number, Address]> = [
    ["worker", 4, expected.worker], ["claimOwner", 5, expected.claimOwner], ["destination", 6, expected.destination],
    ["feeOwner", 7, expected.feeOwner], ["feeDestination", 8, expected.feeDestination],
  ];
  if (!field(order, "exists", 0) || !same(field(order, "epochId", 2), expected.epochId) || !same(field(order, "termsHash", 3), expected.termsHash)) throw new Error("source order identity differs from the participant packet");
  for (const [name, index, value] of addressFields) if (!same(field(order, name, index), value)) throw new Error(`source order ${name} differs from the participant packet`);
  const committee = Array.from(field(order, "committee", 9), String);
  if (committee.length !== 3 || committee.some((item, index) => !same(item, expected.committee[index]!))) throw new Error("source order committee differs from the participant packet");
  if (BigInt(field(order, "acceptBefore", 10)) !== BigInt(expected.acceptBefore) || BigInt(field(order, "nonce", 11)) !== BigInt(expected.nonce) || Number(field(order, "milestoneCount", 12)) !== expected.milestones.length) throw new Error("source order deadlines, nonce or milestone count differ from the participant packet");
}

function assertMilestoneMatches(packet: WorkAuthorizationPackageV1, milestoneId: number, milestone: any): void {
  const expected = packet.orderTerms.milestones[milestoneId]!;
  const fields: Array<[string, number, DecimalString]> = [
    ["work", 4, expected.work], ["fee", 5, expected.fee], ["timeoutWork", 6, expected.timeoutWork],
    ["deliverBefore", 7, expected.deliverBefore], ["reviewBefore", 8, expected.reviewBefore], ["ruleBefore", 9, expected.ruleBefore],
  ];
  for (const [name, index, value] of fields) if (BigInt(field(milestone, name, index)) !== BigInt(value)) throw new Error(`source milestone ${name} differs from the participant packet`);
}

export async function readParticipantWork(packetValue: WorkAuthorizationPackageV1, options: {
  trusted: TrustedParticipantDomain;
  source: WorkAuthorizationProvider;
  target: WorkAuthorizationProvider;
  milestoneId?: number;
  assertFresh?: () => void;
}): Promise<ParticipantWorkRead> {
  const packet = parseWorkAuthorizationPackage(packetValue);
  assertTrustedParticipantDomain(packet, options.trusted);
  const milestoneId = canonicalIndex(options.milestoneId ?? 0, "milestoneId", packet.orderTerms.milestones.length - 1);
  guard(options.assertFresh);
  const sourceBlock = await pinnedLatestSource(options.source, BigInt(packet.authorization.epochConfig.sourceChainId));
  guard(options.assertFresh);
  await assertPinnedRuntime(options.source, packet.authorization.epochConfig.sourceCoordinator, sourceBlock.number, options.trusted.sourceRuntimeHash, options.trusted.sourceDeploymentBlock, "participant source");
  guard(options.assertFresh);
  let order: any;
  try { order = await sourceCall(options.source, packet.authorization.epochConfig.sourceCoordinator, "order", [packet.orderId], sourceBlock.number); }
  catch (error) {
    const data = errorData(error);
    if (typeof data !== "string" || data.slice(0, 10).toLowerCase() !== UNKNOWN_ORDER_SELECTOR) throw error;
    const blockAgain = await options.source.getBlock(sourceBlock.number); guard(options.assertFresh);
    if (!blockAgain?.hash || !same(blockAgain.hash, sourceBlock.hash)) throw new Error("participant source block changed after reads");
    let acceptanceEligibility: ParticipantWorkRead["acceptanceEligibility"] = "eligible";
    let blockingReason: string | undefined;
    try { await verifyCurrentWorkAuthorization(packet, { source: options.source, target: options.target }); }
    catch (reason) {
      const message = errorMessage(reason);
      if (!/source epoch is not active|current source capacity|milestone admission capacity|quote nonce is no longer unused|acceptance deadline has passed|admission cutoff has passed|target epoch is not funded|current target reserve/.test(message)) throw reason;
      acceptanceEligibility = "blocked"; blockingReason = message;
    }
    guard(options.assertFresh);
    const expired = BigInt(sourceBlock.number) >= BigInt(packet.orderTerms.acceptBefore);
    const milestone = packet.orderTerms.milestones[milestoneId]!;
    return {
      packet, milestoneId, stage: expired ? "acceptance-expired" : acceptanceEligibility === "blocked" ? "acceptance-blocked" : packet.workerSignature ? "awaiting-acceptance" : "unsigned-review",
      nextActor: expired || acceptanceEligibility === "blocked" ? "none" : packet.workerSignature ? "buyer-safe" : "worker", sourceBlock, orderExists: false, agreed: false,
      status: null, outcome: null, stateVersion: null, deliveryHash: null, finalWork: null, finalFee: null, workerAction: null,
      acceptanceEligibility, ...(blockingReason ? { blockingReason } : {}),
      sourceGasRequired: false, sourceExecutionAccount: packet.orderTerms.worker,
      sourceExecutionNote: "Signing the quote uses no gas. A later worker delivery is an Ethereum source transaction from the named worker account and requires source-chain gas.",
      deadlines: { acceptBefore: packet.orderTerms.acceptBefore, deliverBefore: milestone.deliverBefore, reviewBefore: milestone.reviewBefore, ruleBefore: milestone.ruleBefore },
      payment: { epochId: packet.orderTerms.epochId, orderId: packet.orderId, milestoneId, worker: packet.orderTerms.worker, claimOwner: packet.orderTerms.claimOwner, destination: packet.orderTerms.destination, expectedWorkAmount: "0" },
    };
  }
  guard(options.assertFresh);
  assertOrderMatches(packet, order);
  const milestone = await sourceCall(options.source, packet.authorization.epochConfig.sourceCoordinator, "milestone", [packet.orderId, milestoneId], sourceBlock.number);
  guard(options.assertFresh);
  assertMilestoneMatches(packet, milestoneId, milestone);
  const blockAgain = await options.source.getBlock(sourceBlock.number);
  guard(options.assertFresh);
  if (!blockAgain?.hash || !same(blockAgain.hash, sourceBlock.hash)) throw new Error("participant source block changed after reads");
  const agreed = Boolean(field(order, "agreed", 1));
  const status = Number(field(milestone, "status", 0));
  const outcome = Number(field(milestone, "outcome", 1));
  const head = BigInt(sourceBlock.number);
  const terms = packet.orderTerms.milestones[milestoneId]!;
  let stage: ParticipantWorkStage;
  let nextActor: ParticipantWorkRead["nextActor"];
  let workerAction: ParticipantWorkRead["workerAction"] = null;
  if (status === 5) { stage = "source-final"; nextActor = BigInt(field(milestone, "finalWork", 11)) > 0n ? "payment-operator" : "none"; }
  else if (!agreed || status === 1) { stage = head >= BigInt(packet.orderTerms.acceptBefore) ? "acceptance-expired" : "awaiting-acceptance"; nextActor = stage === "acceptance-expired" ? "none" : "buyer-safe"; }
  else if (status === 2) {
    if (head < BigInt(terms.deliverBefore)) { stage = "ready-to-deliver"; nextActor = "worker"; workerAction = "deliver"; }
    else { stage = "awaiting-source-finalization"; nextActor = "anyone"; }
  } else if (status === 3) {
    if (head < BigInt(terms.deliverBefore)) { stage = "ready-to-revise"; nextActor = "buyer-safe-or-worker"; workerAction = "revise"; }
    else if (head < BigInt(terms.reviewBefore)) { stage = "awaiting-buyer-review"; nextActor = "buyer-safe"; }
    else { stage = "awaiting-source-finalization"; nextActor = "anyone"; }
  } else if (status === 4) {
    if (head < BigInt(terms.ruleBefore)) { stage = "awaiting-committee"; nextActor = "committee"; }
    else { stage = "awaiting-source-finalization"; nextActor = "anyone"; }
  } else throw new Error(`source milestone returned unsupported status ${status}`);
  return {
    packet, milestoneId, stage, nextActor, sourceBlock, orderExists: true, agreed, status, outcome,
    stateVersion: BigInt(field(milestone, "stateVersion", 2)).toString() as DecimalString,
    deliveryHash: canonicalHex32(field(milestone, "deliveryHash", 3), "source milestone deliveryHash"),
    finalWork: BigInt(field(milestone, "finalWork", 11)).toString() as DecimalString,
    finalFee: BigInt(field(milestone, "finalFee", 12)).toString() as DecimalString,
    workerAction, acceptanceEligibility: status === 1 ? "eligible" : "not-applicable", sourceGasRequired: workerAction !== null, sourceExecutionAccount: packet.orderTerms.worker,
    sourceExecutionNote: workerAction ? "Delivery and revision are Ethereum source transactions from the named worker address. An ERC-1271 worker contract must itself execute this call; an owner EOA is not the contract worker." : "No worker source transaction is currently available.",
    deadlines: { acceptBefore: packet.orderTerms.acceptBefore, deliverBefore: terms.deliverBefore, reviewBefore: terms.reviewBefore, ruleBefore: terms.ruleBefore },
    payment: { epochId: packet.orderTerms.epochId, orderId: packet.orderId, milestoneId, worker: packet.orderTerms.worker, claimOwner: packet.orderTerms.claimOwner, destination: packet.orderTerms.destination, expectedWorkAmount: BigInt(field(milestone, "finalWork", 11)).toString() as DecimalString },
  };
}

export function prepareParticipantDelivery(read: ParticipantWorkRead, contentValue: string): ParticipantDeliveryPlan {
  if (read.workerAction !== "deliver" && read.workerAction !== "revise") throw new Error("the participant's selected milestone is not ready for delivery or revision");
  const packet = parseWorkAuthorizationPackage(read.packet);
  if (!read.orderExists || !read.agreed || (read.status !== 2 && read.status !== 3) || read.milestoneId < 0 || read.milestoneId >= packet.orderTerms.milestones.length) throw new Error("participant delivery readiness is inconsistent with the canonical work packet");
  if ((read.workerAction === "deliver") !== (read.status === 2) || (read.workerAction === "revise") !== (read.status === 3) || !same(read.sourceExecutionAccount, packet.orderTerms.worker)) throw new Error("participant delivery actor or action differs from the source read");
  if (typeof contentValue !== "string" || contentValue.length === 0) throw new Error("delivery content must be nonempty");
  if (contentValue.normalize("NFC") !== contentValue) throw new Error("delivery content must use NFC Unicode normalization");
  if (toUtf8Bytes(contentValue).length > DELIVERY_MAX_BYTES) throw new Error(`delivery content exceeds ${DELIVERY_MAX_BYTES} UTF-8 bytes`);
  const deliveryHash = keccak256(toUtf8Bytes(contentValue)) as Hex;
  if (same(deliveryHash, ZERO32)) throw new Error("delivery content produced the forbidden zero commitment");
  return {
    kind: read.workerAction,
    sourceChainId: packet.authorization.epochConfig.sourceChainId,
    sourceCoordinator: packet.authorization.epochConfig.sourceCoordinator,
    requiredAccount: packet.orderTerms.worker,
    sourceGasRequired: true,
    orderId: packet.orderId,
    milestoneId: read.milestoneId,
    deliveryHash,
    content: contentValue,
    transaction: { to: packet.authorization.epochConfig.sourceCoordinator, value: "0", data: sourceInterface.encodeFunctionData("deliver", [packet.orderId, read.milestoneId, deliveryHash]) as Hex },
    basedOn: { blockNumber: read.sourceBlock.number, blockHash: read.sourceBlock.hash, stateVersion: read.stateVersion },
  };
}

export function dispatchParticipantJourney<T>(read: ParticipantWorkRead, callbacks: ParticipantJourneyCallbacks<T>): T {
  if (read.workerAction) return callbacks.onDelivery(read);
  if (read.stage === "source-final" && BigInt(read.payment.expectedWorkAmount) > 0n) return callbacks.onPayment(read.payment, read);
  return callbacks.onWaiting(read);
}

export function participantPacketJson(packet: WorkAuthorizationPackageV1): string {
  return stringifyWorkAuthorizationPackage(packet);
}
