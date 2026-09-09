import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getAddress,
  isHexString,
  keccak256,
  type Provider,
} from "ethers";

const VENDOR = resolve(import.meta.dirname, "../vendor/safe");

type HardhatArtifact = {
  contractName?: string;
  sourceName?: string;
  deployedBytecode?: string;
};

export type SafeRuntimeVerification = {
  verified: true;
  chainId: string;
  blockNumber: number;
  blockHash: string;
  safe: string;
  proxy: {
    runtimeBytes: number;
    runtimeHash: string;
    artifactSha256: string;
    matchesVendoredSafeProxy: true;
  };
  singletonStorage: {
    slot: 0;
    word: string;
    upperTwelveBytesZero: true;
    singleton: string;
  };
  singleton: {
    runtimeBytes: number;
    runtimeHash: string;
    artifactSha256: string;
    matchesVendoredSafe: true;
  };
  snapshot: {
    semantics: "end-of-block";
    archiveReadRequired: true;
    consensusProof: false;
    intraBlockExecutionTrace: false;
    description: string;
  };
};

function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function artifact(name: "Safe" | "SafeProxy"): Promise<{
  raw: Uint8Array;
  deployedBytecode: string;
}> {
  const raw = await readFile(resolve(VENDOR, `${name}.json`));
  const parsed = JSON.parse(raw.toString("utf8")) as HardhatArtifact;
  requireThat(parsed.contractName === name, `Vendored ${name} artifact has the wrong contract name`);
  requireThat(
    typeof parsed.deployedBytecode === "string"
      && isHexString(parsed.deployedBytecode)
      && parsed.deployedBytecode.length > 2,
    `Vendored ${name} artifact has no deployed bytecode`,
  );
  return { raw, deployedBytecode: parsed.deployedBytecode };
}

/**
 * Verify the Safe proxy and singleton visible at the end of one historical block.
 * The provider supplies the block and state observations; this is not a consensus proof or an
 * intra-block trace of the state at the instant a transaction executed.
 */
export async function verifySafeRuntime(
  provider: Provider,
  safeAddress: string,
  blockNumber: number,
): Promise<SafeRuntimeVerification> {
  requireThat(
    Number.isSafeInteger(blockNumber) && blockNumber >= 0,
    "Safe runtime block number must be a non-negative safe integer",
  );
  const safe = getAddress(safeAddress);
  const [safeArtifact, proxyArtifact] = await Promise.all([
    artifact("Safe"),
    artifact("SafeProxy"),
  ]);

  let block;
  let proxyCode;
  let singletonWord;
  try {
    [block, proxyCode, singletonWord] = await Promise.all([
      provider.getBlock(blockNumber),
      provider.getCode(safe, blockNumber),
      provider.getStorage(safe, 0, blockNumber),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Historical Safe block-end snapshot is unavailable at block ${blockNumber}: ${reason}`);
  }
  requireThat(block?.hash, `Historical Safe block ${blockNumber} is unavailable`);
  requireThat(
    proxyCode.toLowerCase() === proxyArtifact.deployedBytecode.toLowerCase(),
    "Historical Safe proxy runtime differs from the vendored SafeProxy artifact",
  );
  requireThat(isHexString(singletonWord, 32), "Historical Safe singleton slot is not one storage word");
  const word = singletonWord.slice(2);
  requireThat(/^0{24}$/i.test(word.slice(0, 24)), "Historical Safe singleton slot has nonzero upper bytes");
  const singletonRaw = word.slice(24);
  requireThat(!/^0{40}$/i.test(singletonRaw), "Historical Safe singleton is zero");
  const singleton = getAddress(`0x${singletonRaw}`);

  let singletonCode;
  let network;
  let blockReread;
  try {
    [singletonCode, network, blockReread] = await Promise.all([
      provider.getCode(singleton, blockNumber),
      provider.getNetwork(),
      provider.getBlock(blockNumber),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Historical Safe singleton snapshot is unavailable at block ${blockNumber}: ${reason}`);
  }
  requireThat(
    singletonCode.toLowerCase() === safeArtifact.deployedBytecode.toLowerCase(),
    "Historical Safe singleton runtime differs from the vendored Safe artifact",
  );
  requireThat(
    blockReread?.hash && blockReread.hash.toLowerCase() === block.hash.toLowerCase(),
    "Historical Safe block changed during verification",
  );

  return {
    verified: true,
    chainId: network.chainId.toString(),
    blockNumber,
    blockHash: block.hash,
    safe,
    proxy: {
      runtimeBytes: (proxyCode.length - 2) / 2,
      runtimeHash: keccak256(proxyCode),
      artifactSha256: sha256(proxyArtifact.raw),
      matchesVendoredSafeProxy: true,
    },
    singletonStorage: {
      slot: 0,
      word: singletonWord,
      upperTwelveBytesZero: true,
      singleton,
    },
    singleton: {
      runtimeBytes: (singletonCode.length - 2) / 2,
      runtimeHash: keccak256(singletonCode),
      artifactSha256: sha256(safeArtifact.raw),
      matchesVendoredSafe: true,
    },
    snapshot: {
      semantics: "end-of-block",
      archiveReadRequired: true,
      consensusProof: false,
      intraBlockExecutionTrace: false,
      description: "Historical eth_getCode and eth_getStorageAt observations at the end of the named block, supplied by the selected RPC.",
    },
  };
}
