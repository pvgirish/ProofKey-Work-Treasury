import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, getAddress, keccak256 } from "ethers";
import { rebuildAllocations, serializeAllocation, hashAllocation } from "./allocation.ts";
import { PROGRAM_CLOSEOUT_VERSION, verifyProgramCloseout, type CloseoutReceipt, type ProgramCloseoutV1, type TrustedCloseoutDeployment } from "./program-closeout.ts";
import { AllocationKind, AllocationRole, EpochPhase, type Address, type AllocationV1, type Hex } from "./types.ts";

const address = (byte: string) => getAddress(`0x${byte.repeat(40)}`) as Address;
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex;
const epochId = hash("a"), orderId = hash("b"), treasury = address("1"), coordinator = address("2"), worker = address("3"), refund = address("4");
const abi = AbiCoder.defaultAbiCoder();
const target = new Interface([
  "function withdrawFor(bytes32,uint64)",
  "event AllocationRecognized(bytes32 indexed epochId,uint64 indexed allocationId,bytes32 indexed economicId,uint8 kind,uint256 amount,address claimOwner,address destination,bytes32 leafHash)",
  "event ClaimWithdrawn(bytes32 indexed epochId,uint64 indexed allocationId,uint8 kind,address indexed claimOwner,address destination,uint256 amount)",
]);
const trusted: TrustedCloseoutDeployment = { sourceChainId: "111", sourceCoordinator: coordinator, sourceRuntimeHash: hash("1"), targetChainId: "222", targetTreasury: treasury, targetRuntimeHash: hash("2"), sourceChainKey: "7" };

function allocation(index: number, kind: number, value: bigint): AllocationV1 {
  return {
    epochId, allocationId: BigInt(index + 1), treeIndex: index, kind, orderId: kind === AllocationKind.RETURN ? hash("0") : orderId,
    milestoneId: kind === AllocationKind.RETURN ? 0 : index, role: kind === AllocationKind.WORK ? AllocationRole.WORKER : kind === AllocationKind.FEE ? AllocationRole.FEE : AllocationRole.EPOCH,
    asset: address("0"), amount: value, claimOwner: kind === AllocationKind.RETURN ? refund : worker,
    destination: kind === AllocationKind.RETURN ? refund : worker, policyHash: hash("9"), evidenceHash: hash(String(index + 5)),
  };
}
function receipt(event: "AllocationRecognized" | "ClaimWithdrawn", a: AllocationV1): CloseoutReceipt {
  const args = event === "AllocationRecognized"
    ? [a.epochId, a.allocationId, keccak256(abi.encode(["bytes32", "uint64"], [a.epochId, a.allocationId])), a.kind, a.amount, a.claimOwner, a.destination, hashAllocation(a)]
    : [a.epochId, a.allocationId, a.kind, a.claimOwner, a.destination, a.amount];
  const encoded = target.encodeEventLog(target.getEvent(event)!, args);
  return {
    transactionHash: hash(event === "AllocationRecognized" ? "c" : "d"), blockNumber: "15", blockHash: hash("e"), status: 1,
    to: treasury, from: address("8"), input: event === "ClaimWithdrawn" ? target.encodeFunctionData("withdrawFor", [a.epochId, a.allocationId]) as Hex : "0x1234",
    logs: [{ address: treasury, topics: encoded.topics as Hex[], data: encoded.data as Hex }],
  };
}
function closeout(): ProgramCloseoutV1 {
  const allocations = [allocation(0, AllocationKind.WORK, 70n), allocation(1, AllocationKind.RETURN, 30n)];
  const root = rebuildAllocations(allocations).root;
  return {
    version: PROGRAM_CLOSEOUT_VERSION,
    source: { coordinator, runtimeHash: hash("1"), snapshot: { chainId: "111", blockNumber: "20", blockHash: hash("3"), finality: "rpc-finalized" } },
    target: { treasury, runtimeHash: hash("2"), snapshot: { chainId: "222", blockNumber: "20", blockHash: hash("4"), finality: "rpc-finalized" }, sourceChainKey: "7", nativeAttestedSourceHeight: "20" },
    epochs: [{
      epochId, cap: "100", source: { available: "0", unresolved: "0", earned: "70", returned: "30", phase: EpochPhase.CLOSED, leafCount: 2, root, allocations: allocations.map(serializeAllocation) },
      target: {
        reserve: "0", recognized: "100", funded: true, refundOwnerFreeBalance: "30",
        allocations: allocations.map(a => ({
          allocation: serializeAllocation(a), recognized: true, recognizedAllocation: serializeAllocation(a), recognitionReceipt: receipt("AllocationRecognized", a),
          authentication: { authenticationId: hash("f"), blockHeight: "10", transactionIndex: String(a.treeIndex), encodedTransactionHash: hash("7"), exists: true },
          ...(a.kind === AllocationKind.RETURN ? {} : { completedClaim: { allocation: serializeAllocation(a), withdrawn: true, paidDestination: a.destination }, withdrawalReceipt: receipt("ClaimWithdrawn", a) }),
        })),
      },
    }],
  };
}

