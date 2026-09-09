import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { AbiCoder, isHexString, keccak256, type JsonRpcProvider, type TransactionReceipt } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import {
  ROOT,
  SOURCE_CHAIN_ID,
  SOURCE_CHAIN_KEY,
  TARGET_CHAIN_ID,
  loadEnvironment,
  saveReport,
  testNetworks,
} from "./runtime.ts";

export type NativeContinuityProof = {
  lowerEndpointDigest: string;
  roots: string[];
};

export type RefreshedNativeProof = {
  transactionHash: string;
  blockHeight: number;
  transactionIndex: number;
  encodedTransaction: string;
  merkleProof: unknown;
  continuityProof: NativeContinuityProof;
};

export type RefreshNativeProofOptions = {
  source: JsonRpcProvider;
  target: JsonRpcProvider;
  transactionHash: string;
  priorEncodedTransaction?: string;
  priorContinuityProof?: NativeContinuityProof;
  outputName?: string;
  save?: boolean;
};

export type RefreshNativeProofBundleOptions = {
  source: JsonRpcProvider;
  target: JsonRpcProvider;
  transactionHashes: string[];
  priorEncodedTransactions?: Readonly<Record<string, string>>;
  priorContinuityProof?: NativeContinuityProof;
  outputName?: string;
  save?: boolean;
};

type ExpectedSourceTransaction = {
  hash: string;
  receipt: TransactionReceipt;
};

const abi = AbiCoder.defaultAbiCoder();

function exactHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !isHexString(value, 32)) throw new Error(`${label} must be a 32-byte hex value`);
  return value.toLowerCase();
}

function encodedBytes(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "0x" || !isHexString(value)) throw new Error(`${label} must be non-empty hex bytes`);
  return value;
}

function merkleProof(value: any): unknown {
  exactHash(value?.root, "Merkle root");
  if (!Array.isArray(value?.siblings)) throw new Error("Merkle proof siblings must be an array");
  value.siblings.forEach((sibling:any, index:number) => {
    exactHash(sibling?.hash, `Merkle sibling ${index}`);
    if (typeof sibling?.isLeft !== "boolean") throw new Error(`Merkle sibling ${index} has no direction`);
  });
  return value;
}

export function continuityFingerprint(proof: NativeContinuityProof): string {
  exactHash(proof?.lowerEndpointDigest, "Continuity lower endpoint");
  if (!Array.isArray(proof?.roots) || proof.roots.length === 0) throw new Error("Continuity proof must contain at least one root");
  proof.roots.forEach((root, index) => exactHash(root, `Continuity root ${index}`));
  return keccak256(abi.encode(["bytes32", "bytes32[]"], [proof.lowerEndpointDigest, proof.roots]));
}

function normalizeContinuity(value: any): NativeContinuityProof {
  const proof = {lowerEndpointDigest:value?.lowerEndpointDigest, roots:value?.roots};
  continuityFingerprint(proof);
  return proof;
}

function priorBytesFor(options: RefreshNativeProofBundleOptions, hash: string): string | undefined {
  if (!options.priorEncodedTransactions) return undefined;
  return options.priorEncodedTransactions[hash]
    ?? options.priorEncodedTransactions[hash.toLowerCase()]
    ?? Object.entries(options.priorEncodedTransactions).find(([key]) => key.toLowerCase() === hash.toLowerCase())?.[1];
}

async function verifyDomains(source: JsonRpcProvider, target: JsonRpcProvider) {
  const [sourceIdHex, targetIdHex] = await Promise.all([
    source.send("eth_chainId", []),
    target.send("eth_chainId", []),
  ]);
  if (BigInt(sourceIdHex) !== SOURCE_CHAIN_ID) throw new Error(`Source RPC chain ID is not ${SOURCE_CHAIN_ID}`);
  if (BigInt(targetIdHex) !== TARGET_CHAIN_ID) throw new Error(`Target RPC chain ID is not ${TARGET_CHAIN_ID}`);

  const info = new chainInfo.PrecompileChainInfoProvider(target as any);
  const supported = await info.getSupportedChainByKey(Number(SOURCE_CHAIN_KEY));
  if (!supported
    || supported.chainKey !== Number(SOURCE_CHAIN_KEY)
    || BigInt(supported.chainId) !== SOURCE_CHAIN_ID
    || supported.chainEncoding !== Number(proofProvider.raw.EncodingVersion.V1)) {
    throw new Error("Target chain-info precompile does not bind source key 1 to Sepolia encoding V1");
  }
  return info;
}

