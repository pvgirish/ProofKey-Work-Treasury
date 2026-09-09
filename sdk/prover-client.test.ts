import assert from "node:assert/strict";
import test from "node:test";
import { fetchProofByTransaction, normalizeProofResponse, singleProofFromFresh } from "./prover-client.ts";
import type { Hex } from "./types.ts";

const txHash = `0x${"aa".repeat(32)}` as Hex;
const response = {
  chainKey: 42,
  txHash,
  headerNumber: 100,
  txIndex: 3,
  txBytes: "0x0102",
  merkleProof: { root: `0x${"11".repeat(32)}`, siblings: [{ hash: `0x${"22".repeat(32)}`, isLeft: false }] },
  continuityProof: { lowerEndpointDigest: `0x${"33".repeat(32)}`, roots: [`0x${"44".repeat(32)}`] },
};

test("proof client binds and validates the requested chain and transaction", () => {
  const result = normalizeProofResponse(response, 42n, txHash, "https://proof.example");
  assert.equal(result.chainKey, 42n);
  assert.equal(result.encodedTransaction, "0x0102");
  assert.throws(() => normalizeProofResponse({ ...response, chainKey: 43 }, 42n, txHash, "x"), /different source chain/);
  assert.throws(() => normalizeProofResponse({ ...response, txHash: `0x${"bb".repeat(32)}` }, 42n, txHash, "x"), /different transaction/);
});

test("proof client uses the pinned endpoint and returns directly usable fields", async () => {
  let requested = "";
  const result = await fetchProofByTransaction("https://proof.example/", 42n, txHash, 1000, async url => {
    requested = url;
    return { ok: true, status: 200, async json() { return response; } };
  });
  assert.equal(requested, `https://proof.example/api/v1/proof-by-tx/42/${txHash}`);
  assert.deepEqual(result.merkleRoot, response.merkleProof.root);
  assert.equal(result.blockHeight, 100n);
  assert.deepEqual(singleProofFromFresh(result), {
    blockHeight: 100n,
    encodedTransaction: "0x0102",
    merkleProof: { root: response.merkleProof.root, siblings: response.merkleProof.siblings },
    continuityProof: response.continuityProof,
  });
});
