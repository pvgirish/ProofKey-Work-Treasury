import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { epochId, orderId, milestoneHash, quoteDigest } from "./identity.ts";

test("released SDK preserves the committed Solidity-conformance vectors", () => {
  const v = JSON.parse(readFileSync(new URL("../schema/identity-v1-vectors.json", import.meta.url), "utf8"));
  assert.equal(epochId(v.config), v.epochId);
  assert.equal(orderId(v.terms), v.orderId);
  assert.deepEqual(v.terms.milestones.map(milestoneHash), v.milestoneHashes);
  assert.equal(quoteDigest({chainId: BigInt(v.config.sourceChainId), coordinator: v.config.sourceCoordinator, orderId: v.orderId}), v.quoteDigest);
});
