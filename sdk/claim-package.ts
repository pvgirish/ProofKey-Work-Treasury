import { isAddress, isHexString } from "ethers";
import { deserializeAllocation, hashAllocation, verifyOrderedProof } from "./allocation.ts";
import { CLAIM_PACKAGE_VERSION } from "./types.ts";
import type {
  AuthenticationReference,
  ClaimPackage,
  CheckpointClaimPackage,
  Hex,
  NativeProofMaterial,
  ReceiptClaimPackage,
  SerializedAllocationV1,
} from "./types.ts";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a nonempty string`);
  return value;
}

function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`${label} must be a nonnegative integer`);
  return value;
}

function hex(value: unknown, label: string, bytes?: number): Hex {
  if (typeof value !== "string" || !isHexString(value, bytes)) throw new Error(`${label} is not valid hex${bytes ? ` (${bytes} bytes required)` : ""}`);
  return value as Hex;
}

function decimal(value: unknown, label: string): string {
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  const text = string(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label} must be canonical unsigned decimal text`);
  return text;
}

function allocation(value: unknown): SerializedAllocationV1 {
  const v = record(value, "allocation");
  const result: SerializedAllocationV1 = {
    epochId: hex(v.epochId, "allocation.epochId", 32),
    allocationId: decimal(v.allocationId, "allocation.allocationId"),
    treeIndex: integer(v.treeIndex, "allocation.treeIndex", 0xffffffff),
    kind: integer(v.kind, "allocation.kind", 0xff),
    orderId: hex(v.orderId, "allocation.orderId", 32),
    milestoneId: integer(v.milestoneId, "allocation.milestoneId", 0xffffffff),
    role: integer(v.role, "allocation.role", 0xff),
    asset: string(v.asset, "allocation.asset") as `0x${string}`,
    amount: decimal(v.amount, "allocation.amount"),
    claimOwner: string(v.claimOwner, "allocation.claimOwner") as `0x${string}`,
    destination: string(v.destination, "allocation.destination") as `0x${string}`,
    policyHash: hex(v.policyHash, "allocation.policyHash", 32),
    evidenceHash: hex(v.evidenceHash, "allocation.evidenceHash", 32),
  };
  for (const [name, address] of [["asset", result.asset], ["claimOwner", result.claimOwner], ["destination", result.destination]] as const) {
    if (!isAddress(address)) throw new Error(`allocation.${name} is not an address`);
  }
  deserializeAllocation(result);
  return result;
}

function authentication(value: unknown): AuthenticationReference {
  const v = record(value, "authentication");
  return {
    sourceChainKey: BigInt(decimal(v.sourceChainKey, "authentication.sourceChainKey")),
    blockHeight: BigInt(decimal(v.blockHeight, "authentication.blockHeight")),
    transactionIndex: BigInt(decimal(v.transactionIndex, "authentication.transactionIndex")),
    profileId: hex(v.profileId, "authentication.profileId", 32),
    encodedTransactionHash: hex(v.encodedTransactionHash, "authentication.encodedTransactionHash", 32),
  };
}

function material(value: unknown): NativeProofMaterial {
  const v = record(value, "material");
  const merkle = record(v.merkleProof, "material.merkleProof");
  const continuity = record(v.continuityProof, "material.continuityProof");
  if (!Array.isArray(merkle.siblings)) throw new Error("material.merkleProof.siblings must be an array");
  if (!Array.isArray(continuity.roots) || continuity.roots.length === 0) throw new Error("material.continuityProof.roots must be a nonempty array");
  return {
    blockHeight: BigInt(decimal(v.blockHeight, "material.blockHeight")),
    encodedTransaction: hex(v.encodedTransaction, "material.encodedTransaction"),
    merkleProof: {
      root: hex(merkle.root, "material.merkleProof.root", 32),
      siblings: merkle.siblings.map((item, index) => {
        const sibling = record(item, `material.merkleProof.siblings[${index}]`);
        if (typeof sibling.isLeft !== "boolean") throw new Error(`material.merkleProof.siblings[${index}].isLeft must be boolean`);
        return { hash: hex(sibling.hash, `material.merkleProof.siblings[${index}].hash`, 32), isLeft: sibling.isLeft };
      }),
    },
    continuityProof: {
      lowerEndpointDigest: hex(continuity.lowerEndpointDigest, "material.continuityProof.lowerEndpointDigest", 32),
      roots: continuity.roots.map((item, index) => hex(item, `material.continuityProof.roots[${index}]`, 32)),
    },
  };
}

function normalizeAuthentication(value: AuthenticationReference): AuthenticationReference {
  return {
    ...value,
    blockHeight: BigInt(value.blockHeight),
    transactionIndex: BigInt(value.transactionIndex),
  };
}

