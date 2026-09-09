import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  Contract,
  Interface,
  NonceManager,
  Signature,
  Wallet,
  ZeroAddress,
  concat,
  getAddress,
  keccak256,
  parseEther,
  toUtf8Bytes,
  type JsonRpcProvider,
  type TransactionReceipt,
} from "ethers";
import {
  ROOT,
  SOURCE_CHAIN_ID,
  SOURCE_CHAIN_KEY,
  TARGET_CHAIN_ID,
  artifact,
  loadEnvironment,
  required,
  saveReport,
  signingWallet,
  testNetworks,
} from "./runtime.ts";
import { POLICY_HASH, SCHEMA_VERSION, SOURCE_VERSION, epochId } from "../sdk/identity.ts";
import { deserializeAllocation, orderedProof, rebuildAllocations } from "../sdk/allocation.ts";
import {
  SAFE_ABI,
  executeSafeCall,
  MinedSafeExecutionFailure,
  recoverSafeExecution,
  type SafeExecutionRecord,
  type SafeSubmission,
} from "./safe.ts";
import {
  buildSourceReadback,
  jsonTerms,
  oneMilestoneTerms,
  rawSignature,
  receiptSummary,
  safeReceiptSummary,
} from "./source-demo.ts";
import { authenticatedPositions, fetchNativeBundle, singleProof } from "./proofs.ts";

const REPORT_NAME = "public-safe-rotation.json";
const WAD = 10n ** 18n;
const SENTINEL_OWNERS = "0x0000000000000000000000000000000000000001";

type Pending = {
  chain: "source" | "target";
  kind: "direct" | "safe";
  label: string;
  hash: string;
  safeAddress?: string;
  safe?: SafeSubmission;
};

await loadEnvironment();
const { source, target } = await testNetworks();
try {
  await main(source, target);
} finally {
  source.destroy();
  target.destroy();
}

async function readOptional(path: string): Promise<any | null> {
  try { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; return null; }
}

function sortedSignatures(digest: string, wallets: Wallet[]): string {
  return concat([...wallets]
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))
    .map((wallet) => Signature.from(wallet.signingKey.sign(digest)).serialized));
}

