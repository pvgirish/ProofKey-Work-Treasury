import {
  Contract,
  Interface,
  Signature,
  Wallet,
  concat,
  getAddress,
  type JsonRpcProvider,
  type Signer,
  type TransactionReceipt,
} from "ethers";

const SAFE_ABI = [
  "function getOwners() view returns(address[])",
  "function getThreshold() view returns(uint256)",
  "function nonce() view returns(uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns(bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns(bool)",
  "event ExecutionSuccess(bytes32 indexed txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash,uint256 payment)",
];

const ZERO = "0x0000000000000000000000000000000000000000";
const safeInterface = new Interface(SAFE_ABI);

export type SafeOwnerKey = {
  environmentName: string;
  address: string;
  wallet: Wallet;
};

export type SafeExecutionRecord = {
  outerTransactionHash: string;
  safeTransactionHash: string;
  blockNumber: number;
  gasUsed: string;
  nonce: string;
  threshold: number;
  signingOwners: string[];
  executionSuccessOrdinal: number;
  logs: Array<{ ordinal: number; emitter: string; topics: readonly string[]; data: string }>;
};

export type SafeSubmission = Pick<SafeExecutionRecord,
  "outerTransactionHash" | "safeTransactionHash" | "nonce" | "threshold" | "signingOwners"
>;

/** A conclusive mined failure. Other recovery errors are uncertain and must retain the journal. */
export class MinedSafeExecutionFailure extends Error {
  readonly kind: "outer-status-zero" | "inner-execution-failure";
  readonly receipt: TransactionReceipt;

  constructor(
    message: string,
    kind: "outer-status-zero" | "inner-execution-failure",
    receipt: TransactionReceipt,
  ) {
    super(message);
    this.name = "MinedSafeExecutionFailure";
    this.kind = kind;
    this.receipt = receipt;
  }
}

function executionRecordFromReceipt(
  safeAddress: string,
  submission: SafeSubmission,
  receipt: TransactionReceipt,
): SafeExecutionRecord {
  if (receipt.status === 0) {
    throw new MinedSafeExecutionFailure(
      `Safe outer transaction failed: ${submission.outerTransactionHash}`,
      "outer-status-zero",
      receipt,
    );
  }
  if (receipt.status !== 1) throw new Error(`Safe receipt has uncertain status: ${submission.outerTransactionHash}`);
  const successOrdinal = receipt.logs.findIndex((log) =>
    log.address.toLowerCase() === safeAddress.toLowerCase() && (() => {
      try {
        const parsed = safeInterface.parseLog(log);
        return parsed?.name === "ExecutionSuccess"
          && String(parsed.args.txHash).toLowerCase() === submission.safeTransactionHash.toLowerCase();
      } catch { return false; }
    })()
  );
  if (successOrdinal < 0) {
    const failureOrdinal = receipt.logs.findIndex((log) =>
      log.address.toLowerCase() === safeAddress.toLowerCase() && (() => {
        try {
          const parsed = safeInterface.parseLog(log);
          return parsed?.name === "ExecutionFailure"
            && String(parsed.args.txHash).toLowerCase() === submission.safeTransactionHash.toLowerCase();
        } catch { return false; }
      })()
    );
    if (failureOrdinal >= 0) {
      throw new MinedSafeExecutionFailure(
        `Safe inner transaction failed: ${submission.outerTransactionHash}`,
        "inner-execution-failure",
        receipt,
      );
    }
    throw new Error(`Safe transaction ${submission.outerTransactionHash} mined without matching ExecutionSuccess`);
  }
  return {
    ...submission,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    executionSuccessOrdinal: successOrdinal,
    logs: receipt.logs.map((log, ordinal) => ({
      ordinal,
      emitter: getAddress(log.address),
      topics: log.topics,
      data: log.data,
    })),
  };
}

/** Recover and validate a previously journaled Safe submission. Null means it is still pending. */
export async function recoverSafeExecution(
  provider: JsonRpcProvider,
  safe: string,
  submission: SafeSubmission,
): Promise<SafeExecutionRecord | null> {
  const receipt = await provider.getTransactionReceipt(submission.outerTransactionHash);
  return receipt ? executionRecordFromReceipt(getAddress(safe), submission, receipt) : null;
}

