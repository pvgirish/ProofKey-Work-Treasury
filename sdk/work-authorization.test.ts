import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Interface, Signature, Wallet, getAddress } from "ethers";
import type { Address, Hex } from "./types.ts";
import { POLICY_HASH, SCHEMA_VERSION, SOURCE_VERSION, epochId, quoteDigest } from "./identity.ts";
import {
  WORK_AUTHORIZATION_VERSION,
  attachWorkerQuoteSignature,
  createWorkAuthorizationDraft,
  deriveWorkAuthorizationOrderTerms,
  parseWorkAuthorizationPackage,
  stringifyWorkAuthorizationPackage,
  verifyCurrentWorkAuthorization,
  verifyCommittedChainObservations,
  verifyEoaWorkerQuoteOffline,
  verifyWorkerQuoteSignatureAtSource,
  verifyWorkerQuoteSignatureCurrent,
  workAuthorizationTermsHash,
} from "./work-authorization.ts";
import type { WorkAuthorizationContentV1, WorkAuthorizationPackageV1, WorkAuthorizationProvider } from "./work-authorization.ts";

const worker = new Wallet("0x59c6995e998f97a5a0044976f7d2d171d0f9b7d7e4f2f6c43a7a7d0b18f3f231");
const address = (byte: string) => getAddress(`0x${byte.repeat(40)}`) as Address;
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex;

function content(workerAddress: Address = worker.address as Address): WorkAuthorizationContentV1 {
  return {
    commercialTerms: {
      scope: "Implement the bounded ProofKey operator handoff.",
      acceptanceCriteria: "The buyer accepts when the documented checks pass.",
      revisionTerms: "Revisions require a newly reviewed delivery commitment.",
      deliveryRequirements: "Supply source, tests, and an operator runbook.",
      deliveryCommitmentFormat: "A later delivery uses keccak256 of the canonical delivery artifact bytes; no future delivery hash is committed here.",
    },
    epochConfig: {
      sourceChainId: "11155111", sourceChainKey: "1", sourceCoordinator: address("1"), sourceVersion: SOURCE_VERSION,
      targetChainId: "102031", targetTreasury: address("2"), schemaVersion: SCHEMA_VERSION, sourceSafe: address("3"),
      sponsor: address("4"), refundBeneficiary: address("5"), asset: address("0"), cap: "120000000000000000000",
      policyHash: POLICY_HASH, initializationCutoff: "400", admissionCutoff: "900", maxMilestones: 32,
      maxActiveReturns: 16, maxDrainingReturns: 33, treeDepth: 7, nonce: "9",
    },
    order: {
      worker: workerAddress, claimOwner: address("6"), destination: address("7"), feeOwner: address("8"), feeDestination: address("9"),
      committee: [address("a"), address("b"), address("c")], acceptBefore: "500", nonce: "12",
      milestones: [
        { work: "30000000000000000000", fee: "2000000000000000000", timeoutWork: "10000000000000000000", deliverBefore: "600", reviewBefore: "700", ruleBefore: "800" },
        { work: "40000000000000000000", fee: "1000000000000000000", timeoutWork: "15000000000000000000", deliverBefore: "610", reviewBefore: "710", ruleBefore: "810" },
      ],
    },
    targetFunding: {
      targetChainId: "102031", targetTreasury: address("2"), blockNumber: "200", blockHash: hash("d"), finalityBasis: "rpc-finalized-tag",
      epochId: hash("0"), cap: "120000000000000000000", reserve: "120000000000000000000", requiredMaximum: "73000000000000000000",
    },
    sourceCapacity: {
      sourceChainId: "11155111", sourceCoordinator: address("1"), blockNumber: "100", blockHash: hash("e"), finalityBasis: "rpc-finalized-tag",
      epochId: hash("0"), phase: 1, available: "120000000000000000000", reservations: 0, remainingMilestoneAdmissions: 32, requiredMaximum: "73000000000000000000",
    },
  };
}

function draft(workerAddress: Address = worker.address as Address): WorkAuthorizationPackageV1 {
  const provisional = content(workerAddress);
  const epoch = deriveEpoch(provisional);
  provisional.targetFunding.epochId = epoch;
  provisional.sourceCapacity.epochId = epoch;
  return createWorkAuthorizationDraft({ authorization: provisional, createdAt: "2026-09-10T10:00:00.000Z" });
}

