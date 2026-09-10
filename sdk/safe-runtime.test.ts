import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { keccak256, type Provider } from "ethers";
import { SAFE_141_RUNTIME_PINS, verifySafeRuntimeAtBlock } from "./safe-runtime.ts";
import type { Address, Hex } from "./types.ts";

const proxy = JSON.parse(await readFile(new URL("../vendor/safe/SafeProxy.json", import.meta.url), "utf8"));
const singleton = JSON.parse(await readFile(new URL("../vendor/safe/Safe.json", import.meta.url), "utf8"));
const safe = `0x${"1".repeat(40)}` as Address;
const singletonAddress = `0x${"2".repeat(40)}` as Address;
const blockHash = `0x${"a".repeat(64)}` as Hex;

function fixture(overrides: Record<string, unknown> = {}) {
  const reads: Array<[string, unknown]> = [];
  const provider = {
    async getNetwork() { return { chainId: 11155111n }; },
    async send(method: string) { assert.equal(method, "eth_chainId"); return "0xaa36a7"; },
    async getBlock(tag: number | string) { reads.push(["block", tag]); return { number: tag === "finalized" ? 200 : tag, hash: blockHash }; },
    async getCode(address: string, block: number) { reads.push(["code", block]); return address.toLowerCase() === safe ? proxy.deployedBytecode : singleton.deployedBytecode; },
    async getStorage(_address: string, slot: number, block: number) { assert.equal(slot, 0); reads.push(["storage", block]); return `0x${"0".repeat(24)}${singletonAddress.slice(2)}`; },
    ...overrides,
  } as unknown as Provider;
  return { provider, reads };
}
function verify(provider: Provider) { return verifySafeRuntimeAtBlock({ provider, safe, blockNumber: 100, blockHash, chainId: "11155111" }); }

test("browser Safe runtime pins match attributed 1.4.1 artifacts and bound historical reads", async () => {
  assert.equal(keccak256(proxy.deployedBytecode), SAFE_141_RUNTIME_PINS.proxy);
  assert.equal(keccak256(singleton.deployedBytecode), SAFE_141_RUNTIME_PINS.singleton);
  const f = fixture(); const result = await verify(f.provider);
  assert.equal(result.verified, true);
  assert.equal(result.singleton, singletonAddress);
  assert.equal(result.currentOwnersVerified, false);
  assert.equal(result.intraBlockExecutionTrace, false);
  assert(f.reads.filter(([kind]) => kind !== "block").every(([, number]) => number === 100));
});

test("Safe-shaped custom contracts and changed implementations cannot earn a canonical runtime result", async () => {
  await assert.rejects(verify(fixture({ getCode: async () => "0x6000" }).provider), /proxy runtime/);
  await assert.rejects(verify(fixture({ getCode: async (at: string) => at === safe ? proxy.deployedBytecode : "0x6000" }).provider), /singleton runtime/);
  await assert.rejects(verify(fixture({ getStorage: async () => `0x${"1".repeat(64)}` }).provider), /canonical address word/);
  await assert.rejects(verify(fixture({ getStorage: async () => `0x${"0".repeat(64)}` }).provider), /singleton is zero/);
});

test("Safe runtime check refuses chain, finality and historical hash changes", async () => {
  await assert.rejects(verify(fixture({ send: async () => "0x1" }).provider), /chain differs/);
  await assert.rejects(verify(fixture({ getBlock: async (tag: string | number) => ({ number: tag === "finalized" ? 99 : 100, hash: blockHash }) }).provider), /finalized prefix/);
  let numberedReads = 0;
  await assert.rejects(verify(fixture({ getBlock: async (tag: string | number) => ({ number: tag === "finalized" ? 200 : 100, hash: tag !== "finalized" && ++numberedReads > 1 ? `0x${"b".repeat(64)}` : blockHash }) }).provider), /snapshot changed/);
});
