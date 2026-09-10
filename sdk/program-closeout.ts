import { AbiCoder, Interface, concat, getAddress, id, isHexString, keccak256 } from "ethers";
import { deserializeAllocation, hashAllocation, rebuildAllocations } from "./allocation.ts";
import { deriveWorkAuthorizationOrderTerms, parseWorkAuthorizationPackage, type WorkAuthorizationPackageV1 } from "./work-authorization.ts";
import { AllocationKind, EpochPhase, type Address, type AllocationV1, type Hex, type SerializedAllocationV1 } from "./types.ts";

export const PROGRAM_CLOSEOUT_VERSION = "proofkey.work-treasury.program-closeout.v1" as const;

const targetInterface = new Interface([
  "function withdrawFor(bytes32,uint64)",
  "function ownerWithdrawTo(bytes32,uint64,address)",
  "event AllocationRecognized(bytes32 indexed epochId,uint64 indexed allocationId,bytes32 indexed economicId,uint8 kind,uint256 amount,address claimOwner,address destination,bytes32 leafHash)",
  "event ClaimWithdrawn(bytes32 indexed epochId,uint64 indexed allocationId,uint8 kind,address indexed claimOwner,address destination,uint256 amount)",
]);
const sourceInterface = new Interface([
  "function acceptQuote((bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,address[3] committee,uint64 acceptBefore,uint64 nonce,(uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore)[] milestones),bytes workerSignature) returns(bytes32)",
  "event OrderReserved(bytes32 indexed epochId,bytes32 indexed orderId,address indexed worker,bool agreed)",
  "event OrderAgreed(bytes32 indexed epochId,bytes32 indexed orderId)",
]);
const abi = AbiCoder.defaultAbiCoder();
const safeInterface = new Interface([
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)", "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
]);
const domainTypeHash = id("EIP712Domain(uint256 chainId,address verifyingContract)");
const safeTxTypeHash = id("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)");

/** Browser-safe exact Safe CALL verification used by historical closeout provenance. */
export function verifyCloseoutSafeCall(input: { transaction: { to: string | null; data: string }; receipt: { status: number | null; logs: readonly CloseoutLog[] }; safe: string; coordinator: string; chainId: string; nonce: string; expectedSafeTxHash: Hex }) {
  if (input.receipt.status !== 1 || !input.transaction.to || !sameAddress(input.transaction.to, input.safe)) throw new Error("Safe outer transaction did not succeed at the pinned Safe");
  const parsed = safeInterface.parseTransaction({ data: input.transaction.data });
  if (parsed?.name !== "execTransaction") throw new Error("outer calldata is not Safe execTransaction");
  const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures] = parsed.args;
  if (BigInt(operation) !== 0n || !sameAddress(to, input.coordinator)) throw new Error("Safe inner action is not a direct coordinator CALL");
  if (safeInterface.encodeFunctionData("execTransaction", [to,value,data,operation,safeTxGas,baseGas,gasPrice,gasToken,refundReceiver,signatures]).toLowerCase() !== input.transaction.data.toLowerCase()) throw new Error("Safe calldata is not canonical");
  const domainSeparator = keccak256(abi.encode(["bytes32","uint256","address"], [domainTypeHash, input.chainId, input.safe]));
  const structHash = keccak256(abi.encode(["bytes32","address","uint256","bytes32","uint8","uint256","uint256","uint256","address","address","uint256"], [safeTxTypeHash,to,value,keccak256(data),operation,safeTxGas,baseGas,gasPrice,gasToken,refundReceiver,input.nonce]));
  const safeTxHash = keccak256(concat(["0x1901", domainSeparator, structHash]));
  if (safeTxHash.toLowerCase() !== input.expectedSafeTxHash.toLowerCase()) throw new Error("Safe transaction hash differs from its preimage");
  const terminals = input.receipt.logs.filter(log => sameAddress(log.address, input.safe)).map(log => { try { return safeInterface.parseLog({ topics: log.topics, data: log.data }); } catch { return null; } }).filter(Boolean);
  const successes=terminals.filter(event=>event!.name==="ExecutionSuccess"),failures=terminals.filter(event=>event!.name==="ExecutionFailure");
  if (failures.length || successes.length !== 1 || String(successes[0]!.args.txHash).toLowerCase() !== safeTxHash.toLowerCase()) throw new Error("Safe receipt lacks exactly one matching ExecutionSuccess");
  return { verified: true as const, safe: getAddress(input.safe) as Address, coordinator: getAddress(to) as Address, value: String(value), innerData: String(data) as Hex, innerDataHash: keccak256(data) as Hex, nonce: input.nonce, safeTxHash: safeTxHash as Hex, runtimeVerified:false as const, runtimeAssumption:"Safe-format calldata and terminal event verified; canonical proxy, singleton and threshold policy require a separate historical runtime/state check." };
}

