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
await mkdir(join(dist, "sdk"), { recursive: true });

for (const file of ["index.html", "styles.css"]) await copyFile(join(ui, file), join(dist, file));
await copyFile(join(root, "node_modules", "ethers", "dist", "ethers.umd.min.js"), join(dist, "vendor", "ethers.umd.min.js"));
await copyFile(join(root, "node_modules", "ethers", "dist", "ethers.min.js"), join(dist, "vendor", "ethers.esm.min.js"));

const browserModules = [
  ["sdk/types.ts", "types"], ["sdk/allocation.ts", "allocation"], ["sdk/identity.ts", "identity"],
  ["sdk/claim-package.ts", "claim-package"], ["sdk/receipt-evidence.ts", "receipt-evidence"], ["sdk/work-authorization.ts", "work-authorization"],
  ["sdk/settlement-runner.ts", "settlement-runner"], ["sdk/safe-runtime.ts", "safe-runtime"], ["scripts/judge-safe.ts", "judge-safe"], ["sdk/program-closeout.ts", "program-closeout"],
  ...(existsSync(join(root, "sdk", "program-collector.ts")) ? [["sdk/program-collector.ts", "program-collector"]] : []),
  ...(existsSync(join(root, "sdk", "payment-history.ts")) ? [["sdk/payment-history.ts", "payment-history"]] : []),
  ...(existsSync(join(root, "ui", "participant-work.ts")) ? [["ui/participant-work.ts", "participant-work"]] : []),
];
for (const [sourcePath, name] of browserModules) {
  const sdkSource = await readFile(join(root, sourcePath), "utf8");
  const sdkResult = ts.transpileModule(sdkSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, removeComments: true },
    fileName: `${name}.ts`,
    reportDiagnostics: true,
  });
  if (sdkResult.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(`Could not build browser SDK module ${name}`);
  const browserModule = sdkResult.outputText
    .replaceAll('from "ethers"', 'from "../vendor/ethers.esm.min.js"')
    .replaceAll(/from "\.\/([^\"]+)\.ts"/g, 'from "./$1.js"')
    .replaceAll(/from "\.\.\/sdk\/([^\"]+)\.ts"/g, 'from "./$1.js"')
    .replaceAll('from "../scripts/judge-safe.ts"', 'from "./judge-safe.js"');
  await writeFile(join(dist, "sdk", `${name}.js`), browserModule);
}
const bridgeImports = ["work-authorization", "claim-package", "settlement-runner", "safe-runtime", "program-closeout", ...["program-collector", "payment-history", "participant-work"].filter(module => browserModules.some(([, name]) => name === module))];
await writeFile(join(dist, "consent-bridge.js"), `${bridgeImports.map((name, index) => `import * as sdk${index} from "./sdk/${name}.js";`).join("\n")}\nconst sdk = Object.assign({}, ${bridgeImports.map((_name, index) => `sdk${index}`).join(", ")});\nglobalThis.PROOFKEY_SDK = sdk;\nglobalThis.PROOFKEY_CONSENT_SDK = sdk;\nglobalThis.dispatchEvent(new Event("proofkey-consent-ready"));\n`);

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
      proofServiceUrl: parsed.proofServiceUrl ?? "https://prover.cc3-testnet.creditcoin.network",
      ...(publicEpochId ? { lastEpochId: publicEpochId } : {}),
    };
  }
}
await writeFile(join(dist, "demo-config.js"), `globalThis.PROOFKEY_DEMO_CONFIG = ${JSON.stringify(demoConfig)};\nglobalThis.PROOFKEY_DEFAULT_CONFIG = ${JSON.stringify(defaultConfig)};\n`);

const trustedDeployments = [];
const releasePath = join(root, "deployments", "testnet.json");
if (existsSync(releasePath)) {
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  const sourceRecord = release.records?.find(item => item.chain === "source" && item.name === "SourceCoordinator");
  const targetRecord = release.records?.find(item => item.chain === "target" && item.name === "WorkTreasury");
  if (sourceRecord?.deployedCodeHash && targetRecord?.deployedCodeHash) trustedDeployments.push({
    id: "proofkey-public-testnet-v1",
    label: "Published ProofKey public testnet V1",
    source: { chainId: String(release.source.chainId), chainKey: String(release.source.chainKey), coordinator: release.source.coordinator, deployedCodeHash: sourceRecord.deployedCodeHash, deploymentBlock: String(sourceRecord.blockNumber), explorerUrl: "https://sepolia.etherscan.io" },
    target: { chainId: String(release.target.chainId), treasury: release.target.treasury, deployedCodeHash: targetRecord.deployedCodeHash, deploymentBlock: String(targetRecord.blockNumber), explorerUrl: "https://creditcoin-testnet.blockscout.com" },
  });
}
await writeFile(join(dist, "trusted-deployments.js"), `globalThis.PROOFKEY_TRUSTED_DEPLOYMENTS = ${JSON.stringify(trustedDeployments)};\n`);
console.log(`Built operator UI with ${Object.keys(contracts).length} compiled interfaces.`);
