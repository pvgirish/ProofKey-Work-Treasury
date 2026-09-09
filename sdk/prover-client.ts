import { isHexString } from "ethers";
import type { Hex } from "./types.ts";
import type { NativeProofMaterial } from "./types.ts";

export interface FreshProof {
  chainKey: bigint;
  blockHeight: bigint;
  encodedTransaction: Hex;
  merkleRoot: Hex;
  siblings: Array<{ hash: Hex; isLeft: boolean }>;
  lowerEndpointDigest: Hex;
  continuityRoots: Hex[];
  proverTransactionIndex: number | null;
  transactionHash: Hex;
  fetchedAt: string;
  prover: string;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`proof service response has invalid ${label}`);
  return value as Record<string, unknown>;
}

function hex(value: unknown, label: string, bytes?: number): Hex {
  if (typeof value !== "string" || !isHexString(value, bytes)) throw new Error(`proof service response has invalid ${label}`);
  return value as Hex;
}

function safeInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "bigint") return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return safeInteger(BigInt(value));
  return null;
}

async function getJson(url: string, timeoutMs: number, fetchImpl: FetchLike): Promise<unknown> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("proof timeout must be between 1 and 120000 ms");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`proof service returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`proof service did not respond within ${timeoutMs} ms`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeProofResponse(raw: unknown, chainKey: bigint, transactionHash: Hex, prover: string): FreshProof {
  const value = record(raw, "body");
  const returnedChainKey = safeInteger(value.chainKey);
  if (returnedChainKey === null || BigInt(returnedChainKey) !== chainKey) throw new Error("proof service returned a different source chain key");
  const returnedTransactionHash = hex(value.txHash, "txHash", 32);
  if (returnedTransactionHash.toLowerCase() !== transactionHash.toLowerCase()) throw new Error("proof service returned a different transaction hash");
  const headerNumber = safeInteger(value.headerNumber);
  if (headerNumber === null) throw new Error("proof service response has invalid headerNumber");
  const merkle = record(value.merkleProof, "merkleProof");
  if (!Array.isArray(merkle.siblings)) throw new Error("proof service response has invalid merkle siblings");
  const continuity = record(value.continuityProof, "continuityProof");
  if (!Array.isArray(continuity.roots) || continuity.roots.length === 0) throw new Error("proof service response has invalid continuity roots");
  return {
    chainKey,
    blockHeight: BigInt(headerNumber),
    encodedTransaction: hex(value.txBytes, "txBytes"),
    merkleRoot: hex(merkle.root, "merkle root", 32),
    siblings: merkle.siblings.map((item, index) => {
      const sibling = record(item, `merkle sibling ${index}`);
      if (typeof sibling.isLeft !== "boolean") throw new Error(`proof service response has invalid merkle sibling ${index} side`);
      return { hash: hex(sibling.hash, `merkle sibling ${index}`, 32), isLeft: sibling.isLeft };
    }),
    lowerEndpointDigest: hex(continuity.lowerEndpointDigest, "lower endpoint", 32),
    continuityRoots: continuity.roots.map((item, index) => hex(item, `continuity root ${index}`, 32)),
    proverTransactionIndex: safeInteger(value.txIndex),
    transactionHash: returnedTransactionHash,
    fetchedAt: new Date().toISOString(),
    prover,
  };
}

export async function fetchAttestedHeight(baseUrl: string, chainKey: bigint, timeoutMs = 15_000, fetchImpl: FetchLike = fetch): Promise<bigint | null> {
  const body = record(await getJson(`${baseUrl.replace(/\/+$/, "")}/api/v1/attested-height/${chainKey}`, timeoutMs, fetchImpl), "attested height");
  const height = safeInteger(body.attestedHeight);
  return height === null ? null : BigInt(height);
}

export async function fetchProofByTransaction(baseUrl: string, chainKey: bigint, transactionHash: Hex, timeoutMs = 30_000, fetchImpl: FetchLike = fetch): Promise<FreshProof> {
  hex(transactionHash, "transaction hash", 32);
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/v1/proof-by-tx/${chainKey}/${transactionHash}`;
  return normalizeProofResponse(await getJson(endpoint, timeoutMs, fetchImpl), chainKey, transactionHash, baseUrl);
}

/** Converts a validated service response to the exact SingleProof tuple accepted by WorkTreasury. */
export function singleProofFromFresh(value: FreshProof): NativeProofMaterial {
  return {
    blockHeight: value.blockHeight,
    encodedTransaction: value.encodedTransaction,
    merkleProof: { root: value.merkleRoot, siblings: value.siblings.map(item => ({ ...item })) },
    continuityProof: { lowerEndpointDigest: value.lowerEndpointDigest, roots: [...value.continuityRoots] },
  };
}