export interface CloseoutLog { address: Address; topics: Hex[]; data: Hex }
export interface CloseoutReceipt {
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  status: number;
  to: Address;
  from: Address;
  input: Hex;
  logs: CloseoutLog[];
}
export interface FinalizedCloseoutSnapshot { chainId: string; blockNumber: string; blockHash: Hex; finality: "rpc-finalized" | "confirmation-depth" }
export interface CloseoutAuthentication {
  authenticationId: Hex;
  blockHeight: string;
  transactionIndex: string;
  encodedTransactionHash: Hex;
  exists: boolean;
  checkpoint?: { checkpointId: Hex; epochId: Hex; root: Hex; leafCount: number; authenticationId: Hex; logOrdinal: number; blockHeight: string; transactionIndex: string; exists: boolean };
}
export interface CloseoutTargetAllocation {
  allocation: SerializedAllocationV1;
  recognized: boolean;
  recognizedAllocation?: SerializedAllocationV1;
  recognitionReceipt?: CloseoutReceipt;
  authentication?: CloseoutAuthentication;
  completedClaim?: { allocation: SerializedAllocationV1; withdrawn: boolean; paidDestination: Address };
  withdrawalReceipt?: CloseoutReceipt;
}
export interface CloseoutEpochObservation {
  epochId: Hex;
  cap: string;
  source: {
    available: string; unresolved: string; earned: string; returned: string; phase: number;
    leafCount: number; root: Hex; allocations: SerializedAllocationV1[];
  };
  target: { reserve: string; recognized: string; funded: boolean; allocations: CloseoutTargetAllocation[]; refundOwnerFreeBalance: string };
  authorizations?: Array<{
    packet: WorkAuthorizationPackageV1;
    acceptanceReceipt: CloseoutReceipt;
    safeExecution: { nonce: string; expectedSafeTxHash: Hex };
    sourceOrder: { exists: boolean; agreed: boolean; epochId: Hex; termsHash: Hex; worker: Address };
  }>;
}
export interface ProgramCloseoutV1 {
  version: typeof PROGRAM_CLOSEOUT_VERSION;
  source: { coordinator: Address; runtimeHash: Hex; snapshot: FinalizedCloseoutSnapshot };
  target: { treasury: Address; runtimeHash: Hex; snapshot: FinalizedCloseoutSnapshot; sourceChainKey: string; nativeAttestedSourceHeight: string };
  epochs: CloseoutEpochObservation[];
}
export interface TrustedCloseoutDeployment {
  sourceChainId: string; sourceCoordinator: Address; sourceRuntimeHash: Hex;
  targetChainId: string; targetTreasury: Address; targetRuntimeHash: Hex; sourceChainKey: string;
}
export interface ProgramCloseoutResult {
  status: "complete" | "incomplete" | "invalid";
  errors: string[];
  incomplete: string[];
  totals: { cap: bigint; earned: bigint; returned: bigint; paid: bigint; outstanding: bigint };
  consent: { boundOrders: number; legacyOrders: Hex[] };
  returnAccounting: "RETURN is recognized into the refund owner's fungible freeBalance; no free withdrawal is attributed to an epoch.";
}