function deriveEpoch(value: WorkAuthorizationContentV1): Hex {
  const c = value.epochConfig;
  return epochId({ ...c, sourceChainId: BigInt(c.sourceChainId), sourceChainKey: BigInt(c.sourceChainKey), targetChainId: BigInt(c.targetChainId), cap: BigInt(c.cap), initializationCutoff: BigInt(c.initializationCutoff), admissionCutoff: BigInt(c.admissionCutoff), nonce: BigInt(c.nonce) });
}

function signedDraft(workerWallet = worker, workerAddress: Address = workerWallet.address as Address): WorkAuthorizationPackageV1 {
  const unsigned = draft(workerAddress);
  const terms = deriveWorkAuthorizationOrderTerms(unsigned.authorization);
  const digest = quoteDigest({ chainId: 11155111n, coordinator: address("1"), orderId: unsigned.orderId });
  assert.equal(terms.termsHash, unsigned.termsHash);
  return attachWorkerQuoteSignature(unsigned, {
    workerSignature: workerWallet.signingKey.sign(digest).serialized as Hex,
    signatureValidation: { sourceChainId: "11155111", sourceCoordinator: address("1"), blockNumber: "101", blockHash: hash("f") },
  });
}

test("fixed cross-language vector covers canonical termsHash and orderId", async () => {
  const vector = JSON.parse(await readFile(new URL("../schema/work-authorization-v1-vectors.json", import.meta.url), "utf8"));
  const value = draft();
  assert.equal(value.version, WORK_AUTHORIZATION_VERSION);
  assert.deepEqual(value.authorization, vector.authorization);
  assert.equal(workAuthorizationTermsHash(value.authorization), vector.termsHash);
  assert.equal(value.orderId, vector.orderId);
  assert.equal(value.orderTerms.termsHash, vector.termsHash);
  assert.equal(stringifyWorkAuthorizationPackage(value), `${JSON.stringify(value, null, 2)}`);
});

test("parser refuses changes to commercial, observation, order and domain commitments", () => {
  const value = draft();
  for (const mutate of [
    (v: any) => { v.authorization.commercialTerms.scope += "!"; },
    (v: any) => { v.authorization.targetFunding.reserve = "119999999999999999999"; },
    (v: any) => { v.authorization.sourceCapacity.blockHash = hash("a"); },
    (v: any) => { v.authorization.order.destination = address("f"); },
    (v: any) => { v.authorization.order.milestones[0].work = "30000000000000000001"; },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => parseWorkAuthorizationPackage(changed), /does not match|differs/);
  }
  const wrongDomain = structuredClone(value);
  wrongDomain.authorization.targetFunding.targetChainId = "1";
  assert.throws(() => parseWorkAuthorizationPackage(wrongDomain), /domain differs/);
});

test("parser rejects extra fields, noncanonical decimals, malformed text and signature metadata", () => {
  const value: any = draft();
  value.verdict = "valid";
  assert.throws(() => parseWorkAuthorizationPackage(value), /unsupported field verdict/);
  const leadingZero: any = structuredClone(draft());
  leadingZero.authorization.order.nonce = "012";
  assert.throws(() => parseWorkAuthorizationPackage(leadingZero), /canonical unsigned decimal/);
  const nonNfc: any = structuredClone(draft());
  nonNfc.authorization.commercialTerms.scope = "Cafe\u0301";
  assert.throws(() => parseWorkAuthorizationPackage(nonNfc), /NFC/);
  const loneSignature: any = structuredClone(draft());
  loneSignature.workerSignature = "0x01";
  assert.throws(() => parseWorkAuthorizationPackage(loneSignature), /must be supplied together/);
});

