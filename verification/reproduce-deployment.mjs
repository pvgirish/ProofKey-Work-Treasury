// Deployment reproduction check - read-only, no keys, no broadcast.
// Rebuilds each deployed runtime from the LOCAL build artifacts using the SAME
// post-compilation linking that scripts/runtime.ts performs, then compares against
// on-chain code at a pinned block. Writes a dated report; overwrites nothing.
//
//   node verification/reproduce-deployment.mjs
//
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (hex) => createHash("sha256").update(Buffer.from(hex.replace(/^0x/, ""), "hex")).digest("hex");

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function retry(fn, label, attempts = 5) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      process.stderr.write(`  retry ${i}/${attempts} ${label}: ${e.message}\n`);
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
  throw last;
}

const artifact = async (name) =>
  JSON.parse(await readFile(resolve(ROOT, `out/${name}.sol/${name}.json`), "utf8"));

// Identical algorithm to scripts/runtime.ts linkedBytecode(runtime=true).
function link(a, links) {
  const section = a.deployedBytecode;
  let code = section.object.replace(/^0x/, "");
  const applied = [];
  for (const [file, items] of Object.entries(section.linkReferences ?? {})) {
    for (const [name, locations] of Object.entries(items)) {
      const address = links[`${file}:${name}`] ?? links[name];
      if (!address) throw new Error(`Missing library link ${file}:${name}`);
      const raw = address.replace(/^0x/, "");
      if (!/^[0-9a-fA-F]{40}$/.test(raw)) throw new Error("Invalid library address");
      for (const loc of locations) {
        if (loc.length !== 20) throw new Error("Unexpected library link width");
        code = code.slice(0, loc.start * 2) + raw + code.slice((loc.start + 20) * 2);
      }
      applied.push({ library: `${file}:${name}`, address, occurrences: locations.length });
    }
  }
  if (!/^[0-9a-fA-F]+$/.test(code)) throw new Error("Unresolved placeholder remains after linking");
  return { code: `0x${code}`, applied };
}

// Identical masking rule to scripts/runtime.ts compareRuntime: only compiler-declared
// immutable slots are masked. Metadata is NEVER stripped.
function compare(a, onchain, linked) {
  const immutables = a.deployedBytecode.immutableReferences ?? {};
  const ids = Object.keys(immutables);
  const exact = onchain.toLowerCase() === linked.toLowerCase();
  let actual = onchain.toLowerCase(), expected = linked.toLowerCase();
  const values = {};
  for (const [id, locs] of Object.entries(immutables)) {
    values[id] = [];
    for (const loc of locs) {
      const s = 2 + loc.start * 2, e = s + loc.length * 2;
      values[id].push(onchain.slice(s, e));
      const mask = "0".repeat(loc.length * 2);
      actual = actual.slice(0, s) + mask + actual.slice(e);
      expected = expected.slice(0, s) + mask + expected.slice(e);
    }
    if (new Set(values[id].map((v) => v.toLowerCase())).size !== 1)
      throw new Error("Repeated immutable slots disagree");
  }
  const maskedEqual = actual === expected;
  let verdict;
  if (exact) verdict = "FULL_RUNTIME_BYTE_FOR_BYTE_EQUALITY";
  else if (maskedEqual && ids.length > 0) verdict = "EQUAL_OUTSIDE_DECLARED_IMMUTABLE_SLOTS";
  else if (onchain.length === linked.length) verdict = "LENGTH_ONLY_CONTENT_DIFFERS";
  else verdict = "LENGTH_DIFFERS";

  // First differing byte, for diagnosis when not exact.
  let firstDiff = null;
  if (!exact) {
    const n = Math.min(onchain.length, linked.length);
    for (let i = 2; i < n; i += 2) {
      if (onchain.slice(i, i + 2).toLowerCase() !== linked.slice(i, i + 2).toLowerCase()) {
        firstDiff = { byteOffset: (i - 2) / 2, onchain: onchain.slice(i, i + 2), local: linked.slice(i, i + 2) };
        break;
      }
    }
  }
  return {
    verdict, exact, maskedEqual,
    immutableSlotIds: ids.length,
    immutableSlotCount: Object.values(immutables).reduce((n, l) => n + l.length, 0),
    immutableValues: values,
    firstDiff,
  };
}

