import { BrowserProvider, Contract, Interface, JsonRpcProvider, getAddress, toBeHex } from "ethers";
import type { AbiManifest, Address, ChainConnection, Hex } from "./types.ts";

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

export interface PreparedTransaction {
  chainId: string;
  to: Address;
  value: string;
  data: Hex;
  description: string;
}

export interface SafeTransactionFile {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: { name: string; description: string; txBuilderVersion: "1.18.0"; createdFromSafeAddress: Address };
  transactions: Array<{ to: Address; value: string; data: Hex; contractMethod: null; contractInputsValues: null }>;
}

export function getInjectedProvider(): Eip1193Provider | undefined {
  return (globalThis as typeof globalThis & { ethereum?: Eip1193Provider }).ethereum;
}

export async function connectInjectedWallet(expectedChainId?: bigint): Promise<{ provider: BrowserProvider; account: Address; chainId: bigint }> {
  const injected = getInjectedProvider();
  if (!injected) throw new Error("No browser wallet was found");
  const provider = new BrowserProvider(injected as any);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (expectedChainId !== undefined && network.chainId !== expectedChainId) throw new Error(`Wallet is on chain ${network.chainId}; expected ${expectedChainId}`);
  return { provider, account: getAddress(await (await provider.getSigner()).getAddress()) as Address, chainId: network.chainId };
}

export async function requestChain(provider: Eip1193Provider, chainId: bigint): Promise<void> {
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toBeHex(chainId) }] });
}

export async function verifyRpcConnection(config: ChainConnection): Promise<{ chainId: bigint; blockNumber: number }> {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
  if (network.chainId !== config.chainId) throw new Error(`${config.label} RPC reports chain ${network.chainId}; configured chain is ${config.chainId}`);
  return { chainId: network.chainId, blockNumber };
}

export function requireArtifact(manifest: AbiManifest, name: string): readonly unknown[] {
  const artifact = manifest.contracts[name];
  if (!artifact?.abi?.length) throw new Error(`Compiled ABI for ${name} is unavailable; run the UI build after compiling contracts`);
  return artifact.abi;
}

export function prepareContractTransaction(options: {
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  to: Address;
  chainId: bigint;
  value?: bigint;
  description: string;
}): PreparedTransaction {
  const contractInterface = new Interface(options.abi as any);
  if (!contractInterface.hasFunction(options.functionName)) throw new Error(`compiled contract has no ${options.functionName} function`);
  return {
    chainId: options.chainId.toString(),
    to: getAddress(options.to) as Address,
    value: (options.value ?? 0n).toString(),
    data: contractInterface.encodeFunctionData(options.functionName, [...options.args]) as Hex,
    description: options.description,
  };
}

export function toSafeTransactionFile(transaction: PreparedTransaction, safe: Address, name: string): SafeTransactionFile {
  return {
    version: "1.0",
    chainId: transaction.chainId,
    createdAt: Date.now(),
    meta: { name, description: transaction.description, txBuilderVersion: "1.18.0", createdFromSafeAddress: getAddress(safe) as Address },
    transactions: [{ to: transaction.to, value: transaction.value, data: transaction.data, contractMethod: null, contractInputsValues: null }],
  };
}

export async function sendPreparedTransaction(transaction: PreparedTransaction): Promise<Hex> {
  const connected = await connectInjectedWallet(BigInt(transaction.chainId));
  const signer = await connected.provider.getSigner();
  const sent = await signer.sendTransaction({ to: transaction.to, data: transaction.data, value: BigInt(transaction.value) });
  return sent.hash as Hex;
}

export async function readContract(options: {
  rpcUrl: string;
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  blockTag?: number;
}): Promise<unknown> {
  const contract = new Contract(options.address, options.abi as any, new JsonRpcProvider(options.rpcUrl));
  const fn = contract.getFunction(options.functionName);
  return fn.staticCall(...(options.args ?? []), ...(options.blockTag === undefined ? [] : [{ blockTag: options.blockTag }]));
}
