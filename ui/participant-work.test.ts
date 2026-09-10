import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Wallet, getAddress, id, keccak256 } from "ethers";
import { POLICY_HASH, SCHEMA_VERSION, SOURCE_VERSION, epochId, quoteDigest } from "../sdk/identity.ts";
import type { Address, Hex } from "../sdk/types.ts";
import {
  attachWorkerQuoteSignature,
  createWorkAuthorizationDraft,
  deriveWorkAuthorizationOrderTerms,
} from "../sdk/work-authorization.ts";
import type { WorkAuthorizationContentV1, WorkAuthorizationPackageV1, WorkAuthorizationProvider } from "../sdk/work-authorization.ts";
import {
  PARTICIPANT_WORK_STORE_VERSION,
  dispatchParticipantJourney,
  emptyParticipantWorkStore,
  parseParticipantWorkStore,
  prepareParticipantDelivery,
  readParticipantWork,
  reviewSignedParticipantWork,
  reviewUnsignedParticipantOffer,
  signReviewedParticipantOffer,
  upsertParticipantWork,
} from "./participant-work.ts";
import type { ParticipantWorkRead, TrustedParticipantDomain } from "./participant-work.ts";

const worker = new Wallet("0x59c6995e998f97a5a0044976f7d2d171d0f9b7d7e4f2f6c43a7a7d0b18f3f231");
const address = (byte: string) => getAddress(`0x${byte.repeat(40)}`) as Address;
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex;
const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const EPOCH_TUPLE = "tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)";
const sourceSdk = new Interface([
  `function epochConfig(bytes32) view returns (${EPOCH_TUPLE})`,
  "function epochState(bytes32) view returns (tuple(bool initialized,bool expiredUninitialized,uint32 leafCount,bytes32 root,uint256 available,uint256 unresolved,uint256 earned,uint256 returned,uint8 phase,uint32 reservations,uint32 unresolvedMilestones,uint32 activeReturns,uint32 drainingReturns))",
  "function quoteNonceState(bytes32,address,uint64) view returns (uint8)",
]);
const targetSdk = new Interface([
  `function epochConfig(bytes32) view returns (${EPOCH_TUPLE})`,
  "function epochAccount(bytes32) view returns (tuple(uint256 reserve,uint256 recognized,bool funded))",
]);
const sourceRead = new Interface([
  "function order(bytes32) view returns (tuple(bool exists,bool agreed,bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,address[3] committee,uint64 acceptBefore,uint64 nonce,uint32 milestoneCount,uint32 finalizedCount))",
  "function milestone(bytes32,uint32) view returns (tuple(uint8 status,uint8 outcome,uint64 stateVersion,bytes32 deliveryHash,uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore,uint64 mutualNonce,uint256 finalWork,uint256 finalFee,bytes32 decisionHash,bytes32 evidenceHash))",
  "function deliver(bytes32,uint32,bytes32)",
]);

function authorization(): WorkAuthorizationContentV1 {
  const value: WorkAuthorizationContentV1 = {
    commercialTerms: {
      scope: "Review one bounded protocol change.",
      acceptanceCriteria: "The described checks pass.",
      revisionTerms: "The worker may replace delivery before the delivery cutoff.",
      deliveryRequirements: "Source, tests and a short report.",
      deliveryCommitmentFormat: "A later delivery uses keccak256 of canonical artifact bytes; no future delivery hash is committed here.",
    },
    epochConfig: {
      sourceChainId: "11155111", sourceChainKey: "1", sourceCoordinator: address("1"), sourceVersion: SOURCE_VERSION,
      targetChainId: "102031", targetTreasury: address("2"), schemaVersion: SCHEMA_VERSION, sourceSafe: address("3"),
      sponsor: address("4"), refundBeneficiary: address("5"), asset: address("0"), cap: "120000000000000000000",
      policyHash: POLICY_HASH, initializationCutoff: "400", admissionCutoff: "900", maxMilestones: 32,
      maxActiveReturns: 16, maxDrainingReturns: 33, treeDepth: 7, nonce: "9",
    },
    order: {
      worker: worker.address as Address, claimOwner: address("6"), destination: address("7"), feeOwner: address("8"), feeDestination: address("9"),
      committee: [address("a"), address("b"), address("c")], acceptBefore: "500", nonce: "12",
      milestones: [{ work: "30000000000000000000", fee: "2000000000000000000", timeoutWork: "10000000000000000000", deliverBefore: "600", reviewBefore: "700", ruleBefore: "800" }],
    },
    targetFunding: { targetChainId: "102031", targetTreasury: address("2"), blockNumber: "200", blockHash: hash("d"), finalityBasis: "rpc-finalized-tag", epochId: hash("0"), cap: "120000000000000000000", reserve: "120000000000000000000", requiredMaximum: "32000000000000000000" },
    sourceCapacity: { sourceChainId: "11155111", sourceCoordinator: address("1"), blockNumber: "100", blockHash: hash("e"), finalityBasis: "rpc-finalized-tag", epochId: hash("0"), phase: 1, available: "120000000000000000000", reservations: 0, remainingMilestoneAdmissions: 32, requiredMaximum: "32000000000000000000" },
  };
  const config = value.epochConfig;
  const derived = epochId({ ...config, sourceChainId: BigInt(config.sourceChainId), sourceChainKey: BigInt(config.sourceChainKey), targetChainId: BigInt(config.targetChainId), cap: BigInt(config.cap), initializationCutoff: BigInt(config.initializationCutoff), admissionCutoff: BigInt(config.admissionCutoff), nonce: BigInt(config.nonce) });
  value.targetFunding.epochId = derived;
  value.sourceCapacity.epochId = derived;
  return value;
}

