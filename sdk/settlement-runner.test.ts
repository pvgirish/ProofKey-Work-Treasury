import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, getAddress, keccak256 } from "ethers";
import { ALLOCATION_EVENT_ABI, serializeAllocation } from "./allocation.ts";
import { createReceiptClaimPackage } from "./claim-package.ts";
import {
  SETTLEMENT_PACKET_VERSION, SETTLEMENT_TREASURY_ABI, buildSettlementPlan, executeSettlementPlan, settlementActionDigest,
  type SettlementPacketV1, type SettlementPlanV1, type SettlementReadAdapter, type TrustedSettlementDeployment,
} from "./settlement-runner.ts";
import { AllocationKind, AllocationRole, type Address, type AllocationV1, type Hex } from "./types.ts";

const iface = new Interface(SETTLEMENT_TREASURY_ABI);
const address = (byte: string) => getAddress(`0x${byte.repeat(40)}`) as Address;
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex;
const sourceCode = "0x6001" as Hex, targetCode = "0x6002" as Hex;
const coordinator = address("1"), treasury = address("2"), epochId = hash("a");
const allocation: AllocationV1 = {
  epochId, allocationId: 1n, treeIndex: 0, kind: AllocationKind.WORK, orderId: hash("b"), milestoneId: 0,
  role: AllocationRole.WORKER, asset: address("0"), amount: 70n, claimOwner: address("3"), destination: address("4"), policyHash: hash("c"), evidenceHash: hash("d"),
};
const allocationEvents = new Interface([ALLOCATION_EVENT_ABI]);
const encodedAllocationEvent = allocationEvents.encodeEventLog(allocationEvents.getEvent("AllocationCreated")!, [allocation.epochId, allocation.allocationId, allocation.treeIndex, allocation.kind, allocation.orderId, allocation.milestoneId, allocation.role, allocation.asset, allocation.amount, allocation.claimOwner, allocation.destination, allocation.policyHash, allocation.evidenceHash]);
const receiptChunk = AbiCoder.defaultAbiCoder().encode(["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"], [1, 1, [[coordinator, encodedAllocationEvent.topics, encodedAllocationEvent.data]], "0x"]);
const encodedNative = AbiCoder.defaultAbiCoder().encode(["uint8", "bytes[]"], [2, ["0x", "0x", receiptChunk]]) as Hex;
const trusted: TrustedSettlementDeployment = {
  sourceChainId: "111", sourceChainKey: "7", sourceCoordinator: { address: coordinator, deployedCodeHash: keccak256(sourceCode) as Hex },
  targetChainId: "222", targetTreasury: { address: treasury, deployedCodeHash: keccak256(targetCode) as Hex },
};
function claim(stale = false) {
  return createReceiptClaimPackage({
    allocation: serializeAllocation(allocation), receiptLocalLogOrdinal: 0, encodedTransaction: encodedNative,
    material: { blockHeight: 10n, encodedTransaction: encodedNative, merkleProof: { root: hash("e"), siblings: [] }, continuityProof: { lowerEndpointDigest: hash("f"), roots: [hash("1")] } },
    authentication: { sourceChainKey: 7n, blockHeight: 10n, transactionIndex: stale ? 3n : 2n, profileId: hash("2"), encodedTransactionHash: keccak256(encodedNative) as Hex },
    createdAt: "2026-09-10T00:00:00.000Z",
  });
}
function packet(claims = [claim()]): SettlementPacketV1 {
  return {
    version: SETTLEMENT_PACKET_VERSION,
    source: { chainId: "111", chainKey: "7", coordinator: trusted.sourceCoordinator, finalized: { chainId: "111", blockNumber: "20", blockHash: hash("3") } },
    target: { chainId: "222", treasury: trusted.targetTreasury, finalized: { chainId: "222", blockNumber: "30", blockHash: hash("4") } },
    claims,
  };
}
function adapter(options: { recognized?: boolean; rejectWithdrawal?: boolean } = {}): SettlementReadAdapter {
  const config = [111n, 7n, coordinator, hash("5"), 222n, treasury, hash("6"), address("5"), address("6"), address("7"), allocation.asset, 100n, allocation.policyHash, 40n, 50n, 32, 16, 33, 7, 1n];
  const zeroAllocation = [hash("0"), 0n, 0, 0, hash("0"), 0, 0, address("0"), 0n, address("0"), address("0"), hash("0"), hash("0")];
  return {
    async chainId(side) { return side === "source" ? 111n : 222n; },
    async block(side, tag) {
      if (tag === "finalized") return { number: side === "source" ? 25n : 35n, hash: hash("9") };
      return { number: tag, hash: side === "source" ? hash("3") : hash("4") };
    },
    async code(side) { return side === "source" ? sourceCode : targetCode; },
    async calculateNativeTransactionIndex() { return 2n; },
    async simulateTarget(data) {
      const parsed = iface.parseTransaction({ data });
      if (options.rejectWithdrawal && parsed?.name === "withdrawFor") throw Object.assign(new Error("TransferFailed"), { data: keccak256(Buffer.from("TransferFailed()")).slice(0, 10) });
    },
    async targetCall(data) {
      const parsed = iface.parseTransaction({ data }); if (!parsed) throw new Error("unknown call");
      switch (parsed.name) {
        case "SOURCE_CHAIN_ID": return iface.encodeFunctionResult("SOURCE_CHAIN_ID", [111n]) as Hex;
        case "SOURCE_CHAIN_KEY": return iface.encodeFunctionResult("SOURCE_CHAIN_KEY", [7n]) as Hex;
        case "SOURCE_COORDINATOR": return iface.encodeFunctionResult("SOURCE_COORDINATOR", [coordinator]) as Hex;
        case "nativeProfile": return iface.encodeFunctionResult("nativeProfile", [hash("2")]) as Hex;
        case "epochConfig": return iface.encodeFunctionResult("epochConfig", [config]) as Hex;
        case "economicId": return iface.encodeFunctionResult("economicId", [hash("8")]) as Hex;
        case "recognizedEconomicId": return iface.encodeFunctionResult("recognizedEconomicId", [options.recognized === true]) as Hex;
        case "recognizedAllocation": return iface.encodeFunctionResult("recognizedAllocation", [[...Object.values(allocation)]]) as Hex;
        case "completedClaim": return iface.encodeFunctionResult("completedClaim", [zeroAllocation, false, address("0")]) as Hex;
        default: throw new Error(`unexpected ${parsed.name}`);
      }
    },
  };
}