test("complete closeout proves source partition, recognition, payment and labels legacy consent", () => {
  const result = verifyProgramCloseout(closeout(), trusted);
  assert.equal(result.status, "complete", JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value));
  assert.deepEqual(result.totals, { cap: 100n, earned: 70n, returned: 30n, paid: 70n, outstanding: 0n });
  assert.deepEqual(result.consent.legacyOrders, [orderId]);
  assert.match(result.returnAccounting, /fungible freeBalance/);
});

test("rejects conservation failures, duplicate identities and omitted leaves", () => {
  const badConservation = closeout(); badConservation.epochs[0]!.source.available = "1";
  assert.match(verifyProgramCloseout(badConservation, trusted).errors.join(" "), /C=A\+U\+E\+R/);
  const duplicate = closeout(); duplicate.epochs[0]!.source.allocations[1] = duplicate.epochs[0]!.source.allocations[0]!;
  assert.match(verifyProgramCloseout(duplicate, trusted).errors.join(" "), /canonical allocation partition|duplicate/);
  const omitted = closeout(); omitted.epochs[0]!.target.allocations.pop();
  assert.match(verifyProgramCloseout(omitted, trusted).errors.join(" "), /omits|omitted/);
});

test("incomplete prefixes and unpaid claims remain explicit", () => {
  const value = closeout(); value.epochs[0]!.source.leafCount = 3;
  assert.match(verifyProgramCloseout(value, trusted).errors.join(" "), /prefix is incomplete/);
  const unpaid = closeout(); unpaid.epochs[0]!.target.allocations[0]!.completedClaim!.withdrawn = false; delete unpaid.epochs[0]!.target.allocations[0]!.withdrawalReceipt;
  const result = verifyProgramCloseout(unpaid, trusted);
  assert.equal(result.status, "incomplete"); assert.equal(result.totals.outstanding, 70n);
});

test("receipt status and missing exact logs invalidate payment evidence", () => {
  const failed = closeout(); failed.epochs[0]!.target.allocations[0]!.withdrawalReceipt!.status = 0;
  assert.match(verifyProgramCloseout(failed, trusted).errors.join(" "), /withdrawal evidence failed/);
  const missing = closeout(); missing.epochs[0]!.target.allocations[0]!.recognitionReceipt!.logs = [];
  assert.match(verifyProgramCloseout(missing, trusted).errors.join(" "), /recognition receipt\/event/);
});

test("trusted manifest mismatch is invalid", () => {
  assert.match(verifyProgramCloseout(closeout(), { ...trusted, targetRuntimeHash: hash("f") }).errors.join(" "), /trusted deployment manifest/);
});

test("empty and duplicate epoch sets cannot report a complete program", () => {
  const empty = closeout(); empty.epochs = [];
  assert.match(verifyProgramCloseout(empty, trusted).errors.join(" "), /at least one epoch/);
  const duplicate = closeout(); duplicate.epochs.push(structuredClone(duplicate.epochs[0]!));
  assert.match(verifyProgramCloseout(duplicate, trusted).errors.join(" "), /duplicate epoch/);
});