function draft(): WorkAuthorizationPackageV1 {
  return createWorkAuthorizationDraft({ authorization: authorization(), createdAt: "2026-09-10T10:00:00.000Z" });
}

function signedDraft(): WorkAuthorizationPackageV1 {
  const value = draft();
  const digest = quoteDigest({ chainId: 11155111n, coordinator: address("1"), orderId: value.orderId });
  return attachWorkerQuoteSignature(value, {
    workerSignature: worker.signingKey.sign(digest).serialized as Hex,
    signatureValidation: { sourceChainId: "11155111", sourceCoordinator: address("1"), blockNumber: "300", blockHash: hash("a") },
  });
}

const trusted: TrustedParticipantDomain = {
  sourceChainId: "11155111", sourceChainKey: "1", sourceCoordinator: address("1"), targetChainId: "102031", targetTreasury: address("2"),
  sourceRuntimeHash: keccak256("0x6000") as Hex, sourceDeploymentBlock: "90", targetRuntimeHash: keccak256("0x6001") as Hex, targetDeploymentBlock: "190",
};

function verificationProviders(options: { sourceBlock?: number; nonce?: number; sourceCode?: string } = {}) {
  const value = draft();
  const tuple = Object.values(value.authorization.epochConfig);
  const sourceBlock = options.sourceBlock ?? 300;
  const source = {
    getNetwork: async () => ({ chainId: 11155111n }),
    getBlock: async (tag: any) => tag === "finalized" ? ({ number: sourceBlock, hash: hash("a") }) : ({ number: Number(tag), hash: Number(tag) === 100 ? hash("e") : hash("a") }),
    getCode: async (at: string) => sameAddress(at, address("1")) ? "0x6000" : options.sourceCode ?? "0x",
    call: async (tx: any) => {
      const selector = tx.data.slice(0, 10);
      if (selector === sourceSdk.getFunction("epochConfig")!.selector) return sourceSdk.encodeFunctionResult("epochConfig", [tuple]);
      if (selector === sourceSdk.getFunction("epochState")!.selector) return sourceSdk.encodeFunctionResult("epochState", [[true, false, 0, hash("0"), 120000000000000000000n, 0, 0, 0, 1, 0, 0, 0, 0]]);
      if (selector === sourceSdk.getFunction("quoteNonceState")!.selector) return sourceSdk.encodeFunctionResult("quoteNonceState", [options.nonce ?? 0]);
      throw new Error("unexpected source call");
    },
  } as unknown as WorkAuthorizationProvider;
  const target = {
    getNetwork: async () => ({ chainId: 102031n }),
    getBlock: async (tag: any) => tag === "finalized" ? ({ number: 250, hash: hash("b") }) : ({ number: Number(tag), hash: Number(tag) === 200 ? hash("d") : hash("b") }),
    getCode: async () => "0x6001",
    call: async (tx: any) => tx.data.slice(0, 10) === targetSdk.getFunction("epochConfig")!.selector
      ? targetSdk.encodeFunctionResult("epochConfig", [tuple])
      : targetSdk.encodeFunctionResult("epochAccount", [[120000000000000000000n, 0, true]]),
  } as unknown as WorkAuthorizationProvider;
  return { source, target };
}

