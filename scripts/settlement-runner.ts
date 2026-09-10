import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JsonRpcProvider, Wallet, keccak256 } from "ethers";
import { parseClaimPackage } from "../sdk/claim-package.ts";
import {
  SETTLEMENT_PACKET_VERSION,
  buildSettlementPlan,
  ethersSettlementExecutionAdapter,
  ethersSettlementReadAdapter,
  executeSettlementPlan,
  type RuntimePin,
  type SettlementJournalV1,
  type SettlementPacketV1,
  type TrustedSettlementDeployment,
} from "../sdk/settlement-runner.ts";
import type { Address, Hex } from "../sdk/types.ts";
import { ROOT, loadEnvironment } from "./runtime.ts";

function values(flag: string): string[] {
  const result: string[] = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === flag && process.argv[i + 1]) result.push(process.argv[++i]!);
  return result;
}
function value(flag: string, fallback?: string): string | undefined { return values(flag)[0] ?? fallback; }
function has(flag: string): boolean { return process.argv.includes(flag); }
async function json(path: string): Promise<any> { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }
async function optionalJson(path: string): Promise<any | undefined> { try { return await json(path); } catch (error: any) { if (error.code === "ENOENT") return undefined; throw error; } }
async function atomicJson(path: string, data: unknown): Promise<void> { const temporary = `${path}.tmp`; await writeFile(temporary, `${JSON.stringify(data, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`); await rename(temporary, path); }
function recordFor(manifest: any, chain: "source" | "target", name: string): RuntimePin {
  const row = manifest.records?.find((item: any) => item.chain === chain && item.name === name);
  if (!row?.address || !row?.deployedCodeHash || row.matchesCompiledRuntimeOutsideImmutableSlots !== true) throw new Error(`deployment manifest lacks trusted ${chain} ${name} runtime correspondence`);
  return { address: row.address as Address, deployedCodeHash: row.deployedCodeHash as Hex };
}

await loadEnvironment();
const claims = values("--claim");
if (claims.length === 0) throw new Error("Supply one or more --claim <claim-package.json> files");
const manifestPath = value("--manifest", "deployments/testnet.json")!;
const planPath = resolve(ROOT, value("--plan", "evidence/replacement-settlement-plan.json")!);
const journalPath = resolve(ROOT, value("--journal", "evidence/replacement-settlement-journal.json")!);
const manifest = await json(manifestPath);
const sourceRuntime = recordFor(manifest, "source", "SourceCoordinator");
const targetRuntime = recordFor(manifest, "target", "WorkTreasury");
const source = new JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL ?? manifest.source.rpcUrl);
const target = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL ?? manifest.target.rpcUrl);
try {
  const [sourceChain, targetChain] = await Promise.all([source.send("eth_chainId", []), target.send("eth_chainId", [])]);
  if (BigInt(sourceChain) !== BigInt(manifest.source.chainId) || BigInt(targetChain) !== BigInt(manifest.target.chainId)) throw new Error("RPC chain IDs differ from the trusted deployment manifest");
  const [sourceFinalized, targetFinalized] = await Promise.all([source.getBlock("finalized"), target.getBlock("finalized")]);
  if (!sourceFinalized?.hash || !targetFinalized?.hash) throw new Error("both RPCs must expose a finalized block tag for replacement planning");
  const trusted: TrustedSettlementDeployment = {
    sourceChainId: String(manifest.source.chainId), sourceChainKey: String(manifest.source.chainKey), sourceCoordinator: sourceRuntime,
    targetChainId: String(manifest.target.chainId), targetTreasury: targetRuntime,
  };
  const packet: SettlementPacketV1 = {
    version: SETTLEMENT_PACKET_VERSION,
    source: { chainId: trusted.sourceChainId, chainKey: trusted.sourceChainKey, coordinator: sourceRuntime, finalized: { chainId: trusted.sourceChainId, blockNumber: String(sourceFinalized.number), blockHash: sourceFinalized.hash as Hex } },
    target: { chainId: trusted.targetChainId, treasury: targetRuntime, finalized: { chainId: trusted.targetChainId, blockNumber: String(targetFinalized.number), blockHash: targetFinalized.hash as Hex } },
    claims: await Promise.all(claims.map(async path => parseClaimPackage(await json(path)))),
  };
  const plan = await buildSettlementPlan(packet, ethersSettlementReadAdapter(source, target, targetRuntime.address), trusted);
  await atomicJson(planPath, plan);
  console.log(JSON.stringify({ mode: has("--execute") ? "execute" : "plan-only", planPath, planId: plan.planId, actions: plan.actions.map(action => ({ id: action.id, to: action.transaction.to, calldataHash: keccak256(action.transaction.data) })), issues: plan.issues, alreadyComplete: plan.alreadyComplete }, null, 2));
  if (has("--execute")) {
    const privateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
    if (!privateKey) throw new Error("--execute requires CREDITCOIN_WALLET_PRIVATE_KEY; planning remains keyless");
    const prior = await optionalJson(value("--journal", "evidence/replacement-settlement-journal.json")!) as SettlementJournalV1 | undefined;
    const adapter = ethersSettlementExecutionAdapter(new Wallet(privateKey, target), targetRuntime.address);
    const journal = await executeSettlementPlan({
      plan, trustedTreasury: targetRuntime.address, trustedCoordinator: sourceRuntime.address, journal: prior, adapter,
      maxActions: Number(value("--max-actions", "32")),
      persist: async current => { await atomicJson(journalPath, current); },
    });
    console.log(JSON.stringify({ journalPath, entries: journal.entries }, null, 2));
  }
} finally {
  source.destroy(); target.destroy();
}
