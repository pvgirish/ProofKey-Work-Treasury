import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some(arg => !["--browser", "--app-workflows", "--participant-product"].includes(arg))) throw new Error("Usage: node scripts/verify-product-upgrade.mjs [--browser] [--app-workflows | --participant-product]");
const browser = args.includes("--browser");
const participantProduct = args.includes("--participant-product");
const appWorkflows = args.includes("--app-workflows") || participantProduct;
const outputDirectory = participantProduct ? "evidence/participant-product-validation" : appWorkflows ? "evidence/app-workflow-validation" : "evidence/product-upgrade-validation";
const output = resolve(root, outputDirectory);
const baseline = "da0495d6475aa8d0ed533f47f369a6e0085f9a83";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

async function filesUnder(path) {
  const entries = await readdir(resolve(root, path), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "dist" || entry.name.startsWith(".")) continue;
    const next = `${path}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(next));
    else if (entry.isFile()) files.push(next);
    else throw new Error(`Unsupported symbolic link or special file in release input: ${next}`);
  }
  return files;
}

async function inputHashes() {
  const paths = ["package.json", "package-lock.json", "foundry.toml", "tsconfig.json", "docs/compiler.json",
    ".github/workflows/ci.yml", "deployments/testnet.json", "deployments/ui-testnet.json",
    "evidence/claim-1.json", "evidence/native-bundle-33642ef4a9.json"];
  if (appWorkflows) paths.push("evidence/app-workflow-validation/public-main120.json");
  if (participantProduct) paths.push("evidence/public-demo.json");
  for (const dir of ["src", "sdk", "test", "scripts", "schema", "ui", "verification", "vendor", "lib"]) paths.push(...await filesUnder(dir));
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, hash(await readFile(resolve(root, path)))])));
}

function run(command, arguments_) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveRun({ exitCode: code, signal, stdout, stderr }));
  });
}

await mkdir(output, { recursive: true });
const before = await inputHashes();
const revision = await run("git", ["rev-parse", "HEAD"]);
if (revision.exitCode !== 0) throw new Error("Cannot identify the repository revision");
const report = {
  schema: "proofkey.product-upgrade-validation.v1",
  implementationScope: participantProduct ? "participant-offers-repeat-work-payment-history" : appWorkflows ? "app-provenance-replacement-closeout" : "portable-authorization-and-operator-tools",
  startedAt: new Date().toISOString(),
  baseline,
  revision: revision.stdout.trim(),
  scope: "Local execution on the recorded implementation, build configuration and fixed-fixture bytes. Browser checks use disclosed fixtures; this is not public CI, a new settlement, or customer adoption.",
  inputHashes: before,
  financialSourcesMatchBaseline: false,
  checks: [],
  passed: false,
};
try {
  const originalList = await run("git", ["ls-tree", "-r", "--name-only", baseline, "src"]);
  if (originalList.exitCode !== 0) throw new Error("Cannot read frozen financial source list");
  const original = originalList.stdout.trim().split("\n").sort();
  const current = (await filesUnder("src")).sort();
  if (JSON.stringify(original) !== JSON.stringify(current)) throw new Error("Production Solidity source list differs from the financial baseline");
  for (const path of original) {
    const result = await run("git", ["show", `${baseline}:${path}`]);
    if (result.exitCode !== 0 || hash(result.stdout) !== before[path]) throw new Error(`Financial source differs from baseline: ${path}`);
  }
  report.financialSourcesMatchBaseline = true;
  const checks = [
    ["typecheck", "npm", ["run", "typecheck"]],
    ["sdk", "npm", ["run", "test:sdk"]],
    ...(participantProduct ? [["participant", "npm", ["run", "test:participant"]]] : []),
    ["judge", "npm", ["run", "test:judge"]],
    ["contracts", "npm", ["run", "test:contracts"]],
    ["ui-build", "npm", ["run", "ui:build"]],
    ...(browser ? [["consent-browser", "node", ["scripts/ui-consent-qa.mjs"]]] : []),
    ...(browser && appWorkflows ? [["workflow-browser", "node", ["scripts/ui-workflows-qa.mjs"]]] : []),
    ...(browser && participantProduct ? [["participant-browser", "node", ["scripts/ui-participant-qa.mjs"]]] : []),
  ];
  for (const [name, command, arguments_] of checks) {
    const started = Date.now();
    const result = await run(command, arguments_);
    const log = `${result.stdout}${result.stderr ? `\nSTDERR\n${result.stderr}` : ""}`;
    await writeFile(resolve(output, `${name}.log`), log);
    report.checks.push({ name, command: [command, ...arguments_], exitCode: result.exitCode, signal: result.signal, elapsedMs: Date.now() - started, log: `${outputDirectory}/${name}.log`, logSha256: hash(log) });
    console.log(`${name}: ${result.exitCode === 0 ? "passed" : "FAILED"}`);
    if (result.exitCode !== 0) throw new Error(`${name} failed; inspect the saved log`);
  }
  const after = await inputHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Release inputs changed during verification; this run cannot validate the final bytes");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.passed ? "Passed" : "Incomplete"}: ${outputDirectory}/report.json`);
}
