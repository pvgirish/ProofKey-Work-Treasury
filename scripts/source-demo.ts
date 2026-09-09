import {
  AbiCoder,
  Contract,
  Interface,
  NonceManager,
  Signature,
  Wallet,
  getAddress,
  id,
  keccak256,
  parseEther,
  toUtf8Bytes,
  type JsonRpcProvider,
  type TransactionReceipt,
} from "ethers";
import {
  SOURCE_CHAIN_ID,
  artifact,
  loadEnvironment,
  saveReport,
  signingWallet,
} from "./runtime.ts";
import {
  executeSafeCall,
  matchedSafeOwnerKeys,
  MinedSafeExecutionFailure,
  recoverSafeExecution,
  type SafeExecutionRecord,
  type SafeSubmission,
} from "./safe.ts";

const ALLOCATION_TOPIC = id("AllocationCreated(bytes32,uint64,uint32,uint8,bytes32,uint32,uint8,address,uint256,address,address,bytes32,bytes32)");
const CHECKPOINT_TOPIC = id("CheckpointPublished(bytes32,bytes32,uint32,uint256,uint256,uint8)");
const abi = AbiCoder.defaultAbiCoder();
const WAD = 10n ** 18n;
export const SOURCE_TRANSACTION_JOURNAL_VERSION = 1;

export type PendingSourceTransaction = {
  kind: "safe" | "direct";
  label: string;
  transactionHash: string;
  chainId: string;
  submittedAt: string;
  safe?: SafeSubmission;
};

export type SourceDemoArgs = {
  source: JsonRpcProvider;
  coordinator: string;
  safe: string;
  epochConfig: any;
  epochId: string;
  workerKey: string;
  existing?: any;
  /** Default false: stop after RETURN=50 while order B is still unresolved. */
  resumeAfterReturn50?: boolean;
};

export type SourceReceipt = {
  label: string;
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: number;
  gasUsed: string;
  allocationOrdinals: number[];
  checkpointOrdinals: number[];
  safe?: Omit<SafeExecutionRecord, "logs">;
};

type CheckpointPayload = {
  epochId: string;
  root: string;
  leafCount: number;
  earned: string;
  returned: string;
  phase: number;
};

export function jsonTerms(value: any): any {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
}

function amount(value: any): bigint {
  return BigInt(value);
}

export function rawSignature(wallet: Wallet, digest: string): string {
  return Signature.from(wallet.signingKey.sign(digest)).serialized;
}

function termsHash(label: string, epochId: string, work: bigint, nonce: bigint): string {
  return keccak256(abi.encode(
    ["string", "bytes32", "uint256", "uint64", "bytes32"],
    [label, epochId, work, nonce, keccak256(toUtf8Bytes(`ProofKey public source demo: ${label}`))],
  ));
}

function oneMilestoneTerms(args: {
  epochId: string;
  label: string;
  worker: string;
  claimOwner: string;
  destination: string;
  committee: string[];
  work: bigint;
  nonce: bigint;
  acceptBefore: bigint;
  deliverBefore: bigint;
  reviewBefore: bigint;
  ruleBefore: bigint;
}): any {
  return {
    epochId: args.epochId,
    termsHash: termsHash(args.label, args.epochId, args.work, args.nonce),
    worker: args.worker,
    claimOwner: args.claimOwner,
    destination: args.destination,
    feeOwner: args.claimOwner,
    feeDestination: args.destination,
    committee: args.committee,
    acceptBefore: args.acceptBefore,
    nonce: args.nonce,
    milestones: [{
      work: args.work,
      fee: 0n,
      timeoutWork: 0n,
      deliverBefore: args.deliverBefore,
      reviewBefore: args.reviewBefore,
      ruleBefore: args.ruleBefore,
    }],
  };
}

export async function receiptSummary(
  provider: JsonRpcProvider,
  coordinator: string,
  label: string,
  receipt: TransactionReceipt,
  safe?: SafeExecutionRecord,
): Promise<SourceReceipt> {
  if (receipt.status !== 1) throw new Error(`${label} transaction failed: ${receipt.hash}`);
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block) throw new Error(`Missing source block ${receipt.blockNumber}`);
  const allocationOrdinals: number[] = [];
  const checkpointOrdinals: number[] = [];
  receipt.logs.forEach((log, ordinal) => {
    if (log.address.toLowerCase() !== coordinator.toLowerCase()) return;
    if (log.topics[0]?.toLowerCase() === ALLOCATION_TOPIC.toLowerCase()) allocationOrdinals.push(ordinal);
    if (log.topics[0]?.toLowerCase() === CHECKPOINT_TOPIC.toLowerCase()) checkpointOrdinals.push(ordinal);
  });
  const safeWithoutLogs = safe ? {
    outerTransactionHash: safe.outerTransactionHash,
    safeTransactionHash: safe.safeTransactionHash,
    blockNumber: safe.blockNumber,
    gasUsed: safe.gasUsed,
    nonce: safe.nonce,
    threshold: safe.threshold,
    signingOwners: safe.signingOwners,
    executionSuccessOrdinal: safe.executionSuccessOrdinal,
  } : undefined;
  return {
    label,
    transactionHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    blockTimestamp: block.timestamp,
    gasUsed: receipt.gasUsed.toString(),
    allocationOrdinals,
    checkpointOrdinals,
    safe: safeWithoutLogs,
  };
}