test("offline EOA verification matches SourceSignatureLib low-s and v rules", () => {
  const value = signedDraft();
  assert.equal(verifyEoaWorkerQuoteOffline(value).recoveredWorker, worker.address);
  const raw = value.workerSignature!.slice(2);
  const badV = structuredClone(value);
  badV.workerSignature = `0x${raw.slice(0, 128)}00`;
  assert.throws(() => verifyEoaWorkerQuoteOffline(badV), /v must be 27 or 28/);
  const sig = Signature.from(value.workerSignature!);
  const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (curveOrder - BigInt(sig.s)).toString(16).padStart(64, "0");
  const high = structuredClone(value);
  high.workerSignature = `0x${sig.r.slice(2)}${highS}${sig.v === 27 ? "1c" : "1b"}`;
  assert.throws(() => verifyEoaWorkerQuoteOffline(high), /not low-s/);
  const changed = structuredClone(value);
  changed.workerSignature = `${value.workerSignature!.slice(0, 4)}${value.workerSignature![4] === "0" ? "1" : "0"}${value.workerSignature!.slice(5)}` as Hex;
  assert.throws(() => verifyEoaWorkerQuoteOffline(changed), /does not recover|malformed/);
});

test("source-block signature verification distinguishes EOA and ERC-1271", async () => {
  const value = signedDraft();
  const base = {
    getNetwork: async () => ({ chainId: 11155111n }),
    getBlock: async (tag: any) => tag === "finalized" ? ({ number: 110, hash: hash("a") }) : ({ number: Number(tag), hash: hash("f") }),
    getCode: async () => "0x",
    call: async () => { throw new Error("unexpected call"); },
  } as unknown as WorkAuthorizationProvider;
  assert.equal((await verifyWorkerQuoteSignatureAtSource(value, base)).kind, "eoa");
  const contractValue = attachWorkerQuoteSignature(draft(address("d")), {
    workerSignature: "0x01",
    signatureValidation: { sourceChainId: "11155111", sourceCoordinator: address("1"), blockNumber: "101", blockHash: hash("f") },
  });
  const contractProvider = { ...base, getCode: async () => "0x6000", call: async () => `${"0x1626ba7e"}${"0".repeat(56)}` } as unknown as WorkAuthorizationProvider;
  assert.equal((await verifyWorkerQuoteSignatureAtSource(contractValue, contractProvider)).kind, "erc1271");
  const currentProvider = { ...contractProvider, getBlock: async () => ({ number: 110, hash: hash("b") }) } as unknown as WorkAuthorizationProvider;
  const current = await verifyWorkerQuoteSignatureCurrent(contractValue, currentProvider);
  assert.equal(current.kind, "erc1271");
  assert.equal(current.blockNumber, 110);
  const movedBlock = { ...base, getBlock: async (tag: any) => tag === "finalized" ? ({ number: 110, hash: hash("a") }) : ({ number: Number(tag), hash: hash("a") }) } as unknown as WorkAuthorizationProvider;
  await assert.rejects(verifyWorkerQuoteSignatureAtSource(value, movedBlock), /block hash does not match/);
  const notFinal = { ...base, getBlock: async (tag: any) => tag === "finalized" ? ({ number: 100, hash: hash("a") }) : ({ number: Number(tag), hash: hash("f") }) } as unknown as WorkAuthorizationProvider;
  await assert.rejects(verifyWorkerQuoteSignatureAtSource(value, notFinal), /outside the current finalized prefix/);
  let historicalReads = 0;
  const reorg = { ...base, getBlock: async (tag: any) => {
    if (tag === "finalized") return { number: 110, hash: hash("a") };
    historicalReads++;
    return { number: Number(tag), hash: historicalReads === 1 ? hash("f") : hash("0") };
  } } as unknown as WorkAuthorizationProvider;
  await assert.rejects(verifyWorkerQuoteSignatureAtSource(value, reorg), /after reads block hash does not match/);
});