/** Parses untrusted JSON and proves its application-level structure. Native authenticity remains a target-chain check. */
export function parseClaimPackage(input: string | unknown): ClaimPackage {
  const root = record(typeof input === "string" ? JSON.parse(input) : input, "claim package");
  if (root.version !== CLAIM_PACKAGE_VERSION) throw new Error(`unsupported claim-package version: ${String(root.version)}`);
  if (root.route !== "checkpoint" && root.route !== "receipt") throw new Error("route must be checkpoint or receipt");
  const createdAt = string(root.createdAt, "createdAt");
  if (Number.isNaN(Date.parse(createdAt))) throw new Error("createdAt must be an ISO date");
  const parsedAllocation = allocation(root.allocation);
  if (root.route === "checkpoint") {
    const checkpoint = record(root.checkpoint, "checkpoint");
    if (!Array.isArray(root.siblings) || root.siblings.length !== 7) throw new Error("checkpoint route requires exactly seven siblings");
    const siblings = root.siblings.map((value, index) => hex(value, `siblings[${index}]`, 32));
    const result: ClaimPackage = {
      version: CLAIM_PACKAGE_VERSION,
      route: "checkpoint",
      createdAt,
      allocation: parsedAllocation,
      siblings,
      checkpoint: {
        checkpointId: hex(checkpoint.checkpointId, "checkpoint.checkpointId", 32),
        root: hex(checkpoint.root, "checkpoint.root", 32),
        leafCount: integer(checkpoint.leafCount, "checkpoint.leafCount", 128),
        ...(checkpoint.receiptLocalLogOrdinal === undefined ? {} : { receiptLocalLogOrdinal: integer(checkpoint.receiptLocalLogOrdinal, "checkpoint.receiptLocalLogOrdinal", 0xffffffff) }),
        ...(checkpoint.authentication === undefined ? {} : { authentication: authentication(checkpoint.authentication) }),
        ...(checkpoint.material === undefined ? {} : { material: material(checkpoint.material) }),
      },
    };
    const leaf = hashAllocation(deserializeAllocation(result.allocation));
    if (!verifyOrderedProof(leaf, result.allocation.treeIndex, result.siblings, result.checkpoint.root, result.checkpoint.leafCount)) {
      throw new Error("allocation does not belong to the supplied ordered checkpoint");
    }
    if (result.checkpoint.material && result.checkpoint.receiptLocalLogOrdinal === undefined) throw new Error("fresh checkpoint proof requires receiptLocalLogOrdinal");
    return result;
  }
  const result: ClaimPackage = {
    version: CLAIM_PACKAGE_VERSION,
    route: "receipt",
    createdAt,
    allocation: parsedAllocation,
    receiptLocalLogOrdinal: integer(root.receiptLocalLogOrdinal, "receiptLocalLogOrdinal", 0xffffffff),
    encodedTransaction: hex(root.encodedTransaction, "encodedTransaction"),
    ...(root.authentication === undefined ? {} : { authentication: authentication(root.authentication) }),
    ...(root.material === undefined ? {} : { material: material(root.material) }),
  };
  if (!result.authentication && !result.material) throw new Error("receipt route requires native proof material or an existing authentication reference");
  if (result.material && result.material.encodedTransaction.toLowerCase() !== result.encodedTransaction.toLowerCase()) throw new Error("receipt material and package encodedTransaction differ");
  return result;
}

export function stringifyClaimPackage(value: ClaimPackage): string {
  const packageValue = parseClaimPackage(value);
  return JSON.stringify(packageValue, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

export function createCheckpointClaimPackage(options: {
  allocation: SerializedAllocationV1;
  siblings: Hex[];
  checkpoint: CheckpointClaimPackage["checkpoint"];
  createdAt?: string;
}): CheckpointClaimPackage {
  return parseClaimPackage({
    version: CLAIM_PACKAGE_VERSION,
    route: "checkpoint",
    createdAt: options.createdAt ?? new Date().toISOString(),
    allocation: options.allocation,
    siblings: options.siblings,
    checkpoint: options.checkpoint,
  }) as CheckpointClaimPackage;
}

export function createReceiptClaimPackage(options: {
  allocation: SerializedAllocationV1;
  receiptLocalLogOrdinal: number;
  encodedTransaction: Hex;
  authentication?: AuthenticationReference;
  material?: NativeProofMaterial;
  createdAt?: string;
}): ReceiptClaimPackage {
  return parseClaimPackage({
    version: CLAIM_PACKAGE_VERSION,
    route: "receipt",
    createdAt: options.createdAt ?? new Date().toISOString(),
    allocation: options.allocation,
    receiptLocalLogOrdinal: options.receiptLocalLogOrdinal,
    encodedTransaction: options.encodedTransaction,
    ...(options.authentication ? { authentication: options.authentication } : {}),
    ...(options.material ? { material: options.material } : {}),
  }) as ReceiptClaimPackage;
}

export function claimPackageSummary(value: ClaimPackage): {
  route: "checkpoint" | "receipt";
  allocationId: bigint;
  leafHash: Hex;
  canWorkOfflineFromApplicationHistory: boolean;
  hasNativeMaterial: boolean;
  requiresTargetCacheLookup: boolean;
} {
  const parsed = parseClaimPackage(value);
  const normalized = deserializeAllocation(parsed.allocation);
  const hasMaterial = parsed.route === "checkpoint" ? Boolean(parsed.checkpoint.material) : Boolean(parsed.material);
  return {
    route: parsed.route,
    allocationId: normalized.allocationId,
    leafHash: hashAllocation(normalized),
    canWorkOfflineFromApplicationHistory: parsed.route === "checkpoint" || parsed.route === "receipt",
    hasNativeMaterial: hasMaterial,
    requiresTargetCacheLookup: !hasMaterial,
  };
}

export function withNormalizedAuthentication<T extends ClaimPackage>(value: T): T {
  const parsed = parseClaimPackage(value);
  if (parsed.route === "checkpoint") {
    if (parsed.checkpoint.authentication) parsed.checkpoint.authentication = normalizeAuthentication(parsed.checkpoint.authentication);
  } else if (parsed.authentication) {
    parsed.authentication = normalizeAuthentication(parsed.authentication);
  }
  return parsed as T;
}
