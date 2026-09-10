import {
  Contract,
  Interface,
  getAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  type Provider,
  type Signer,
  type TransactionReceipt,
} from "ethers";
import { deserializeAllocation, hashAllocation } from "./allocation.ts";
import { parseClaimPackage } from "./claim-package.ts";
import { decodeNativeAllocation, decodeNativeCheckpoint } from "./receipt-evidence.ts";
import { AllocationKind, type Address, type AllocationV1, type ClaimPackage, type Hex } from "./types.ts";

export const SETTLEMENT_PACKET_VERSION = "proofkey.work-treasury.settlement.v1" as const;
export const SETTLEMENT_JOURNAL_VERSION = "proofkey.work-treasury.settlement-journal.v1" as const;
export const MAX_SETTLEMENT_ACTIONS = 32;

const allocationTuple = "(bytes32 epochId,uint64 allocationId,uint32 treeIndex,uint8 kind,bytes32 orderId,uint32 milestoneId,uint8 role,address asset,uint256 amount,address claimOwner,address destination,bytes32 policyHash,bytes32 evidenceHash)";
const proofTuple = "(uint64 blockHeight,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof)";
export const SETTLEMENT_TREASURY_ABI = [
  "function SOURCE_CHAIN_ID() view returns (uint256)",
  "function SOURCE_CHAIN_KEY() view returns (uint64)",
  "function SOURCE_COORDINATOR() view returns (address)",
  "function VERIFIER() view returns (address)",
  "function nativeProfile() pure returns (bytes32)",
  "function epochConfig(bytes32) view returns (tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce))",
  "function recognizedEconomicId(bytes32) view returns (bool)",
  `function recognizedAllocation(bytes32,uint64) view returns (${allocationTuple})`,
  `function completedClaim(bytes32,uint64) view returns (${allocationTuple} allocation,bool withdrawn,address paidDestination)`,
  "function economicId(bytes32,uint64) pure returns (bytes32)",
  "function authenticationId((uint64 blockHeight,uint64 transactionIndex),bytes32) view returns (bytes32)",
  "function authentication(bytes32) view returns (tuple(uint64 blockHeight,uint64 transactionIndex,bytes32 encodedTransactionHash,bool exists))",
  "function isAuthenticated((uint64 blockHeight,uint64 transactionIndex),bytes) view returns (bool)",
  "function checkpoint(bytes32) view returns (tuple(tuple(bytes32 epochId,bytes32 root,uint32 leafCount,uint256 earned,uint256 returned,uint8 phase) checkpoint,(uint64 blockHeight,uint64 transactionIndex) position,uint32 logOrdinal,bytes32 authenticationId,bool exists))",
  `function recognizeFromCheckpoint(bytes32,${allocationTuple},bytes32[])`,
  `function authenticateAndRecognizeCheckpoint(${proofTuple},uint32,${allocationTuple},bytes32[])`,
  "function recognizeFromReceipt((uint64 blockHeight,uint64 transactionIndex),bytes,uint32)",
  `function authenticateAndRecognizeReceipt(${proofTuple},uint32)`,
  "function withdrawFor(bytes32,uint64)",
  "event AllocationRecognized(bytes32 indexed epochId,uint64 indexed allocationId,bytes32 indexed economicId,uint8 kind,uint256 amount,address claimOwner,address destination,bytes32 leafHash)",
  "event ClaimWithdrawn(bytes32 indexed epochId,uint64 indexed allocationId,uint8 kind,address indexed claimOwner,address destination,uint256 amount)",
] as const;
const treasuryInterface = new Interface(SETTLEMENT_TREASURY_ABI);
const verifierInterface = new Interface(["function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings)) pure returns(uint64)"]);

export interface FinalizedSnapshotPin { chainId: string; blockNumber: string; blockHash: Hex }
export interface RuntimePin { address: Address; deployedCodeHash: Hex }
export interface SettlementPacketV1 {
  version: typeof SETTLEMENT_PACKET_VERSION;
  source: { chainId: string; chainKey: string; coordinator: RuntimePin; finalized: FinalizedSnapshotPin };
  target: { chainId: string; treasury: RuntimePin; finalized: FinalizedSnapshotPin };
  claims: ClaimPackage[];
}
export interface TrustedSettlementDeployment {
  sourceChainId: string; sourceChainKey: string; sourceCoordinator: RuntimePin;
  targetChainId: string; targetTreasury: RuntimePin;
}

