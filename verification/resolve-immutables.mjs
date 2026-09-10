// Resolves every masked immutable slot to a documented, independently-read value.
// Read-only eth_call / eth_getCode. No keys, no broadcast.
//   node verification/resolve-immutables.mjs
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toUtf8Bytes } from "ethers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sel = (sig) => keccak256(toUtf8Bytes(sig)).slice(0, 10);

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
async function retry(fn, label, n = 5) {
  let last; for (let i = 1; i <= n; i++) { try { return await fn(); } catch (e) { last = e;
    process.stderr.write(`  retry ${i}/${n} ${label}: ${e.message}\n`); await new Promise(r => setTimeout(r, 800 * i)); } }
  throw last;
}

const d = JSON.parse(await readFile(resolve(ROOT, "deployments/testnet.json"), "utf8"));
const repro = JSON.parse(await readFile(resolve(ROOT, "verification/deployment-reproduction-2026-09-10.json"), "utf8"));

const out = { version: 1, generatedAt: new Date().toISOString(),
  purpose: "Every masked immutable slot resolved to a documented value read independently from chain state.",
  results: {} };

for (const [side, cfg] of [["source", d.source], ["target", d.target]]) {
  const url = cfg.rpcUrl;
  const blk = "0x" + repro.chains[side].pinnedBlock.number.toString(16);
  out.results[side] = { pinnedBlock: repro.chains[side].pinnedBlock.number, contracts: {} };

  // Libraries: solc bakes the library's OWN deployed address in as an immutable.
  for (const [name, address] of Object.entries(cfg.libraries ?? {})) {
    const c = repro.chains[side].contracts[name];
    if (!c || c.immutableSlotCount === 0) continue;
    const slotVals = Object.values(c.immutableValues).flat();
    const uniq = [...new Set(slotVals.map(v => v.toLowerCase()))];
    const expected = address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
    out.results[side].contracts[name] = {
      kind: "library", address,
      interpretation: "solc embeds a deployed library's own address as an immutable reference",
      distinctSlotValues: uniq.length,
      slotValue: uniq[0],
      expectedSelfAddressWord: expected,
      resolved: uniq.length === 1 && uniq[0] === expected,
    };
  }

  // WorkTreasury: four declared immutables, each with a public getter.
  if (side === "target") {
    const addr = cfg.treasury;
    const call = async (sig) => retry(() => rpc(url, "eth_call", [{ to: addr, data: sel(sig) }, blk]), `${sig}`);
    const chainId = await call("SOURCE_CHAIN_ID()");
    const chainKey = await call("SOURCE_CHAIN_KEY()");
    const coordinator = await call("SOURCE_COORDINATOR()");
    const verifier = await call("VERIFIER()");
    const c = repro.chains[side].contracts.WorkTreasury;
    const slotVals = Object.entries(c.immutableValues).map(([id, v]) => [id, v[0].toLowerCase()]);
    const read = {
      SOURCE_CHAIN_ID: BigInt(chainId).toString(),
      SOURCE_CHAIN_KEY: BigInt(chainKey).toString(),
      SOURCE_COORDINATOR: "0x" + coordinator.slice(-40),
      VERIFIER: "0x" + verifier.slice(-40),
    };
    const expect = {
      SOURCE_CHAIN_ID: d.source.chainId,
      SOURCE_CHAIN_KEY: d.source.chainKey,
      SOURCE_COORDINATOR: d.source.coordinator.toLowerCase(),
      VERIFIER: "0x0000000000000000000000000000000000000fd2",
    };
    // Match each masked slot word to whichever read value produces it.
    const words = {
      SOURCE_CHAIN_ID: BigInt(chainId).toString(16).padStart(64, "0"),
      SOURCE_CHAIN_KEY: BigInt(chainKey).toString(16).padStart(64, "0"),
      SOURCE_COORDINATOR: coordinator.slice(-40).toLowerCase().padStart(64, "0"),
      VERIFIER: verifier.slice(-40).toLowerCase().padStart(64, "0"),
    };
    const mapped = slotVals.map(([id, v]) => {
      const hit = Object.entries(words).find(([, w]) => w === v);
      return { immutableId: id, slotValue: v, resolvesTo: hit ? hit[0] : null };
    });
    out.results[side].contracts.WorkTreasury = {
      kind: "contract", address: addr,
      readImmutables: read,
      expectedImmutables: expect,
      immutablesMatchDeploymentManifest:
        read.SOURCE_CHAIN_ID === expect.SOURCE_CHAIN_ID &&
        read.SOURCE_CHAIN_KEY === expect.SOURCE_CHAIN_KEY &&
        read.SOURCE_COORDINATOR.toLowerCase() === expect.SOURCE_COORDINATOR &&
        read.VERIFIER.toLowerCase() === expect.VERIFIER,
      slotMapping: mapped,
      everySlotResolved: mapped.every(m => m.resolvesTo !== null),
    };
  }
}

const p = resolve(ROOT, "verification/immutable-resolution-2026-09-10.json");
await writeFile(p, JSON.stringify(out, null, 2) + "\n");

for (const [side, r] of Object.entries(out.results)) {
  console.log(`\n=== ${side} @ block ${r.pinnedBlock}`);
  for (const [n, c] of Object.entries(r.contracts)) {
    if (c.kind === "library") console.log(`  ${n.padEnd(20)} self-address immutable resolved: ${c.resolved}`);
    else {
      console.log(`  ${n} immutables match manifest: ${c.immutablesMatchDeploymentManifest}`);
      console.log(`     read: ${JSON.stringify(c.readImmutables)}`);
      console.log(`     every masked slot resolved: ${c.everySlotResolved}`);
      for (const m of c.slotMapping) console.log(`       id ${m.immutableId} -> ${m.resolvesTo}`);
    }
  }
}
console.log(`\nwrote ${p}`);