/** Load only explicitly named Safe owner variables already present in process.env. */
export function safeOwnerKeys(provider?: JsonRpcProvider): SafeOwnerKey[] {
  return Object.keys(process.env)
    .filter((name) => /^SAFE_OWNER_[A-Z0-9]+_PRIVATE_KEY$/.test(name) && process.env[name])
    .sort()
    .map((environmentName) => {
      const wallet = new Wallet(process.env[environmentName]!, provider);
      return { environmentName, address: getAddress(wallet.address), wallet };
    });
}

export async function matchedSafeOwnerKeys(
  safeAddress: string,
  provider: JsonRpcProvider,
): Promise<{ owners: string[]; threshold: number; matched: SafeOwnerKey[] }> {
  const safe = new Contract(safeAddress, SAFE_ABI, provider);
  const [rawOwners, rawThreshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
  const owners = Array.from(rawOwners, (owner) => getAddress(String(owner)));
  const ownerSet = new Set(owners.map((owner) => owner.toLowerCase()));
  const matched = safeOwnerKeys(provider).filter((entry) => ownerSet.has(entry.address.toLowerCase()));
  const threshold = Number(rawThreshold);
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error("Safe returned an invalid owner threshold");
  }
  if (matched.length < threshold) {
    throw new Error(`Only ${matched.length} configured Safe owner keys match ${threshold} required owners`);
  }
  return { owners, threshold, matched };
}

/**
 * Execute one ordinary Safe CALL with the current owner set. The Safe itself supplies the EIP-712
 * transaction digest; signatures are sorted by owner address as required by Safe.
 */
export async function executeSafeCall(args: {
  provider: JsonRpcProvider;
  safe: string;
  to: string;
  data: string;
  relayer: Signer;
  value?: bigint;
  /** Optional exact current owner subset; useful when demonstrating a specific rotation path. */
  ownerAddresses?: string[];
  onSubmitted?: (submission: SafeSubmission) => Promise<void>;
}): Promise<SafeExecutionRecord> {
  const safeAddress = getAddress(args.safe);
  const target = getAddress(args.to);
  const value = args.value ?? 0n;
  const { threshold, matched } = await matchedSafeOwnerKeys(safeAddress, args.provider);
  const requested = args.ownerAddresses?.map((address) => getAddress(address).toLowerCase());
  if (requested && (requested.length !== threshold || new Set(requested).size !== threshold)) {
    throw new Error(`Safe call requires exactly ${threshold} distinct requested owners`);
  }
  const selected = (requested
    ? requested.map((address) => {
      const match = matched.find((entry) => entry.address.toLowerCase() === address);
      if (!match) throw new Error(`Requested Safe owner is not current or has no configured key: ${address}`);
      return match;
    })
    : [...matched].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase())).slice(0, threshold))
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  const readSafe = new Contract(safeAddress, SAFE_ABI, args.provider);
  const nonce: bigint = await readSafe.nonce();
  const safeTransactionHash: string = await readSafe.getTransactionHash(
    target,
    value,
    args.data,
    0,
    0,
    0,
    0,
    ZERO,
    ZERO,
    nonce,
  );
  const signatures = concat(selected.map(({ wallet }) =>
    Signature.from(wallet.signingKey.sign(safeTransactionHash)).serialized
  ));
  const writeSafe = new Contract(safeAddress, SAFE_ABI, args.relayer);
  const callArgs = [target, value, args.data, 0, 0, 0, 0, ZERO, ZERO, signatures] as const;
  const simulation = await writeSafe.execTransaction.staticCall(...callArgs, { value });
  if (simulation !== true) throw new Error("Safe simulation reported an inner-call failure");
  const gas = await writeSafe.execTransaction.estimateGas(...callArgs, { value });
  const transaction = await writeSafe.execTransaction(...callArgs, { value, gasLimit: gas * 12n / 10n });
  const submission: SafeSubmission = {
    outerTransactionHash: transaction.hash,
    safeTransactionHash,
    nonce: nonce.toString(),
    threshold,
    signingOwners: selected.map(({ address }) => address),
  };
  await args.onSubmitted?.(submission);
  const receipt: TransactionReceipt | null = await transaction.wait();
  if (!receipt) throw new Error(`Missing Safe transaction receipt: ${transaction.hash}`);
  return executionRecordFromReceipt(safeAddress, submission, receipt);
}

export { SAFE_ABI, safeInterface };