export type SettlementActionKind = "recognize" | "withdraw";
export interface SettlementAction {
  id: string;
  kind: SettlementActionKind;
  epochId: Hex;
  allocationId: string;
  expectedAllocation: AllocationV1;
  checkpointSiblings?: Hex[];
  transaction: { to: Address; data: Hex; value: "0" };
}
export interface SettlementIssue {
  allocationId: string;
  code: "needs-owner-redirection" | "unsupported";
  detail: string;
}
export interface SettlementPlanV1 {
  version: "proofkey.work-treasury.settlement-plan.v1";
  planId: Hex;
  executionDigest: Hex;
  sourceSnapshot: FinalizedSnapshotPin;
  targetSnapshot: FinalizedSnapshotPin;
  actions: SettlementAction[];
  issues: SettlementIssue[];
  alreadyComplete: string[];
}

export interface SettlementReadAdapter {
  chainId(side: "source" | "target"): Promise<bigint>;
  block(side: "source" | "target", tag: "finalized" | bigint): Promise<{ number: bigint; hash: Hex } | null>;
  code(side: "source" | "target", address: Address, blockNumber: bigint): Promise<Hex>;
  targetCall(data: Hex, blockNumber: bigint): Promise<Hex>;
  calculateNativeTransactionIndex(merkleProof: ClaimPackage extends never ? never : { root: Hex; siblings: Array<{ hash: Hex; isLeft: boolean }> }, blockNumber: bigint): Promise<bigint>;
  simulateTarget(data: Hex, blockNumber: bigint): Promise<void>;
}