export async function safeReceiptSummary(
  provider: JsonRpcProvider,
  coordinator: string,
  label: string,
  safeRecord: SafeExecutionRecord,
): Promise<SourceReceipt> {
  const receipt = await provider.getTransactionReceipt(safeRecord.outerTransactionHash);
  if (!receipt) throw new Error(`Missing mined Safe receipt ${safeRecord.outerTransactionHash}`);
  return receiptSummary(provider, coordinator, label, receipt, safeRecord);
}

export async function directReceiptSummary(
  provider: JsonRpcProvider,
  coordinator: string,
  label: string,
  transactionPromise: Promise<any>,
  onSubmitted?: (transactionHash: string) => Promise<void>,
): Promise<SourceReceipt> {
  const transaction = await transactionPromise;
  await onSubmitted?.(transaction.hash);
  const receipt: TransactionReceipt | null = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error(`${label} transaction failed: ${transaction.hash}`);
  return receiptSummary(provider, coordinator, label, receipt);
}

function epochStateSnapshot(value: any): any {
  return {
    initialized: Boolean(value.initialized),
    expiredUninitialized: Boolean(value.expiredUninitialized),
    leafCount: Number(value.leafCount),
    root: String(value.root),
    available: value.available.toString(),
    unresolved: value.unresolved.toString(),
    earned: value.earned.toString(),
    returned: value.returned.toString(),
    phase: Number(value.phase),
    reservations: Number(value.reservations),
    unresolvedMilestones: Number(value.unresolvedMilestones),
    activeReturns: Number(value.activeReturns),
    drainingReturns: Number(value.drainingReturns),
  };
}

function epochConfigSnapshot(value: any): any {
  return {
    sourceChainId: value.sourceChainId.toString(),
    sourceChainKey: value.sourceChainKey.toString(),
    sourceCoordinator: String(value.sourceCoordinator),
    sourceVersion: String(value.sourceVersion),
    targetChainId: value.targetChainId.toString(),
    targetTreasury: String(value.targetTreasury),
    schemaVersion: String(value.schemaVersion),
    sourceSafe: String(value.sourceSafe),
    sponsor: String(value.sponsor),
    refundBeneficiary: String(value.refundBeneficiary),
    asset: String(value.asset),
    cap: value.cap.toString(),
    policyHash: String(value.policyHash),
    initializationCutoff: value.initializationCutoff.toString(),
    admissionCutoff: value.admissionCutoff.toString(),
    maxMilestones: Number(value.maxMilestones),
    maxActiveReturns: Number(value.maxActiveReturns),
    maxDrainingReturns: Number(value.maxDrainingReturns),
    treeDepth: Number(value.treeDepth),
    nonce: value.nonce.toString(),
  };
}

async function pinnedEpochSnapshot(
  provider: JsonRpcProvider,
  coordinator: Contract,
  epochId: string,
  requestedBlock?: number,
): Promise<any> {
  const blockNumber = requestedBlock ?? await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  if (!block) throw new Error(`Missing pinned source block ${blockNumber}`);
  const [state, config] = await Promise.all([
    coordinator.epochState.staticCall(epochId, { blockTag: blockNumber }),
    coordinator.epochConfig.staticCall(epochId, { blockTag: blockNumber }),
  ]);
  return {
    blockNumber,
    blockHash: block.hash,
    state: epochStateSnapshot(state),
    config: epochConfigSnapshot(config),
  };
}

async function checkpointPayloadForOperation(
  provider: JsonRpcProvider,
  coordinatorAddress: string,
  coordinatorInterface: Interface,
  operation: SourceReceipt,
): Promise<CheckpointPayload> {
  if (operation.allocationOrdinals.length !== 0 && operation.label.startsWith("republish-checkpoint-")) {
    throw new Error(`${operation.label} unexpectedly emitted an allocation`);
  }
  if (operation.checkpointOrdinals.length !== 1) {
    throw new Error(`${operation.label} must contain exactly one coordinator checkpoint`);
  }
  const receipt = await provider.getTransactionReceipt(operation.transactionHash);
  if (!receipt || receipt.status !== 1) throw new Error(`Missing successful receipt for ${operation.label}`);
  const log = receipt.logs[operation.checkpointOrdinals[0]];
  if (!log || log.address.toLowerCase() !== coordinatorAddress.toLowerCase()
    || log.topics[0]?.toLowerCase() !== CHECKPOINT_TOPIC.toLowerCase()) {
    throw new Error(`Recorded checkpoint ordinal is invalid for ${operation.label}`);
  }
  const decoded = coordinatorInterface.decodeEventLog("CheckpointPublished", log.data, log.topics);
  return {
    epochId: String(decoded.epochId),
    root: String(decoded.root),
    leafCount: Number(decoded.leafCount),
    earned: decoded.earned.toString(),
    returned: decoded.returned.toString(),
    phase: Number(decoded.phase),
  };
}