async function expectedTransactions(source: JsonRpcProvider, hashes: string[]): Promise<ExpectedSourceTransaction[]> {
  if (hashes.length === 0 || hashes.length > 32) throw new Error("Raw proof refresh requires 1–32 transaction hashes");
  const normalized = hashes.map((hash, index) => exactHash(hash, `Transaction hash ${index}`));
  if (new Set(normalized).size !== normalized.length) throw new Error("Raw proof refresh does not accept duplicate transactions");

  return Promise.all(normalized.map(async hash => {
    const [receipt, transaction] = await Promise.all([
      source.getTransactionReceipt(hash),
      source.getTransaction(hash),
    ]);
    if (!receipt || receipt.status !== 1) throw new Error(`Source transaction ${hash} is missing or unsuccessful`);
    if (!transaction || exactHash(transaction.hash, "Fetched transaction hash") !== hash) throw new Error(`Source RPC substituted transaction ${hash}`);
    if (transaction.blockNumber !== receipt.blockNumber
      || transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()
      || transaction.index !== receipt.index) {
      throw new Error(`Source transaction and receipt disagree for ${hash}`);
    }
    return {hash, receipt};
  }));
}

function normalizeRawEntry(
  expected: ExpectedSourceTransaction,
  entry: any,
  blockHeight: number,
  transactionIndex: number,
  continuityProof: NativeContinuityProof,
): RefreshedNativeProof {
  const actualHash = exactHash(entry?.txHash, "Raw proof transaction hash");
  if (actualHash !== expected.hash
    || blockHeight !== expected.receipt.blockNumber
    || transactionIndex !== expected.receipt.index) {
    throw new Error(`Raw proof transaction position does not match source receipt ${expected.hash}`);
  }
  const bytes = encodedBytes(entry?.txBytes, "Raw encoded transaction");
  return {
    transactionHash: actualHash,
    blockHeight,
    transactionIndex,
    encodedTransaction: bytes,
    merkleProof: merkleProof(entry?.merkleProof),
    continuityProof,
  };
}

async function buildRaw(
  source: JsonRpcProvider,
  info: chainInfo.ChainInfoProvider,
  expected: ExpectedSourceTransaction[],
): Promise<{proofs: RefreshedNativeProof[]; continuityProof: NativeContinuityProof}> {
  const blocks = new proofProvider.raw.blockProvider.SimpleBlockProvider(source as any);
  const builder = new proofProvider.raw.RawProofBuilder(
    Number(SOURCE_CHAIN_KEY),
    blocks,
    info,
    proofProvider.raw.EncodingVersion.V1,
  );

  // RawProofBuilder 0.18 rejects a batch whose transactions all occupy one block.
  // Single proofs for that block are safe to combine only when their freshly built
  // continuity proofs are byte-for-byte identical.
  const heights = new Set(expected.map(item => item.receipt.blockNumber));
  if (expected.length > 1 && heights.size === 1) {
    const responses = [];
    for (const item of expected) {
      const response = await builder.getProof(item.hash);
      if (!response.success || !response.data) throw new Error(`Raw proof generation failed: ${response.error ?? "empty response"}`);
      responses.push(response.data);
    }
    const continuityProof = normalizeContinuity(responses[0].continuityProof);
    const fingerprint = continuityFingerprint(continuityProof);
    for (const response of responses) {
      if (response.chainKey !== Number(SOURCE_CHAIN_KEY)
        || continuityFingerprint(normalizeContinuity(response.continuityProof)) !== fingerprint) {
        throw new Error("Same-block raw proofs did not produce one shared continuity proof");
      }
    }
    return {
      continuityProof,
      proofs: responses.map((entry, index) => normalizeRawEntry(
        expected[index], entry, entry.headerNumber, entry.txIndex, continuityProof,
      )),
    };
  }

  if (expected.length === 1) {
    const response = await builder.getProof(expected[0].hash);
    if (!response.success || !response.data) throw new Error(`Raw proof generation failed: ${response.error ?? "empty response"}`);
    if (response.data.chainKey !== Number(SOURCE_CHAIN_KEY)) throw new Error("Raw proof source key mismatch");
    const continuityProof = normalizeContinuity(response.data.continuityProof);
    return {
      continuityProof,
      proofs:[normalizeRawEntry(expected[0], response.data, response.data.headerNumber, response.data.txIndex, continuityProof)],
    };
  }

  const response = await builder.getBatchProof(expected.map(item => item.hash));
  if (!response.success || !response.data) throw new Error(`Raw batch proof generation failed: ${response.error ?? "empty response"}`);
  if (response.data.chainKey !== Number(SOURCE_CHAIN_KEY)) throw new Error("Raw batch proof source key mismatch");
  const continuityProof = normalizeContinuity(response.data.continuityProof);
  const byHash = new Map<string, RefreshedNativeProof>();
  for (const [blockHeight, entries] of response.data.merkleProofs) {
    for (const [transactionIndex, entry] of entries) {
      const hash = exactHash(entry.txHash, "Raw batch transaction hash");
      const item = expected.find(candidate => candidate.hash === hash);
      if (!item || byHash.has(hash)) throw new Error("Raw batch contained an unexpected or duplicate transaction");
      byHash.set(hash, normalizeRawEntry(item, entry, blockHeight, transactionIndex, continuityProof));
    }
  }
  const proofs = expected.map(item => byHash.get(item.hash));
  if (proofs.some(proof => !proof)) throw new Error("Raw batch omitted a requested transaction");
  return {proofs:proofs as RefreshedNativeProof[], continuityProof};
}

