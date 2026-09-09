import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { getAddress, type Provider } from "ethers";
import { verifySafeRuntime } from "./judge-safe-runtime.ts";

const safe = getAddress("0x1000000000000000000000000000000000000001");
const singleton = getAddress("0x2000000000000000000000000000000000000002");
const blockNumber = 1234;
const blockHash = `0x${"ab".repeat(32)}`;
const vendor = resolve(import.meta.dirname, "../vendor/safe");
const safeArtifact = JSON.parse(await readFile(resolve(vendor, "Safe.json"), "utf8"));
const proxyArtifact = JSON.parse(await readFile(resolve(vendor, "SafeProxy.json"), "utf8"));
const singletonWord = `0x${"00".repeat(12)}${singleton.slice(2).toLowerCase()}`;

function provider(options: {
  proxyCode?: string;
  singletonCode?: string;
  storage?: string;
  unavailable?: boolean;
  rereadBlockHash?: string;
} = {}, calls?: {
  blocks: number[];
  codes: Array<{ address: string; block: number }>;
  storage: Array<{ address: string; slot: number; block: number }>;
}): Provider {
  return {
    getBlock: async (block: number) => {
      calls?.blocks.push(block);
      if (options.unavailable) throw new Error("archive state missing");
      return { hash: calls && calls.blocks.length > 1 ? options.rereadBlockHash ?? blockHash : blockHash };
    },
    getCode: async (address: string, block: number) => {
      calls?.codes.push({ address: getAddress(address), block });
      if (options.unavailable) throw new Error("archive state missing");
      return getAddress(address) === safe
        ? options.proxyCode ?? proxyArtifact.deployedBytecode
        : options.singletonCode ?? safeArtifact.deployedBytecode;
    },
    getStorage: async (address: string, slot: number, block: number) => {
      calls?.storage.push({ address: getAddress(address), slot, block });
      if (options.unavailable) throw new Error("archive state missing");
      return options.storage ?? singletonWord;
    },
    getNetwork: async () => ({ chainId: 11_155_111n }),
  } as unknown as Provider;
}

test("anchors exact proxy, slot-zero singleton and singleton runtime at block end", async () => {
  const calls: {
    blocks: number[];
    codes: Array<{ address: string; block: number }>;
    storage: Array<{ address: string; slot: number; block: number }>;
  } = { blocks: [], codes: [], storage: [] };
  const result = await verifySafeRuntime(provider({}, calls), safe, blockNumber);
  assert.equal(result.verified, true);
  assert.equal(result.blockHash, blockHash);
  assert.equal(result.singletonStorage.singleton, singleton);
  assert.equal(result.proxy.matchesVendoredSafeProxy, true);
  assert.equal(result.singleton.matchesVendoredSafe, true);
  assert.equal(result.snapshot.semantics, "end-of-block");
  assert.equal(result.snapshot.consensusProof, false);
  assert.equal(result.snapshot.intraBlockExecutionTrace, false);
  assert.deepEqual(calls.blocks, [blockNumber, blockNumber]);
  assert.deepEqual(calls.codes, [
    { address: safe, block: blockNumber },
    { address: singleton, block: blockNumber },
  ]);
  assert.deepEqual(calls.storage, [{ address: safe, slot: 0, block: blockNumber }]);
});

test("rejects a proxy or singleton runtime byte substitution", async () => {
  await assert.rejects(
    verifySafeRuntime(provider({ proxyCode: "0x6000" }), safe, blockNumber),
    /proxy runtime differs/,
  );
  await assert.rejects(
    verifySafeRuntime(provider({ singletonCode: "0x6000" }), safe, blockNumber),
    /singleton runtime differs/,
  );
});

test("rejects malformed or zero slot-zero singleton state", async () => {
  await assert.rejects(
    verifySafeRuntime(provider({ storage: `0x01${"00".repeat(31)}` }), safe, blockNumber),
    /nonzero upper bytes/,
  );
  await assert.rejects(
    verifySafeRuntime(provider({ storage: `0x${"00".repeat(32)}` }), safe, blockNumber),
    /singleton is zero/,
  );
});

test("fails closed when the provider cannot serve historical state", async () => {
  await assert.rejects(
    verifySafeRuntime(provider({ unavailable: true }), safe, blockNumber),
    /Historical Safe block-end snapshot is unavailable.*archive state missing/,
  );
});

test("rejects a changed block hash between the historical reads", async () => {
  await assert.rejects(
    verifySafeRuntime(provider({ rereadBlockHash: `0x${"cd".repeat(32)}` }, {
      blocks: [],
      codes: [],
      storage: [],
    }), safe, blockNumber),
    /block changed during verification/,
  );
});