export async function waitForBlock(provider: JsonRpcProvider, target: bigint, onProgress: (height: bigint) => Promise<void>) {
  let current = BigInt(await provider.getBlockNumber());
  while (current < target) {
    await onProgress(current);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    current = BigInt(await provider.getBlockNumber());
  }
}

/**
 * Run the exact source half of the locked 120-unit demonstration. This function intentionally stops
 * after RETURN=50 by default so the target runner can recognize that return while B is unresolved.
 * It authenticates no native proof and makes no statement about target funding or recognition.
 */
export async function runSourceDemo(args: SourceDemoArgs): Promise<any> {
  await loadEnvironment();
  const network = await args.source.getNetwork();
  if (network.chainId !== SOURCE_CHAIN_ID) throw new Error("Source demo only permits Ethereum Sepolia");
  const coordinatorAddress = getAddress(args.coordinator);
  const safeAddress = getAddress(args.safe);
  const coordinatorArtifact = await artifact("SourceCoordinator");
  const coordinatorInterface = new Interface(coordinatorArtifact.abi);
  const relayer = signingWallet("SEPOLIA_PRIVATE_KEY", args.source);
  const workerWallet = new Wallet(args.workerKey, args.source);
  const workerTransactions = new NonceManager(workerWallet);
  const relayerCoordinator = new Contract(coordinatorAddress, coordinatorArtifact.abi, relayer);
  const workerCoordinator = new Contract(coordinatorAddress, coordinatorArtifact.abi, workerTransactions);
  const readCoordinator = new Contract(coordinatorAddress, coordinatorArtifact.abi, args.source);

  const [coordinatorCode, safeCode, ownerInfo, workerBalance, computedEpoch] = await Promise.all([
    args.source.getCode(coordinatorAddress),
    args.source.getCode(safeAddress),
    matchedSafeOwnerKeys(safeAddress, args.source),
    args.source.getBalance(workerWallet.address),
    readCoordinator.computeEpochId(args.epochConfig),
  ]);
  if (coordinatorCode === "0x" || safeCode === "0x") throw new Error("Coordinator and Safe must both be deployed contracts");
  if (String(computedEpoch).toLowerCase() !== args.epochId.toLowerCase()) throw new Error("epochId does not match the supplied canonical configuration");
  if (getAddress(args.epochConfig.sourceCoordinator) !== coordinatorAddress
    || getAddress(args.epochConfig.sourceSafe) !== safeAddress) throw new Error("Configuration is bound to another coordinator or Safe");
  if (amount(args.epochConfig.cap) !== 120n * WAD) throw new Error("The locked main source demonstration requires an exact 120 CTC cap");
  if (ownerInfo.threshold !== 2 || ownerInfo.owners.length !== 3) throw new Error("Public main demo requires the disclosed current 2-of-3 Safe");
  if (workerBalance === 0n) throw new Error("Worker signer needs Sepolia gas for delivery transactions");

  const report: any = args.existing ? structuredClone(args.existing) : {
    schema: "ProofKeySourceDemoV1",
    startedAt: new Date().toISOString(),
    status: "starting",
    sourceOnly: true,
    transactionJournalVersion: SOURCE_TRANSACTION_JOURNAL_VERSION,
    nativeAuthenticationClaim: false,
    coordinator: coordinatorAddress,
    safe: safeAddress,
    epochId: args.epochId,
    cap: (120n * WAD).toString(),
    roles: {
      buyerSafe: "Existing team-controlled 2-of-3 Safe; not represented as an independent buyer",
      worker: "Configured source worker signer; control relationship must be disclosed separately",
      relayer: "Configured Sepolia transaction relayer",
    },
    safeOwners: ownerInfo.owners,
    safeThreshold: ownerInfo.threshold,
    worker: workerWallet.address,
    operations: [],
    stages: {},
    orders: {},
  };
  if (report.transactionJournalVersion === undefined && !report.pendingSourceTransaction) {
    report.transactionJournalVersion = SOURCE_TRANSACTION_JOURNAL_VERSION;
  }
  if (report.transactionJournalVersion !== SOURCE_TRANSACTION_JOURNAL_VERSION) {
    throw new Error("Unsupported source transaction journal version");
  }
  if (String(report.epochId).toLowerCase() !== args.epochId.toLowerCase()
    || String(report.coordinator).toLowerCase() !== coordinatorAddress.toLowerCase()
    || String(report.safe).toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error("Existing source report belongs to another epoch or deployment");
  }

  const persist = async () => {
    report.updatedAt = new Date().toISOString();
    await saveReport("source-demo.json", report);
  };
  const pushOperation = async (operation: SourceReceipt) => {
    if (!report.operations.some((entry: SourceReceipt) => entry.transactionHash === operation.transactionHash)) {
      report.operations.push(operation);
    }
    if (report.pendingSourceTransaction?.transactionHash === operation.transactionHash) {
      delete report.pendingSourceTransaction;
    }
    await persist();
  };
  const journalDirect = async (label: string, transactionHash: string) => {
    report.pendingSourceTransaction = {
      kind: "direct",
      label,
      transactionHash,
      chainId: SOURCE_CHAIN_ID.toString(),
      submittedAt: new Date().toISOString(),
    } satisfies PendingSourceTransaction;
    await persist();
  };
  const directCall = async (label: string, transactionPromise: Promise<any>) => {
    const summary = await directReceiptSummary(
      args.source,
      coordinatorAddress,
      label,
      transactionPromise,
      (transactionHash) => journalDirect(label, transactionHash),
    );
    await pushOperation(summary);
    return summary;
  };
  const state = async () => readCoordinator.epochState(args.epochId);
  const assertAccounting = async (expected: { a: bigint; u: bigint; e: bigint; r: bigint }) => {
    const current = await state();
    const actual = {
      a: BigInt(current.available),
      u: BigInt(current.unresolved),
      e: BigInt(current.earned),
      r: BigInt(current.returned),
    };
    if (actual.a !== expected.a || actual.u !== expected.u || actual.e !== expected.e || actual.r !== expected.r) {
      throw new Error(`Unexpected source accounting: ${JSON.stringify(actual, (_key, value) => typeof value === "bigint" ? value.toString() : value)}`);
    }
    if (actual.a + actual.u + actual.e + actual.r !== 120n * WAD) throw new Error("Source conservation invariant failed");
    if (!await readCoordinator.slotSafetyHolds(args.epochId)) throw new Error("Source slot-safety invariant failed");
  };
  const safeCall = async (label: string, data: string) => {
    const safeRecord = await executeSafeCall({
      provider: args.source,
      safe: safeAddress,
      to: coordinatorAddress,
      data,
      relayer,
      onSubmitted: async (submission) => {
        report.pendingSourceTransaction = {
          kind: "safe",
          label,
          transactionHash: submission.outerTransactionHash,
          chainId: SOURCE_CHAIN_ID.toString(),
          submittedAt: new Date().toISOString(),
          safe: submission,
        } satisfies PendingSourceTransaction;
        await persist();
      },
    });
    const summary = await safeReceiptSummary(args.source, coordinatorAddress, label, safeRecord);
    await pushOperation(summary);
    return summary;
  };
  const orderExists = async (orderId: string) => {
    try { return Boolean((await readCoordinator.order(orderId)).exists); } catch { return false; }
  };

  if (report.pendingSourceTransaction) {
    const pending = report.pendingSourceTransaction as PendingSourceTransaction;
    if (pending.chainId !== SOURCE_CHAIN_ID.toString()) throw new Error(`Journaled source transaction belongs to chain ${pending.chainId}`);
    let summary: SourceReceipt | undefined;
    if (pending.kind === "safe") {
      if (!pending.safe) throw new Error("Journaled Safe transaction is missing Safe metadata");
      try {
        const recovered = await recoverSafeExecution(args.source, safeAddress, pending.safe);
        if (recovered) summary = await safeReceiptSummary(args.source, coordinatorAddress, pending.label, recovered);
      } catch (error) {
        if (!(error instanceof MinedSafeExecutionFailure)) throw error;
        report.failedSourceTransactions ??= [];
        report.failedSourceTransactions.push({ ...pending, failedAt: new Date().toISOString(), error: error.message, failureKind: error.kind,
          blockNumber: error.receipt.blockNumber });
        delete report.pendingSourceTransaction;
        await persist();
        throw error;
      }
    } else {
      const mined = await args.source.getTransactionReceipt(pending.transactionHash);
      if (mined?.status === 0) {
        report.failedSourceTransactions ??= [];
        report.failedSourceTransactions.push({ ...pending, failedAt: new Date().toISOString(), error: "Mined with status 0",
          blockNumber: mined.blockNumber });
        delete report.pendingSourceTransaction;
        await persist();
        // A conclusively failed acceptance leaves the offer pending. Continue so the deadline-aware
        // path can retry it or explicitly expire and replace it in this invocation.
        if (!pending.label.startsWith("accept-offer-")) throw new Error(`${pending.label} transaction mined with status 0`);
      } else if (mined?.status === 1) {
        summary = await receiptSummary(args.source, coordinatorAddress, pending.label, mined);
      } else if (mined) {
        throw new Error(`Source receipt has uncertain status: ${pending.transactionHash}`);
      }
    }
    if (summary) await pushOperation(summary);
    else if (report.pendingSourceTransaction) {
      report.status = `source-transaction-pending:${pending.label}`;
      await persist();
      throw new Error(`Source transaction is still pending: ${pending.transactionHash}`);
    }
  }

  const refreshExpiredOffer = async (key: "a" | "b" | "c") => {
    const order = report.orders[key];
    if (!order) return;
    const current = BigInt(await args.source.getBlockNumber());
    const exists = await orderExists(order.orderId);
    let reason: "unreserved-draft-expired" | "reserved-offer-expired" | "reserved-offer-already-terminal" | undefined;
    if (!exists) {
      if (current < BigInt(order.terms.acceptBefore)) return;
      reason = "unreserved-draft-expired";
    } else {
      const [storedOrder, milestone] = await Promise.all([
        readCoordinator.order(order.orderId),
        readCoordinator.milestone(order.orderId, 0),
      ]);
      if (storedOrder.agreed) return;
      if (Number(milestone.status) === 5) {
        reason = "reserved-offer-already-terminal";
      } else {
        if (current < BigInt(order.terms.acceptBefore)) return;
        await directCall(`expire-stale-offer-${key.toUpperCase()}`, relayerCoordinator.expirePendingOrder(order.orderId));
        reason = "reserved-offer-expired";
      }
    }

    const replacementBlock = BigInt(await args.source.getBlockNumber());
    const replacementNonce = BigInt(order.terms.nonce) + 1_000_000n;
    const isC = key === "c";
    const label = key === "a" ? "Order A / approved 30"
      : key === "b" ? "Order B / mutual 25 of 40"
      : "Order C / no delivery";
    const replacementTerms = jsonTerms(oneMilestoneTerms({
      epochId: args.epochId,
      label,
      worker: workerWallet.address,
      claimOwner: workerWallet.address,
      destination: workerWallet.address,
      committee: ownerInfo.owners,
      work: BigInt(order.terms.milestones[0].work),
      nonce: replacementNonce,
      acceptBefore: replacementBlock + (isC ? 12n : 60n),
      deliverBefore: replacementBlock + (isC ? 18n : 1_800n),
      reviewBefore: replacementBlock + (isC ? 32n : 2_400n),
      ruleBefore: replacementBlock + (isC ? 48n : 3_000n),
    }));
    const replacementOrderId = await readCoordinator.computeOrderId(replacementTerms);
    report.offerReplacements ??= [];
    report.offerReplacements.push({
      key,
      reason,
      replacedAtBlock: replacementBlock.toString(),
      oldOrderId: order.orderId,
      oldNonce: String(order.terms.nonce),
      oldTerms: order.terms,
      newOrderId: replacementOrderId,
      newNonce: replacementNonce.toString(),
      reservationSlotPermanentlyConsumed: reason !== "unreserved-draft-expired",
    });
    report.orders[key] = { terms: replacementTerms, orderId: replacementOrderId };
    await persist();
  };

  if (!report.stages?.awaitingReturn50Recognition) {
  // Initialization is idempotently inferred from the canonical public getter for resume safety.
  if (!report.stages.epochInitialized) {
  let initialized = true;
  try { await state(); } catch { initialized = false; }
  if (!initialized) {
    await safeCall("initialize-epoch", coordinatorInterface.encodeFunctionData("initializeEpoch", [args.epochConfig]));
  }
  await assertAccounting({ a: 120n * WAD, u: 0n, e: 0n, r: 0n });
  report.stages.epochInitialized = true;
  await persist();
  }

  if (!report.orders.a || !report.orders.b) {
    const current = BigInt(await args.source.getBlockNumber());
    const committee = ownerInfo.owners;
    const common = {
      epochId: args.epochId,
      worker: workerWallet.address,
      claimOwner: workerWallet.address,
      destination: workerWallet.address,
      committee,
      acceptBefore: current + 60n,
      deliverBefore: current + 1_800n,
      reviewBefore: current + 2_400n,
      ruleBefore: current + 3_000n,
    };
    report.orders.a = { terms: jsonTerms(oneMilestoneTerms({ ...common, label: "Order A / approved 30", work: 30n * WAD, nonce: 1001n })) };
    report.orders.b = { terms: jsonTerms(oneMilestoneTerms({ ...common, label: "Order B / mutual 25 of 40", work: 40n * WAD, nonce: 1002n })) };
    report.orders.a.orderId = await readCoordinator.computeOrderId(report.orders.a.terms);
    report.orders.b.orderId = await readCoordinator.computeOrderId(report.orders.b.terms);
    await persist(); // Save exact consent payloads before any reservation transaction.
  }

  if (!report.stages.ordersABReserved) {
  for (const key of ["a", "b"] as const) {
    await refreshExpiredOffer(key);
    const order = report.orders[key];
    if (!await orderExists(order.orderId)) {
      await safeCall(`create-offer-${key.toUpperCase()}`, coordinatorInterface.encodeFunctionData("createOffer", [order.terms]));
    }
  }
  await assertAccounting({ a: 50n * WAD, u: 70n * WAD, e: 0n, r: 0n });
  report.stages.ordersABReserved = true;
  await persist();
  }

  if (!report.stages.ordersABAgreed) {
  for (const key of ["a", "b"] as const) {
    await refreshExpiredOffer(key);
    const order = report.orders[key];
    if (!await orderExists(order.orderId)) {
      await safeCall(`create-offer-${key.toUpperCase()}`, coordinatorInterface.encodeFunctionData("createOffer", [order.terms]));
    }
    if (!(await readCoordinator.order(order.orderId)).agreed) {
      const digest = await readCoordinator.offerAcceptanceDigest(order.orderId);
      await directCall(
        `accept-offer-${key.toUpperCase()}`,
        relayerCoordinator.acceptOffer(order.orderId, rawSignature(workerWallet, digest)),
      );
    }
  }
  report.stages.ordersABAgreed = true;
  await persist();
  }

  if (!report.stages.orderAApproved) {
  const aMilestone = await readCoordinator.milestone(report.orders.a.orderId, 0);
  if (Number(aMilestone.status) === 2) {
    report.orders.a.deliveryHash = keccak256(toUtf8Bytes("ProofKey source demo A delivery v1"));
    await directCall(
      "deliver-A",
      workerCoordinator.deliver(report.orders.a.orderId, 0, report.orders.a.deliveryHash),
    );
  }
  const deliveredA = await readCoordinator.milestone(report.orders.a.orderId, 0);
  if (Number(deliveredA.status) !== 5) {
    await safeCall("approve-A", coordinatorInterface.encodeFunctionData("approve", [
      report.orders.a.orderId,
      0,
      deliveredA.deliveryHash,
      deliveredA.stateVersion,
    ]));
  }
  await assertAccounting({ a: 50n * WAD, u: 40n * WAD, e: 30n * WAD, r: 0n });
  report.stages.orderAApproved = true;
  await persist();
  }

  if (!report.stages.awaitingReturn50Recognition) {
  const beforeReturn = await state();
  if (BigInt(beforeReturn.returned) === 0n) {
    const authorizationHash = keccak256(abi.encode(
      ["string", "bytes32", "uint256"],
      ["ProofKey authorized active free release", args.epochId, 50n * WAD],
    ));
    await safeCall("release-free-50", coordinatorInterface.encodeFunctionData("releaseFree", [
      args.epochId,
      50n * WAD,
      authorizationHash,
    ]));
  }
  await assertAccounting({ a: 0n, u: 40n * WAD, e: 30n * WAD, r: 50n * WAD });
  report.status = "awaiting-return50-recognition";
  report.stages.awaitingReturn50Recognition = true;
  report.return50RecognitionInstruction = "Authenticate and recognize the recorded release-free-50 RETURN on Creditcoin while order B remains unresolved; then resume with resumeAfterReturn50=true.";
  report.readback = await buildSourceReadback(args.source, readCoordinator, args.epochId);
  await persist();
  }
  } else if (!report.stages.orderBMutuallySettled) {
    const b = report.orders?.b ? await readCoordinator.milestone(report.orders.b.orderId, 0) : undefined;
    if (!b || Number(b.status) !== 5) {
      await assertAccounting({ a: 0n, u: 40n * WAD, e: 30n * WAD, r: 50n * WAD });
    }
  }
  if (!args.resumeAfterReturn50) return report;

  // The target orchestrator must establish target recognition before selecting this explicit resume option.
  report.resumeAfterReturn50RequestedAt = new Date().toISOString();
  report.status = "resuming-after-external-return50-recognition";
  await persist();

  if (!report.stages.orderBMutuallySettled) {
    let bMilestone = await readCoordinator.milestone(report.orders.b.orderId, 0);
    if (Number(bMilestone.status) === 2) {
    report.orders.b.deliveryHash = keccak256(toUtf8Bytes("ProofKey source demo B delivery v1"));
    await directCall(
      "deliver-B",
      workerCoordinator.deliver(report.orders.b.orderId, 0, report.orders.b.deliveryHash),
    );
      bMilestone = await readCoordinator.milestone(report.orders.b.orderId, 0);
    }
    if (Number(bMilestone.status) !== 5) {
    const mutualNonce = BigInt(bMilestone.mutualNonce);
    const digest = await readCoordinator.mutualDigest(report.orders.b.orderId, 0, 25n * WAD, mutualNonce);
    await safeCall("mutually-settle-B-25", coordinatorInterface.encodeFunctionData("settleMutually", [
      report.orders.b.orderId,
      0,
      25n * WAD,
      mutualNonce,
      "0x", // Valid only because the Safe itself executes this coordinator call.
      rawSignature(workerWallet, digest),
    ]));
    }
    await assertAccounting({ a: 15n * WAD, u: 0n, e: 55n * WAD, r: 50n * WAD });
    report.stages.orderBMutuallySettled = true;
    await persist();
  }

  if (!report.stages.orderCAgreed) {
    if (!report.orders.c) {
    const current = BigInt(await args.source.getBlockNumber());
    report.orders.c = { terms: jsonTerms(oneMilestoneTerms({
      epochId: args.epochId,
      label: "Order C / no delivery",
      worker: workerWallet.address,
      claimOwner: workerWallet.address,
      destination: workerWallet.address,
      committee: ownerInfo.owners,
      work: 15n * WAD,
      nonce: 1003n,
      acceptBefore: current + 12n,
      deliverBefore: current + 18n,
      reviewBefore: current + 32n,
      ruleBefore: current + 48n,
    })) };
    report.orders.c.orderId = await readCoordinator.computeOrderId(report.orders.c.terms);
    await persist();
    }
    await refreshExpiredOffer("c");
    if (!await orderExists(report.orders.c.orderId)) {
    await safeCall("create-offer-C", coordinatorInterface.encodeFunctionData("createOffer", [report.orders.c.terms]));
    }
    if (!(await readCoordinator.order(report.orders.c.orderId)).agreed) {
    const digest = await readCoordinator.offerAcceptanceDigest(report.orders.c.orderId);
    await directCall(
      "accept-offer-C",
      relayerCoordinator.acceptOffer(report.orders.c.orderId, rawSignature(workerWallet, digest)),
    );
    }
    await assertAccounting({ a: 0n, u: 15n * WAD, e: 55n * WAD, r: 50n * WAD });
    report.stages.orderCAgreed = true;
    report.status = "waiting-for-order-C-delivery-block";
    await persist();
  }
  if (!report.stages.orderCNoDelivery) {
    const cDeliverBefore = BigInt(report.orders.c.terms.milestones[0].deliverBefore);
    await waitForBlock(args.source, cDeliverBefore, async (height) => {
    report.currentSourceBlock = height.toString();
    await persist();
    });
    const cMilestone = await readCoordinator.milestone(report.orders.c.orderId, 0);
    if (Number(cMilestone.status) !== 5) {
    await directCall(
      "finalize-C-no-delivery",
      relayerCoordinator.finalizeNoDelivery(report.orders.c.orderId, 0),
    );
    }
    await assertAccounting({ a: 15n * WAD, u: 0n, e: 55n * WAD, r: 50n * WAD });
    report.stages.orderCNoDelivery = true;
    await persist();
  }

  let finalState = await state();
  if (Number(finalState.phase) === 1) {
    await safeCall("start-draining", coordinatorInterface.encodeFunctionData("startDraining", [args.epochId]));
    finalState = await state();
  }
  if (BigInt(finalState.available) !== 0n) {
    await directCall(
      "sweep-final-15",
      relayerCoordinator.sweepAvailable(args.epochId),
    );
  }
  await assertAccounting({ a: 0n, u: 0n, e: 55n * WAD, r: 65n * WAD });
  finalState = await state();
  if (Number(finalState.phase) !== 3) throw new Error("Final source epoch did not close");

  if (!report.stages.checkpointRepublished) {
    const sweepOperation = report.operations.find((entry: SourceReceipt) => entry.label === "sweep-final-15") as SourceReceipt | undefined;
    if (!sweepOperation) throw new Error("Missing sweep-final-15 receipt for checkpoint republish comparison");
    const sweepPayload = await checkpointPayloadForOperation(
      args.source,
      coordinatorAddress,
      coordinatorInterface,
      sweepOperation,
    );
    const sweepSnapshot = await pinnedEpochSnapshot(
      args.source,
      readCoordinator,
      args.epochId,
      sweepOperation.blockNumber,
    );
    const preRepublish = await pinnedEpochSnapshot(args.source, readCoordinator, args.epochId);
    for (const label of ["republish-checkpoint-1", "republish-checkpoint-2"]) {
      if (!report.operations.some((entry: SourceReceipt) => entry.label === label)) {
        await directCall(label, relayerCoordinator.republishCheckpoint(args.epochId));
      }
    }
    const republishOperations = ["republish-checkpoint-1", "republish-checkpoint-2"].map((label) => {
      const operation = report.operations.find((entry: SourceReceipt) => entry.label === label) as SourceReceipt | undefined;
      if (!operation) throw new Error(`Missing completed ${label} operation`);
      return operation;
    });
    const republishPayloads = await Promise.all(republishOperations.map((operation) =>
      checkpointPayloadForOperation(args.source, coordinatorAddress, coordinatorInterface, operation)));
    const postRepublish = await pinnedEpochSnapshot(args.source, readCoordinator, args.epochId);
    const sweepPayloadMatchesState = sweepPayload.epochId.toLowerCase() === args.epochId.toLowerCase()
      && sweepPayload.root.toLowerCase() === sweepSnapshot.state.root.toLowerCase()
      && sweepPayload.leafCount === sweepSnapshot.state.leafCount
      && sweepPayload.earned === sweepSnapshot.state.earned
      && sweepPayload.returned === sweepSnapshot.state.returned
      && sweepPayload.phase === sweepSnapshot.state.phase;
    const samePayload = republishPayloads.every((payload) => JSON.stringify(payload) === JSON.stringify(sweepPayload));
    const sameFinancialState = [preRepublish, postRepublish].every((snapshot) =>
      snapshot.state.available === sweepSnapshot.state.available
      && snapshot.state.unresolved === sweepSnapshot.state.unresolved
      && snapshot.state.earned === sweepSnapshot.state.earned
      && snapshot.state.returned === sweepSnapshot.state.returned
      && snapshot.state.phase === sweepSnapshot.state.phase);
    const sameLeafState = [preRepublish, postRepublish].every((snapshot) =>
      snapshot.state.leafCount === sweepSnapshot.state.leafCount
      && snapshot.state.root.toLowerCase() === sweepSnapshot.state.root.toLowerCase());
    const sameConfig = [preRepublish, postRepublish].every((snapshot) =>
      JSON.stringify(snapshot.config).toLowerCase() === JSON.stringify(sweepSnapshot.config).toLowerCase());
    if (!sweepPayloadMatchesState || !samePayload || !sameFinancialState || !sameLeafState || !sameConfig) {
      throw new Error("Checkpoint republish changed or misreported frozen epoch state");
    }
    report.checkpointRepublishObservation = {
      sweepOperation: {
        label: sweepOperation.label,
        transactionHash: sweepOperation.transactionHash,
        blockNumber: sweepOperation.blockNumber,
        checkpointOrdinal: sweepOperation.checkpointOrdinals[0],
      },
      payload: sweepPayload,
      preRepublish,
      republishes: republishOperations.map((operation, index) => ({
        label: operation.label,
        transactionHash: operation.transactionHash,
        blockNumber: operation.blockNumber,
        checkpointOrdinal: operation.checkpointOrdinals[0],
        payload: republishPayloads[index],
      })),
      postRepublish,
      sweepPayloadMatchesState,
      samePayload,
      financialStateUnchanged: sameFinancialState,
      leafStateUnchanged: sameLeafState,
      configUnchanged: sameConfig,
    };
    report.stages.checkpointRepublished = true;
    await persist();
  }
  report.status = "source-complete-awaiting-final-target-recognition";
  report.completedAt = new Date().toISOString();
  report.stages.sourceComplete = true;
  report.readback = await buildSourceReadback(args.source, readCoordinator, args.epochId);
  await persist();
  return report;
}