function decimal(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be canonical unsigned decimal text`);
  return BigInt(value);
}
function address(value: string, label: string): Address {
  try { return getAddress(value) as Address; } catch { throw new Error(`${label} is not an address`); }
}
function hex32(value: string, label: string): Hex {
  if (!isHexString(value, 32)) throw new Error(`${label} must be 32-byte hex`);
  return value as Hex;
}
function sameAllocation(left: AllocationV1, right: AllocationV1): boolean {
  return hashAllocation(left).toLowerCase() === hashAllocation(right).toLowerCase();
}
function decodeAllocation(result: readonly unknown[]): AllocationV1 {
  const a: any = result[0];
  return deserializeAllocation({
    epochId: a.epochId ?? a[0], allocationId: String(a.allocationId ?? a[1]), treeIndex: Number(a.treeIndex ?? a[2]),
    kind: Number(a.kind ?? a[3]), orderId: a.orderId ?? a[4], milestoneId: Number(a.milestoneId ?? a[5]), role: Number(a.role ?? a[6]),
    asset: a.asset ?? a[7], amount: String(a.amount ?? a[8]), claimOwner: a.claimOwner ?? a[9], destination: a.destination ?? a[10],
    policyHash: a.policyHash ?? a[11], evidenceHash: a.evidenceHash ?? a[12],
  });
}
function allocationFromTuple(a: any): AllocationV1 {
  return deserializeAllocation({
    epochId: a.epochId ?? a[0], allocationId: String(a.allocationId ?? a[1]), treeIndex: Number(a.treeIndex ?? a[2]), kind: Number(a.kind ?? a[3]),
    orderId: a.orderId ?? a[4], milestoneId: Number(a.milestoneId ?? a[5]), role: Number(a.role ?? a[6]), asset: a.asset ?? a[7], amount: String(a.amount ?? a[8]),
    claimOwner: a.claimOwner ?? a[9], destination: a.destination ?? a[10], policyHash: a.policyHash ?? a[11], evidenceHash: a.evidenceHash ?? a[12],
  });
}
function materialOf(claim: ClaimPackage) {
  return claim.route === "checkpoint" ? claim.checkpoint.material : claim.material;
}
function authenticationOf(claim: ClaimPackage) {
  return claim.route === "checkpoint" ? claim.checkpoint.authentication : claim.authentication;
}
function proofOf(claim: ClaimPackage) {
  const material = materialOf(claim);
  if (!material) throw new Error("fresh recognition requires native material");
  return { blockHeight: material.blockHeight, encodedTransaction: material.encodedTransaction, merkleProof: material.merkleProof, continuityProof: material.continuityProof };
}

async function call(adapter: SettlementReadAdapter, name: string, args: readonly unknown[], block: bigint): Promise<readonly unknown[]> {
  const data = treasuryInterface.encodeFunctionData(name, args) as Hex;
  return treasuryInterface.decodeFunctionResult(name, await adapter.targetCall(data, block));
}

async function verifyPin(adapter: SettlementReadAdapter, side: "source" | "target", pin: FinalizedSnapshotPin, runtime: RuntimePin): Promise<void> {
  const chain = decimal(pin.chainId, `${side} snapshot chainId`);
  if (await adapter.chainId(side) !== chain) throw new Error(`${side} chain domain mismatch`);
  const pinned = decimal(pin.blockNumber, `${side} snapshot blockNumber`);
  const [block, finalized] = await Promise.all([adapter.block(side, pinned), adapter.block(side, "finalized")]);
  if (!block || block.hash.toLowerCase() !== pin.blockHash.toLowerCase()) throw new Error(`${side} snapshot block hash mismatch`);
  if (!finalized || finalized.number < pinned) throw new Error(`${side} snapshot is outside the current finalized prefix`);
  const code = await adapter.code(side, runtime.address, pinned);
  if (code === "0x" || keccak256(code).toLowerCase() !== runtime.deployedCodeHash.toLowerCase()) throw new Error(`${side} runtime pin mismatch`);
}

async function verifyAuthentication(adapter: SettlementReadAdapter, claim: ClaimPackage, targetBlock: bigint, sourceKey: bigint, nativeProfile: Hex): Promise<{ blockHeight: bigint; transactionIndex: bigint }> {
  const material = materialOf(claim);
  const reference = authenticationOf(claim);
  if (reference && reference.sourceChainKey !== sourceKey) throw new Error("claim authentication source domain mismatch");
  if (reference && reference.profileId.toLowerCase() !== nativeProfile.toLowerCase()) throw new Error("claim authentication native profile mismatch");
  if (material) {
    const transactionIndex = await adapter.calculateNativeTransactionIndex(material.merkleProof, targetBlock);
    if (reference && (reference.blockHeight !== material.blockHeight || reference.transactionIndex !== transactionIndex || reference.encodedTransactionHash.toLowerCase() !== keccak256(material.encodedTransaction).toLowerCase())) {
      throw new Error("stale proof: native material differs from its authentication reference");
    }
    return { blockHeight: material.blockHeight, transactionIndex };
  }
  if (!reference) throw new Error("claim has neither fresh native material nor cached authentication");
  const encoded = claim.route === "receipt" ? claim.encodedTransaction : claim.checkpoint.material?.encodedTransaction;
  if (!encoded) throw new Error("cached checkpoint claim is missing exact authenticated transaction bytes");
  if (keccak256(encoded).toLowerCase() !== reference.encodedTransactionHash.toLowerCase()) throw new Error("cached authentication encoded transaction hash mismatch");
  const position = { blockHeight: reference.blockHeight, transactionIndex: reference.transactionIndex };
  const authId = (await call(adapter, "authenticationId", [position, reference.encodedTransactionHash], targetBlock))[0] as Hex;
  const stored: any = (await call(adapter, "authentication", [authId], targetBlock))[0];
  if (!(stored.exists ?? stored[3]) || BigInt(stored.blockHeight ?? stored[0]) !== reference.blockHeight || BigInt(stored.transactionIndex ?? stored[1]) !== reference.transactionIndex || String(stored.encodedTransactionHash ?? stored[2]).toLowerCase() !== reference.encodedTransactionHash.toLowerCase()) {
    throw new Error("cached authentication readback mismatch");
  }
  const authenticated = (await call(adapter, "isAuthenticated", [position, encoded], targetBlock))[0];
  if (authenticated !== true) throw new Error("exact encoded receipt is not authenticated");
  return position;
}

/** Builds an immutable, bounded plan from real WorkTreasury reads. It never sends a transaction. */
export async function buildSettlementPlan(packet: SettlementPacketV1, adapter: SettlementReadAdapter, trusted: TrustedSettlementDeployment): Promise<SettlementPlanV1> {
  if (packet.version !== SETTLEMENT_PACKET_VERSION) throw new Error("unsupported settlement packet version");
  if (packet.claims.length === 0 || packet.claims.length > MAX_SETTLEMENT_ACTIONS) throw new Error(`settlement packet requires 1-${MAX_SETTLEMENT_ACTIONS} claims`);
  const sourceChainId = decimal(packet.source.chainId, "source.chainId");
  const targetChainId = decimal(packet.target.chainId, "target.chainId");
  const sourceKey = decimal(packet.source.chainKey, "source.chainKey");
  if (packet.source.chainId !== trusted.sourceChainId || packet.source.chainKey !== trusted.sourceChainKey
    || packet.target.chainId !== trusted.targetChainId
    || packet.source.coordinator.address.toLowerCase() !== trusted.sourceCoordinator.address.toLowerCase()
    || packet.source.coordinator.deployedCodeHash.toLowerCase() !== trusted.sourceCoordinator.deployedCodeHash.toLowerCase()
    || packet.target.treasury.address.toLowerCase() !== trusted.targetTreasury.address.toLowerCase()
    || packet.target.treasury.deployedCodeHash.toLowerCase() !== trusted.targetTreasury.deployedCodeHash.toLowerCase()) {
    throw new Error("settlement packet does not match the independently trusted deployment manifest");
  }
  address(packet.source.coordinator.address, "source coordinator"); address(packet.target.treasury.address, "target treasury");
  hex32(packet.source.coordinator.deployedCodeHash, "source runtime hash"); hex32(packet.target.treasury.deployedCodeHash, "target runtime hash");
  await Promise.all([
    verifyPin(adapter, "source", packet.source.finalized, packet.source.coordinator),
    verifyPin(adapter, "target", packet.target.finalized, packet.target.treasury),
  ]);
  const targetBlock = decimal(packet.target.finalized.blockNumber, "target finalized block");
  const immutables = await Promise.all([
    call(adapter, "SOURCE_CHAIN_ID", [], targetBlock), call(adapter, "SOURCE_CHAIN_KEY", [], targetBlock), call(adapter, "SOURCE_COORDINATOR", [], targetBlock), call(adapter, "nativeProfile", [], targetBlock),
  ]);
  if (BigInt(immutables[0][0] as any) !== sourceChainId || BigInt(immutables[1][0] as any) !== sourceKey || String(immutables[2][0]).toLowerCase() !== packet.source.coordinator.address.toLowerCase()) throw new Error("treasury immutable source domain mismatch");
  const nativeProfile = immutables[3][0] as Hex;
  if (targetChainId !== decimal(packet.target.finalized.chainId, "target finalized chainId")) throw new Error("target domain mismatch");

  const actions: SettlementAction[] = [], issues: SettlementIssue[] = [], alreadyComplete: string[] = [];
  const seen = new Set<string>();
  for (const raw of packet.claims) {
    const claim = parseClaimPackage(raw);
    const allocation = deserializeAllocation(claim.allocation);
    const key = `${allocation.epochId.toLowerCase()}:${allocation.allocationId}`;
    if (seen.has(key)) throw new Error(`duplicate settlement claim ${key}`); seen.add(key);
    const config: any = (await call(adapter, "epochConfig", [allocation.epochId], targetBlock))[0];
    if (BigInt(config.sourceChainId ?? config[0]) !== sourceChainId || BigInt(config.sourceChainKey ?? config[1]) !== sourceKey || String(config.sourceCoordinator ?? config[2]).toLowerCase() !== packet.source.coordinator.address.toLowerCase() || BigInt(config.targetChainId ?? config[4]) !== targetChainId || String(config.targetTreasury ?? config[5]).toLowerCase() !== packet.target.treasury.address.toLowerCase() || String(config.asset ?? config[10]).toLowerCase() !== allocation.asset.toLowerCase() || String(config.policyHash ?? config[12]).toLowerCase() !== allocation.policyHash.toLowerCase()) {
      throw new Error(`claim ${allocation.allocationId} does not match the funded epoch domain/asset/policy`);
    }
    const economicId = (await call(adapter, "economicId", [allocation.epochId, allocation.allocationId], targetBlock))[0] as Hex;
    const recognized = (await call(adapter, "recognizedEconomicId", [economicId], targetBlock))[0] === true;
    const completed: any = await call(adapter, "completedClaim", [allocation.epochId, allocation.allocationId], targetBlock);
    const withdrawn = completed[1] === true;
    if (recognized) {
      const recognizedAllocation = decodeAllocation(await call(adapter, "recognizedAllocation", [allocation.epochId, allocation.allocationId], targetBlock));
      if (!sameAllocation(recognizedAllocation, allocation)) throw new Error(`recognized allocation ${allocation.allocationId} differs from the portable claim`);
    } else {
      let data: Hex;
      if (claim.route === "checkpoint") {
        const stored: any = (await call(adapter, "checkpoint", [claim.checkpoint.checkpointId], targetBlock))[0];
        const exists = stored.exists ?? stored[4];
        if (exists) {
          const checkpoint = stored.checkpoint ?? stored[0];
          if (String(checkpoint.epochId ?? checkpoint[0]).toLowerCase() !== allocation.epochId.toLowerCase() || String(checkpoint.root ?? checkpoint[1]).toLowerCase() !== claim.checkpoint.root.toLowerCase() || Number(checkpoint.leafCount ?? checkpoint[2]) !== claim.checkpoint.leafCount) throw new Error("stored checkpoint identity differs from claim package");
          const storedPosition = stored.position ?? stored[1];
          const authId = stored.authenticationId ?? stored[3];
          const auth: any = (await call(adapter, "authentication", [authId], targetBlock))[0];
          if (!(auth.exists ?? auth[3]) || BigInt(auth.blockHeight ?? auth[0]) !== BigInt(storedPosition.blockHeight ?? storedPosition[0]) || BigInt(auth.transactionIndex ?? auth[1]) !== BigInt(storedPosition.transactionIndex ?? storedPosition[1])) throw new Error("stored checkpoint authentication readback mismatch");
          const reference = claim.checkpoint.authentication;
          if (reference && (reference.sourceChainKey !== sourceKey || reference.profileId.toLowerCase() !== nativeProfile.toLowerCase() || reference.blockHeight !== BigInt(auth.blockHeight ?? auth[0]) || reference.transactionIndex !== BigInt(auth.transactionIndex ?? auth[1]) || reference.encodedTransactionHash.toLowerCase() !== String(auth.encodedTransactionHash ?? auth[2]).toLowerCase())) throw new Error("checkpoint authentication reference differs from stored checkpoint");
          data = treasuryInterface.encodeFunctionData("recognizeFromCheckpoint", [claim.checkpoint.checkpointId, allocation, claim.siblings]) as Hex;
        } else if (claim.checkpoint.material && claim.checkpoint.receiptLocalLogOrdinal !== undefined) {
          await verifyAuthentication(adapter, claim, targetBlock, sourceKey, nativeProfile);
          const decoded = decodeNativeCheckpoint(claim.checkpoint.material.encodedTransaction, claim.checkpoint.receiptLocalLogOrdinal, packet.source.coordinator.address);
          if (decoded.epochId.toLowerCase() !== allocation.epochId.toLowerCase() || decoded.root.toLowerCase() !== claim.checkpoint.root.toLowerCase() || decoded.leafCount !== claim.checkpoint.leafCount) throw new Error("fresh checkpoint receipt differs from the portable checkpoint identity");
          data = treasuryInterface.encodeFunctionData("authenticateAndRecognizeCheckpoint", [proofOf(claim), claim.checkpoint.receiptLocalLogOrdinal, allocation, claim.siblings]) as Hex;
        } else throw new Error("checkpoint is not imported and package lacks fresh checkpoint material");
      } else if (claim.material) {
        await verifyAuthentication(adapter, claim, targetBlock, sourceKey, nativeProfile);
        const decoded = decodeNativeAllocation(claim.material.encodedTransaction, claim.receiptLocalLogOrdinal, packet.source.coordinator.address);
        if (!sameAllocation(decoded, allocation)) throw new Error("selected native receipt allocation differs from the portable claim");
        data = treasuryInterface.encodeFunctionData("authenticateAndRecognizeReceipt", [proofOf(claim), claim.receiptLocalLogOrdinal]) as Hex;
      } else {
        const position = await verifyAuthentication(adapter, claim, targetBlock, sourceKey, nativeProfile);
        const decoded = decodeNativeAllocation(claim.encodedTransaction, claim.receiptLocalLogOrdinal, packet.source.coordinator.address);
        if (!sameAllocation(decoded, allocation)) throw new Error("selected cached receipt allocation differs from the portable claim");
        data = treasuryInterface.encodeFunctionData("recognizeFromReceipt", [position, claim.encodedTransaction, claim.receiptLocalLogOrdinal]) as Hex;
      }
      await adapter.simulateTarget(data, targetBlock);
      actions.push({ id: `recognize:${key}`, kind: "recognize", epochId: allocation.epochId, allocationId: allocation.allocationId.toString(), expectedAllocation: allocation, ...(claim.route === "checkpoint" ? { checkpointSiblings: [...claim.siblings] } : {}), transaction: { to: packet.target.treasury.address, data, value: "0" } });
    }
    if (allocation.kind === AllocationKind.RETURN) {
      if (recognized) alreadyComplete.push(`return-credit:${key}`);
      continue;
    }
    if (allocation.kind !== AllocationKind.WORK && allocation.kind !== AllocationKind.FEE) throw new Error(`unsupported allocation kind ${allocation.kind}`);
    if (withdrawn) { alreadyComplete.push(`withdraw:${key}`); continue; }
    const data = treasuryInterface.encodeFunctionData("withdrawFor", [allocation.epochId, allocation.allocationId]) as Hex;
    if (recognized) {
      try { await adapter.simulateTarget(data, targetBlock); }
      catch (error) {
        const failureData = (error as any)?.data ?? (error as any)?.info?.error?.data ?? (error as any)?.error?.data;
        const transferFailed = keccak256(toUtf8Bytes("TransferFailed()")).slice(0, 10);
        if (typeof failureData !== "string" || failureData.slice(0, 10).toLowerCase() !== transferFailed.toLowerCase()) throw error;
        issues.push({ allocationId: allocation.allocationId.toString(), code: "needs-owner-redirection", detail: `Committed destination ${allocation.destination} rejected withdrawFor; only claim owner ${allocation.claimOwner} may call ownerWithdrawTo.` }); continue;
      }
    }
    actions.push({ id: `withdraw:${key}`, kind: "withdraw", epochId: allocation.epochId, allocationId: allocation.allocationId.toString(), expectedAllocation: allocation, transaction: { to: packet.target.treasury.address, data, value: "0" } });
  }
  if (actions.length > MAX_SETTLEMENT_ACTIONS) throw new Error(`plan exceeds ${MAX_SETTLEMENT_ACTIONS} actions; split the packet`);
  const basis = JSON.stringify({ version: SETTLEMENT_PACKET_VERSION, source: { chainId: packet.source.chainId, chainKey: packet.source.chainKey, coordinator: packet.source.coordinator }, target: { chainId: packet.target.chainId, treasury: packet.target.treasury }, claims: packet.claims }, (_k, v) => typeof v === "bigint" ? v.toString() : v);
  const planId = keccak256(toUtf8Bytes(basis)) as Hex;
  const executionDigest = settlementActionDigest(planId, actions);
  return { version: "proofkey.work-treasury.settlement-plan.v1", planId, executionDigest, sourceSnapshot: packet.source.finalized, targetSnapshot: packet.target.finalized, actions, issues, alreadyComplete };
}

export function settlementActionDigest(planId: Hex, actions: readonly SettlementAction[]): Hex {
  const canonical = JSON.stringify(actions.map(action => ({ id: action.id, kind: action.kind, epochId: action.epochId, allocationId: action.allocationId, to: action.transaction.to, data: action.transaction.data, value: action.transaction.value, leafHash: hashAllocation(action.expectedAllocation) })));
  return keccak256(toUtf8Bytes(`${planId.toLowerCase()}:${canonical}`)) as Hex;
}

export interface SettlementJournalV1 {
  version: typeof SETTLEMENT_JOURNAL_VERSION;
  planId: Hex;
  entries: Record<string, { state: "pending" | "complete"; transactionHash: Hex; blockNumber?: string }>;
}
export interface SettlementExecutionAdapter {
  send(transaction: SettlementAction["transaction"]): Promise<{ hash: Hex }>;
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
  wait(hash: Hex): Promise<TransactionReceipt>;
  verify(action: SettlementAction, receipt: TransactionReceipt): Promise<void>;
}

/** Executes only actions already present in an immutable plan. The tx hash is persisted before receipt waiting. */
function validateExecutableAction(action: SettlementAction, trustedTreasury: Address, trustedCoordinator: Address): void {
  if ((action.kind !== "recognize" && action.kind !== "withdraw") || action.id !== `${action.kind}:${action.epochId.toLowerCase()}:${action.allocationId}`) throw new Error("settlement action kind or canonical identity is invalid");
  if (action.transaction.to.toLowerCase() !== trustedTreasury.toLowerCase() || action.transaction.value !== "0") throw new Error(`${action.id} is outside the trusted zero-value treasury boundary`);
  if (action.epochId.toLowerCase() !== action.expectedAllocation.epochId.toLowerCase() || BigInt(action.allocationId) !== action.expectedAllocation.allocationId) throw new Error(`${action.id} identity differs from expected allocation`);
  const parsed = treasuryInterface.parseTransaction({ data: action.transaction.data });
  if (!parsed) throw new Error(`${action.id} calldata is not a treasury function`);
  const allowedRecognition = new Set(["recognizeFromCheckpoint", "authenticateAndRecognizeCheckpoint", "recognizeFromReceipt", "authenticateAndRecognizeReceipt"]);
  if (action.kind === "withdraw") {
    if (parsed.name !== "withdrawFor" || String(parsed.args[0]).toLowerCase() !== action.epochId.toLowerCase() || BigInt(parsed.args[1]) !== BigInt(action.allocationId)) throw new Error(`${action.id} is not the canonical fixed-destination withdrawal`);
  } else {
    if (!allowedRecognition.has(parsed.name)) throw new Error(`${action.id} is not a supported recognition call`);
    if (parsed.name === "recognizeFromCheckpoint" || parsed.name === "authenticateAndRecognizeCheckpoint") {
      const allocationIndex = parsed.name === "recognizeFromCheckpoint" ? 1 : 2;
      const siblingsIndex = parsed.name === "recognizeFromCheckpoint" ? 2 : 3;
      if (!sameAllocation(allocationFromTuple(parsed.args[allocationIndex]), action.expectedAllocation)) throw new Error(`${action.id} checkpoint calldata allocation differs from the verified leaf`);
      const siblings = Array.from(parsed.args[siblingsIndex], String);
      if (!action.checkpointSiblings || siblings.length !== action.checkpointSiblings.length || siblings.some((item, index) => item.toLowerCase() !== action.checkpointSiblings![index]!.toLowerCase())) throw new Error(`${action.id} checkpoint siblings differ from the verified plan`);
    } else {
      const proofOrPosition = parsed.args[0];
      const encoded = parsed.name === "recognizeFromReceipt" ? parsed.args[1] : proofOrPosition.encodedTransaction;
      const ordinal = Number(parsed.name === "recognizeFromReceipt" ? parsed.args[2] : parsed.args[1]);
      if (!sameAllocation(decodeNativeAllocation(encoded, ordinal, trustedCoordinator), action.expectedAllocation)) throw new Error(`${action.id} selected receipt allocation differs from the verified leaf`);
    }
  }
  if (treasuryInterface.encodeFunctionData(parsed.fragment, parsed.args).toLowerCase() !== action.transaction.data.toLowerCase()) throw new Error(`${action.id} calldata is not canonical ABI encoding`);
}

export async function executeSettlementPlan(options: { plan: SettlementPlanV1; trustedTreasury: Address; trustedCoordinator: Address; journal?: SettlementJournalV1; adapter: SettlementExecutionAdapter; persist: (journal: SettlementJournalV1) => Promise<void>; maxActions?: number }): Promise<SettlementJournalV1> {
  const maximum = options.maxActions ?? MAX_SETTLEMENT_ACTIONS;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_SETTLEMENT_ACTIONS) throw new Error(`maxActions must be 1-${MAX_SETTLEMENT_ACTIONS}`);
  const journal = options.journal ?? { version: SETTLEMENT_JOURNAL_VERSION, planId: options.plan.planId, entries: {} };
  if (settlementActionDigest(options.plan.planId, options.plan.actions).toLowerCase() !== options.plan.executionDigest.toLowerCase()) throw new Error("settlement plan actions differ from the verified execution digest");
  if (options.plan.version !== "proofkey.work-treasury.settlement-plan.v1" || new Set(options.plan.actions.map(action => action.id)).size !== options.plan.actions.length) throw new Error("settlement plan version or action identities are invalid");
  for (const action of options.plan.actions) validateExecutableAction(action, options.trustedTreasury, options.trustedCoordinator);
  if (journal.version !== SETTLEMENT_JOURNAL_VERSION || journal.planId.toLowerCase() !== options.plan.planId.toLowerCase()) throw new Error("journal belongs to a different settlement plan");
  let submitted = 0;
  for (const action of options.plan.actions) {
    let entry = journal.entries[action.id];
    if (entry?.state === "complete") {
      const completedReceipt = await options.adapter.receipt(entry.transactionHash);
      if (!completedReceipt || completedReceipt.status !== 1) throw new Error(`${action.id} journal completion has no successful receipt`);
      await options.adapter.verify(action, completedReceipt);
      continue;
    }
    let receipt: TransactionReceipt | null;
    if (entry?.state === "pending") receipt = await options.adapter.receipt(entry.transactionHash);
    else {
      if (submitted >= maximum) break;
      const tx = await options.adapter.send(action.transaction);
      entry = journal.entries[action.id] = { state: "pending", transactionHash: tx.hash };
      await options.persist(journal);
      submitted++;
      receipt = await options.adapter.wait(tx.hash);
    }
    if (!receipt) break;
    if (receipt.status !== 1) throw new Error(`${action.id} transaction failed: ${entry.transactionHash}`);
    await options.adapter.verify(action, receipt);
    journal.entries[action.id] = { state: "complete", transactionHash: entry.transactionHash, blockNumber: String(receipt.blockNumber) };
    await options.persist(journal);
  }
  return journal;
}

/** Real ethers adapter used by the replacement-operator CLI. */
export function ethersSettlementReadAdapter(source: Provider, target: Provider, treasury: Address): SettlementReadAdapter {
  return {
    async chainId(side) { return (await (side === "source" ? source : target).getNetwork()).chainId; },
    async block(side, tag) { const b = await (side === "source" ? source : target).getBlock(tag === "finalized" ? tag : Number(tag)); return b ? { number: BigInt(b.number), hash: b.hash as Hex } : null; },
    async code(side, at, blockNumber) { return await (side === "source" ? source : target).getCode(at, Number(blockNumber)) as Hex; },
    async targetCall(data, blockNumber) { return await target.call({ to: treasury, data, blockTag: Number(blockNumber) }) as Hex; },
    async calculateNativeTransactionIndex(merkleProof, blockNumber) {
      const verifierResult = treasuryInterface.decodeFunctionResult("VERIFIER", await target.call({ to: treasury, data: treasuryInterface.encodeFunctionData("VERIFIER"), blockTag: Number(blockNumber) }));
      const result = await target.call({ to: verifierResult[0], data: verifierInterface.encodeFunctionData("calculateTxIndex", [merkleProof]), blockTag: Number(blockNumber) });
      return BigInt(verifierInterface.decodeFunctionResult("calculateTxIndex", result)[0]);
    },
    async simulateTarget(data, blockNumber) { await target.call({ to: treasury, data, blockTag: Number(blockNumber) }); },
  };
}

export function ethersSettlementExecutionAdapter(signer: Signer, treasury: Address): SettlementExecutionAdapter {
  const provider = signer.provider;
  if (!provider) throw new Error("settlement signer has no provider");
  const contract = new Contract(treasury, SETTLEMENT_TREASURY_ABI, provider);
  return {
    async send(transaction) { const tx = await signer.sendTransaction({ to: transaction.to, data: transaction.data, value: 0 }); return { hash: tx.hash as Hex }; },
    async receipt(hash) { return await provider.getTransactionReceipt(hash); },
    async wait(hash) { const receipt = await provider.waitForTransaction(hash); if (!receipt) throw new Error(`transaction was not mined: ${hash}`); return receipt; },
    async verify(action, receipt) {
      const expected = action.expectedAllocation;
      const eventName = action.kind === "recognize" ? "AllocationRecognized" : "ClaimWithdrawn";
      const matching = receipt.logs.some(log => {
        if (log.address.toLowerCase() !== treasury.toLowerCase()) return false;
        try { const parsed = treasuryInterface.parseLog(log); return parsed?.name === eventName && String(parsed.args.epochId).toLowerCase() === action.epochId.toLowerCase() && BigInt(parsed.args.allocationId) === BigInt(action.allocationId) && BigInt(parsed.args.amount) === expected.amount && String(parsed.args.destination).toLowerCase() === expected.destination.toLowerCase(); } catch { return false; }
      });
      if (!matching) throw new Error(`${action.id} successful receipt is missing its exact ${eventName} event`);
      if (action.kind === "recognize") {
        const economicId = await contract.economicId(action.epochId, action.allocationId);
        if (!await contract.recognizedEconomicId(economicId)) throw new Error(`${action.id} recognition readback is false`);
      } else {
        const completed = await contract.completedClaim(action.epochId, action.allocationId);
        if (!completed.withdrawn || String(completed.paidDestination).toLowerCase() !== expected.destination.toLowerCase()) throw new Error(`${action.id} completedClaim readback mismatch`);
      }
    },
  };
}
