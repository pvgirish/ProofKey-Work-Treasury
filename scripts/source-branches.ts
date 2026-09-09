import {
  Contract,
  Interface,
  NonceManager,
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
  type JsonRpcProvider,
} from "ethers";
import { SOURCE_CHAIN_ID, artifact, loadEnvironment, saveReport, signingWallet } from "./runtime.ts";
import { executeSafeCall, matchedSafeOwnerKeys, recoverSafeExecution } from "./safe.ts";
import {
  SOURCE_TRANSACTION_JOURNAL_VERSION,
  buildSourceReadback,
  directReceiptSummary,
  jsonTerms,
  oneMilestoneTerms,
  rawSignature,
  receiptSummary,
  safeReceiptSummary,
  waitForBlock,
  type PendingSourceTransaction,
  type SourceReceipt,
} from "./source-demo.ts";

const WAD = 10n ** 18n;

export type SourceBranchArgs = {
  source: JsonRpcProvider;
  coordinator: string;
  safe: string;
  epochConfig: any;
  epochId: string;
  workerKey: string;
  existing?: any;
};

/** Run the separate public WorkPolicyV1 branch epoch. No target/native proof is asserted here. */
export async function runSourceBranches(args: SourceBranchArgs): Promise<any> {
  await loadEnvironment();
  const network = await args.source.getNetwork();
  if (network.chainId !== SOURCE_CHAIN_ID) throw new Error("Source branch runner only permits Ethereum Sepolia");
  const coordinatorAddress = getAddress(args.coordinator);
  const safeAddress = getAddress(args.safe);
  const a = await artifact("SourceCoordinator");
  const iface = new Interface(a.abi);
  const read = new Contract(coordinatorAddress, a.abi, args.source);
  const relayer = signingWallet("SEPOLIA_PRIVATE_KEY", args.source);
  const relayed = new Contract(coordinatorAddress, a.abi, relayer);
  const workerWallet = new Wallet(args.workerKey, args.source);
  const workerCalls = new Contract(coordinatorAddress, a.abi, new NonceManager(workerWallet));
  const ownerInfo = await matchedSafeOwnerKeys(safeAddress, args.source);
  if (ownerInfo.threshold !== 2 || ownerInfo.owners.length !== 3 || ownerInfo.matched.length !== 3) {
    throw new Error("Branch evidence requires all keys for the disclosed current 2-of-3 Safe owners");
  }
  const ownerKey = new Map(ownerInfo.matched.map((entry) => [entry.address.toLowerCase(), entry]));
  const committeeKeys = ownerInfo.owners.map((owner) => {
    const key = ownerKey.get(owner.toLowerCase());
    if (!key) throw new Error(`Missing configured key for committee ${owner}`);
    return key;
  });
  const [coordinatorCode, safeCode, workerBalance, computedEpoch] = await Promise.all([
    args.source.getCode(coordinatorAddress),
    args.source.getCode(safeAddress),
    args.source.getBalance(workerWallet.address),
    read.computeEpochId(args.epochConfig),
  ]);
  if (coordinatorCode === "0x" || safeCode === "0x") throw new Error("Missing coordinator or Safe code");
  if (workerBalance === 0n) throw new Error("Worker needs Sepolia gas for branch delivery/decline calls");
  if (String(computedEpoch).toLowerCase() !== args.epochId.toLowerCase()) throw new Error("Branch epochId mismatch");
  if (getAddress(args.epochConfig.sourceCoordinator) !== coordinatorAddress
    || getAddress(args.epochConfig.sourceSafe) !== safeAddress
    || BigInt(args.epochConfig.cap) !== 20n * WAD) throw new Error("Branch configuration must bind this coordinator/Safe and exact 20 CTC cap");

  const report: any = args.existing ? structuredClone(args.existing) : {
    schema: "ProofKeySourceBranchesV1",
    startedAt: new Date().toISOString(),
    status: "running",
    sourceOnly: true,
    transactionJournalVersion: SOURCE_TRANSACTION_JOURNAL_VERSION,
    nativeAuthenticationClaim: false,
    coordinator: coordinatorAddress,
    safe: safeAddress,
    epochId: args.epochId,
    cap: (20n * WAD).toString(),
    committee: ownerInfo.owners,
    worker: workerWallet.address,
    operations: [],
    refusals: [],
    orders: {},
    stages: {},
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
    throw new Error("Existing source branch report belongs to another epoch or deployment");
  }
  const persist = async () => {
    report.updatedAt = new Date().toISOString();
    await saveReport("source-branches.json", report);
  };
  const push = async (record: SourceReceipt) => {
    if (!report.operations.some((entry: SourceReceipt) => entry.transactionHash === record.transactionHash)) {
      report.operations.push(record);
    }
    if (report.pendingSourceTransaction?.transactionHash === record.transactionHash) {
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
    await push(summary);
    return summary;
  };
  const safeCall = async (label: string, data: string) => {
    const record = await executeSafeCall({
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
    const summary = await safeReceiptSummary(args.source, coordinatorAddress, label, record);
    await push(summary);
  };
  const getState = async () => read.epochState(args.epochId);
  const assertConserved = async () => {
    const s = await getState();
    if (BigInt(s.available) + BigInt(s.unresolved) + BigInt(s.earned) + BigInt(s.returned) !== 20n * WAD) {
      throw new Error("Branch source conservation failed");
    }
    if (!await read.slotSafetyHolds(args.epochId)) throw new Error("Branch source slot safety failed");
  };
  const assertAccounting = async (expected: {
    available: bigint;
    unresolved: bigint;
    earned: bigint;
    returned: bigint;
    phase?: number;
  }) => {
    const s = await getState();
    const actual = {
      available: BigInt(s.available),
      unresolved: BigInt(s.unresolved),
      earned: BigInt(s.earned),
      returned: BigInt(s.returned),
      phase: Number(s.phase),
    };
    if (actual.available !== expected.available || actual.unresolved !== expected.unresolved
      || actual.earned !== expected.earned || actual.returned !== expected.returned
      || (expected.phase !== undefined && actual.phase !== expected.phase)) {
      throw new Error(`Unexpected branch accounting: ${JSON.stringify(actual, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value)}`);
    }
    await assertConserved();
  };
  const orderExists = async (orderId: string) => {
    try { return Boolean((await read.order(orderId)).exists); } catch { return false; }
  };
  const stage = async (name: string) => { report.stages[name] = true; await assertConserved(); await persist(); };
  const refusal = async (label: string, action: Promise<any>) => {
    try {
      await action;
      throw new Error(`${label} unexpectedly succeeded`);
    } catch (error: any) {
      if (String(error?.message ?? error).includes("unexpectedly succeeded")) throw error;
      let decoded: string | undefined;
      const data = error?.data ?? error?.info?.error?.data ?? error?.revert?.data;
      if (typeof data === "string") {
        try { decoded = iface.parseError(data)?.name; } catch { /* preserve shortMessage */ }
      }
      report.refusals.push({
        label,
        atBlock: await args.source.getBlockNumber(),
        error: decoded ?? error?.revert?.name ?? error?.shortMessage ?? "reverted",
      });
      await persist();
    }
  };
  const makeOrder = async (
    key: string,
    label: string,
    nonce: bigint,
    work: bigint,
    fee: bigint,
    timeoutWork: bigint,
    offsets = { accept: 7n, deliver: 10n, review: 14n, rule: 20n },
  ) => {
    if (!report.orders[key]) {
      const current = BigInt(await args.source.getBlockNumber());
      const terms = oneMilestoneTerms({
        epochId: args.epochId,
        label,
        worker: workerWallet.address,
        claimOwner: workerWallet.address,
        destination: workerWallet.address,
        committee: ownerInfo.owners,
        work,
        nonce,
        acceptBefore: current + offsets.accept,
        deliverBefore: current + offsets.deliver,
        reviewBefore: current + offsets.review,
        ruleBefore: current + offsets.rule,
      });
      terms.milestones[0].fee = fee;
      terms.milestones[0].timeoutWork = timeoutWork;
      report.orders[key] = { terms: jsonTerms(terms) };
      report.orders[key].orderId = await read.computeOrderId(report.orders[key].terms);
      await persist();
    }
    return report.orders[key];
  };
  const createOffer = async (key: string) => {
    const order = report.orders[key];
    if (!await orderExists(order.orderId)) {
      await safeCall(`create-${key}`, iface.encodeFunctionData("createOffer", [order.terms]));
    }
  };
  const acceptOffer = async (key: string) => {
    const order = report.orders[key];
    if (!(await read.order(order.orderId)).agreed) {
      const digest = await read.offerAcceptanceDigest(order.orderId);
      await directCall(
        `accept-${key}`,
        relayed.acceptOffer(order.orderId, rawSignature(workerWallet, digest)),
      );
    }
  };
  const createAndAccept = async (key: string) => { await createOffer(key); await acceptOffer(key); };
  const deliver = async (key: string, label: string) => {
    const order = report.orders[key];
    const m = await read.milestone(order.orderId, 0);
    if (Number(m.status) === 2) {
      order.deliveryHash = keccak256(toUtf8Bytes(label));
      await directCall(
        `deliver-${key}`,
        workerCalls.deliver(order.orderId, 0, order.deliveryHash),
      );
    }
    return read.milestone(order.orderId, 0);
  };
  const challenge = async (key: string) => {
    const order = report.orders[key];
    const m = await read.milestone(order.orderId, 0);
    if (Number(m.status) === 3) {
      await safeCall(`challenge-${key}`, iface.encodeFunctionData("challenge", [
        order.orderId, 0, m.deliveryHash, m.stateVersion,
      ]));
    }
  };
  const waitAt = async (target: bigint, label: string) => waitForBlock(args.source, target, async (height) => {
    report.status = `${label}:${height}/${target}`;
    await persist();
  });

  if (report.pendingSourceTransaction) {
    const pending = report.pendingSourceTransaction as PendingSourceTransaction;
    if (pending.chainId !== SOURCE_CHAIN_ID.toString()) {
      throw new Error(`Journaled source transaction belongs to chain ${pending.chainId}`);
    }
    try {
      let summary: SourceReceipt | undefined;
      if (pending.kind === "safe") {
        if (!pending.safe) throw new Error("Journaled Safe transaction is missing Safe metadata");
        const recovered = await recoverSafeExecution(args.source, safeAddress, pending.safe);
        if (recovered) summary = await safeReceiptSummary(args.source, coordinatorAddress, pending.label, recovered);
      } else {
        const receipt = await args.source.getTransactionReceipt(pending.transactionHash);
        if (receipt) summary = await receiptSummary(args.source, coordinatorAddress, pending.label, receipt);
      }
      if (!summary) {
        report.status = `source-transaction-pending:${pending.label}`;
        await persist();
        throw new Error(`Source transaction is still pending: ${pending.transactionHash}`);
      }
      await push(summary);
    } catch (error) {
      if (String((error as Error).message).startsWith("Source transaction is still pending:")) throw error;
      report.failedSourceTransactions ??= [];
      report.failedSourceTransactions.push({ ...pending, failedAt: new Date().toISOString(), error: String((error as Error).message) });
      delete report.pendingSourceTransaction;
      await persist();
      throw error;
    }
  }

  if (report.stages.complete) return report;
  if (!report.stages.initialized) {
    let exists = true;
    try { await getState(); } catch { exists = false; }
    if (!exists) await safeCall("initialize-branch-epoch", iface.encodeFunctionData("initializeEpoch", [args.epochConfig]));
    await assertAccounting({ available: 20n * WAD, unresolved: 0n, earned: 0n, returned: 0n, phase: 1 });
    await stage("initialized");
  }

  if (!report.stages.pendingDeclined) {
    const order = await makeOrder("pending-decline", "Pending offer declined by worker", 2001n, 1n * WAD, 0n, 0n);
    await createOffer("pending-decline");
    if (Number((await read.milestone(order.orderId, 0)).status) !== 5) {
      await directCall(
        "worker-declines-pending",
        workerCalls.declinePendingOrder(order.orderId),
      );
    }
    if (Number((await read.milestone(order.orderId, 0)).outcome) !== 1) throw new Error("Pending decline outcome mismatch");
    await assertAccounting({ available: 20n * WAD, unresolved: 0n, earned: 0n, returned: 0n });
    await stage("pendingDeclined");
  }

  if (!report.stages.pendingExpired) {
    const order = await makeOrder(
      "pending-expiry", "Pending offer permissionlessly expired", 2002n, 1n * WAD, 0n, 0n,
      { accept: 3n, deliver: 8n, review: 12n, rule: 16n },
    );
    await createOffer("pending-expiry");
    await waitAt(BigInt(order.terms.acceptBefore), "waiting-pending-expiry");
    if (Number((await read.milestone(order.orderId, 0)).status) !== 5) {
      await directCall(
        "permissionless-pending-expiry",
        relayed.expirePendingOrder(order.orderId),
      );
    }
    if (Number((await read.milestone(order.orderId, 0)).outcome) !== 2) throw new Error("Pending expiry outcome mismatch");
    await assertAccounting({ available: 20n * WAD, unresolved: 0n, earned: 0n, returned: 0n });
    await stage("pendingExpired");
  }

  if (!report.stages.monitoringDefault) {
    const order = await makeOrder("monitoring-default", "Delivered monitoring default", 2003n, 2n * WAD, 0n, 0n);
    await createAndAccept("monitoring-default");
    await deliver("monitoring-default", "Monitoring-default delivery");
    await waitAt(BigInt(order.terms.milestones[0].reviewBefore), "waiting-monitoring-default");
    if (Number((await read.milestone(order.orderId, 0)).status) !== 5) {
      await directCall(
        "finalize-monitoring-default",
        relayed.finalizeMonitoringDefault(order.orderId, 0),
      );
    }
    if (Number((await read.milestone(order.orderId, 0)).outcome) !== 5) throw new Error("Monitoring default mismatch");
    await assertAccounting({ available: 18n * WAD, unresolved: 0n, earned: 2n * WAD, returned: 0n });
    await stage("monitoringDefault");
  }

  if (!report.stages.committeeQuorum) {
    const order = await makeOrder("committee-quorum", "Challenged exact 2-of-3 ruling", 2004n, 3n * WAD, 1n * WAD, 1n * WAD);
    await createAndAccept("committee-quorum");
    let m = await deliver("committee-quorum", "Committee-ruling delivery");
    // A mined final vote can precede the report write if the process exits between those operations.
    // Once terminal, digest getters intentionally reject the milestone, so infer completion on chain.
    if (Number(m.status) !== 5) {
      if (!order.staleSignature) {
        const staleDigest = await read.rulingDigest(order.orderId, 0, 2n * WAD, 10);
        order.staleSignature = rawSignature(committeeKeys[0].wallet, staleDigest);
        await persist();
      }
      await challenge("committee-quorum");
      m = await read.milestone(order.orderId, 0);
      if (!report.stages.staleRulingRejected) {
        await refusal("stale-ruling-signature-after-challenge", relayed.submitRulingVote.staticCall(
          order.orderId, 0, 2n * WAD, 10, committeeKeys[0].address, order.staleSignature,
        ));
        report.stages.staleRulingRejected = true;
        await persist();
      }
      const exactDigest = await read.rulingDigest(order.orderId, 0, 2n * WAD, 11);
      const exactSignature = rawSignature(committeeKeys[0].wallet, exactDigest);
      const exactMask = Number(await read.rulingVoteMask(exactDigest));
      if ((exactMask & 1) === 0 && Number(m.status) === 4) {
        await directCall(
          "committee-vote-exact-one",
          relayed.submitRulingVote(order.orderId, 0, 2n * WAD, 11, committeeKeys[0].address, exactSignature),
        );
      }
      if (!report.stages.duplicateVoteRejected) {
        await refusal("duplicate-committee-vote", relayed.submitRulingVote.staticCall(
          order.orderId, 0, 2n * WAD, 11, committeeKeys[0].address, exactSignature,
        ));
        report.stages.duplicateVoteRejected = true;
        await persist();
      }
      const otherDigest = await read.rulingDigest(order.orderId, 0, 1n * WAD, 12);
      if (Number(await read.rulingVoteMask(otherDigest)) === 0 && Number((await read.milestone(order.orderId, 0)).status) === 4) {
        await directCall(
          "committee-vote-distinct-proposal",
          relayed.submitRulingVote(
            order.orderId, 0, 1n * WAD, 12, committeeKeys[1].address,
            rawSignature(committeeKeys[1].wallet, otherDigest),
          ),
        );
      }
      if (Number((await read.milestone(order.orderId, 0)).status) !== 4) throw new Error("Distinct ruling proposals pooled unexpectedly");
      const secondDigest = await read.rulingDigest(order.orderId, 0, 2n * WAD, 11);
      await directCall(
        "committee-vote-exact-two-finalizes-work-fee",
        relayed.submitRulingVote(
          order.orderId, 0, 2n * WAD, 11, committeeKeys[2].address,
          rawSignature(committeeKeys[2].wallet, secondDigest),
        ),
      );
    }
    m = await read.milestone(order.orderId, 0);
    if (BigInt(m.finalWork) !== 2n * WAD || BigInt(m.finalFee) !== 1n * WAD) throw new Error("Exact WORK+FEE ruling mismatch");
    const finalVoteReceipt = report.operations.find((entry: SourceReceipt) =>
      entry.label === "committee-vote-exact-two-finalizes-work-fee");
    if (!finalVoteReceipt || finalVoteReceipt.allocationOrdinals.length !== 2
      || finalVoteReceipt.checkpointOrdinals.length !== 1) {
      throw new Error("Missing exact committee WORK+FEE receipt ordinals");
    }
    const [workAllocation, feeAllocation] = await Promise.all([
      read.allocationAt(args.epochId, 1),
      read.allocationAt(args.epochId, 2),
    ]);
    if (String(workAllocation.orderId).toLowerCase() !== order.orderId.toLowerCase()
      || String(feeAllocation.orderId).toLowerCase() !== order.orderId.toLowerCase()
      || Number(workAllocation.kind) !== 1 || Number(workAllocation.role) !== 1
      || Number(feeAllocation.kind) !== 2 || Number(feeAllocation.role) !== 2
      || BigInt(workAllocation.amount) !== 2n * WAD || BigInt(feeAllocation.amount) !== 1n * WAD) {
      throw new Error("Committee WORK+FEE allocation readback mismatch");
    }
    order.receiptOnlyFixture = {
      description: "Both payment facts are noninitial canonical leaves from one exact source receipt; target proofing may retain one receipt while withholding all tree siblings.",
      transactionHash: finalVoteReceipt.transactionHash,
      work: { treeIndex: 1, receiptLogOrdinal: finalVoteReceipt.allocationOrdinals[0] },
      fee: { treeIndex: 2, receiptLogOrdinal: finalVoteReceipt.allocationOrdinals[1] },
      checkpointLogOrdinal: finalVoteReceipt.checkpointOrdinals[0],
    };
    await assertAccounting({ available: 15n * WAD, unresolved: 0n, earned: 5n * WAD, returned: 0n });
    await stage("committeeQuorum");
  }

  if (!report.stages.committeeTimeout) {
    const order = await makeOrder("committee-timeout", "Challenged committee timeout", 2005n, 2n * WAD, 1n * WAD, 1n * WAD);
    await createAndAccept("committee-timeout");
    await deliver("committee-timeout", "Committee-timeout delivery");
    await challenge("committee-timeout");
    await waitAt(BigInt(order.terms.milestones[0].ruleBefore), "waiting-committee-timeout");
    if (Number((await read.milestone(order.orderId, 0)).status) !== 5) {
      await directCall(
        "finalize-committee-timeout",
        relayed.finalizeCommitteeTimeout(order.orderId, 0),
      );
    }
    const m = await read.milestone(order.orderId, 0);
    if (BigInt(m.finalWork) !== 1n * WAD || BigInt(m.finalFee) !== 0n) throw new Error("Committee timeout split mismatch");
    await assertAccounting({ available: 14n * WAD, unresolved: 0n, earned: 6n * WAD, returned: 0n });
    await stage("committeeTimeout");
  }

  if (!report.stages.mutualBeforeDefault) {
    const order = await makeOrder("mutual-before-default", "Mutual settlement after default becomes available", 2006n, 2n * WAD, 0n, 0n);
    await createAndAccept("mutual-before-default");
    await deliver("mutual-before-default", "Mutual-before-default delivery");
    await waitAt(BigInt(order.terms.milestones[0].reviewBefore), "waiting-mutual-before-default");
    let m = await read.milestone(order.orderId, 0);
    if (Number(m.status) !== 5) {
      const digest = await read.mutualDigest(order.orderId, 0, 1n * WAD, m.mutualNonce);
      await safeCall("mutual-wins-before-default", iface.encodeFunctionData("settleMutually", [
        order.orderId, 0, 1n * WAD, m.mutualNonce, "0x", rawSignature(workerWallet, digest),
      ]));
      m = await read.milestone(order.orderId, 0);
    }
    await refusal("default-rejected-after-mutual", relayed.finalizeMonitoringDefault.staticCall(order.orderId, 0));
    if (Number(m.outcome) !== 8) throw new Error("Mutual-first outcome mismatch");
    await assertAccounting({ available: 13n * WAD, unresolved: 0n, earned: 7n * WAD, returned: 0n });
    await stage("mutualBeforeDefault");
  }

  if (!report.stages.defaultBeforeMutual) {
    const order = await makeOrder("default-before-mutual", "Monitoring default wins before signed mutual", 2007n, 2n * WAD, 0n, 0n);
    await createAndAccept("default-before-mutual");
    let m = await deliver("default-before-mutual", "Default-before-mutual delivery");
    if (!order.mutualWorkerSignature) {
      const digest = await read.mutualDigest(order.orderId, 0, 1n * WAD, m.mutualNonce);
      order.mutualNonce = m.mutualNonce.toString();
      order.mutualWorkerSignature = rawSignature(workerWallet, digest);
      await persist();
    }
    await waitAt(BigInt(order.terms.milestones[0].reviewBefore), "waiting-default-before-mutual");
    if (Number((await read.milestone(order.orderId, 0)).status) !== 5) {
      await directCall(
        "default-wins-before-mutual",
        relayed.finalizeMonitoringDefault(order.orderId, 0),
      );
    }
    await refusal("mutual-rejected-after-default", relayed.settleMutually.staticCall(
      order.orderId, 0, 1n * WAD, order.mutualNonce, "0x", order.mutualWorkerSignature,
    ));
    m = await read.milestone(order.orderId, 0);
    if (Number(m.outcome) !== 5) throw new Error("Default-first outcome mismatch");
    await assertAccounting({ available: 11n * WAD, unresolved: 0n, earned: 9n * WAD, returned: 0n });
    await stage("defaultBeforeMutual");
  }

  const expectedEarned = 9n * WAD;
  let finalState = await getState();
  if (BigInt(finalState.earned) !== expectedEarned || BigInt(finalState.unresolved) !== 0n) {
    throw new Error("Unexpected branch totals before final return");
  }
  const alreadyReturned = BigInt(finalState.returned) === 11n * WAD
    && BigInt(finalState.available) === 0n
    && Number(finalState.phase) === 3;
  if (!alreadyReturned && (BigInt(finalState.available) !== 11n * WAD || BigInt(finalState.returned) !== 0n)) {
    throw new Error("Unexpected branch available/returned balance before final return");
  }
  if (Number(finalState.phase) === 1) {
    await safeCall("start-branch-draining", iface.encodeFunctionData("startDraining", [args.epochId]));
    finalState = await getState();
  }
  if (BigInt(finalState.available) !== 0n) {
    await directCall(
      "sweep-branch-remainder-11",
      relayed.sweepAvailable(args.epochId),
    );
  }
  finalState = await getState();
  if (BigInt(finalState.earned) !== 9n * WAD || BigInt(finalState.returned) !== 11n * WAD
    || BigInt(finalState.available) !== 0n || BigInt(finalState.unresolved) !== 0n || Number(finalState.phase) !== 3) {
    throw new Error("Branch epoch did not close at E=9/R=11");
  }
  report.readback = await buildSourceReadback(args.source, read, args.epochId);
  report.status = "source-branches-complete-awaiting-target-proofing";
  report.completedAt = new Date().toISOString();
  report.stages.complete = true;
  await persist();
  return report;
}
