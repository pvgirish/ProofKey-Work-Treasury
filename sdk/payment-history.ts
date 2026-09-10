import { AbiCoder, Interface, getAddress, isHexString, keccak256, toUtf8Bytes } from "ethers";
import { deserializeAllocation } from "./allocation.ts";
import { verifyProgramCloseout, type CloseoutEpochObservation, type TrustedCloseoutDeployment } from "./program-closeout.ts";
import type { AllocationProvenanceV1, CollectedProgramCloseoutV1 } from "./program-collector.ts";
import { parseWorkAuthorizationPackage } from "./work-authorization.ts";
import { AllocationKind, type Address, type Hex } from "./types.ts";

export const PAYMENT_HISTORY_LOCATOR_VERSION = "proofkey.work-treasury.payment-history-locator.v1" as const;
export const PAYMENT_HISTORY_VERSION = "proofkey.work-treasury.selected-payment-history.v1" as const;

export type PaymentHistorySubjectRole = "source-worker" | "claim-owner" | "paid-destination";

export interface PaymentHistoryLocatorV1 {
  version: typeof PAYMENT_HISTORY_LOCATOR_VERSION;
  subject: { address: Address; role: PaymentHistorySubjectRole };
  domain: {
    sourceChainId: string; sourceCoordinator: Address; sourceRuntimeHash: Hex;
    targetChainId: string; targetTreasury: Address; targetRuntimeHash: Hex; sourceChainKey: string;
  };
  selections: Array<{ epochId: Hex; orderIds?: Hex[]; economicIds?: Hex[] }>;
}

export interface VerifiedPaymentRecordV1 {
  recordKey: string;
  economicId: Hex;
  epochId: Hex;
  allocationId: string;
  orderId: Hex;
  milestoneId: number;
  kind: "WORK" | "FEE";
  asset: Address;
  amount: string;
  subjectMatchedAs: PaymentHistorySubjectRole;
  sourceWorker?: Address;
  claimOwner: Address;
  committedDestination: Address;
  paidDestination: Address;
  withdrawalRoute: "fixed-destination" | "owner-redirect";
  commercialConsentEvidence: "bound-authorization" | "legacy-no-commercial-consent-evidence";
  sourceOutcome: { code?: number; label: string; transactionHash?: Hex };
  nativeAuthentication: {
    authenticationId: Hex; sourceBlockHeight: string; sourceTransactionIndex: string;
    classification?: "fresh-atomic" | "cached"; verificationTransactionHash?: Hex;
    storedAuthenticationTransactionHash?: Hex;
  };
  recognition: { transactionHash: Hex; snapshotBlockNumber: string; snapshotBlockHash: Hex };
  withdrawal: { transactionHash: Hex; caller: Address; snapshotBlockNumber: string; snapshotBlockHash: Hex };
}

export interface SelectedPaymentHistoryV1 {
  version: typeof PAYMENT_HISTORY_VERSION;
  status: "verified" | "partial" | "invalid";
  label: string;
  locator: PaymentHistoryLocatorV1;
  selectedScope: "selected-not-exhaustive";
  snapshots: Array<{ epochId: Hex; source: { chainId: string; blockNumber: string; blockHash: Hex }; target: { chainId: string; blockNumber: string; blockHash: Hex }; programAccountingStatus: "complete" | "incomplete" }>;
  records: VerifiedPaymentRecordV1[];
  totals: Array<{ targetChainId: string; treasury: Address; asset: Address; kind: "WORK" | "FEE"; amount: string; paymentCount: number }>;
  unresolvedSelections: string[];
  errors: string[];
  limitations: string[];
  artifactDigest: Hex;
}

const targetInterface = new Interface([
  "function withdrawFor(bytes32,uint64)",
  "function ownerWithdrawTo(bytes32,uint64,address)",
]);
const abi = AbiCoder.defaultAbiCoder();

