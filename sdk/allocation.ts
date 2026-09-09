import {
  AbiCoder,
  Interface,
  getAddress,
  getBytes,
  hexlify,
  isHexString,
  keccak256,
  toBeHex,
  zeroPadValue,
} from "ethers";
import type { AllocationV1, CheckpointV1, Hex, SerializedAllocationV1 } from "./types.ts";
import { AllocationKind, AllocationRole } from "./types.ts";

export const TREE_DEPTH = 7;
export const TREE_CAPACITY = 1 << TREE_DEPTH;
export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
export const ZERO_ADDRESS = `0x${"00".repeat(20)}` as const;
export const ALLOCATION_TYPE_HASH =
  "0x0c0b09698524f69712b08b7d15b0b0905cae44a5014fe49c7d221a343d080a66" as Hex;
export const NODE_TYPE_HASH =
  "0xb8ec434e179bde7da6b36cc81a26875509c52f3e5a4e39c7cbe9d77b7310a88b" as Hex;
export const EMPTY_LEAF_TYPE_HASH =
  "0x0721dfd2e1d57c54005918c3762eb76dcd3937a850be4d44c46f5da723f237de" as Hex;
export const ALLOCATION_EVENT_TOPIC =
  "0x49fae38c8740272ece744b0358c59b9e9f438e6c80f1e02463347c5ac9471dc5" as Hex;
export const CHECKPOINT_EVENT_TOPIC =
  "0xcc4ad7968159f3d07b5b9609f189ec675bcdce2d3d904d0c6e1e40c7ee6ce820" as Hex;

const abi = AbiCoder.defaultAbiCoder();

export const ALLOCATION_EVENT_ABI = {
  type: "event",
  anonymous: false,
  name: "AllocationCreated",
  inputs: [
    { type: "bytes32", name: "epochId", indexed: true },
    { type: "uint64", name: "allocationId", indexed: true },
    { type: "uint32", name: "treeIndex" },
    { type: "uint8", name: "kind" },
    { type: "bytes32", name: "orderId" },
    { type: "uint32", name: "milestoneId" },
    { type: "uint8", name: "role" },
    { type: "address", name: "asset" },
    { type: "uint256", name: "amount" },
    { type: "address", name: "claimOwner" },
    { type: "address", name: "destination" },
    { type: "bytes32", name: "policyHash" },
    { type: "bytes32", name: "evidenceHash" },
  ],
} as const;

export const CHECKPOINT_EVENT_ABI = {
  type: "event",
  anonymous: false,
  name: "CheckpointPublished",
  inputs: [
    { type: "bytes32", name: "epochId", indexed: true },
    { type: "bytes32", name: "root" },
    { type: "uint32", name: "leafCount" },
    { type: "uint256", name: "earned" },
    { type: "uint256", name: "returned" },
    { type: "uint8", name: "phase" },
  ],
} as const;

const events = new Interface([ALLOCATION_EVENT_ABI, CHECKPOINT_EVENT_ABI]);
const allocationDataTypes = [
  "uint32",
  "uint8",
  "bytes32",
  "uint32",
  "uint8",
  "address",
  "uint256",
  "address",
  "address",
  "bytes32",
  "bytes32",
];

function assertHex(value: unknown, bytes: number, label: string): asserts value is Hex {
  if (typeof value !== "string" || !isHexString(value, bytes)) throw new Error(`${label} must be ${bytes} bytes`);
}

function asSafeNumber(value: bigint, max: number, label: string): number {
  if (value < 0n || value > BigInt(max)) throw new Error(`${label} is outside its canonical range`);
  return Number(value);
}