function amount(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} is not canonical unsigned decimal text`);
  return BigInt(value);
}
function sameAddress(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase(); }
function receiptFinalized(receipt: CloseoutReceipt, snapshot: FinalizedCloseoutSnapshot): boolean { return amount(receipt.blockNumber, "receipt block") <= amount(snapshot.blockNumber, "snapshot block"); }
function hasExactEvent(receipt: CloseoutReceipt, treasury: Address, event: "AllocationRecognized" | "ClaimWithdrawn", allocation: AllocationV1): boolean {
  return receipt.logs.some(log => {
    if (!sameAddress(log.address, treasury)) return false;
    try {
      const parsed = targetInterface.parseLog({ topics: log.topics, data: log.data });
      const economicId = keccak256(abi.encode(["bytes32", "uint64"], [allocation.epochId, allocation.allocationId]));
      return parsed?.name === event && String(parsed.args.epochId).toLowerCase() === allocation.epochId.toLowerCase()
        && BigInt(parsed.args.allocationId) === allocation.allocationId && Number(parsed.args.kind) === allocation.kind
        && BigInt(parsed.args.amount) === allocation.amount && sameAddress(parsed.args.claimOwner, allocation.claimOwner)
        && sameAddress(parsed.args.destination, allocation.destination)
        && (event !== "AllocationRecognized" || (String(parsed.args.leafHash).toLowerCase() === hashAllocation(allocation).toLowerCase() && String(parsed.args.economicId).toLowerCase() === economicId.toLowerCase()));
    } catch { return false; }
  });
}
function exactWithdrawalCall(receipt: CloseoutReceipt, treasury: Address, allocation: AllocationV1, paidDestination: Address): string | null {
  if (!sameAddress(receipt.to, treasury)) return "withdrawal transaction was not sent to the pinned treasury";
  try {
    const parsed = targetInterface.parseTransaction({ data: receipt.input });
    if (!parsed) return "withdrawal calldata is not a supported treasury function";
    if (parsed.name === "withdrawFor") {
      if (String(parsed.args[0]).toLowerCase() !== allocation.epochId.toLowerCase() || BigInt(parsed.args[1]) !== allocation.allocationId) return "withdrawFor calldata identifies another claim";
      if (!sameAddress(paidDestination, allocation.destination)) return "withdrawFor paidDestination differs from the fixed beneficiary";
      return null;
    }
    if (parsed.name === "ownerWithdrawTo") {
      if (String(parsed.args[0]).toLowerCase() !== allocation.epochId.toLowerCase() || BigInt(parsed.args[1]) !== allocation.allocationId || !sameAddress(parsed.args[2], paidDestination)) return "ownerWithdrawTo calldata differs from completedClaim";
      if (!sameAddress(receipt.from, allocation.claimOwner)) return "ownerWithdrawTo Safe/module-mediated caller is unsupported without direct claim-owner sender evidence";
      return null;
    }
    return "withdrawal calldata is not withdrawFor or ownerWithdrawTo";
  } catch { return "withdrawal calldata cannot be decoded with the pinned treasury ABI"; }
}
function exactAcceptance(packet: WorkAuthorizationPackageV1, receipt: CloseoutReceipt, coordinator: Address, sourceChainId: string, safeEvidence: { nonce: string; expectedSafeTxHash: Hex }): boolean {
  const terms = deriveWorkAuthorizationOrderTerms(packet.authorization);
  const safe = verifyCloseoutSafeCall({
    transaction: { to: receipt.to, data: receipt.input }, receipt: { status: receipt.status, logs: receipt.logs },
    safe: packet.authorization.epochConfig.sourceSafe, coordinator, chainId: sourceChainId,
    nonce: safeEvidence.nonce, expectedSafeTxHash: safeEvidence.expectedSafeTxHash,
  });
  const expectedInner = sourceInterface.encodeFunctionData("acceptQuote", [terms, packet.workerSignature]);
  if (safe.value !== "0" || safe.innerData.toLowerCase() !== expectedInner.toLowerCase()) return false;
  return receipt.logs.some(log => {
    if (!sameAddress(log.address, coordinator)) return false;
    try {
      const parsed = sourceInterface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed || String(parsed.args.epochId).toLowerCase() !== packet.authorization.targetFunding.epochId.toLowerCase() || String(parsed.args.orderId).toLowerCase() !== packet.orderId.toLowerCase()) return false;
      return parsed.name === "OrderAgreed" || (parsed.name === "OrderReserved" && sameAddress(parsed.args.worker, packet.authorization.order.worker) && parsed.args.agreed === true);
    } catch { return false; }
  });
}

/** Checks the internal consistency of an observation against an independently trusted deployment pin. A fresh RPC collector must construct the observation for a trusted verdict. */
export function verifyProgramCloseout(closeout: ProgramCloseoutV1, trusted: TrustedCloseoutDeployment): ProgramCloseoutResult {
  const errors: string[] = [], incomplete: string[] = [], legacy = new Set<Hex>();
  let capTotal = 0n, earnedTotal = 0n, returnedTotal = 0n, paid = 0n, outstanding = 0n, boundOrders = 0;
  if (closeout.version !== PROGRAM_CLOSEOUT_VERSION) errors.push("unsupported ProgramCloseout version");
  if (closeout.epochs.length === 0) errors.push("program closeout must contain at least one epoch");
  const epochIds = closeout.epochs.map(epoch => epoch.epochId.toLowerCase());
  if (new Set(epochIds).size !== epochIds.length) errors.push("program closeout contains duplicate epoch identities");
  if (closeout.source.snapshot.chainId !== trusted.sourceChainId || closeout.target.snapshot.chainId !== trusted.targetChainId
    || closeout.target.sourceChainKey !== trusted.sourceChainKey
    || !sameAddress(closeout.source.coordinator, trusted.sourceCoordinator) || !sameAddress(closeout.target.treasury, trusted.targetTreasury)
    || closeout.source.runtimeHash.toLowerCase() !== trusted.sourceRuntimeHash.toLowerCase() || closeout.target.runtimeHash.toLowerCase() !== trusted.targetRuntimeHash.toLowerCase()) errors.push("closeout does not match the independently trusted deployment manifest");
  try { getAddress(closeout.source.coordinator); getAddress(closeout.target.treasury); } catch { errors.push("invalid closeout contract address"); }
  if (!isHexString(closeout.source.runtimeHash, 32) || !isHexString(closeout.target.runtimeHash, 32)) errors.push("runtime hashes must be 32 bytes");
  const attested = amount(closeout.target.nativeAttestedSourceHeight, "native attested source height");

  for (const epoch of closeout.epochs) {
    let cap: bigint, available: bigint, unresolved: bigint, earned: bigint, returned: bigint;
    try {
      cap = amount(epoch.cap, "cap"); available = amount(epoch.source.available, "available"); unresolved = amount(epoch.source.unresolved, "unresolved"); earned = amount(epoch.source.earned, "earned"); returned = amount(epoch.source.returned, "returned");
    } catch (error) { errors.push(`${epoch.epochId}: ${(error as Error).message}`); continue; }
    capTotal += cap; earnedTotal += earned; returnedTotal += returned;
    if (cap !== available + unresolved + earned + returned) errors.push(`${epoch.epochId}: source conservation C=A+U+E+R fails`);
    if (epoch.source.phase !== EpochPhase.CLOSED || available !== 0n || unresolved !== 0n) incomplete.push(`${epoch.epochId}: source epoch is not closed with A=U=0`);
    if (epoch.source.phase === EpochPhase.CLOSED && earned + returned !== cap) errors.push(`${epoch.epochId}: closed source does not satisfy E+R=C`);
    if (epoch.source.allocations.length !== epoch.source.leafCount) errors.push(`${epoch.epochId}: source allocation prefix is incomplete`);
    let allocations: AllocationV1[] = [];
    try {
      allocations = epoch.source.allocations.map(deserializeAllocation);
      const rebuilt = rebuildAllocations(allocations);
      if (rebuilt.root.toLowerCase() !== epoch.source.root.toLowerCase()) errors.push(`${epoch.epochId}: rebuilt allocation root differs from source root`);
      if (allocations.some(a => a.epochId.toLowerCase() !== epoch.epochId.toLowerCase())) errors.push(`${epoch.epochId}: allocation belongs to another epoch`);
    } catch (error) { errors.push(`${epoch.epochId}: canonical allocation partition failed: ${(error as Error).message}`); }
    const leafKeys = new Set(allocations.map(a => `${a.epochId.toLowerCase()}:${a.allocationId}`));
    if (leafKeys.size !== allocations.length) errors.push(`${epoch.epochId}: duplicate allocation identity`);
    const allocationEarned = allocations.filter(a => a.kind === AllocationKind.WORK || a.kind === AllocationKind.FEE).reduce((sum, a) => sum + a.amount, 0n);
    const allocationReturned = allocations.filter(a => a.kind === AllocationKind.RETURN).reduce((sum, a) => sum + a.amount, 0n);
    if (allocationEarned !== earned || allocationReturned !== returned) errors.push(`${epoch.epochId}: allocation kind sums differ from E/R source state`);

    const targetReserve = amount(epoch.target.reserve, "target reserve"), targetRecognized = amount(epoch.target.recognized, "target recognized");
    if (!epoch.target.funded) errors.push(`${epoch.epochId}: target epoch is not funded`);
    if (targetReserve !== cap - targetRecognized) errors.push(`${epoch.epochId}: target reserve is not C-recognized`);
    if (epoch.target.allocations.length !== allocations.length) errors.push(`${epoch.epochId}: target allocation evidence omits or adds source leaves`);
    const targetByKey = new Map(epoch.target.allocations.map(item => [`${item.allocation.epochId.toLowerCase()}:${item.allocation.allocationId}`, item]));
    if (targetByKey.size !== epoch.target.allocations.length) errors.push(`${epoch.epochId}: duplicate target allocation evidence`);
    let recognizedSum = 0n;
    for (const allocation of allocations) {
      const key = `${allocation.epochId.toLowerCase()}:${allocation.allocationId}`;
      const item = targetByKey.get(key);
      if (!item) { errors.push(`${epoch.epochId}: omitted target evidence for allocation ${allocation.allocationId}`); continue; }
      if (hashAllocation(deserializeAllocation(item.allocation)).toLowerCase() !== hashAllocation(allocation).toLowerCase()) errors.push(`${epoch.epochId}: target evidence changed allocation ${allocation.allocationId}`);
      if (!item.recognized || !item.recognizedAllocation) { incomplete.push(`${epoch.epochId}: allocation ${allocation.allocationId} is not recognized`); outstanding += allocation.amount; continue; }
      if (hashAllocation(deserializeAllocation(item.recognizedAllocation)).toLowerCase() !== hashAllocation(allocation).toLowerCase()) errors.push(`${epoch.epochId}: recognized readback differs for allocation ${allocation.allocationId}`);
      recognizedSum += allocation.amount;
      const auth = item.authentication;
      if (!auth?.exists || !isHexString(auth.authenticationId, 32) || !isHexString(auth.encodedTransactionHash, 32)) errors.push(`${epoch.epochId}: allocation ${allocation.allocationId} lacks exact native authentication readback`);
      else if (amount(auth.blockHeight, "native authentication block") > attested) incomplete.push(`${epoch.epochId}: native frontier does not cover allocation ${allocation.allocationId} authentication position`);
      if (auth?.checkpoint) {
        const c = auth.checkpoint;
        let prefixRoot: Hex | undefined;
        try { prefixRoot = rebuildAllocations(allocations.slice(0, c.leafCount)).root; } catch {}
        if (!c.exists || c.epochId.toLowerCase() !== epoch.epochId.toLowerCase() || c.leafCount <= allocation.treeIndex || c.leafCount > epoch.source.leafCount || !prefixRoot || c.root.toLowerCase() !== prefixRoot.toLowerCase() || c.authenticationId.toLowerCase() !== auth.authenticationId.toLowerCase() || c.blockHeight !== auth.blockHeight || c.transactionIndex !== auth.transactionIndex) errors.push(`${epoch.epochId}: allocation ${allocation.allocationId} checkpoint/native identity mismatch`);
      }
      if (item.recognitionReceipt) {
        if (item.recognitionReceipt.status !== 1 || !receiptFinalized(item.recognitionReceipt, closeout.target.snapshot) || !sameAddress(item.recognitionReceipt.to, closeout.target.treasury) || !hasExactEvent(item.recognitionReceipt, closeout.target.treasury, "AllocationRecognized", allocation)) errors.push(`${epoch.epochId}: allocation ${allocation.allocationId} has no exact successful finalized recognition receipt/event`);
      } else incomplete.push(`${epoch.epochId}: allocation ${allocation.allocationId} recognition receipt is missing`);
      if (allocation.kind === AllocationKind.RETURN) continue;
      const completed = item.completedClaim;
      if (!completed || hashAllocation(deserializeAllocation(completed.allocation)).toLowerCase() !== hashAllocation(allocation).toLowerCase()) { errors.push(`${epoch.epochId}: allocation ${allocation.allocationId} completedClaim readback differs`); continue; }
      if (!completed.withdrawn) { incomplete.push(`${epoch.epochId}: allocation ${allocation.allocationId} remains payable`); outstanding += allocation.amount; continue; }
      if (!item.withdrawalReceipt) { incomplete.push(`${epoch.epochId}: allocation ${allocation.allocationId} withdrawal receipt is missing`); continue; }
      const wr = item.withdrawalReceipt;
      const callError = exactWithdrawalCall(wr, closeout.target.treasury, allocation, completed.paidDestination);
      if (wr.status !== 1 || !receiptFinalized(wr, closeout.target.snapshot) || callError || !hasExactEvent(wr, closeout.target.treasury, "ClaimWithdrawn", { ...allocation, destination: completed.paidDestination })) errors.push(`${epoch.epochId}: allocation ${allocation.allocationId} withdrawal evidence failed${callError ? `: ${callError}` : ""}`);
      else paid += allocation.amount;
    }
    if (recognizedSum !== targetRecognized) errors.push(`${epoch.epochId}: recognized leaf sum differs from target recognized accounting`);
    if (recognizedSum === cap && targetReserve !== 0n) errors.push(`${epoch.epochId}: fully recognized epoch has nonzero reserve`);

    const authorizationByOrder = new Map<Hex, NonNullable<CloseoutEpochObservation["authorizations"]>[number]>();
    for (const record of epoch.authorizations ?? []) {
      try {
        const packet = parseWorkAuthorizationPackage(record.packet);
        if (authorizationByOrder.has(packet.orderId)) throw new Error(`duplicate authorization order ${packet.orderId}`);
        if (!packet.workerSignature || !packet.signatureValidation) throw new Error("authorization packet is unsigned");
        if (packet.authorization.epochConfig.sourceCoordinator.toLowerCase() !== closeout.source.coordinator.toLowerCase() || packet.authorization.epochConfig.targetTreasury.toLowerCase() !== closeout.target.treasury.toLowerCase() || packet.authorization.targetFunding.epochId.toLowerCase() !== epoch.epochId.toLowerCase()) throw new Error("authorization domain/epoch differs from closeout");
        if (!record.sourceOrder.exists || !record.sourceOrder.agreed || record.sourceOrder.epochId.toLowerCase() !== epoch.epochId.toLowerCase() || record.sourceOrder.termsHash.toLowerCase() !== packet.termsHash.toLowerCase() || record.sourceOrder.worker.toLowerCase() !== packet.authorization.order.worker.toLowerCase()) throw new Error("historical source order readback differs from packet");
        if (!receiptFinalized(record.acceptanceReceipt, closeout.source.snapshot) || !exactAcceptance(packet, record.acceptanceReceipt, closeout.source.coordinator, trusted.sourceChainId, record.safeExecution)) throw new Error("no exact successful finalized historical Safe acceptance event");
        authorizationByOrder.set(packet.orderId, record as any); boundOrders++;
      } catch (error) { errors.push(`${epoch.epochId}: authorization evidence failed: ${(error as Error).message}`); }
    }
    for (const orderId of new Set(allocations.filter(a => a.kind !== AllocationKind.RETURN).map(a => a.orderId))) if (!authorizationByOrder.has(orderId)) legacy.add(orderId);
  }
  const status = errors.length ? "invalid" : incomplete.length ? "incomplete" : "complete";
  return { status, errors, incomplete, totals: { cap: capTotal, earned: earnedTotal, returned: returnedTotal, paid, outstanding }, consent: { boundOrders, legacyOrders: [...legacy] }, returnAccounting: "RETURN is recognized into the refund owner's fungible freeBalance; no free withdrawal is attributed to an epoch." };
}
