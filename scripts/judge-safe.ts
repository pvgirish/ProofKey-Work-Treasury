import {
  AbiCoder,
  Interface,
  concat,
  getAddress,
  id,
  isHexString,
  keccak256,
  type BigNumberish,
} from "ethers";

const SAFE_ABI = [
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
] as const;

const safeInterface = new Interface(SAFE_ABI);
const abi = AbiCoder.defaultAbiCoder();
const domainTypeHash = id("EIP712Domain(uint256 chainId,address verifyingContract)");
const safeTxTypeHash = id(
  "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)",
);

const successTopic = safeInterface.getEvent("ExecutionSuccess")!.topicHash;
const failureTopic = safeInterface.getEvent("ExecutionFailure")!.topicHash;

export type SafeEvidenceLog = {
  address: string;
  topics: readonly string[];
  data: string;
};

export type SafeCallVerificationInput = {
  transaction: { to: string | null; data: string };
  receipt: { status: number | null; logs: readonly SafeEvidenceLog[] };
  safe: string;
  coordinator: string;
  chainId: BigNumberish;
  nonce: BigNumberish;
  expectedSafeTxHash: string;
};

export type SafeCallVerification = {
  verified: true;
  safe: string;
  outerTransactionTo: string;
  outerCalldataHash: string;
  coordinator: string;
  to: string;
  value: string;
  data: string;
  dataHash: string;
  operation: 0;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: string;
  safeTxHash: string;
  executionSuccessOrdinal: number;
  gasReimbursement: string;
  claims: {
    currentSafeOwnershipVerified: false;
    participantIndependenceVerified: false;
    workQualityVerified: false;
    coordinatorEconomicEffectVerified: false;
  };
  runtimeAssumption: string;
};

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equalHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** Recompute Safe 1.4.1's EIP-712 transaction digest from the complete execution preimage. */
function safeTransactionHash(args: {
  safe: string;
  chainId: BigNumberish;
  nonce: BigNumberish;
  to: string;
  value: BigNumberish;
  data: string;
  operation: BigNumberish;
  safeTxGas: BigNumberish;
  baseGas: BigNumberish;
  gasPrice: BigNumberish;
  gasToken: string;
  refundReceiver: string;
}): string {
  const domainSeparator = keccak256(abi.encode(
    ["bytes32", "uint256", "address"],
    [domainTypeHash, args.chainId, args.safe],
  ));
  const structHash = keccak256(abi.encode(
    [
      "bytes32", "address", "uint256", "bytes32", "uint8", "uint256",
      "uint256", "uint256", "address", "address", "uint256",
    ],
    [
      safeTxTypeHash,
      args.to,
      args.value,
      keccak256(args.data),
      args.operation,
      args.safeTxGas,
      args.baseGas,
      args.gasPrice,
      args.gasToken,
      args.refundReceiver,
      args.nonce,
    ],
  ));
  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

/**
 * Verify read-only provenance for one canonical Safe CALL to the pinned coordinator.
 * Coordinator events and their financial meaning must be checked separately from the same receipt.
 */
export function verifySafeCall(input: SafeCallVerificationInput): SafeCallVerification {
  requireThat(input.receipt.status === 1, "Safe outer transaction did not succeed");
  const safe = getAddress(input.safe);
  const coordinator = getAddress(input.coordinator);
  requireThat(input.transaction.to !== null, "Safe outer transaction has no destination");
  requireThat(getAddress(input.transaction.to) === safe, "Outer transaction is not addressed to the pinned Safe");
  requireThat(isHexString(input.expectedSafeTxHash, 32), "Expected Safe transaction hash is not bytes32");

  const parsed = safeInterface.parseTransaction({ data: input.transaction.data });
  requireThat(parsed?.name === "execTransaction", "Outer calldata is not Safe execTransaction");
  const {
    to,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    signatures,
  } = parsed.args;
  const exactCalldata = safeInterface.encodeFunctionData("execTransaction", [
    to,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    signatures,
  ]);
  requireThat(equalHex(exactCalldata, input.transaction.data), "Safe execTransaction calldata is not canonical ABI encoding");
  requireThat(operation === 0n, "Safe operation is not a direct CALL");
  requireThat(getAddress(to) === coordinator, "Safe inner call is not addressed to the pinned coordinator");

  const nonce = BigInt(input.nonce);
  requireThat(nonce >= 0n, "Safe nonce must be non-negative");
  const chainId = BigInt(input.chainId);
  requireThat(chainId > 0n, "Safe chain ID must be positive");
  const recomputedHash = safeTransactionHash({
    safe,
    chainId,
    nonce,
    to,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
  });
  requireThat(equalHex(recomputedHash, input.expectedSafeTxHash), "Safe transaction preimage does not match the expected hash");

  const successes: Array<{ ordinal: number; txHash: string; payment: bigint }> = [];
  const failures: Array<{ ordinal: number; txHash: string }> = [];
  input.receipt.logs.forEach((log, ordinal) => {
    if (getAddress(log.address) !== safe) return;
    const topic = log.topics[0];
    if (!topic || (!equalHex(topic, successTopic) && !equalHex(topic, failureTopic))) return;
    requireThat(log.topics.length === 2 && isHexString(log.data, 32), "Safe terminal event has an invalid ABI shape");
    const event = safeInterface.parseLog({ topics: log.topics, data: log.data });
    requireThat(event !== null, "Safe terminal event could not be decoded");
    if (event.name === "ExecutionSuccess") {
      successes.push({ ordinal, txHash: String(event.args.txHash), payment: BigInt(event.args.payment) });
    } else {
      failures.push({ ordinal, txHash: String(event.args.txHash) });
    }
  });
  requireThat(failures.length === 0, "Safe receipt contains ExecutionFailure");
  requireThat(successes.length === 1, "Safe receipt must contain exactly one terminal ExecutionSuccess");
  const success = successes[0]!;
  requireThat(equalHex(success.txHash, recomputedHash), "ExecutionSuccess does not match the recomputed Safe transaction hash");

  return {
    verified: true,
    safe,
    outerTransactionTo: safe,
    outerCalldataHash: keccak256(input.transaction.data),
    coordinator,
    to: getAddress(to),
    value: value.toString(),
    data: String(data),
    dataHash: keccak256(data),
    operation: 0,
    safeTxGas: safeTxGas.toString(),
    baseGas: baseGas.toString(),
    gasPrice: gasPrice.toString(),
    gasToken: getAddress(gasToken),
    refundReceiver: getAddress(refundReceiver),
    nonce: nonce.toString(),
    safeTxHash: recomputedHash,
    executionSuccessOrdinal: success.ordinal,
    gasReimbursement: success.payment.toString(),
    claims: {
      currentSafeOwnershipVerified: false,
      participantIndependenceVerified: false,
      workQualityVerified: false,
      coordinatorEconomicEffectVerified: false,
    },
    runtimeAssumption: "The caller must independently anchor the Safe proxy and singleton runtime/state to the intended implementation. This pure receipt check does not read current ownership or implementation state.",
  };
}

export { SAFE_ABI as JUDGE_SAFE_ABI };