function exactCodeHash(bytecode: string): string {
  return keccak256(bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`);
}

async function main(source: JsonRpcProvider, target: JsonRpcProvider): Promise<void> {
  const deployment = await readOptional("deployments/testnet.json");
  if (!deployment?.source?.coordinator || !deployment?.target?.treasury || !deployment?.source?.safe) {
    throw new Error("Pinned testnet contracts must be deployed first");
  }
  const existingSafeAddress = getAddress(deployment.source.safe);
  if (getAddress(required("SAFE_ADDRESS")) !== existingSafeAddress) {
    throw new Error("SAFE_ADDRESS does not match the pinned existing Safe");
  }

  const ownerWallets = {
    X: new Wallet(required("SAFE_OWNER_X_PRIVATE_KEY"), source),
    Y: new Wallet(required("SAFE_OWNER_Y_PRIVATE_KEY"), source),
    Z: new Wallet(required("SAFE_OWNER_Z_PRIVATE_KEY"), source),
    W: new Wallet(required("SAFE_OWNER_W_PRIVATE_KEY"), source),
  };
  if (new Set(Object.values(ownerWallets).map((wallet) => wallet.address.toLowerCase())).size !== 4) {
    throw new Error("Safe rotation requires four distinct X/Y/Z/W owner keys");
  }
  const initialOwners = [ownerWallets.X.address, ownerWallets.Y.address, ownerWallets.Z.address].map(getAddress);
  const replacementOwner = getAddress(ownerWallets.W.address);
  const workerWallet = new Wallet(required("NEW_OWNER_PRIVATE_KEY"), source);
  if (await source.getBalance(workerWallet.address) === 0n) {
    throw new Error("Rotation worker needs Sepolia gas for delivery transactions");
  }
  const workerCalls = new Contract(
    deployment.source.coordinator,
    (await artifact("SourceCoordinator")).abi,
    new NonceManager(workerWallet),
  );
  const sourceRelayer = signingWallet("SEPOLIA_PRIVATE_KEY", source);
  const targetSponsor = signingWallet("CREDITCOIN_WALLET_PRIVATE_KEY", target);
  const sourceArtifact = await artifact("SourceCoordinator");
  const sourceInterface = new Interface(sourceArtifact.abi);
  const coordinator = new Contract(deployment.source.coordinator, sourceArtifact.abi, sourceRelayer);
  const coordinatorRead = new Contract(deployment.source.coordinator, sourceArtifact.abi, source);
  const treasuryArtifact = await artifact("WorkTreasury");
  const treasury = new Contract(deployment.target.treasury, treasuryArtifact.abi, targetSponsor);

  const safeArtifact = JSON.parse(await readFile(resolve(ROOT, "vendor/safe/Safe.json"), "utf8"));
  const factoryArtifact = JSON.parse(await readFile(resolve(ROOT, "vendor/safe/SafeProxyFactory.json"), "utf8"));
  const safeInterface = new Interface(safeArtifact.abi);
  const factoryInterface = new Interface(factoryArtifact.abi);
  const existingProxy = new Contract(existingSafeAddress, [
    "function masterCopy() view returns(address)",
    "function getOwners() view returns(address[])",
    "function getThreshold() view returns(uint256)",
    "function nonce() view returns(uint256)",
  ], source);
  const [singletonRaw, existingOwnersRaw, existingThreshold, existingNonce] = await Promise.all([
    existingProxy.masterCopy(), existingProxy.getOwners(), existingProxy.getThreshold(), existingProxy.nonce(),
  ]);
  const singleton = getAddress(singletonRaw);
  const singletonCode = await source.getCode(singleton);
  const expectedSingletonHash = exactCodeHash(safeArtifact.deployedBytecode);
  if (singletonCode === "0x" || keccak256(singletonCode) !== expectedSingletonHash) {
    throw new Error("Existing Safe masterCopy does not match the pinned vendor Safe 1.4.1 runtime");
  }

  let report: any = await readOptional(`evidence/${REPORT_NAME}`);
  report ??= {
    version: 1,
    startedAt: new Date().toISOString(),
    status: "preparing-disposable-safe",
    scope: "Public testnet demonstration with a new disposable Safe. The existing SAFE_ADDRESS is never a transaction target.",
    existingSafe: {
      address: existingSafeAddress,
      ownersAtStart: Array.from(existingOwnersRaw, (owner) => getAddress(String(owner))),
      threshold: Number(existingThreshold),
      nonceAtStart: existingNonce.toString(),
      masterCopy: singleton,
      pinnedRuntimeHash: expectedSingletonHash,
    },
    initialOwners,
    replacementOwner,
    removedOwner: getAddress(ownerWallets.Z.address),
    worker: getAddress(workerWallet.address),
    operations: [],
    stages: {},
  };
  if (getAddress(report.existingSafe.address) !== existingSafeAddress
    || getAddress(report.existingSafe.masterCopy) !== singleton
    || String(report.existingSafe.pinnedRuntimeHash).toLowerCase() !== expectedSingletonHash.toLowerCase()) {
    throw new Error("Rotation report belongs to another existing Safe or singleton runtime");
  }
  const persist = async () => {
    report.updatedAt = new Date().toISOString();
    await saveReport(REPORT_NAME, report);
  };
  const mark = async (stage: string, status: string) => {
    report.stages[stage] = true;
    report.status = status;
    await persist();
  };
  const push = async (record: any) => {
    if (!report.operations.some((entry: any) => entry.transactionHash?.toLowerCase() === record.transactionHash.toLowerCase())) {
      report.operations.push(record);
    }
    if (record.label === "deploy-disposable-safe-factory" && record.contractAddress) {
      report.factory = getAddress(record.contractAddress);
    }
    if (record.label === "create-disposable-safe-proxy" && !report.disposableSafe) {
      const creation = record.logs.map((log: any) => {
        try { return factoryInterface.parseLog({ topics: log.topics, data: log.data }); } catch { return null; }
      }).find((parsed: any) => parsed?.name === "ProxyCreation");
      if (!creation || getAddress(creation.args.singleton) !== singleton) throw new Error("Missing exact Safe ProxyCreation event");
      report.disposableSafe = getAddress(creation.args.proxy);
    }
    if (report.pending?.hash?.toLowerCase() === record.transactionHash.toLowerCase()) delete report.pending;
    await persist();
    return record;
  };
  const rawReceiptRecord = async (chain: "source" | "target", label: string, receipt: TransactionReceipt) => {
    const rpc = chain === "source" ? source : target;
    const block = await rpc.getBlock(receipt.blockNumber);
    if (!block || receipt.status !== 1) throw new Error(`${label} failed`);
    return {
      chain,
      label,
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      blockTimestamp: block.timestamp,
      gasUsed: receipt.gasUsed.toString(),
      contractAddress: receipt.contractAddress,
      logs: receipt.logs.map((log, ordinal) => ({ ordinal, address: getAddress(log.address), topics: Array.from(log.topics), data: log.data })),
    };
  };
  const direct = async (chain: "source" | "target", label: string, promise: Promise<any>) => {
    const tx = await promise;
    report.pending = { chain, kind: "direct", label, hash: tx.hash } satisfies Pending;
    await persist();
    let receipt: TransactionReceipt | null;
    try { receipt = await tx.wait(); }
    catch (error: any) { receipt = error.receipt; if (!receipt) throw error; }
    if (!receipt || receipt.status !== 1) {
      report.failedTransactions ??= [];
      report.failedTransactions.push({ ...(report.pending as Pending), failedAt: new Date().toISOString(), blockNumber: receipt?.blockNumber });
      delete report.pending;
      await persist();
      throw new Error(`${label} transaction failed: ${tx.hash}`);
    }
    const record = chain === "source"
      ? { chain, ...(await receiptSummary(source, deployment.source.coordinator, label, receipt)), contractAddress: receipt.contractAddress,
        logs: receipt.logs.map((log, ordinal) => ({ ordinal, address: getAddress(log.address), topics: Array.from(log.topics), data: log.data })) }
      : await rawReceiptRecord(chain, label, receipt);
    return push(record);
  };
  const safeCall = async (label: string, safe: string, to: string, data: string, ownerAddresses?: string[]) => {
    if (getAddress(safe) === existingSafeAddress || getAddress(to) === existingSafeAddress) {
      throw new Error("Disposable rotation runner refuses to transact through or call the existing SAFE_ADDRESS");
    }
    const execution = await executeSafeCall({
      provider: source,
      safe,
      to,
      data,
      relayer: sourceRelayer,
      ownerAddresses,
      onSubmitted: async (submission) => {
        report.pending = {
          chain: "source",
          kind: "safe",
          label,
          hash: submission.outerTransactionHash,
          safeAddress: safe,
          safe: submission,
        } satisfies Pending;
        await persist();
      },
    });
    return push({ chain: "source", ...(await safeReceiptSummary(source, deployment.source.coordinator, label, execution)) });
  };

  if (report.pending) {
    const pending = report.pending as Pending;
    const rpc = pending.chain === "source" ? source : target;
    if (pending.kind === "safe") {
      if (!pending.safe || !pending.safeAddress) throw new Error("Pending Safe execution lacks recovery metadata");
      let recovered: SafeExecutionRecord | null;
      try { recovered = await recoverSafeExecution(source, pending.safeAddress, pending.safe); }
      catch (error: any) {
        if (!(error instanceof MinedSafeExecutionFailure)) throw error;
        report.failedTransactions ??= [];
        report.failedTransactions.push({ ...pending, failedAt: new Date().toISOString(), error: error.message,
          failureKind: error.kind, blockNumber: error.receipt.blockNumber });
        delete report.pending;
        await persist();
        throw error;
      }
      if (!recovered) { report.status = `waiting-pending-${pending.label}`; await persist(); return; }
      await push({ chain: "source", ...(await safeReceiptSummary(source, deployment.source.coordinator, pending.label, recovered)) });
    } else {
      const receipt = await rpc.getTransactionReceipt(pending.hash);
      if (!receipt) { report.status = `waiting-pending-${pending.label}`; await persist(); return; }
      if (receipt.status !== 1) {
        report.failedTransactions ??= [];
        report.failedTransactions.push({ ...pending, failedAt: new Date().toISOString(), blockNumber: receipt.blockNumber });
        delete report.pending;
        await persist();
        throw new Error(`Recorded ${pending.label} transaction failed: ${pending.hash}`);
      }
      const record = pending.chain === "source"
        ? { chain: "source", ...(await receiptSummary(source, deployment.source.coordinator, pending.label, receipt)), contractAddress: receipt.contractAddress,
          logs: receipt.logs.map((log, ordinal) => ({ ordinal, address: getAddress(log.address), topics: Array.from(log.topics), data: log.data })) }
        : await rawReceiptRecord("target", pending.label, receipt);
      await push(record);
    }
  }

  if (!report.factory) {
    const gas = await sourceRelayer.estimateGas({ data: factoryArtifact.bytecode });
    const record = await direct("source", "deploy-disposable-safe-factory",
      sourceRelayer.sendTransaction({ data: factoryArtifact.bytecode, gasLimit: gas * 12n / 10n }));
    if (!record.contractAddress) throw new Error("Safe factory deployment returned no contract address");
    report.factory = getAddress(record.contractAddress);
    await persist();
  }
  const factoryCode = await source.getCode(report.factory);
  if (keccak256(factoryCode) !== exactCodeHash(factoryArtifact.deployedBytecode)) {
    throw new Error("Disposable Safe factory runtime does not match the pinned vendor artifact");
  }
  report.factoryRuntimeHash = keccak256(factoryCode);

  if (!report.disposableSafe) {
    report.safeSaltNonce ??= BigInt(Date.now()).toString();
    const initializer = safeInterface.encodeFunctionData("setup", [
      initialOwners, 2, ZeroAddress, "0x", ZeroAddress, ZeroAddress, 0, ZeroAddress,
    ]);
    report.safeInitializer = initializer;
    await persist();
    const factory = new Contract(report.factory, factoryArtifact.abi, sourceRelayer);
    const record = await direct("source", "create-disposable-safe-proxy",
      factory.createProxyWithNonce(singleton, initializer, report.safeSaltNonce));
    if (!report.disposableSafe) throw new Error(`Safe proxy address missing from ${record.transactionHash}`);
    await persist();
  }
  const disposableSafe = getAddress(report.disposableSafe);
  if (disposableSafe === existingSafeAddress) throw new Error("Disposable Safe unexpectedly equals existing SAFE_ADDRESS");
  const safeRead = new Contract(disposableSafe, [
    ...SAFE_ABI,
    "function masterCopy() view returns(address)",
    "function isOwner(address) view returns(bool)",
    "function swapOwner(address prevOwner,address oldOwner,address newOwner)",
  ], source);
  const [disposableMasterCopy, disposableOwners, disposableThreshold] = await Promise.all([
    safeRead.masterCopy(), safeRead.getOwners(), safeRead.getThreshold(),
  ]);
  if (getAddress(disposableMasterCopy) !== singleton || Number(disposableThreshold) !== 2) {
    throw new Error("Disposable Safe masterCopy or threshold mismatch");
  }
  report.disposableSafeVerification = {
    address: disposableSafe,
    masterCopy: getAddress(disposableMasterCopy),
    singletonRuntimeHash: expectedSingletonHash,
    factory: getAddress(report.factory),
    factoryRuntimeHash: report.factoryRuntimeHash,
    threshold: Number(disposableThreshold),
  };
  const currentOwnerSet = new Set(Array.from(disposableOwners, (owner) => getAddress(String(owner)).toLowerCase()));
  const preRotation = currentOwnerSet.has(ownerWallets.Z.address.toLowerCase());
  const expectedOwners = preRotation ? initialOwners : [ownerWallets.X.address, ownerWallets.Y.address, ownerWallets.W.address];
  if (expectedOwners.some((owner) => !currentOwnerSet.has(owner.toLowerCase()))) throw new Error("Disposable Safe owner set mismatch");
  if (!report.stages.disposableSafeCreated) await mark("disposableSafeCreated", "disposable-safe-created-and-verified");

  if (!report.config) {
    const height = BigInt(await source.getBlockNumber());
    const sponsor = await targetSponsor.getAddress();
    report.config = {
      sourceChainId: SOURCE_CHAIN_ID,
      sourceChainKey: SOURCE_CHAIN_KEY,
      sourceCoordinator: deployment.source.coordinator,
      sourceVersion: SOURCE_VERSION,
      targetChainId: TARGET_CHAIN_ID,
      targetTreasury: deployment.target.treasury,
      schemaVersion: SCHEMA_VERSION,
      sourceSafe: disposableSafe,
      sponsor,
      refundBeneficiary: sponsor,
      asset: ZeroAddress,
      cap: parseEther("3"),
      policyHash: POLICY_HASH,
      initializationCutoff: height + 1_800n,
      admissionCutoff: height + 7_200n,
      maxMilestones: 32,
      maxActiveReturns: 16,
      maxDrainingReturns: 33,
      treeDepth: 7,
      nonce: BigInt(Date.now()),
    };
    report.epochId = epochId(report.config);
    await persist();
  }
  if (BigInt(report.config.cap) !== 3n * WAD || getAddress(report.config.sourceSafe) !== disposableSafe
    || getAddress(report.config.sourceCoordinator) !== getAddress(deployment.source.coordinator)
    || getAddress(report.config.targetTreasury) !== getAddress(deployment.target.treasury)
    || epochId(report.config).toLowerCase() !== String(report.epochId).toLowerCase()) {
    throw new Error("Rotation epoch must bind the disposable Safe and exact 3 CTC cap");
  }

  const account = await treasury.epochAccount(report.epochId);
  if (!account.funded) await direct("target", "fund-disposable-safe-epoch-3", treasury.fundEpoch(report.config, { value: report.config.cap }));
  if (!report.fundingFinalized) {
    const finalized = await target.getBlock("finalized");
    if (!finalized || !(await treasury.epochAccount.staticCall(report.epochId, { blockTag: finalized.number })).funded) {
      report.status = "awaiting-finalized-disposable-safe-funding";
      await persist();
      return;
    }
    report.fundingFinalized = { blockNumber: finalized.number, blockHash: finalized.hash };
    await mark("fundingFinalized", "disposable-safe-funding-finalized");
  }

  let sourceState: any;
  try { sourceState = await coordinatorRead.epochState(report.epochId); } catch { sourceState = null; }
  if (!sourceState) {
    await safeCall("initialize-disposable-safe-epoch", disposableSafe, deployment.source.coordinator,
      sourceInterface.encodeFunctionData("initializeEpoch", [report.config]));
  }
  if (!report.stages.epochInitialized) await mark("epochInitialized", "disposable-safe-source-epoch-initialized");

  if (!report.orders) {
    const height = BigInt(await source.getBlockNumber());
    const common = {
      epochId: report.epochId,
      worker: workerWallet.address,
      claimOwner: workerWallet.address,
      destination: workerWallet.address,
      committee: initialOwners,
      acceptBefore: height + 720n,
      deliverBefore: height + 1_800n,
      reviewBefore: height + 2_400n,
      ruleBefore: height + 3_000n,
    };
    report.orders = {
      a: { terms: jsonTerms(oneMilestoneTerms({ ...common, label: "Disposable Safe pre-rotation WORK", work: 1n * WAD, nonce: 3001n })) },
      b: { terms: jsonTerms(oneMilestoneTerms({ ...common, label: "Disposable Safe queued WORK", work: 1n * WAD, nonce: 3002n })) },
    };
    for (const key of ["a", "b"]) report.orders[key].orderId = await coordinatorRead.computeOrderId(report.orders[key].terms);
    await persist();
  }
  const orderExists = async (id: string) => { try { return Boolean((await coordinatorRead.order(id)).exists); } catch { return false; } };
  const accept = async (key: "a" | "b") => {
    const order = report.orders[key];
    if (!(await coordinatorRead.order(order.orderId)).agreed) {
      const digest = await coordinatorRead.offerAcceptanceDigest(order.orderId);
      await direct("source", `accept-rotation-${key.toUpperCase()}`,
        coordinator.acceptOffer(order.orderId, rawSignature(workerWallet, digest)));
    }
  };
  const deliver = async (key: "a" | "b") => {
    const order = report.orders[key];
    const milestone = await coordinatorRead.milestone(order.orderId, 0);
    if (Number(milestone.status) === 2) {
      order.deliveryHash ??= keccak256(toUtf8Bytes(`ProofKey disposable Safe ${key.toUpperCase()} delivery`));
      await persist();
      await direct("source", `deliver-rotation-${key.toUpperCase()}`,
        workerCalls.deliver(order.orderId, 0, order.deliveryHash));
    }
    return coordinatorRead.milestone(order.orderId, 0);
  };

  const orderA = report.orders.a;
  if (!await orderExists(orderA.orderId)) {
    await safeCall("create-rotation-offer-A", disposableSafe, deployment.source.coordinator,
      sourceInterface.encodeFunctionData("createOffer", [orderA.terms]));
  }
  await accept("a");
  let milestoneA = await deliver("a");
  if (Number(milestoneA.status) !== 5) {
    await safeCall("approve-pre-rotation-A", disposableSafe, deployment.source.coordinator,
      sourceInterface.encodeFunctionData("approve", [orderA.orderId, 0, milestoneA.deliveryHash, milestoneA.stateVersion]));
    milestoneA = await coordinatorRead.milestone(orderA.orderId, 0);
  }
  if (BigInt(milestoneA.finalWork) !== 1n * WAD || Number(milestoneA.outcome) !== 4) {
    throw new Error("Pre-rotation WORK did not finalize exactly");
  }
  if (!report.stages.preRotationWorkEarned) await mark("preRotationWorkEarned", "pre-rotation-work-earned");

  const orderB = report.orders.b;
  if (!await orderExists(orderB.orderId)) {
    await safeCall("create-rotation-offer-B", disposableSafe, deployment.source.coordinator,
      sourceInterface.encodeFunctionData("createOffer", [orderB.terms]));
  }
  await accept("b");
  let milestoneB = await deliver("b");
  if (Number(milestoneB.status) !== 3 && Number(milestoneB.status) !== 5) {
    throw new Error("Queued B must be delivered or final");
  }
  if (!report.stages.secondWorkDelivered) await mark("secondWorkDelivered", "second-work-delivered-before-rotation");

  if (!report.queuedApproval && Number(milestoneB.status) !== 5) {
    const safeNonce = BigInt(await safeRead.nonce());
    const executionNonce = safeNonce + 1n;
    const approvalCalldata = sourceInterface.encodeFunctionData("approve", [
      orderB.orderId, 0, milestoneB.deliveryHash, milestoneB.stateVersion,
    ]);
    const digest = await safeRead.getTransactionHash(
      deployment.source.coordinator, 0, approvalCalldata, 0, 0, 0, 0, ZeroAddress, ZeroAddress, executionNonce,
    );
    const oldSigningWallets = [ownerWallets.X, ownerWallets.Z]
      .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
    const oldSignatures = sortedSignatures(digest, oldSigningWallets);
    report.queuedApproval = {
      preparedBeforeRotation: true,
      preparedAtBlock: await source.getBlockNumber(),
      preparedAtSafeNonce: safeNonce.toString(),
      executionNonce: executionNonce.toString(),
      coordinator: deployment.source.coordinator,
      approvalCalldata,
      safeTransactionHash: digest,
      oldSigningOwners: oldSigningWallets.map((wallet) => getAddress(wallet.address)),
      oldSignatures,
      execTransactionCalldata: safeInterface.encodeFunctionData("execTransaction", [
        deployment.source.coordinator, 0, approvalCalldata, 0, 0, 0, 0, ZeroAddress, ZeroAddress, oldSignatures,
      ]),
    };
    await mark("oldApprovalQueued", "old-owner-approval-signed-for-post-rotation-nonce");
  }

  if (await safeRead.isOwner(ownerWallets.Z.address)) {
    const owners = Array.from(await safeRead.getOwners(), (owner) => getAddress(String(owner)));
    const index = owners.findIndex((owner) => owner.toLowerCase() === ownerWallets.Z.address.toLowerCase());
    if (index < 0) throw new Error("Selected removed owner is absent before rotation");
    const previousOwner = index === 0 ? SENTINEL_OWNERS : owners[index - 1]!;
    const rotationCalldata = safeInterface.encodeFunctionData("swapOwner", [previousOwner, ownerWallets.Z.address, ownerWallets.W.address]);
    report.rotation = {
      previousOwner,
      removedOwner: ownerWallets.Z.address,
      replacementOwner: ownerWallets.W.address,
      calldata: rotationCalldata,
      target: disposableSafe,
    };
    await persist();
    await safeCall("rotate-disposable-safe-Z-to-W", disposableSafe, disposableSafe, rotationCalldata,
      [ownerWallets.X.address, ownerWallets.Y.address]);
  }
  const ownersAfter = Array.from(await safeRead.getOwners(), (owner) => getAddress(String(owner)));
  if (ownersAfter.some((owner) => owner.toLowerCase() === ownerWallets.Z.address.toLowerCase())
    || !ownersAfter.some((owner) => owner.toLowerCase() === ownerWallets.W.address.toLowerCase())) {
    throw new Error("Disposable Safe owner rotation did not persist");
  }
  if (!report.stages.ownerRotated) await mark("ownerRotated", "disposable-safe-owner-rotated");

  milestoneB = await coordinatorRead.milestone(orderB.orderId, 0);
  if (!report.oldOwnerRefusal && Number(milestoneB.status) !== 5) {
    const queued = report.queuedApproval;
    if (BigInt(await safeRead.nonce()) !== BigInt(queued.executionNonce)) throw new Error("Queued approval nonce is no longer current");
    const safeWrite = new Contract(disposableSafe, SAFE_ABI, sourceRelayer);
    try {
      await safeWrite.execTransaction.staticCall(
        deployment.source.coordinator, 0, queued.approvalCalldata, 0, 0, 0, 0,
        ZeroAddress, ZeroAddress, queued.oldSignatures,
      );
      throw new Error("Removed-owner signature set unexpectedly succeeded");
    } catch (error: any) {
      if (String(error.message).includes("unexpectedly succeeded")) throw error;
      const refusalReason = String(error.reason ?? error.shortMessage ?? error.message ?? "reverted");
      if (!refusalReason.includes("GS026")) throw new Error(`Old-owner refusal was not Safe GS026: ${refusalReason}`);
      report.oldOwnerRefusal = {
        observedAtBlock: await source.getBlockNumber(),
        safeNonce: String(await safeRead.nonce()),
        safeTransactionHash: queued.safeTransactionHash,
        exactExecTransactionCalldata: queued.execTransactionCalldata,
        error: refusalReason,
        scope: "Read-only eth_call after rotation against the disposable Safe. No refusal transaction was broadcast and no claim is made about the existing SAFE_ADDRESS.",
      };
      await mark("oldOwnerRefused", "queued-old-owner-signatures-refused");
    }
  }
  if (Number(milestoneB.status) !== 5) {
    const execution = await executeSafeCall({
      provider: source,
      safe: disposableSafe,
      to: deployment.source.coordinator,
      data: report.queuedApproval.approvalCalldata,
      relayer: sourceRelayer,
      ownerAddresses: [ownerWallets.X.address, ownerWallets.W.address],
      onSubmitted: async (submission) => {
        report.pending = { chain: "source", kind: "safe", label: "approve-queued-B-with-current-X-W", hash: submission.outerTransactionHash,
          safeAddress: disposableSafe, safe: submission } satisfies Pending;
        await persist();
      },
    });
    if (execution.safeTransactionHash.toLowerCase() !== report.queuedApproval.safeTransactionHash.toLowerCase()) {
      throw new Error("Current owners did not execute the exact queued approval");
    }
    await push({ chain: "source", ...(await safeReceiptSummary(source, deployment.source.coordinator, "approve-queued-B-with-current-X-W", execution)) });
  }
  milestoneB = await coordinatorRead.milestone(orderB.orderId, 0);
  if (BigInt(milestoneB.finalWork) !== 1n * WAD || Number(milestoneB.outcome) !== 4) {
    throw new Error("Post-rotation queued WORK did not finalize exactly");
  }
  if (!report.stages.currentOwnersApproved) await mark("currentOwnersApproved", "same-queued-approval-executed-by-current-owners");

  sourceState = await coordinatorRead.epochState(report.epochId);
  if (Number(sourceState.phase) === 1) {
    await safeCall("start-disposable-safe-draining", disposableSafe, deployment.source.coordinator,
      sourceInterface.encodeFunctionData("startDraining", [report.epochId]), [ownerWallets.X.address, ownerWallets.W.address]);
    sourceState = await coordinatorRead.epochState(report.epochId);
  }
  if (BigInt(sourceState.available) !== 0n) {
    await direct("source", "return-disposable-safe-remainder-1", coordinator.sweepAvailable(report.epochId));
  }
  sourceState = await coordinatorRead.epochState(report.epochId);
  if (BigInt(sourceState.earned) !== 2n * WAD || BigInt(sourceState.returned) !== 1n * WAD
    || BigInt(sourceState.available) !== 0n || BigInt(sourceState.unresolved) !== 0n || Number(sourceState.phase) !== 3) {
    throw new Error("Disposable Safe epoch did not close at E=2/R=1");
  }
  if (!report.stages.sourceClosed) await mark("sourceClosed", "source-closed-earned-2-returned-1");
  const finalSource = report.operations.find((entry: any) => entry.label === "return-disposable-safe-remainder-1");
  if (!finalSource || finalSource.allocationOrdinals.length !== 1 || finalSource.checkpointOrdinals.length !== 1) {
    throw new Error("Final RETURN receipt ordinals are missing");
  }
  report.sourceReadback = await buildSourceReadback(source, coordinatorRead, report.epochId);
  await persist();

  if (!report.nativeBundle) {
    const bundle = await fetchNativeBundle(source, target, [finalSource.transactionHash]);
    if (!bundle.ready) {
      report.status = "awaiting-disposable-safe-native-attestation";
      report.nativeWait = bundle;
      await persist();
      return;
    }
    report.nativeBundle = bundle;
    delete report.nativeWait;
    await persist();
  }
  const proof = report.nativeBundle.proofs[0];
  if (!report.checkpointId) {
    let position: any;
    try { position = (await authenticatedPositions(treasury, [proof]))[0]; } catch { /* authenticate below */ }
    if (!position) {
      await direct("target", "authenticate-disposable-safe-final-checkpoint",
        treasury.authenticateCheckpoint(singleProof(proof), finalSource.checkpointOrdinals[0]));
      position = (await authenticatedPositions(treasury, [proof]))[0];
    }
    const authenticationId = await treasury.authenticationId(
      { blockHeight: position.blockHeight, transactionIndex: position.transactionIndex }, position.encodedTransactionHash,
    );
    report.nativePosition = position;
    report.checkpointId = await treasury.selectedLogId(authenticationId, finalSource.checkpointOrdinals[0]);
    await persist();
  }
  const position = { blockHeight: report.nativePosition.blockHeight, transactionIndex: report.nativePosition.transactionIndex };
  if (!await treasury.recognizedEconomicId(await treasury.economicId(report.epochId, 3))) {
    await direct("target", "recognize-disposable-safe-return-receipt",
      treasury.recognizeFromReceipt(position, proof.encodedTransaction, finalSource.allocationOrdinals[0]));
  }
  const allocations = report.sourceReadback.allocations.map(deserializeAllocation);
  const rebuilt = rebuildAllocations(allocations);
  const checkpoint = await treasury.checkpoint(report.checkpointId);
  if (rebuilt.root.toLowerCase() !== checkpoint.checkpoint.root.toLowerCase()) {
    throw new Error("Disposable Safe public allocation rebuild does not match the authenticated checkpoint");
  }
  for (const allocation of allocations.filter((entry: any) => entry.kind === 1)) {
    if (!await treasury.recognizedEconomicId(await treasury.economicId(report.epochId, allocation.allocationId))) {
      await direct("target", `recognize-rotation-work-${allocation.allocationId}`,
        treasury.recognizeFromCheckpoint(report.checkpointId, allocation, orderedProof(rebuilt.leaves, allocation.treeIndex)));
    }
    if (!(await treasury.claim(report.epochId, allocation.allocationId)).withdrawn) {
      await direct("target", `withdraw-rotation-work-${allocation.allocationId}`,
        treasury.withdrawFor(report.epochId, allocation.allocationId));
    }
  }
  // A RETURN credit is not a completed refund until the owner withdraws it.
  if (!report.operations.some((entry: any) => entry.label === "withdraw-disposable-safe-return-1")) {
    await direct("target", "withdraw-disposable-safe-return-1",
      treasury.withdrawFreeFor(report.config.refundBeneficiary, WAD));
  }
  const finalAccount = await treasury.epochAccount(report.epochId);
  if (BigInt(finalAccount.reserve) !== 0n || BigInt(finalAccount.recognized) !== 3n * WAD) {
    throw new Error("Disposable Safe target epoch did not recognize exact 3 CTC");
  }
  const existingOwnersAfter = Array.from(await existingProxy.getOwners(), (owner) => getAddress(String(owner)));
  if (existingOwnersAfter.map((owner) => owner.toLowerCase()).sort().join(",")
    !== report.existingSafe.ownersAtStart.map((owner: string) => owner.toLowerCase()).sort().join(",")) {
    throw new Error("Existing Safe owner set changed during disposable rotation demonstration");
  }
  if (BigInt(await existingProxy.nonce()) !== BigInt(report.existingSafe.nonceAtStart)) {
    throw new Error("Existing Safe nonce changed during disposable rotation demonstration");
  }
  const preRotationApproval = report.operations.find((entry: any) => entry.label === "approve-pre-rotation-A");
  const rotationExecution = report.operations.find((entry: any) => entry.label === "rotate-disposable-safe-Z-to-W");
  if (!preRotationApproval || !rotationExecution
    || preRotationApproval.blockNumber >= rotationExecution.blockNumber
    || Number(report.queuedApproval.preparedAtBlock) >= rotationExecution.blockNumber) {
    throw new Error("Recorded Safe rotation chronology is incomplete or out of order");
  }
  report.oldAllocationCollectedAfterRotation = {
    allocationId: "1",
    sourceOrderId: orderA.orderId,
    createdBeforeRotation: true,
    sourceAllocationBlock: preRotationApproval.blockNumber,
    rotationBlock: rotationExecution.blockNumber,
    recognizedFromAuthenticatedFinalCheckpoint: true,
    withdrawn: true,
  };
  report.finalTarget = { reserve: finalAccount.reserve.toString(), recognized: finalAccount.recognized.toString(), refundWithdrawn: WAD.toString() };
  report.status = "disposable-safe-rotation-complete";
  report.completedAt = new Date().toISOString();
  await persist();
}