export async function buildSourceReadback(provider: JsonRpcProvider, coordinator: Contract, epochId: string): Promise<any> {
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  if (!block) throw new Error(`Missing pinned source block ${blockNumber}`);
  const state = await coordinator.epochState.staticCall(epochId, { blockTag: blockNumber });
  const leafCount = Number(state.leafCount);
  const allocations = [];
  for (let index = 0; index < leafCount; index += 1) {
    const [allocation, leafHash] = await Promise.all([
      coordinator.allocationAt.staticCall(epochId, index, { blockTag: blockNumber }),
      coordinator.leafHashAt.staticCall(epochId, index, { blockTag: blockNumber }),
    ]);
    allocations.push({
      epochId: allocation.epochId,
      allocationId: allocation.allocationId.toString(),
      treeIndex: Number(allocation.treeIndex),
      kind: Number(allocation.kind),
      orderId: allocation.orderId,
      milestoneId: Number(allocation.milestoneId),
      role: Number(allocation.role),
      asset: allocation.asset,
      amount: allocation.amount.toString(),
      claimOwner: allocation.claimOwner,
      destination: allocation.destination,
      policyHash: allocation.policyHash,
      evidenceHash: allocation.evidenceHash,
      leafHash,
    });
  }
  return {
    blockNumber,
    blockHash: block.hash,
    root: state.root,
    leafCount,
    available: state.available.toString(),
    unresolved: state.unresolved.toString(),
    earned: state.earned.toString(),
    returned: state.returned.toString(),
    phase: Number(state.phase),
    allocations,
  };
}

export { oneMilestoneTerms };