test("fresh profile reviews a canonical unsigned offer without a wallet and refuses stale or wrong domains", async () => {
  const providers = verificationProviders();
  let guards = 0;
  const review = await reviewUnsignedParticipantOffer(draft(), { trusted, ...providers, assertFresh: () => { guards++; } });
  assert.equal(review.summary.worker, worker.address);
  assert.equal(review.summary.requiredMaximum, "32000000000000000000");
  assert.equal(review.summary.destination, address("7"));
  assert.equal(review.summary.fundingCreatesPrivateReservation, false);
  assert.ok(guards >= 3);
  await assert.rejects(reviewUnsignedParticipantOffer(draft(), { trusted: { ...trusted, targetChainId: "1" }, ...providers }), /does not match the trusted deployment/);
  await assert.rejects(reviewUnsignedParticipantOffer(draft(), { trusted: { ...trusted, sourceRuntimeHash: hash("f") }, ...providers }), /runtime differs from the trusted deployment/);
  await assert.rejects(reviewUnsignedParticipantOffer(draft(), { trusted, ...verificationProviders({ sourceBlock: 500 }) }), /acceptance deadline has passed/);
  const tampered: any = structuredClone(draft()); tampered.authorization.commercialTerms.scope += " changed";
  await assert.rejects(reviewUnsignedParticipantOffer(tampered, { trusted, ...providers }), /termsHash does not match/);
});

test("signing rechecks the offer, requests exact QuoteV1 typed data and rejects stale wallet return", async () => {
  const providers = verificationProviders();
  const review = await reviewUnsignedParticipantOffer(draft(), { trusted, ...providers });
  let requested = 0;
  const signed = await signReviewedParticipantOffer(review, {
    trusted, ...providers,
    requestSignature: async request => {
      requested++;
      assert.equal(request.expectedWorker, worker.address);
      assert.equal(request.value.orderId, review.packet.orderId);
      return { signature: await worker.signTypedData(request.domain, request.types, request.value) as Hex, account: worker.address as Address, chainId: 11155111n };
    },
  });
  assert.equal(requested, 1);
  assert.ok(signed.workerSignature);
  assert.equal(signed.orderId, review.packet.orderId);

  let revision = 1;
  await assert.rejects(signReviewedParticipantOffer(review, {
    trusted, ...providers, assertFresh: () => { if (revision !== 1) throw new Error("participant selection changed"); },
    requestSignature: async request => { revision++; return { signature: await worker.signTypedData(request.domain, request.types, request.value) as Hex, account: worker.address as Address, chainId: 11155111n }; },
  }), /participant selection changed/);
  await assert.rejects(signReviewedParticipantOffer(review, {
    trusted, ...providers,
    requestSignature: async request => ({ signature: await worker.signTypedData(request.domain, request.types, request.value) as Hex, account: address("f"), chainId: 11155111n }),
  }), /account does not match/);
});

test("My work store reparses packets, replaces unsigned with signed and rejects imported verdicts", () => {
  const initial = upsertParticipantWork(emptyParticipantWorkStore(), draft(), { savedAt: "2026-09-10T10:01:00.000Z" });
  const updated = upsertParticipantWork(initial, signedDraft(), { savedAt: "2026-09-10T10:02:00.000Z" });
  assert.equal(updated.version, PARTICIPANT_WORK_STORE_VERSION);
  assert.equal(updated.records.length, 1);
  assert.ok(updated.records[0]!.packet.workerSignature);
  const noDowngrade = upsertParticipantWork(updated, draft(), { savedAt: "2026-09-10T10:03:00.000Z" });
  assert.ok(noDowngrade.records[0]!.packet.workerSignature);
  const roundTrip = parseParticipantWorkStore(JSON.stringify(updated));
  assert.equal(roundTrip.records[0]!.orderId, draft().orderId);
  const verdict: any = structuredClone(updated); verdict.records[0].status = "paid";
  assert.throws(() => parseParticipantWorkStore(verdict), /unsupported field status/);
  const changed: any = structuredClone(updated); changed.records[0].orderId = hash("f");
  assert.throws(() => parseParticipantWorkStore(changed), /differs from its packet/);
});