/**
 * Rebuilds native evidence entirely from the pinned SDK, the source RPC, and the
 * target chain-info precompile. It only reads chains and never submits a transaction.
 */
export async function refreshNativeProofBundle(options: RefreshNativeProofBundleOptions) {
  const info = await verifyDomains(options.source, options.target);
  const expected = await expectedTransactions(options.source, options.transactionHashes);
  const requiredHeight = Math.max(...expected.map(item => item.receipt.blockNumber));
  const frontier = await info.getLatestAttestedHeightAndHash(Number(SOURCE_CHAIN_KEY));
  if (!frontier.exists || frontier.height < requiredHeight) {
    throw new Error(`Native attestation is not ready: source height ${requiredHeight}, target frontier ${frontier.height}`);
  }
  exactHash(frontier.hash, "Target attested hash");

  const built = await buildRaw(options.source, info, expected);
  const encodedComparisons = built.proofs.map(proof => {
    const refreshedHash = keccak256(proof.encodedTransaction);
    const prior = priorBytesFor(options, proof.transactionHash);
    if (prior === undefined) return {transactionHash:proof.transactionHash, refreshedHash, priorHash:null, matchesPrior:null};
    const priorHash = keccak256(encodedBytes(prior, "Prior encoded transaction"));
    if (priorHash !== refreshedHash || prior.toLowerCase() !== proof.encodedTransaction.toLowerCase()) {
      throw new Error(`Refreshed encoded transaction changed for ${proof.transactionHash}`);
    }
    return {transactionHash:proof.transactionHash, refreshedHash, priorHash, matchesPrior:true};
  });

  const refreshedContinuityFingerprint = continuityFingerprint(built.continuityProof);
  const priorContinuityFingerprint = options.priorContinuityProof
    ? continuityFingerprint(options.priorContinuityProof)
    : null;
  const result = {
    schema:"proofkey.native-proof-refresh.v1",
    generatedAt:new Date().toISOString(),
    generator:"@gluwa/usc-sdk@0.18.0 RawProofBuilder",
    readOnly:true,
    sourceChainId:SOURCE_CHAIN_ID,
    sourceChainKey:Number(SOURCE_CHAIN_KEY),
    targetChainId:TARGET_CHAIN_ID,
    targetAttestedHeight:frontier.height,
    targetAttestedHash:frontier.hash,
    proofs:built.proofs,
    continuityProof:built.continuityProof,
    comparison:{
      encodedTransactions:encodedComparisons,
      continuity:{
        priorFingerprint:priorContinuityFingerprint,
        refreshedFingerprint:refreshedContinuityFingerprint,
        changed:priorContinuityFingerprint === null ? null : priorContinuityFingerprint !== refreshedContinuityFingerprint,
      },
    },
    disclosure:"Generated from current source RPC data and target attestation state. It has not been accepted by the target native verifier unless separately submitted and authenticated.",
  };

  if (options.save !== false) {
    const outputName = options.outputName ?? `refreshed-native-${expected[0].hash.slice(2, 12)}.json`;
    if (basename(outputName) !== outputName || !outputName.endsWith(".json")) throw new Error("Output name must be a JSON filename within evidence/");
    await saveReport(outputName, result);
  }
  return result;
}

