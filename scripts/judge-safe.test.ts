import assert from "node:assert/strict";
import test from "node:test";
import { Interface, TypedDataEncoder, ZeroAddress, getAddress } from "ethers";
import { JUDGE_SAFE_ABI, verifySafeCall, type SafeEvidenceLog } from "./judge-safe.ts";

const safeInterface = new Interface(JUDGE_SAFE_ABI);
const safe = getAddress("0x1000000000000000000000000000000000000001");
const coordinator = getAddress("0x2000000000000000000000000000000000000002");
const other = getAddress("0x3000000000000000000000000000000000000003");
const chainId = 11_155_111n;
const nonce = 17n;
const coordinatorData = "0x12345678aabbccdd";

const fields = {
  to: coordinator,
  value: 0n,
  data: coordinatorData,
  operation: 0,
  safeTxGas: 91_000n,
  baseGas: 4_200n,
  gasPrice: 3n,
  gasToken: ZeroAddress,
  refundReceiver: other,
};

const types = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

function digest(overrides: Partial<typeof fields & { nonce: bigint }> = {}): string {
  const value = { ...fields, nonce, ...overrides };
  return TypedDataEncoder.hash({ chainId, verifyingContract: safe }, types, value);
}

function terminalLog(name: "ExecutionSuccess" | "ExecutionFailure", txHash: string, payment = 12n): SafeEvidenceLog {
  const encoded = safeInterface.encodeEventLog(safeInterface.getEvent(name)!, [txHash, payment]);
  return { address: safe, topics: encoded.topics, data: encoded.data };
}

function calldata(overrides: Partial<typeof fields> = {}): string {
  const call = { ...fields, ...overrides };
  return safeInterface.encodeFunctionData("execTransaction", [
    call.to,
    call.value,
    call.data,
    call.operation,
    call.safeTxGas,
    call.baseGas,
    call.gasPrice,
    call.gasToken,
    call.refundReceiver,
    "0x1122",
  ]);
}

function fixture(overrides: {
  transactionTo?: string;
  transactionData?: string;
  receiptStatus?: number | null;
  logs?: SafeEvidenceLog[];
  suppliedNonce?: bigint;
  expectedSafeTxHash?: string;
} = {}) {
  const expectedSafeTxHash = overrides.expectedSafeTxHash ?? digest();
  return {
    transaction: { to: overrides.transactionTo ?? safe, data: overrides.transactionData ?? calldata() },
    receipt: { status: overrides.receiptStatus === undefined ? 1 : overrides.receiptStatus, logs: overrides.logs ?? [terminalLog("ExecutionSuccess", expectedSafeTxHash)] },
    safe,
    coordinator,
    chainId,
    nonce: overrides.suppliedNonce ?? nonce,
    expectedSafeTxHash,
  };
}

test("verifies one canonical Safe CALL and reports only bounded provenance", () => {
  const result = verifySafeCall(fixture({
    logs: [
      { address: coordinator, topics: ["0x" + "44".repeat(32)], data: "0x" },
      terminalLog("ExecutionSuccess", digest(), 77n),
    ],
  }));
  assert.equal(result.safeTxHash, digest());
  assert.equal(result.to, coordinator);
  assert.equal(result.nonce, "17");
  assert.equal(result.executionSuccessOrdinal, 1);
  assert.equal(result.gasReimbursement, "77");
  assert.equal(result.claims.currentSafeOwnershipVerified, false);
  assert.equal(result.claims.participantIndependenceVerified, false);
  assert.equal(result.claims.workQualityVerified, false);
  assert.equal(result.claims.coordinatorEconomicEffectVerified, false);
});

test("rejects a matching-looking Safe event emitted through a delegatecall execution", () => {
  const fakeHash = digest({ operation: 1 });
  assert.throws(
    () => verifySafeCall(fixture({
      transactionData: calldata({ operation: 1 }),
      expectedSafeTxHash: fakeHash,
      logs: [terminalLog("ExecutionSuccess", fakeHash)],
    })),
    /not a direct CALL/,
  );
});

test("rejects a mined outer transaction whose Safe inner call failed", () => {
  assert.throws(
    () => verifySafeCall(fixture({ logs: [terminalLog("ExecutionFailure", digest())] })),
    /contains ExecutionFailure/,
  );
});

test("rejects coordinator calldata that does not match the committed Safe preimage", () => {
  assert.throws(
    () => verifySafeCall(fixture({ transactionData: calldata({ data: "0x12345678deadbeef" }) })),
    /preimage does not match/,
  );
});

test("rejects a supplied nonce that differs from the committed Safe nonce", () => {
  assert.throws(
    () => verifySafeCall(fixture({ suppliedNonce: nonce + 1n })),
    /preimage does not match/,
  );
});

test("rejects an outer transaction addressed somewhere other than the pinned Safe", () => {
  assert.throws(
    () => verifySafeCall(fixture({ transactionTo: other })),
    /not addressed to the pinned Safe/,
  );
});

test("rejects duplicate Safe success logs even when one matches the committed hash", () => {
  assert.throws(
    () => verifySafeCall(fixture({
      logs: [terminalLog("ExecutionSuccess", digest()), terminalLog("ExecutionSuccess", digest())],
    })),
    /exactly one terminal ExecutionSuccess/,
  );
});