test("committed observations require exact historical state inside both finalized prefixes", async () => {
  const value = draft();
  const sourceAbi = new Interface([
    "function epochConfig(bytes32) view returns (tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce))",
    "function epochState(bytes32) view returns (tuple(bool initialized,bool expiredUninitialized,uint32 leafCount,bytes32 root,uint256 available,uint256 unresolved,uint256 earned,uint256 returned,uint8 phase,uint32 reservations,uint32 unresolvedMilestones,uint32 activeReturns,uint32 drainingReturns))",
  ]);
  const targetAbi = new Interface([
    "function epochConfig(bytes32) view returns (tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce))",
    "function epochAccount(bytes32) view returns (tuple(uint256 reserve,uint256 recognized,bool funded))",
  ]);
  const tuple = Object.values(value.authorization.epochConfig);
  const provider = (chainId: bigint, source: boolean, finalizedNumber: number) => ({
    getNetwork: async () => ({ chainId }),
    getBlock: async (tag: any) => tag === "finalized"
      ? ({ number: finalizedNumber, hash: hash(source ? "a" : "b") })
      : ({ number: Number(tag), hash: Number(tag) === (source ? 100 : 200) ? hash(source ? "e" : "d") : hash("0") }),
    getCode: async () => "0x6000",
    call: async (tx: any) => {
      if (source) {
        if (tx.data.slice(0, 10) === sourceAbi.getFunction("epochConfig")!.selector) return sourceAbi.encodeFunctionResult("epochConfig", [tuple]);
        return sourceAbi.encodeFunctionResult("epochState", [[true, false, 0, hash("0"), 120000000000000000000n, 0, 0, 0, 1, 0, 0, 0, 0]]);
      }
      if (tx.data.slice(0, 10) === targetAbi.getFunction("epochConfig")!.selector) return targetAbi.encodeFunctionResult("epochConfig", [tuple]);
      return targetAbi.encodeFunctionResult("epochAccount", [[120000000000000000000n, 0, true]]);
    },
  }) as unknown as WorkAuthorizationProvider;
  const checked = await verifyCommittedChainObservations(value, { source: provider(11155111n, true, 120), target: provider(102031n, false, 220) });
  assert.equal(checked.sourceBlock.number, 100);
  await assert.rejects(verifyCommittedChainObservations(value, { source: provider(11155111n, true, 99), target: provider(102031n, false, 220) }), /outside the current finalized prefix/);
});

test("fresh chain verification checks exact epoch, total reserve, nonce and deadlines separately", async () => {
  const value = draft();
  const sourceAbi = new Interface([
    "function epochConfig(bytes32) view returns (tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce))",
    "function epochState(bytes32) view returns (tuple(bool initialized,bool expiredUninitialized,uint32 leafCount,bytes32 root,uint256 available,uint256 unresolved,uint256 earned,uint256 returned,uint8 phase,uint32 reservations,uint32 unresolvedMilestones,uint32 activeReturns,uint32 drainingReturns))",
    "function quoteNonceState(bytes32,address,uint64) view returns (uint8)",
  ]);
  const targetAbi = new Interface([
    "function epochConfig(bytes32) view returns (tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce))",
    "function epochAccount(bytes32) view returns (tuple(uint256 reserve,uint256 recognized,bool funded))",
  ]);
  const config = value.authorization.epochConfig;
  const tuple = Object.values(config);
  const provider = (chainId: bigint, source: boolean, nonce = 0, sourceBlock = 300) => ({
    getNetwork: async () => ({ chainId }),
    getBlock: async () => ({ number: source ? sourceBlock : 250, hash: source ? hash("a") : hash("b") }),
    getCode: async () => "0x6000",
    call: async (tx: any) => {
      const selector = tx.data.slice(0, 10);
      if (source) {
        if (selector === sourceAbi.getFunction("epochConfig")!.selector) return sourceAbi.encodeFunctionResult("epochConfig", [tuple]);
        if (selector === sourceAbi.getFunction("epochState")!.selector) return sourceAbi.encodeFunctionResult("epochState", [[true, false, 0, hash("0"), 120000000000000000000n, 0, 0, 0, 1, 0, 0, 0, 0]]);
        return sourceAbi.encodeFunctionResult("quoteNonceState", [nonce]);
      }
      if (selector === targetAbi.getFunction("epochConfig")!.selector) return targetAbi.encodeFunctionResult("epochConfig", [tuple]);
      return targetAbi.encodeFunctionResult("epochAccount", [[120000000000000000000n, 0, true]]);
    },
  }) as unknown as WorkAuthorizationProvider;
  const verified = await verifyCurrentWorkAuthorization(value, { source: provider(11155111n, true), target: provider(102031n, false) });
  assert.equal(verified.requiredMaximum, 73000000000000000000n);
  assert.equal(verified.sourceRemainingMilestoneAdmissions, 32);
  await assert.rejects(verifyCurrentWorkAuthorization(value, { source: provider(11155111n, true, 2), target: provider(102031n, false) }), /nonce is no longer unused/);
  await assert.rejects(verifyCurrentWorkAuthorization(value, { source: provider(11155111n, true, 0, 500), target: provider(102031n, false) }), /acceptance deadline has passed/);
});