test("rejects a packet whose domain is outside the trusted manifest", async () => {
  const wrong = packet(); wrong.target.chainId = "333";
  await assert.rejects(buildSettlementPlan(wrong, adapter(), trusted), /trusted deployment manifest/);
});

test("rejects stale native proof metadata using authoritative target calculation", async () => {
  await assert.rejects(buildSettlementPlan(packet([claim(true)]), adapter(), trusted), /stale proof/);
});

test("rejects a portable authentication from another native profile", async () => {
  const wrong = claim(); wrong.authentication!.profileId = hash("f");
  await assert.rejects(buildSettlementPlan(packet([wrong]), adapter(), trusted), /native profile mismatch/);
});

test("recognized claim with rejecting receiver reports owner-only redirection", async () => {
  const plan = await buildSettlementPlan(packet(), adapter({ recognized: true, rejectWithdrawal: true }), trusted);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.issues[0]?.code, "needs-owner-redirection");
  assert.match(plan.issues[0]!.detail, /only claim owner/);
});

test("execution persists pending hash before wait and replay skips completed actions", async () => {
  const action = { id: `recognize:${epochId.toLowerCase()}:1`, kind: "recognize" as const, epochId, allocationId: "1", expectedAllocation: allocation, transaction: { to: treasury, data: iface.encodeFunctionData("recognizeFromReceipt", [{ blockHeight: 1, transactionIndex: 0 }, encodedNative, 0]) as Hex, value: "0" as const } };
  const planId = hash("7");
  const plan: SettlementPlanV1 = { version: "proofkey.work-treasury.settlement-plan.v1", planId, executionDigest: settlementActionDigest(planId, [action]), sourceSnapshot: packet().source.finalized, targetSnapshot: packet().target.finalized, actions: [action], issues: [], alreadyComplete: [] };
  const order: string[] = []; let sends = 0;
  const execution = {
    async send() { sends++; order.push("send"); return { hash: hash("8") }; },
    async receipt() { return null; },
    async wait() { order.push("wait"); return { status: 1, blockNumber: 40 } as any; },
    async verify() { order.push("verify"); },
  };
  const journal = await executeSettlementPlan({ plan, trustedTreasury: treasury, trustedCoordinator: coordinator, adapter: execution, persist: async value => { order.push(`persist:${value.entries[action.id]?.state}`); } });
  assert.deepEqual(order, ["send", "persist:pending", "wait", "verify", "persist:complete"]);
  execution.receipt = async () => ({ status: 1, blockNumber: 40 } as any);
  await executeSettlementPlan({ plan, trustedTreasury: treasury, trustedCoordinator: coordinator, journal, adapter: execution, persist: async () => {} });
  assert.equal(sends, 1);
});

