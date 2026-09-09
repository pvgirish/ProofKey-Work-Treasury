import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { EventFragment, FunctionFragment, Interface, keccak256, toUtf8Bytes } from "ethers";
import { SAFE_ABI, safeInterface } from "../scripts/safe.ts";

const safeArtifact = JSON.parse(await readFile(resolve(import.meta.dirname, "../vendor/safe/Safe.json"), "utf8"));
const artifactInterface = new Interface(safeArtifact.abi);

test("Safe helper ABI remains a canonical subset of the pinned Safe 1.4.1 artifact", () => {
  assert.ok(SAFE_ABI.length > 0);
  for (const fragment of safeInterface.fragments) {
    if (fragment instanceof FunctionFragment) {
      const canonical = artifactInterface.getFunction(fragment.format("sighash"));
      assert.ok(canonical, `missing pinned function ${fragment.format("sighash")}`);
      assert.equal(fragment.selector, canonical.selector);
    } else if (fragment instanceof EventFragment) {
      const canonical = artifactInterface.getEvent(fragment.format("sighash"));
      assert.ok(canonical, `missing pinned event ${fragment.format("sighash")}`);
      assert.equal(fragment.topicHash, canonical.topicHash);
      assert.deepEqual(
        fragment.inputs.map((input) => input.indexed === true),
        canonical.inputs.map((input) => input.indexed === true),
      );
    }
  }
});

test("decodes pinned indexed Safe success and failure transaction hashes", () => {
  for (const eventName of ["ExecutionSuccess", "ExecutionFailure"] as const) {
    const hash = keccak256(toUtf8Bytes(`ProofKey ${eventName} regression`));
    const canonicalEvent = artifactInterface.getEvent(eventName);
    assert.ok(canonicalEvent);
    assert.equal(canonicalEvent.inputs[0]?.indexed, true);
    const encoded = artifactInterface.encodeEventLog(canonicalEvent, [hash, 7n]);
    assert.equal(encoded.topics.length, 2, `${eventName} must carry txHash in topic[1]`);
    assert.equal(encoded.topics[1]?.toLowerCase(), hash.toLowerCase());
    const decoded = safeInterface.parseLog(encoded);
    assert.equal(decoded?.name, eventName);
    assert.equal(String(decoded?.args.txHash).toLowerCase(), hash.toLowerCase());
    assert.equal(decoded?.args.payment, 7n);
  }
});
