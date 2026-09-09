import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AllocationV1, Hex } from "./types.ts";
import {
  buildOrderedTree,
  decodeAllocationEvent,
  decodeCheckpointEvent,
  deserializeAllocation,
  emptyTree,
  encodeAllocation,
  hashAllocation,
  orderedProof,
  rebuildAllocations,
  serializeAllocation,
  verifyOrderedProof,
} from "./allocation.ts";
import { CLAIM_PACKAGE_VERSION } from "./types.ts";
import { createReceiptClaimPackage, parseClaimPackage, stringifyClaimPackage } from "./claim-package.ts";

const vectorUrl = new URL("../../architecture-lock/schema-v1-vectors.json", import.meta.url);
const vectors = JSON.parse(await readFile(vectorUrl, "utf8"));

function fromVector(value: any): AllocationV1 {
  return deserializeAllocation({
    ...value,
    treeIndex: Number(value.treeIndex),
    kind: Number(value.kind),
    milestoneId: Number(value.milestoneId),
    role: Number(value.role),
  });
}

const allocations = vectors.allocations.map((entry: any) => fromVector(entry.values));

test("matches every frozen AllocationV1 encoding, event and hash", () => {
  for (let i = 0; i < allocations.length; i += 1) {
    const expected = vectors.allocations[i];
    assert.equal(encodeAllocation(allocations[i]).toLowerCase(), expected.leafPreimage);
    assert.equal(hashAllocation(allocations[i]), expected.leafHash);
    assert.deepEqual(serializeAllocation(decodeAllocationEvent(expected.event.topics, expected.event.data)), serializeAllocation(allocations[i]));
  }
});

test("rebuilds the frozen ordered tree and all seven-level witnesses", () => {
  const rebuilt = rebuildAllocations(allocations);
  assert.equal(rebuilt.root, vectors.tree.root);
  assert.deepEqual(emptyTree(), vectors.tree.emptySubtreeHashes);
  for (let index = 0; index < allocations.length; index += 1) {
    const proof = orderedProof(rebuilt.leaves, index);
    assert.deepEqual(proof, vectors.allocations[index].inclusionProof);
    assert.equal(verifyOrderedProof(rebuilt.leaves[index], index, proof, rebuilt.root, allocations.length), true);
  }
});

test("rejects reordered leaves, changed amounts and noncanonical events", () => {
  const leaves = allocations.map(hashAllocation);
  assert.notEqual(buildOrderedTree([leaves[1], leaves[0], leaves[2]]).root, vectors.tree.root);
  assert.equal(hashAllocation({ ...allocations[0], amount: 51n }), vectors.negativeHashFixtures.changedAmount.leafHash);
  const event = vectors.allocations[0].event;
  assert.throws(() => decodeAllocationEvent(event.topics.slice(0, 2), event.data), /canonical/);
  assert.throws(() => decodeAllocationEvent(event.topics, `${event.data}00`), /352 bytes/);
  const badPadding = `${event.data.slice(0, 2 + 63)}1${event.data.slice(2 + 64)}`;
  assert.throws(() => decodeAllocationEvent(event.topics, badPadding), /canonical|range|treeIndex/);
});

test("decodes the frozen checkpoint event", () => {
  const event = vectors.checkpoint.event;
  const checkpoint = decodeCheckpointEvent(event.topics, event.data);
  assert.deepEqual(checkpoint, {
    epochId: vectors.checkpoint.values.epochId,
    root: vectors.checkpoint.values.root,
    leafCount: 3,
    earned: 55n,
    returned: 65n,
    phase: 3,
  });
});

test("validates a portable checkpoint package and detects a modified witness", () => {
  const work = allocations[0];
  const proof = orderedProof(allocations.map(hashAllocation), 0);
  const packageValue = {
    version: CLAIM_PACKAGE_VERSION,
    route: "checkpoint",
    createdAt: "2026-09-09T00:00:00.000Z",
    allocation: serializeAllocation(work),
    siblings: proof,
    checkpoint: {
      checkpointId: `0x${"ef".repeat(32)}`,
      root: vectors.tree.root as Hex,
      leafCount: 3,
      receiptLocalLogOrdinal: 4,
      authentication: {
        sourceChainKey: "102030",
        blockHeight: "500",
        transactionIndex: "2",
        profileId: `0x${"ab".repeat(32)}`,
        encodedTransactionHash: `0x${"cd".repeat(32)}`,
      },
    },
  };
  const parsed = parseClaimPackage(JSON.stringify(packageValue));
  assert.equal(parsed.route, "checkpoint");
  assert.equal(parseClaimPackage(stringifyClaimPackage(parsed)).route, "checkpoint");
  const changed = structuredClone(packageValue);
  changed.siblings[0] = `0x${"00".repeat(32)}`;
  assert.throws(() => parseClaimPackage(changed), /does not belong/);
});

test("receipt package contains a directly usable SingleProof and exact transaction bytes", () => {
  const encodedTransaction = "0x010203" as Hex;
  const packageValue = {
    version: CLAIM_PACKAGE_VERSION,
    route: "receipt",
    createdAt: "2026-09-09T00:00:00.000Z",
    allocation: serializeAllocation(allocations[1]),
    receiptLocalLogOrdinal: 3,
    encodedTransaction,
    material: {
      blockHeight: "700",
      encodedTransaction,
      merkleProof: { root: `0x${"11".repeat(32)}`, siblings: [{ hash: `0x${"22".repeat(32)}`, isLeft: true }] },
      continuityProof: { lowerEndpointDigest: `0x${"33".repeat(32)}`, roots: [`0x${"44".repeat(32)}`] },
    },
  };
  const parsed = parseClaimPackage(packageValue);
  assert.equal(parsed.route, "receipt");
  assert.equal(parsed.material?.blockHeight, 700n);
  assert.throws(() => parseClaimPackage({ ...packageValue, encodedTransaction: "0x99" }), /differ/);
  assert.equal(createReceiptClaimPackage({
    allocation: packageValue.allocation,
    receiptLocalLogOrdinal: 3,
    encodedTransaction,
    material: parsed.route === "receipt" ? parsed.material : undefined,
  }).route, "receipt");
});

test("runs the independent reconstruction through all 128 leaves", () => {
  const generated: AllocationV1[] = Array.from({ length: 128 }, (_, index) => ({
    ...allocations[index % allocations.length],
    allocationId: BigInt(index + 1),
    treeIndex: index,
    kind: 1,
    role: 1,
    orderId: `0x${(index + 1).toString(16).padStart(64, "0")}` as Hex,
  }));
  const { root, leaves } = rebuildAllocations(generated);
  assert.equal(leaves.length, 128);
  assert.equal(verifyOrderedProof(leaves[127], 127, orderedProof(leaves, 127), root, 128), true);
  assert.throws(() => buildOrderedTree([...leaves, leaves[0]]), /more than 128/);
});