export function normalizeAllocation(value: AllocationV1): AllocationV1 {
  assertHex(value.epochId, 32, "epochId");
  assertHex(value.orderId, 32, "orderId");
  assertHex(value.policyHash, 32, "policyHash");
  assertHex(value.evidenceHash, 32, "evidenceHash");
  const allocationId = BigInt(value.allocationId);
  const amount = BigInt(value.amount);
  const treeIndex = asSafeNumber(BigInt(value.treeIndex), 0xffffffff, "treeIndex");
  const milestoneId = asSafeNumber(BigInt(value.milestoneId), 0xffffffff, "milestoneId");
  const kind = asSafeNumber(BigInt(value.kind), 0xff, "kind");
  const role = asSafeNumber(BigInt(value.role), 0xff, "role");
  if (allocationId !== BigInt(treeIndex) + 1n) throw new Error("allocationId must equal treeIndex + 1");
  if (allocationId > 0xffffffffffffffffn) throw new Error("allocationId exceeds uint64");
  if (treeIndex >= TREE_CAPACITY) throw new Error(`treeIndex must be below ${TREE_CAPACITY}`);
  if (amount <= 0n) throw new Error("amount must be positive");
  const asset = getAddress(value.asset) as `0x${string}`;
  const claimOwner = getAddress(value.claimOwner) as `0x${string}`;
  const destination = getAddress(value.destination) as `0x${string}`;
  if (claimOwner === ZERO_ADDRESS || destination === ZERO_ADDRESS) throw new Error("claim owner and destination must be nonzero");
  const expectedRole = kind === AllocationKind.WORK ? AllocationRole.WORKER : kind === AllocationKind.FEE ? AllocationRole.FEE : kind === AllocationKind.RETURN ? AllocationRole.EPOCH : -1;
  if (role !== expectedRole) throw new Error("kind and role do not match the frozen schema");
  if (kind === AllocationKind.RETURN) {
    if (value.orderId !== ZERO_BYTES32 || milestoneId !== 0) throw new Error("RETURN must use zero order and milestone IDs");
  } else if (value.orderId === ZERO_BYTES32) {
    throw new Error("WORK and FEE require a nonzero orderId");
  }
  return { ...value, allocationId, treeIndex, kind, milestoneId, role, amount, asset, claimOwner, destination };
}

export function encodeAllocation(value: AllocationV1): Hex {
  const a = normalizeAllocation(value);
  return abi.encode(
    ["bytes32", "bytes32", "uint64", "uint32", "uint8", "bytes32", "uint32", "uint8", "address", "uint256", "address", "address", "bytes32", "bytes32"],
    [ALLOCATION_TYPE_HASH, a.epochId, a.allocationId, a.treeIndex, a.kind, a.orderId, a.milestoneId, a.role, a.asset, a.amount, a.claimOwner, a.destination, a.policyHash, a.evidenceHash],
  ) as Hex;
}

export function hashAllocation(value: AllocationV1): Hex {
  return keccak256(encodeAllocation(value)) as Hex;
}

export function hashNode(left: Hex, right: Hex): Hex {
  assertHex(left, 32, "left node");
  assertHex(right, 32, "right node");
  return keccak256(abi.encode(["bytes32", "bytes32", "bytes32"], [NODE_TYPE_HASH, left, right])) as Hex;
}

export function emptyTree(): Hex[] {
  const zero: Hex[] = [keccak256(abi.encode(["bytes32"], [EMPTY_LEAF_TYPE_HASH])) as Hex];
  for (let i = 0; i < TREE_DEPTH; i += 1) zero.push(hashNode(zero[i]!, zero[i]!));
  return zero;
}

export function buildOrderedTree(leaves: readonly Hex[]): { root: Hex; levels: Hex[][] } {
  if (leaves.length > TREE_CAPACITY) throw new Error(`tree has more than ${TREE_CAPACITY} leaves`);
  const zero = emptyTree();
  const base = Array.from({ length: TREE_CAPACITY }, (_, i) => {
    const leaf = leaves[i] ?? zero[0]!;
    assertHex(leaf, 32, `leaf ${i}`);
    return leaf;
  });
  const levels: Hex[][] = [base];
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    const previous = levels[level]!;
    const next: Hex[] = [];
    for (let i = 0; i < previous.length; i += 2) next.push(hashNode(previous[i]!, previous[i + 1]!));
    levels.push(next);
  }
  return { root: levels[TREE_DEPTH]![0]!, levels };
}

export function orderedProof(leaves: readonly Hex[], index: number): Hex[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new Error("proof index is outside the leaf prefix");
  const { levels } = buildOrderedTree(leaves);
  const proof: Hex[] = [];
  let cursor = index;
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    proof.push(levels[level]![cursor ^ 1]!);
    cursor >>= 1;
  }
  return proof;
}