export async function refreshNativeProof(options: RefreshNativeProofOptions) {
  const priorEncodedTransactions = options.priorEncodedTransaction
    ? {[options.transactionHash.toLowerCase()]:options.priorEncodedTransaction}
    : undefined;
  const bundle = await refreshNativeProofBundle({
    source:options.source,
    target:options.target,
    transactionHashes:[options.transactionHash],
    priorEncodedTransactions,
    priorContinuityProof:options.priorContinuityProof,
    outputName:options.outputName,
    save:options.save,
  });
  return {...bundle, proof:bundle.proofs[0]};
}

function priorMaterial(document: any, transactionHash: string) {
  const hash = transactionHash.toLowerCase();
  const candidates = [
    document?.proof,
    ...(Array.isArray(document?.proofs) ? document.proofs : []),
    ...(Array.isArray(document?.bundle?.proofs) ? document.bundle.proofs : []),
  ].filter(Boolean);
  const proof = candidates.find((candidate:any) => !candidate?.transactionHash || String(candidate.transactionHash).toLowerCase() === hash);
  return {
    encodedTransaction:proof?.encodedTransaction ?? document?.encodedTransaction,
    continuityProof:proof?.continuityProof ?? document?.continuityProof ?? document?.bundle?.continuityProof,
  };
}

function usage() {
  return "Usage: npm run proof:refresh -- <transactionHash> [--prior <evidence.json>] [--output <filename.json>]";
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { console.log(usage()); return; }
  const valueAfter = (flag:string) => {
    const index=args.indexOf(flag);
    if(index<0) return undefined;
    const value=args[index+1];
    if(!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
  };
  const priorPath=valueAfter("--prior");
  const outputName=valueAfter("--output");
  const consumed=new Set<number>();
  for(const flag of ["--prior","--output"]) {
    const index=args.indexOf(flag);
    if(index>=0) { consumed.add(index); consumed.add(index+1); }
  }
  const positional=args.filter((_arg,index)=>!consumed.has(index));
  if(positional.length!==1 || positional[0].startsWith("--")) throw new Error(usage());
  const transactionHash=positional[0];
  let prior:any={};
  if(priorPath) {
    const path=isAbsolute(priorPath)?priorPath:resolve(ROOT,priorPath);
    prior=priorMaterial(JSON.parse(await readFile(path,"utf8")),transactionHash);
  }

  await loadEnvironment();
  const {source,target}=await testNetworks();
  try {
    const result=await refreshNativeProof({
      source,target,transactionHash,
      priorEncodedTransaction:prior.encodedTransaction,
      priorContinuityProof:prior.continuityProof,
      outputName,
    });
    console.log(JSON.stringify({
      transactionHash:result.proof.transactionHash,
      blockHeight:result.proof.blockHeight,
      transactionIndex:result.proof.transactionIndex,
      encodedTransactionHash:result.comparison.encodedTransactions[0].refreshedHash,
      priorEncodedTransactionMatched:result.comparison.encodedTransactions[0].matchesPrior,
      priorContinuityFingerprint:result.comparison.continuity.priorFingerprint,
      refreshedContinuityFingerprint:result.comparison.continuity.refreshedFingerprint,
      continuityChanged:result.comparison.continuity.changed,
      output:outputName ?? `refreshed-native-${transactionHash.slice(2,12)}.json`,
    },null,2));
  } finally {
    source.destroy(); target.destroy();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  cli().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; });
}