function ownRecord(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, any>;
}
function only(value: Record<string, any>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} contains unsupported field ${key}`);
}
function address(value: unknown, label: string): Address {
  try { return getAddress(String(value)) as Address; } catch { throw new Error(`${label} is not an address`); }
}
function hex32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !isHexString(value, 32)) throw new Error(`${label} must be bytes32`);
  return value as Hex;
}
function decimal(value: unknown, label: string): string {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label} must be canonical unsigned decimal text`);
  return text;
}
function sameAddress(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function sameHex(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function economicId(epochId: Hex, allocationId: bigint): Hex { return keccak256(abi.encode(["bytes32", "uint64"], [epochId, allocationId])) as Hex; }

function parseLocatorObject(value: unknown): PaymentHistoryLocatorV1 {
  const root = ownRecord(value, "payment history locator");
  only(root, ["version", "subject", "domain", "selections"], "payment history locator");
  if (root.version !== PAYMENT_HISTORY_LOCATOR_VERSION) throw new Error("unsupported payment history locator version");
  const subject = ownRecord(root.subject, "payment history subject");
  only(subject, ["address", "role"], "payment history subject");
  if (!["source-worker", "claim-owner", "paid-destination"].includes(subject.role)) throw new Error("unsupported payment history subject role");
  const domain = ownRecord(root.domain, "payment history domain");
  only(domain, ["sourceChainId", "sourceCoordinator", "sourceRuntimeHash", "targetChainId", "targetTreasury", "targetRuntimeHash", "sourceChainKey"], "payment history domain");
  if (!Array.isArray(root.selections) || root.selections.length === 0) throw new Error("payment history requires at least one epoch selection");
  const selections = root.selections.map((entry: unknown, index: number) => {
    const selection = ownRecord(entry, `payment history selection ${index}`);
    only(selection, ["epochId", "orderIds", "economicIds"], `payment history selection ${index}`);
    const parseList = (name: "orderIds" | "economicIds") => {
      if (selection[name] === undefined) return undefined;
      if (!Array.isArray(selection[name]) || selection[name].length === 0) throw new Error(`${name} must be a non-empty array when supplied`);
      const items = selection[name].map((item: unknown, itemIndex: number) => hex32(item, `${name}[${itemIndex}]`));
      if (new Set(items.map(item => item.toLowerCase())).size !== items.length) throw new Error(`${name} contains duplicates`);
      return items;
    };
    return { epochId: hex32(selection.epochId, `selection ${index} epochId`), ...(selection.orderIds === undefined ? {} : { orderIds: parseList("orderIds") }), ...(selection.economicIds === undefined ? {} : { economicIds: parseList("economicIds") }) };
  });
  if (new Set(selections.map(selection => selection.epochId.toLowerCase())).size !== selections.length) throw new Error("payment history contains duplicate epoch selections");
  return {
    version: PAYMENT_HISTORY_LOCATOR_VERSION,
    subject: { address: address(subject.address, "subject address"), role: subject.role },
    domain: {
      sourceChainId: decimal(domain.sourceChainId, "source chainId"), sourceCoordinator: address(domain.sourceCoordinator, "source coordinator"), sourceRuntimeHash: hex32(domain.sourceRuntimeHash, "source runtime hash"),
      targetChainId: decimal(domain.targetChainId, "target chainId"), targetTreasury: address(domain.targetTreasury, "target treasury"), targetRuntimeHash: hex32(domain.targetRuntimeHash, "target runtime hash"), sourceChainKey: decimal(domain.sourceChainKey, "source chain key"),
    },
    selections,
  };
}

/** Imported totals, records, snapshots, labels and verdicts are discarded. */
export function parsePaymentHistoryLocator(input: unknown): PaymentHistoryLocatorV1 {
  const root = ownRecord(typeof input === "string" ? JSON.parse(input) : input, "payment history import");
  if (root.version === PAYMENT_HISTORY_LOCATOR_VERSION) return parseLocatorObject(root);
  if (root.version !== PAYMENT_HISTORY_VERSION) throw new Error("unsupported payment history import version");
  only(root, ["version", "status", "label", "locator", "selectedScope", "snapshots", "records", "totals", "unresolvedSelections", "errors", "limitations", "artifactDigest"], "payment history export");
  return parseLocatorObject(root.locator);
}

function trustedMatches(locator: PaymentHistoryLocatorV1, trusted: TrustedCloseoutDeployment): boolean {
  const d = locator.domain;
  return d.sourceChainId === trusted.sourceChainId && d.targetChainId === trusted.targetChainId && d.sourceChainKey === trusted.sourceChainKey
    && sameAddress(d.sourceCoordinator, trusted.sourceCoordinator) && sameAddress(d.targetTreasury, trusted.targetTreasury)
    && sameHex(d.sourceRuntimeHash, trusted.sourceRuntimeHash) && sameHex(d.targetRuntimeHash, trusted.targetRuntimeHash);
}
function findWorker(epoch: CloseoutEpochObservation, orderId: Hex): Address | undefined {
  for (const record of epoch.authorizations ?? []) {
    const packet = parseWorkAuthorizationPackage(record.packet);
    if (sameHex(packet.orderId, orderId)) return packet.authorization.order.worker;
  }
  return undefined;
}
function provenanceFor(report: CollectedProgramCloseoutV1, allocationId: bigint): AllocationProvenanceV1 | undefined {
  return report.allocations.find(row => BigInt(row.allocationId) === allocationId);
}
function provenanceErrors(row: AllocationProvenanceV1 | undefined): string[] {
  if (!row) return ["fresh per-allocation provenance is missing"];
  return [...row.errors, ...row.source.errors, ...row.nativeAuthentication.errors, ...row.recognition.errors, ...row.withdrawal.errors];
}
function requested(selection: PaymentHistoryLocatorV1["selections"][number], orderId: Hex, id: Hex): boolean {
  return (!selection.orderIds || selection.orderIds.some(value => sameHex(value, orderId))) && (!selection.economicIds || selection.economicIds.some(value => sameHex(value, id)));
}
function subjectMatches(role: PaymentHistorySubjectRole, subject: Address, worker: Address | undefined, claimOwner: Address, paidDestination: Address): boolean {
  if (role === "source-worker") return !!worker && sameAddress(worker, subject);
  if (role === "claim-owner") return sameAddress(claimOwner, subject);
  return sameAddress(paidDestination, subject);
}
function baseResult(locator: PaymentHistoryLocatorV1, status: SelectedPaymentHistoryV1["status"], errors: string[], unresolvedSelections: string[], snapshots: SelectedPaymentHistoryV1["snapshots"], records: VerifiedPaymentRecordV1[], totals: SelectedPaymentHistoryV1["totals"]): SelectedPaymentHistoryV1 {
  const withoutDigest = {
    version: PAYMENT_HISTORY_VERSION, status,
    label: status === "verified" ? "Verified selected payment record" : status === "partial" ? "Selected payment record is incomplete" : "Selected payment record is invalid",
    locator, selectedScope: "selected-not-exhaustive" as const, snapshots, records, totals, unresolvedSelections, errors,
    limitations: [
      "This is selected wallet-address settlement history, not an exhaustive account history or a claim about a human or organization.",
      "It proves finalized recorded WORK/FEE withdrawals in the selected scope; it does not establish work quality, invoice truth, income, independence, beneficial control, repayment behavior or creditworthiness.",
      "WORK and FEE are totaled separately. RETURN is excluded because it credits fungible owner free balance rather than paying a worker claim.",
      "A source outcome label does not prove there was never a dispute, and an unresolved program amount is not itself evidence of a dispute.",
      "Public transaction visibility does not establish permission to attach a name, contact detail or testimonial.",
    ],
  };
  return { ...withoutDigest, artifactDigest: keccak256(toUtf8Bytes(JSON.stringify(withoutDigest))) as Hex };
}

/**
 * Validates freshly collected observations against a separately trusted deployment and selects exact paid claims.
 * A caller importing an old export must first reduce it with parsePaymentHistoryLocator and recollect each epoch.
 */
export function verifySelectedPaymentHistory(input: { locator: PaymentHistoryLocatorV1; reports: readonly CollectedProgramCloseoutV1[]; trusted: TrustedCloseoutDeployment }): SelectedPaymentHistoryV1 {
  let locator: PaymentHistoryLocatorV1;
  try { locator = parsePaymentHistoryLocator(input.locator); } catch (error) { throw error; }
  const errors: string[] = [], unresolved: string[] = [];
  if (!trustedMatches(locator, input.trusted)) errors.push("payment history locator differs from the independently trusted deployment");
  const byEpoch = new Map<string, CollectedProgramCloseoutV1>();
  for (const report of input.reports) {
    const epoch = report.closeout?.epochs?.[0];
    if (!epoch || report.closeout.epochs.length !== 1) { errors.push("each fresh program report must contain exactly one epoch"); continue; }
    const key = epoch.epochId.toLowerCase();
    if (byEpoch.has(key)) { errors.push(`duplicate evidence route/report for epoch ${epoch.epochId}`); continue; }
    byEpoch.set(key, report);
  }
  const snapshots: SelectedPaymentHistoryV1["snapshots"] = [];
  const validated = new Map<string, { report: CollectedProgramCloseoutV1; epoch: CloseoutEpochObservation; accountingStatus: "complete" | "incomplete" }>();
  for (const selection of locator.selections) {
    const report = byEpoch.get(selection.epochId.toLowerCase());
    if (!report) { unresolved.push(`${selection.epochId}: fresh program report is missing`); continue; }
    const result = verifyProgramCloseout(report.closeout, input.trusted);
    if (result.status === "invalid") { errors.push(`${selection.epochId}: contradictory program report: ${result.errors.join("; ")}`); continue; }
    const epoch = report.closeout.epochs[0]!;
    if (!sameHex(epoch.epochId, selection.epochId)) { errors.push(`${selection.epochId}: report epoch differs from selection`); continue; }
    snapshots.push({ epochId: epoch.epochId, source: { chainId: report.closeout.source.snapshot.chainId, blockNumber: report.closeout.source.snapshot.blockNumber, blockHash: report.closeout.source.snapshot.blockHash }, target: { chainId: report.closeout.target.snapshot.chainId, blockNumber: report.closeout.target.snapshot.blockNumber, blockHash: report.closeout.target.snapshot.blockHash }, programAccountingStatus: result.status });
    validated.set(selection.epochId.toLowerCase(), { report, epoch, accountingStatus: result.status });
  }
  if (errors.length) return baseResult(locator, "invalid", errors, unresolved, snapshots, [], []);

  const records: VerifiedPaymentRecordV1[] = [], seen = new Set<string>();
  for (const selection of locator.selections) {
    const value = validated.get(selection.epochId.toLowerCase());
    if (!value) continue;
    const recordCountBeforeSelection = records.length;
    const matchedOrders = new Set<string>(), matchedEconomicIds = new Set<string>();
    for (const serialized of value.epoch.source.allocations) {
      const allocation = deserializeAllocation(serialized);
      const id = economicId(allocation.epochId, allocation.allocationId);
      if (!requested(selection, allocation.orderId, id)) continue;
      if (allocation.kind === AllocationKind.RETURN) { if (selection.economicIds?.some(item => sameHex(item, id))) unresolved.push(`${id}: RETURN is not a WORK/FEE payment`); continue; }
      const item = value.epoch.target.allocations.find(candidate => sameHex(candidate.allocation.epochId, allocation.epochId) && BigInt(candidate.allocation.allocationId) === allocation.allocationId);
      const row = provenanceFor(value.report, allocation.allocationId);
      const rowErrors = provenanceErrors(row);
      const worker = findWorker(value.epoch, allocation.orderId);
      const candidatePaidDestination=item?.completedClaim?.paidDestination;
      const roleMatches=candidatePaidDestination?subjectMatches(locator.subject.role,locator.subject.address,worker,allocation.claimOwner,candidatePaidDestination):locator.subject.role!=="paid-destination"&&subjectMatches(locator.subject.role,locator.subject.address,worker,allocation.claimOwner,allocation.destination);
      if(!roleMatches){if(selection.orderIds||selection.economicIds)unresolved.push(`${id}: selected subject address does not match the requested ${locator.subject.role} role`);continue;}
      const claimGaps:string[]=[];
      if(!item?.recognized||!item.recognizedAllocation)claimGaps.push("recognition readback is missing");
      if(!item?.recognitionReceipt)claimGaps.push("recognition receipt is missing");
      if(!item?.authentication?.exists)claimGaps.push("native authentication readback is missing");
      else if(BigInt(item.authentication.blockHeight)>BigInt(value.report.closeout.target.nativeAttestedSourceHeight))claimGaps.push("native finalized frontier does not cover the authentication position");
      if(!item?.completedClaim?.withdrawn)claimGaps.push("completed withdrawal readback is missing");
      if(!item?.withdrawalReceipt)claimGaps.push("withdrawal receipt is missing");
      if (claimGaps.length || rowErrors.length) {
        unresolved.push(`${id}: selected claim is not a freshly verified successful withdrawal (${[...claimGaps,...rowErrors].join("; ")})`);
        continue;
      }
      if(!item||!item.completedClaim||!item.withdrawalReceipt||!item.recognitionReceipt||!item.authentication)throw new Error("verified payment narrowing failed");
      const paidDestination = item.completedClaim.paidDestination;
      const key = `${locator.domain.targetChainId}:${locator.domain.targetTreasury.toLowerCase()}:${id.toLowerCase()}`;
      if (seen.has(key)) { errors.push(`${id}: duplicate payment evidence route`); continue; }
      seen.add(key); matchedOrders.add(allocation.orderId.toLowerCase()); matchedEconomicIds.add(id.toLowerCase());
      const parsed = targetInterface.parseTransaction({ data: item.withdrawalReceipt.input });
      const withdrawalRoute = parsed?.name === "ownerWithdrawTo" ? "owner-redirect" : "fixed-destination";
      records.push({
        recordKey: key, economicId: id, epochId: allocation.epochId, allocationId: String(allocation.allocationId), orderId: allocation.orderId, milestoneId: allocation.milestoneId,
        kind: allocation.kind === AllocationKind.WORK ? "WORK" : "FEE", asset: allocation.asset, amount: String(allocation.amount), subjectMatchedAs: locator.subject.role,
        ...(worker ? { sourceWorker: worker } : {}), claimOwner: allocation.claimOwner, committedDestination: allocation.destination, paidDestination, withdrawalRoute,
        commercialConsentEvidence: worker ? "bound-authorization" : "legacy-no-commercial-consent-evidence",
        sourceOutcome: { ...(row?.policyOutcome.outcomeCode === undefined ? {} : { code: row.policyOutcome.outcomeCode }), label: row?.policyOutcome.label ?? "unknown", ...(row?.source.transactionHash ? { transactionHash: row.source.transactionHash } : {}) },
        nativeAuthentication: { authenticationId: item.authentication!.authenticationId, sourceBlockHeight: item.authentication!.blockHeight, sourceTransactionIndex: item.authentication!.transactionIndex, ...(row?.nativeAuthentication.classification ? { classification: row.nativeAuthentication.classification } : {}), ...(row?.nativeAuthentication.transactionHash ? { verificationTransactionHash: row.nativeAuthentication.transactionHash } : {}), ...(row?.nativeAuthentication.storedAuthenticationTransactionHash ? { storedAuthenticationTransactionHash: row.nativeAuthentication.storedAuthenticationTransactionHash } : {}) },
        recognition: { transactionHash: item.recognitionReceipt!.transactionHash, snapshotBlockNumber: value.report.closeout.target.snapshot.blockNumber, snapshotBlockHash: value.report.closeout.target.snapshot.blockHash },
        withdrawal: { transactionHash: item.withdrawalReceipt.transactionHash, caller: item.withdrawalReceipt.from, snapshotBlockNumber: value.report.closeout.target.snapshot.blockNumber, snapshotBlockHash: value.report.closeout.target.snapshot.blockHash },
      });
    }
    for (const orderId of selection.orderIds ?? []) if (!matchedOrders.has(orderId.toLowerCase())) unresolved.push(`${selection.epochId}: selected order ${orderId} produced no verified payment for the requested subject role`);
    for (const id of selection.economicIds ?? []) if (!matchedEconomicIds.has(id.toLowerCase())) unresolved.push(`${selection.epochId}: selected economic ID ${id} produced no verified payment for the requested subject role`);
    if (!selection.orderIds && !selection.economicIds && records.length === recordCountBeforeSelection) unresolved.push(`${selection.epochId}: no verified payment matched the requested ${locator.subject.role} role`);
  }
  if (errors.length) return baseResult(locator, "invalid", errors, unresolved, snapshots, [], []);
  const grouped = new Map<string, { targetChainId: string; treasury: Address; asset: Address; kind: "WORK" | "FEE"; amount: bigint; paymentCount: number }>();
  for (const record of records) {
    const key = `${locator.domain.targetChainId}:${locator.domain.targetTreasury.toLowerCase()}:${record.asset.toLowerCase()}:${record.kind}`;
    const current = grouped.get(key) ?? { targetChainId: locator.domain.targetChainId, treasury: locator.domain.targetTreasury, asset: record.asset, kind: record.kind, amount: 0n, paymentCount: 0 };
    current.amount += BigInt(record.amount); current.paymentCount++; grouped.set(key, current);
  }
  const totals = [...grouped.values()].map(group => ({ ...group, amount: String(group.amount) }));
  return baseResult(locator, unresolved.length ? "partial" : "verified", [], [...new Set(unresolved)], snapshots, records, totals);
}

export async function collectSelectedPaymentHistory(input: { locator: PaymentHistoryLocatorV1; trusted: TrustedCloseoutDeployment; collectEpoch: (epochId: Hex) => Promise<CollectedProgramCloseoutV1> }): Promise<SelectedPaymentHistoryV1> {
  const locator = parsePaymentHistoryLocator(input.locator);
  const reports = await Promise.all(locator.selections.map(selection => input.collectEpoch(selection.epochId)));
  return verifySelectedPaymentHistory({ locator, reports, trusted: input.trusted });
}

export function stringifySelectedPaymentHistory(value: SelectedPaymentHistoryV1): string { return JSON.stringify(value, null, 2); }