const d = JSON.parse(await readFile(resolve(ROOT, "deployments/testnet.json"), "utf8"));
const report = {
  version: 1,
  purpose: "Reproduce deployed runtimes from local build artifacts. Read-only. No redeploy, no verification submission.",
  generatedAt: new Date().toISOString(),
  method:
    "Libraries were linked AFTER compilation by patching linkReferences placeholders (same algorithm as scripts/runtime.ts). Compilation used settings.libraries = {}. Metadata is not stripped. Only compiler-declared immutable slots are masked, and only where they exist.",
  compiler: { version: d.compiler, optimizerRuns: d.optimizerRuns, viaIR: d.viaIR, evmVersion: d.evmVersion },
  chains: {},
};

for (const [side, cfg] of [["source", d.source], ["target", d.target]]) {
  const url = cfg.rpcUrl;
  const latest = await retry(() => rpc(url, "eth_blockNumber", []), `${side} blockNumber`);
  const pinnedNum = parseInt(latest, 16) - 8; // a few blocks back for stability
  const pinnedHex = "0x" + pinnedNum.toString(16);
  const block = await retry(() => rpc(url, "eth_getBlockByNumber", [pinnedHex, false]), `${side} block`);
  const chainId = await retry(() => rpc(url, "eth_chainId", []), `${side} chainId`);

  const entry = {
    rpcUrl: url,
    chainIdDeclared: cfg.chainId,
    chainIdObserved: String(BigInt(chainId)),
    pinnedBlock: { number: pinnedNum, hash: block.hash, timestamp: parseInt(block.timestamp, 16) },
    contracts: {},
  };

  const targets = [];
  for (const [name, address] of Object.entries(cfg.libraries ?? {})) targets.push([name, address, "library"]);
  if (side === "source") targets.push(["SourceCoordinator", cfg.coordinator, "contract"]);
  else targets.push(["WorkTreasury", cfg.treasury, "contract"]);

  for (const [name, address, kind] of targets) {
    process.stderr.write(`[${side}] ${name} @ ${address}\n`);
    const onchain = await retry(() => rpc(url, "eth_getCode", [address, pinnedHex]), `${side} ${name} code`);
    const a = await artifact(name);
    const { code: linked, applied } = link(a, cfg.libraries ?? {});
    const cmp = compare(a, onchain, linked);
    entry.contracts[name] = {
      kind, address,
      onchainRuntimeBytes: (onchain.length - 2) / 2,
      localRuntimeBytes: (linked.length - 2) / 2,
      onchainRuntimeSha256: sha256(onchain),
      reproducedRuntimeSha256: sha256(linked),
      onchainRuntimeKeccakInput: onchain.length,
      librariesApplied: applied,
      ...cmp,
    };
  }
  report.chains[side] = entry;
}

const out = resolve(ROOT, "verification/deployment-reproduction-2026-09-10.json");
await writeFile(out, JSON.stringify(report, null, 2) + "\n");

for (const [side, e] of Object.entries(report.chains)) {
  console.log(`\n=== ${side} (chain ${e.chainIdObserved}) @ block ${e.pinnedBlock.number}`);
  for (const [n, c] of Object.entries(e.contracts)) {
    console.log(`  ${n.padEnd(20)} ${String(c.onchainRuntimeBytes).padStart(6)}B  ${c.verdict}`);
    if (c.firstDiff) console.log(`      first diff @ byte ${c.firstDiff.byteOffset}: onchain ${c.firstDiff.onchain} vs local ${c.firstDiff.local}`);
  }
}
console.log(`\nwrote ${out}`);