test("resumes a pending transaction without resubmitting", async () => {
  const action = { id: `withdraw:${epochId.toLowerCase()}:1`, kind: "withdraw" as const, epochId, allocationId: "1", expectedAllocation: allocation, transaction: { to: treasury, data: iface.encodeFunctionData("withdrawFor", [epochId, 1]) as Hex, value: "0" as const } };
  const planId = hash("7");
  const plan: SettlementPlanV1 = { version: "proofkey.work-treasury.settlement-plan.v1", planId, executionDigest: settlementActionDigest(planId, [action]), sourceSnapshot: packet().source.finalized, targetSnapshot: packet().target.finalized, actions: [action], issues: [], alreadyComplete: [] };
  let sent = false;
  const journal = await executeSettlementPlan({ plan, trustedTreasury: treasury, trustedCoordinator: coordinator, journal: { version: "proofkey.work-treasury.settlement-journal.v1", planId: plan.planId, entries: { [action.id]: { state: "pending", transactionHash: hash("8") } } }, adapter: {
    async send() { sent = true; return { hash: hash("9") }; }, async receipt() { return { status: 1, blockNumber: 41 } as any; }, async wait() { throw new Error("unexpected wait"); }, async verify() {},
  }, persist: async () => {} });
  assert.equal(sent, false); assert.equal(journal.entries[action.id]?.state, "complete");
});

test("executor refuses an edited destination before sending", async () => {
  const action = { id: `withdraw:${epochId.toLowerCase()}:1`, kind: "withdraw" as const, epochId, allocationId: "1", expectedAllocation: allocation, transaction: { to: address("f"), data: iface.encodeFunctionData("withdrawFor", [epochId, 1]) as Hex, value: "0" as const } };
  const planId = hash("7");
  const plan: SettlementPlanV1 = { version: "proofkey.work-treasury.settlement-plan.v1", planId, executionDigest: settlementActionDigest(planId, [action]), sourceSnapshot: packet().source.finalized, targetSnapshot: packet().target.finalized, actions: [action], issues: [], alreadyComplete: [] };
  let sent = false;
  await assert.rejects(executeSettlementPlan({ plan, trustedTreasury: treasury, trustedCoordinator: coordinator, adapter: { async send() { sent = true; return { hash: hash("8") }; }, async receipt() { return null; }, async wait() { return {} as any; }, async verify() {} }, persist: async () => {} }), /trusted zero-value treasury boundary/);
  assert.equal(sent, false);
});