function workProvider(packet: WorkAuthorizationPackageV1, options: { status?: number; outcome?: number; block?: number; finalizedBlock?: number; agreed?: boolean; absent?: boolean; arbitraryFailure?: boolean; changedWork?: boolean; finalWork?: bigint; phase?: number; allowCurrentWorkerSignature?: boolean } = {}): WorkAuthorizationProvider {
  const terms = deriveWorkAuthorizationOrderTerms(packet.authorization);
  const milestone = terms.milestones[0]!;
  const tuple = Object.values(packet.authorization.epochConfig);
  const block = options.block ?? 350;
  return {
    getNetwork: async () => ({ chainId: 11155111n }),
    getBlock: async (tag: any) => ({ number: tag === "finalized" ? options.finalizedBlock ?? block : typeof tag === "number" ? tag : block, hash: Number(tag) === 100 ? hash("e") : hash("a") }),
    getCode: async (at: string, tag: any) => {
      if (sameAddress(at, address("1"))) return "0x6000";
      if (sameAddress(at, worker.address) && (Number(tag) === 300 || options.allowCurrentWorkerSignature)) return "0x";
      throw new Error("current signature policy must not be read for accepted work");
    },
    call: async (tx: any) => {
      const selector = tx.data.slice(0, 10);
      if (selector === sourceSdk.getFunction("epochConfig")!.selector) return sourceSdk.encodeFunctionResult("epochConfig", [tuple]);
      if (selector === sourceSdk.getFunction("epochState")!.selector) return sourceSdk.encodeFunctionResult("epochState", [[true, false, 0, hash("0"), 120000000000000000000n, 0, 0, 0, options.phase ?? 1, 0, 0, 0, 0]]);
      if (selector === sourceSdk.getFunction("quoteNonceState")!.selector) return sourceSdk.encodeFunctionResult("quoteNonceState", [0]);
      if (selector === sourceRead.getFunction("order")!.selector) {
        if (options.arbitraryFailure) throw new Error("RPC unavailable");
        if (options.absent) throw { data: id("UnknownOrder()").slice(0, 10) };
        return sourceRead.encodeFunctionResult("order", [[true, options.agreed ?? true, terms.epochId, terms.termsHash, terms.worker, terms.claimOwner, terms.destination, terms.feeOwner, terms.feeDestination, terms.committee, terms.acceptBefore, terms.nonce, 1, options.status === 5 ? 1 : 0]]);
      }
      if (selector === sourceRead.getFunction("milestone")!.selector) return sourceRead.encodeFunctionResult("milestone", [[options.status ?? 2, options.outcome ?? 0, 1, hash("0"), options.changedWork ? milestone.work + 1n : milestone.work, milestone.fee, milestone.timeoutWork, milestone.deliverBefore, milestone.reviewBefore, milestone.ruleBefore, 0, options.finalWork ?? (options.status === 5 ? milestone.work : 0), 0, hash("0"), hash("0")]]);
      throw new Error("unexpected source read");
    },
  } as unknown as WorkAuthorizationProvider;
}

test("My work binds the complete accepted order and preserves historical acceptance after wallet-policy change", async () => {
  const packet = signedDraft();
  const read = await readParticipantWork(packet, { trusted, source: workProvider(packet), target: verificationProviders().target });
  assert.equal(read.stage, "ready-to-deliver");
  assert.equal(read.workerAction, "deliver");
  assert.equal(read.sourceExecutionAccount, worker.address);
  assert.match(read.sourceExecutionNote, /ERC-1271 worker contract must itself execute/);
  const plan = prepareParticipantDelivery(read, "ipfs://canonical-delivery");
  assert.equal(plan.requiredAccount, worker.address);
  assert.equal(plan.sourceGasRequired, true);
  const decoded = sourceRead.decodeFunctionData("deliver", plan.transaction.data);
  assert.equal(decoded[0], packet.orderId);
  assert.equal(decoded[1], 0n);
  assert.equal(decoded[2], plan.deliveryHash);
  await assert.rejects(readParticipantWork(packet, { trusted, source: workProvider(packet, { changedWork: true }), target: verificationProviders().target }), /milestone work differs/);
  await assert.rejects(readParticipantWork(packet, { trusted: { ...trusted, sourceRuntimeHash: hash("f") }, source: workProvider(packet), target: verificationProviders().target }), /runtime differs/);
  let selection = 1;
  const base = workProvider(packet), staleSource = { ...base, call: async (tx: any) => { const result = await base.call(tx); if (tx.data.slice(0, 10) === sourceRead.getFunction("order")!.selector) selection++; return result; } } as WorkAuthorizationProvider;
  await assert.rejects(readParticipantWork(packet, { trusted, source: staleSource, target: verificationProviders().target, assertFresh: () => { if (selection !== 1) throw new Error("participant selection changed"); } }), /participant selection changed/);
});

