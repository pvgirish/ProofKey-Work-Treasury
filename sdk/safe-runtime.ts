import { getAddress, isHexString, keccak256, type Provider } from "ethers";
import type { Address, Hex } from "./types.ts";

/** Runtime hashes from vendor/safe/PROVENANCE.json, Safe release 1.4.1. */
export const SAFE_141_RUNTIME_PINS = Object.freeze({
  proxy: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  singleton: "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
});

export interface SafeRuntimeSnapshotV1 {
  verified: true;
  version: "safe-1.4.1";
  chainId: string;
  safe: Address;
  blockNumber: number;
  blockHash: Hex;
  proxyRuntimeHash: Hex;
  singleton: Address;
  singletonRuntimeHash: Hex;
  semantics: "historical-end-of-block-rpc-observation";
  consensusProof: false;
  intraBlockExecutionTrace: false;
  currentOwnersVerified: false;
}

/**
 * Browser-safe historical implementation check. A Safe-shaped success event alone does not
 * establish that the emitter uses Safe code. This binds the proxy and slot-zero singleton
 * to the canonical 1.4.1 runtimes at a named finalized block. It remains an RPC observation
 * at block end, not a trace of execution-time code/owners or a consensus proof.
 */
export async function verifySafeRuntimeAtBlock(options: {
  provider: Provider;
  safe: Address;
  blockNumber: number;
  blockHash: Hex;
  chainId: string;
}): Promise<SafeRuntimeSnapshotV1> {
  const { provider, blockNumber, blockHash, chainId } = options;
  const safe = getAddress(options.safe) as Address;
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0 || !isHexString(blockHash, 32)
    || !/^[1-9][0-9]*$/.test(chainId)) throw new Error("Invalid historical Safe snapshot locator");
  const chainProvider = provider as Provider & { send?: (method: string, params: unknown[]) => Promise<unknown> };
  const readChain = async () => typeof chainProvider.send === "function"
    ? BigInt(await chainProvider.send("eth_chainId", []) as string)
    : (await provider.getNetwork()).chainId;
  const [chain, block, finalized, proxyCode, singletonWord] = await Promise.all([
    readChain(), provider.getBlock(blockNumber), provider.getBlock("finalized"),
    provider.getCode(safe, blockNumber), provider.getStorage(safe, 0, blockNumber),
  ]);
  if (chain.toString() !== chainId) throw new Error("Historical Safe RPC chain differs from trusted domain");
  if (block?.number !== blockNumber || block.hash?.toLowerCase() !== blockHash.toLowerCase()) throw new Error("Historical Safe block hash mismatch");
  if (!finalized?.hash || finalized.number < blockNumber) throw new Error("Historical Safe block is outside the finalized prefix");
  if (keccak256(proxyCode).toLowerCase() !== SAFE_141_RUNTIME_PINS.proxy) throw new Error("Historical Safe proxy runtime is not canonical Safe 1.4.1");
  if (!isHexString(singletonWord, 32) || !/^0{24}$/i.test(singletonWord.slice(2, 26))) throw new Error("Historical Safe singleton slot is not a canonical address word");
  const singleton = getAddress(`0x${singletonWord.slice(26)}`) as Address;
  if (/^0x0{40}$/i.test(singleton)) throw new Error("Historical Safe singleton is zero");
  const singletonCode = await provider.getCode(singleton, blockNumber);
  if (keccak256(singletonCode).toLowerCase() !== SAFE_141_RUNTIME_PINS.singleton) throw new Error("Historical Safe singleton runtime is not canonical Safe 1.4.1");
  const [after, finalizedAfter, chainAfter] = await Promise.all([
    provider.getBlock(blockNumber), provider.getBlock("finalized"), readChain(),
  ]);
  if (after?.hash?.toLowerCase() !== blockHash.toLowerCase() || !finalizedAfter?.hash
    || finalizedAfter.number < blockNumber || chainAfter.toString() !== chainId) {
    throw new Error("Historical Safe chain or finalized snapshot changed during verification");
  }
  return {
    verified: true, version: "safe-1.4.1", chainId, safe, blockNumber, blockHash,
    proxyRuntimeHash: keccak256(proxyCode) as Hex, singleton,
    singletonRuntimeHash: keccak256(singletonCode) as Hex,
    semantics: "historical-end-of-block-rpc-observation", consensusProof: false,
    intraBlockExecutionTrace: false, currentOwnersVerified: false,
  };
}