export function verifyOrderedProof(leaf: Hex, index: number, siblings: readonly Hex[], root: Hex, leafCount: number): boolean {
  assertHex(leaf, 32, "leaf");
  assertHex(root, 32, "root");
  if (siblings.length !== TREE_DEPTH || !Number.isInteger(index) || index < 0 || index >= leafCount || leafCount > TREE_CAPACITY) return false;
  let node = leaf;
  for (let level = 0; level < TREE_DEPTH; level += 1) {
    const sibling = siblings[level]!;
    assertHex(sibling, 32, `sibling ${level}`);
    node = ((index >> level) & 1) === 0 ? hashNode(node, sibling) : hashNode(sibling, node);
  }
  return node.toLowerCase() === root.toLowerCase();
}

export function rebuildAllocations(allocations: readonly AllocationV1[]): { root: Hex; leaves: Hex[] } {
  const leaves = allocations.map((allocation, index) => {
    const normalized = normalizeAllocation(allocation);
    if (normalized.treeIndex !== index) throw new Error(`allocation at position ${index} declares treeIndex ${normalized.treeIndex}`);
    return hashAllocation(normalized);
  });
  return { root: buildOrderedTree(leaves).root, leaves };
}

export function decodeAllocationEvent(topics: readonly string[], data: string): AllocationV1 {
  if (topics.length !== 3 || topics[0]?.toLowerCase() !== ALLOCATION_EVENT_TOPIC) throw new Error("not a canonical AllocationCreated event");
  if (!isHexString(data, 352)) throw new Error("AllocationCreated data must be exactly 352 bytes");
  assertHex(topics[1], 32, "epochId topic");
  assertHex(topics[2], 32, "allocationId topic");
  const allocationId = BigInt(topics[2]);
  if (allocationId > 0xffffffffffffffffn || zeroPadValue(toBeHex(allocationId), 32).toLowerCase() !== topics[2].toLowerCase()) throw new Error("allocationId topic is not canonical uint64");
  const decoded = events.decodeEventLog("AllocationCreated", data, [...topics]);
  const canonicalData = abi.encode(allocationDataTypes, Array.from(decoded).slice(2));
  if (hexlify(getBytes(canonicalData)).toLowerCase() !== hexlify(getBytes(data)).toLowerCase()) throw new Error("AllocationCreated data has noncanonical padding");
  return normalizeAllocation({
    epochId: decoded.epochId,
    allocationId: decoded.allocationId,
    treeIndex: Number(decoded.treeIndex),
    kind: Number(decoded.kind),
    orderId: decoded.orderId,
    milestoneId: Number(decoded.milestoneId),
    role: Number(decoded.role),
    asset: decoded.asset,
    amount: decoded.amount,
    claimOwner: decoded.claimOwner,
    destination: decoded.destination,
    policyHash: decoded.policyHash,
    evidenceHash: decoded.evidenceHash,
  });
}

export function decodeCheckpointEvent(topics: readonly string[], data: string): CheckpointV1 {
  if (topics.length !== 2 || topics[0]?.toLowerCase() !== CHECKPOINT_EVENT_TOPIC) throw new Error("not a canonical CheckpointPublished event");
  if (!isHexString(data, 160)) throw new Error("CheckpointPublished data must be exactly 160 bytes");
  const decoded = events.decodeEventLog("CheckpointPublished", data, [...topics]);
  const canonicalData = abi.encode(["bytes32", "uint32", "uint256", "uint256", "uint8"], Array.from(decoded).slice(1));
  if (canonicalData.toLowerCase() !== data.toLowerCase()) throw new Error("CheckpointPublished data has noncanonical padding");
  return {
    epochId: decoded.epochId,
    root: decoded.root,
    leafCount: asSafeNumber(decoded.leafCount, TREE_CAPACITY, "leafCount"),
    earned: decoded.earned,
    returned: decoded.returned,
    phase: asSafeNumber(decoded.phase, 0xff, "phase"),
  };
}

export function serializeAllocation(value: AllocationV1): SerializedAllocationV1 {
  const allocation = normalizeAllocation(value);
  return { ...allocation, allocationId: allocation.allocationId.toString(), amount: allocation.amount.toString() };
}

export function deserializeAllocation(value: SerializedAllocationV1): AllocationV1 {
  return normalizeAllocation({ ...value, allocationId: BigInt(value.allocationId), amount: BigInt(value.amount) });
}
