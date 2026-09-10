import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { AbiCoder, Interface } from "ethers";
import { ALLOCATION_EVENT_ABI, hashAllocation } from "./allocation.ts";
import { decodeNativeAllocation, decodeNativeCheckpoint, decodeNativeReceiptLog } from "./receipt-evidence.ts";
import type { Address, Hex } from "./types.ts";

const abi = AbiCoder.defaultAbiCoder();
const emitter = "0x1111111111111111111111111111111111111111" as Address;
const other = "0x2222222222222222222222222222222222222222" as Address;
const h = `0x${"ab".repeat(32)}` as Hex;
const iface = new Interface([ALLOCATION_EVENT_ABI]);
const event = iface.encodeEventLog(iface.getEvent("AllocationCreated")!, [h, 1, 0, 1, h, 0, 1, "0x0000000000000000000000000000000000000000", 12, other, other, h, h]);
function encoded(type: number, status = 1, at: Address = emitter, topic = event.topics[0]!, extraChunk = false): Hex {
  const receipt = abi.encode(["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"], [status, 21000, [[at, [topic, ...event.topics.slice(1)], event.data]], "0x"]);
  const chunks = type <= 2 ? ["0x", "0x", receipt] : ["0x", "0x", "0x", receipt];
  if (extraChunk) chunks.push("0x");
  return abi.encode(["uint8", "bytes[]"], [type, chunks]) as Hex;
}

test("receipt selection follows all five native ABI-v1 chunk layouts", () => {
  for (let type = 0; type <= 4; type++) {
    const allocation = decodeNativeAllocation(encoded(type), 0, emitter);
    assert.equal(allocation.amount, 12n);
    assert.equal(allocation.allocationId, 1n);
  }
});

test("receipt selection refuses failed, wrong-emitter, wrong-event and malformed source evidence", () => {
  assert.throws(() => decodeNativeAllocation(encoded(2, 0), 0, emitter), /did not succeed/);
  assert.throws(() => decodeNativeAllocation(encoded(2, 1, other), 0, emitter), /pinned source coordinator/);
  assert.throws(() => decodeNativeAllocation(encoded(2, 1, emitter, h), 0, emitter), /canonical AllocationCreated/);
  assert.throws(() => decodeNativeReceiptLog(encoded(2), 1, emitter), /outside/);
  assert.throws(() => decodeNativeReceiptLog(encoded(2), -1, emitter), /ordinal/);
  assert.throws(() => decodeNativeReceiptLog(encoded(2, 1, emitter, event.topics[0], true), 0, emitter), /chunk count/);
  assert.throws(() => decodeNativeReceiptLog(`${encoded(2)}00`, 0, emitter), /noncanonical/);
  assert.throws(() => decodeNativeReceiptLog(encoded(5), 0, emitter), /unsupported/);
});

test("native receipt helper decodes the captured public allocation and checkpoint at exact ordinals", async () => {
  const bundle = JSON.parse(await readFile(new URL("../evidence/native-bundle-33642ef4a9.json", import.meta.url), "utf8"));
  const claim = JSON.parse(await readFile(new URL("../evidence/claim-1.json", import.meta.url), "utf8"));
  const proof = bundle.proofs.find((p: any) => p.transactionHash === "0x33642ef4a994dd63b5426a3835051f314cf422761d48000fcb1bcc4b4538efc5");
  assert.ok(proof, "the exact captured source transaction is required");
  const source = "0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138";
  const allocation = decodeNativeAllocation(proof.encodedTransaction, 0, source);
  assert.equal(hashAllocation(allocation), hashAllocation({ ...claim.allocation, allocationId: BigInt(claim.allocation.allocationId), amount: BigInt(claim.allocation.amount) }));
  const checkpoint = decodeNativeCheckpoint(proof.encodedTransaction, 2, source);
  assert.equal(checkpoint.epochId, allocation.epochId);
  assert.equal(checkpoint.earned, allocation.amount);
  assert.equal(checkpoint.leafCount, 1);
  assert.throws(() => decodeNativeAllocation(proof.encodedTransaction, 2, source), /canonical AllocationCreated/);
});