test("signed-work import pins historical runtimes and does not apply current signature policy to accepted work", async () => {
  const packet = signedDraft();
  const accepted = await reviewSignedParticipantWork(packet, { trusted, source: workProvider(packet), target: verificationProviders().target });
  assert.equal(accepted.work.stage, "ready-to-deliver");
  assert.equal(accepted.verification.historicalSignature.kind, "eoa");
  assert.equal(accepted.verification.acceptanceReady, false);
  assert.match(accepted.verification.acceptanceBlockingReason!, /already accepted/);
  await assert.rejects(reviewSignedParticipantWork(packet, { trusted: { ...trusted, targetRuntimeHash: hash("f") }, source: workProvider(packet), target: verificationProviders().target }), /runtime differs/);

  const rotatedBeforeAcceptance = await reviewSignedParticipantWork(packet, { trusted, source: workProvider(packet, { absent: true }), target: verificationProviders().target });
  assert.equal(rotatedBeforeAcceptance.work.stage, "awaiting-acceptance");
  assert.equal(rotatedBeforeAcceptance.verification.acceptanceReady, false);
  assert.match(rotatedBeforeAcceptance.verification.acceptanceBlockingReason!, /current worker signature policy/);
  const currentlyValid = await reviewSignedParticipantWork(packet, { trusted, source: workProvider(packet, { absent: true, allowCurrentWorkerSignature: true }), target: verificationProviders().target });
  assert.equal(currentlyValid.verification.acceptanceReady, true);
  assert.equal(currentlyValid.verification.currentSignature?.kind, "eoa");
});

test("My work exposes exact worker, buyer, committee, finalization and payment stages", async () => {
  const packet = signedDraft();
  const absent = await readParticipantWork(packet, { trusted, source: workProvider(packet, { absent: true }), target: verificationProviders().target });
  assert.equal(absent.stage, "awaiting-acceptance");
  const blocked = await readParticipantWork(packet, { trusted, source: workProvider(packet, { absent: true, phase: 2 }), target: verificationProviders().target });
  assert.equal(blocked.stage, "acceptance-blocked");
  assert.match(blocked.blockingReason!, /not active/);
  await assert.rejects(readParticipantWork(packet, { trusted, source: workProvider(packet, { arbitraryFailure: true }), target: verificationProviders().target }), /RPC unavailable/);
  const revised = await readParticipantWork(packet, { trusted, source: workProvider(packet, { status: 3 }), target: verificationProviders().target });
  assert.equal(revised.stage, "ready-to-revise");
  assert.equal(prepareParticipantDelivery(revised, "revision two").kind, "revise");
  const challenged = await readParticipantWork(packet, { trusted, source: workProvider(packet, { status: 4 }), target: verificationProviders().target });
  assert.equal(challenged.stage, "awaiting-committee");
  assert.throws(() => prepareParticipantDelivery(challenged, "forbidden revision"), /not ready/);
  const final = await readParticipantWork(packet, { trusted, source: workProvider(packet, { status: 5, outcome: 4 }), target: verificationProviders().target });
  assert.equal(final.stage, "source-final");
  const route = dispatchParticipantJourney(final, { onDelivery: () => "delivery", onPayment: locator => `${locator.orderId}:payment`, onWaiting: () => "waiting" });
  assert.equal(route, `${packet.orderId}:payment`);
  const cancelled = await readParticipantWork(packet, { trusted, source: workProvider(packet, { status: 5, outcome: 1, agreed: false, finalWork: 0n }), target: verificationProviders().target });
  assert.equal(cancelled.stage, "source-final");
  assert.equal(cancelled.payment.expectedWorkAmount, "0");
  assert.equal(cancelled.workerAction, null);
  assert.equal(cancelled.nextActor, "none");
  assert.equal(dispatchParticipantJourney(cancelled, { onDelivery: () => "delivery", onPayment: () => "payment", onWaiting: () => "no-payment" }), "no-payment");
  const deadlinePassed = await readParticipantWork(packet, { trusted, source: workProvider(packet, { status: 2, block: 650, finalizedBlock: 550 }), target: verificationProviders().target });
  assert.equal(deadlinePassed.stage, "awaiting-source-finalization");
  const stale = { ...revised, workerAction: "deliver", sourceBlock: { ...revised.sourceBlock, hash: hash("f") } } as ParticipantWorkRead;
  assert.throws(() => prepareParticipantDelivery(stale, "same content"), /actor or action differs/);
});
