import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import { keccak256 } from "ethers";

const root = dirname(dirname(new URL(import.meta.url).pathname));
const ui = join(root, "ui");
const dist = join(ui, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "vendor"), { recursive: true });

for (const file of ["index.html", "styles.css"]) await copyFile(join(ui, file), join(dist, file));
await copyFile(join(root, "node_modules", "ethers", "dist", "ethers.umd.min.js"), join(dist, "vendor", "ethers.umd.min.js"));

const source = await readFile(join(ui, "app.ts"), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, removeComments: true },
  fileName: "app.ts",
  reportDiagnostics: true,
});
if (transpiled.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(transpiled.diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
}
await writeFile(join(dist, "app.js"), transpiled.outputText);

const contracts = {};
for (const name of ["SourceCoordinator", "WorkTreasury", "PaidInvoiceBook"]) {
  const artifactPath = join(root, "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(artifactPath)) continue;
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  const deployedBytecode = artifact.deployedBytecode?.object;
  contracts[name] = {
    contractName: name,
    sourceName: `src/${name}.sol`,
    abi: artifact.abi,
    ...(deployedBytecode && deployedBytecode !== "0x" && !deployedBytecode.includes("__") ? { compiledTemplateCodeHash: keccak256(deployedBytecode) } : {}),
  };
}
const manifest = { generatedAt: new Date().toISOString(), contracts };
await writeFile(join(dist, "abi-manifest.js"), `globalThis.PROOFKEY_ABI_MANIFEST = ${JSON.stringify(manifest)};\n`);

let demoConfig = null;
for (const candidate of [join(root, "deployments", "ui-local.json"), join(root, "deployments", "local.json")]) {
  if (!existsSync(candidate)) continue;
  const parsed = JSON.parse(await readFile(candidate, "utf8"));
  if (parsed?.source?.rpcUrl && parsed?.target?.rpcUrl) { demoConfig = parsed; break; }
}
let defaultConfig = null;
const testnetConfigPath = join(root, "deployments", "ui-testnet.json");
if (existsSync(testnetConfigPath)) {
  const parsed = JSON.parse(await readFile(testnetConfigPath, "utf8"));
  if (parsed?.source?.rpcUrl && parsed?.target?.rpcUrl) {
    let publicEpochId = parsed.lastEpochId;
    const publicEvidencePath = join(root, "evidence", "public-demo.json");
    if (!publicEpochId && existsSync(publicEvidencePath)) publicEpochId = JSON.parse(await readFile(publicEvidencePath, "utf8")).epochId;
    defaultConfig = {
      ...parsed,
      source: { label: "Ethereum Sepolia", confirmations: 12, ...parsed.source },
      target: { label: "Creditcoin Testnet", confirmations: 12, ...parsed.target },
      ...(publicEpochId ? { lastEpochId: publicEpochId } : {}),
    };
  }
}
await writeFile(join(dist, "demo-config.js"), `globalThis.PROOFKEY_DEMO_CONFIG = ${JSON.stringify(demoConfig)};\nglobalThis.PROOFKEY_DEFAULT_CONFIG = ${JSON.stringify(defaultConfig)};\n`);
console.log(`Built operator UI with ${Object.keys(contracts).length} compiled interfaces.`);
