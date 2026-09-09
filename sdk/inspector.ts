import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { hashAllocation, normalizeAllocation, rebuildAllocations } from "./allocation.ts";
import type { Address, AllocationV1, Hex } from "./types.ts";

export interface InspectorEpochState {
  blockNumber: number;
  finality: "rpc-finalized" | "confirmation-depth";
  leafCount: number;
  root: Hex;
  available: bigint;
  unresolved: bigint;
  earned: bigint;
  returned: bigint;
  phase: number;
}

export interface InspectorResult {
  state: InspectorEpochState;
  allocations: AllocationV1[];
  rebuiltRoot: Hex;
  rootMatches: boolean;
  leafGetterMatches: boolean;
}

function namedOrIndex(result: any, name: string, index: number): any {
  return result?.[name] ?? result?.[index];
}

function toAllocation(value: any): AllocationV1 {
  return normalizeAllocation({
    epochId: namedOrIndex(value, "epochId", 0),
    allocationId: BigInt(namedOrIndex(value, "allocationId", 1)),
    treeIndex: Number(namedOrIndex(value, "treeIndex", 2)),
    kind: Number(namedOrIndex(value, "kind", 3)),
    orderId: namedOrIndex(value, "orderId", 4),
    milestoneId: Number(namedOrIndex(value, "milestoneId", 5)),
    role: Number(namedOrIndex(value, "role", 6)),
    asset: getAddress(namedOrIndex(value, "asset", 7)) as Address,
    amount: BigInt(namedOrIndex(value, "amount", 8)),
    claimOwner: getAddress(namedOrIndex(value, "claimOwner", 9)) as Address,
    destination: getAddress(namedOrIndex(value, "destination", 10)) as Address,
    policyHash: namedOrIndex(value, "policyHash", 11),
    evidenceHash: namedOrIndex(value, "evidenceHash", 12),
  });
}

/** Rebuilds from full public leaves at one finalized source block, independently from the contract's frontier. */
export async function inspectEpochAtFinalizedBlock(options: {
  rpcUrl: string;
  coordinator: Address;
  coordinatorAbi: readonly unknown[];
  epochId: Hex;
  confirmations?: number;
  allowConfirmationDepthFallback?: boolean;
}): Promise<InspectorResult> {
  const provider = new JsonRpcProvider(options.rpcUrl);
  try {
    let finalized = null;
    try { finalized = await provider.getBlock("finalized"); } catch {}
    if (!finalized && !options.allowConfirmationDepthFallback) throw new Error("source RPC does not expose a finalized block tag");
    const blockNumber = finalized?.number ?? Math.max(0, await provider.getBlockNumber() - Math.max(0, options.confirmations ?? 12));
    const coordinator = new Contract(options.coordinator, options.coordinatorAbi as any, provider);
    const raw = await coordinator.epochState.staticCall(options.epochId, { blockTag: blockNumber });
    const state: InspectorEpochState = {
      blockNumber,
      finality: finalized ? "rpc-finalized" : "confirmation-depth",
      leafCount: Number(namedOrIndex(raw, "leafCount", 2)),
      root: namedOrIndex(raw, "root", 3),
      available: BigInt(namedOrIndex(raw, "available", 4)),
      unresolved: BigInt(namedOrIndex(raw, "unresolved", 5)),
      earned: BigInt(namedOrIndex(raw, "earned", 6)),
      returned: BigInt(namedOrIndex(raw, "returned", 7)),
      phase: Number(namedOrIndex(raw, "phase", 8)),
    };
    if (state.leafCount < 0 || state.leafCount > 128) throw new Error("source returned an impossible leafCount");
    const allocations = await Promise.all(
      Array.from({ length: state.leafCount }, (_, index) => coordinator.allocationAt.staticCall(options.epochId, index, { blockTag: blockNumber }).then(toAllocation)),
    );
    const rebuilt = rebuildAllocations(allocations);
    let leafGetterMatches = true;
    if (coordinator.interface.hasFunction("leafHashAt(bytes32,uint32)")) {
      const storedLeaves = await Promise.all(
        allocations.map((_, index) => coordinator.leafHashAt.staticCall(options.epochId, index, { blockTag: blockNumber })),
      );
      leafGetterMatches = storedLeaves.every((stored, index) => stored.toLowerCase() === hashAllocation(allocations[index]!).toLowerCase());
    }
    return {
      state,
      allocations,
      rebuiltRoot: rebuilt.root,
      rootMatches: rebuilt.root.toLowerCase() === state.root.toLowerCase(),
      leafGetterMatches,
    };
  } finally {
    provider.destroy();
  }
}
