import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from "ethers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPLORER = "https://creditcoin-testnet.blockscout.com";
const COMPILER = "v0.8.28+commit.7893614a";
const TARGETS = ["WorkTypes", "AllocationTree", "WorkTreasury"] as const;

type TargetName = (typeof TARGETS)[number];
type Prepared = {
  name: TargetName;
  sourceName: string;
  address: string;
  standardInput: Record<string, any>;
  constructorArguments: string;
  libraries: Array<{ sourceName: string; name: string; address: string }>;
  sourceCount: number;
};

function fail(message: string): never { throw new Error(message); }
function exactAddress(value: unknown, label: string) {
  if (typeof value !== "string") fail(`${label} is missing`);
  return getAddress(value);
}
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/verify-target-blockscout.ts [--check | --submit] [--write-dir <directory>]");
    process.exit(0);
  }
  const submit = args.includes("--submit");
  const check = args.includes("--check");
  if (submit && check) fail("Choose --check or --submit, not both");
  const outputIndex = args.indexOf("--write-dir");
  const outputDir = outputIndex < 0 ? undefined : args[outputIndex + 1];
  if (outputIndex >= 0 && (!outputDir || outputDir.startsWith("--"))) fail("--write-dir requires a directory");
  const consumed = new Set<number>();
  for (const flag of ["--submit", "--check"]) {
    const index = args.indexOf(flag);
    if (index >= 0) consumed.add(index);
  }
  if (outputIndex >= 0) { consumed.add(outputIndex); consumed.add(outputIndex + 1); }
  const unknown = args.filter((_value, index) => !consumed.has(index));
  if (unknown.length) fail(`Unknown argument: ${unknown[0]}`);
  return { submit, check, outputDir };
}

async function json(path: string) { return JSON.parse(await readFile(resolve(ROOT, path), "utf8")); }

function compilationOutput(input: Record<string, any>) {
  const solc = resolve(ROOT, ".toolchain/solc-0.8.28");
  const result = spawnSync(solc, ["--standard-json"], {
    input: JSON.stringify(input), encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) fail(`Cannot run pinned compiler ${solc}: ${result.error.message}`);
  if (result.status !== 0) fail(`Pinned compiler exited ${result.status}: ${result.stderr.trim()}`);
  const output = JSON.parse(result.stdout);
  const errors = (output.errors ?? []).filter((item: any) => item.severity === "error");
  if (errors.length) fail(`Pinned compiler rejected standard input: ${errors[0].formattedMessage ?? errors[0].message}`);
  return output;
}

function linkedObject(object: string, links: Record<string, any>, addresses: Map<string, string>) {
  const characters = [...object.replace(/^0x/, "")];
  for (const [sourceName, contracts] of Object.entries(links)) {
    for (const [name, positions] of Object.entries(contracts as Record<string, any[]>)) {
      const address = addresses.get(`${sourceName}:${name}`)?.slice(2).toLowerCase();
      if (!address) fail(`No deployed address for linked library ${sourceName}:${name}`);
      for (const position of positions) {
        if (position.length !== 20) fail(`Unexpected link length for ${sourceName}:${name}`);
        characters.splice(position.start * 2, position.length * 2, ...address);
      }
    }
  }
  const value = characters.join("");
  if (!/^[0-9a-f]+$/i.test(value)) fail("Linked creation bytecode still contains placeholders");
  return value;
}

async function prepare(name: TargetName, manifest: any): Promise<Prepared> {
  const sourceName = `src/${name}.sol`;
  const artifact = await json(`out/${name}.sol/${name}.json`);
  const metadata = artifact.metadata;
  if (metadata.compiler?.version !== manifest.compiler || `v${manifest.compiler}` !== COMPILER) {
    fail(`${name} compiler does not match deployments/testnet.json`);
  }
  if (metadata.settings?.optimizer?.enabled !== true
    || metadata.settings.optimizer.runs !== manifest.optimizerRuns
    || metadata.settings.viaIR !== manifest.viaIR
    || metadata.settings.evmVersion !== manifest.evmVersion) {
    fail(`${name} artifact settings do not match deployments/testnet.json`);
  }
  if (metadata.settings.compilationTarget?.[sourceName] !== name) fail(`${name} compilation target mismatch`);

  const sources: Record<string, { content: string }> = {};
  for (const [path, expected] of Object.entries(metadata.sources as Record<string, any>)) {
    // Forge supplied LF-normalized source to solc even when an npm package was
    // installed with CRLF working-tree bytes. Hash and publish the compiler input.
    const content = (await readFile(resolve(ROOT, path), "utf8")).replace(/\r\n/g, "\n");
    if (keccak256(toUtf8Bytes(content)) !== expected.keccak256) fail(`${name} source changed since compilation: ${path}`);
    sources[path] = { content };
  }
  const settings = structuredClone(metadata.settings);
  delete settings.compilationTarget;
  settings.outputSelection = { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } };
  const standardInput = { language: "Solidity", sources, settings };
  const output = compilationOutput(standardInput);
  const compiled = output.contracts?.[sourceName]?.[name];
  if (!compiled) fail(`Pinned compiler did not emit ${sourceName}:${name}`);
  if (compiled.metadata !== artifact.rawMetadata) fail(`${name} metadata does not reproduce the deployment artifact`);
  if (`0x${compiled.evm.bytecode.object}` !== artifact.bytecode.object) fail(`${name} creation bytecode does not reproduce the deployment artifact`);

  const record = manifest.records?.find((item: any) => item.chain === "target" && item.name === name);
  if (!record?.matchesCompiledRuntimeOutsideImmutableSlots) fail(`${name} has no successful deployed-runtime correspondence record`);
  const configuredAddress = name === "WorkTreasury" ? manifest.target.treasury : manifest.target.libraries[name];
  const address = exactAddress(record.address, `${name} deployment address`);
  if (address !== exactAddress(configuredAddress, `${name} configured address`)) fail(`${name} address differs from target configuration`);

  const libraries: Prepared["libraries"] = [];
  const addresses = new Map<string, string>();
  for (const [path, contracts] of Object.entries(artifact.bytecode.linkReferences ?? {})) {
    for (const libraryName of Object.keys(contracts as Record<string, any>)) {
      const deployed = exactAddress(manifest.target.libraries[libraryName], `${libraryName} target library`);
      if (record.libraries?.[libraryName] !== deployed) fail(`${name} record does not bind ${libraryName} to ${deployed}`);
      libraries.push({ sourceName: path, name: libraryName, address: deployed });
      addresses.set(`${path}:${libraryName}`, deployed);
    }
  }
  linkedObject(artifact.bytecode.object, artifact.bytecode.linkReferences ?? {}, addresses);

  const constructor = artifact.abi.find((item: any) => item.type === "constructor");
  const inputs = constructor?.inputs ?? [];
  const values = record.constructorArguments ?? [];
  if (inputs.length !== values.length) fail(`${name} constructor argument count differs from deployment record`);
  const constructorArguments = inputs.length
    ? AbiCoder.defaultAbiCoder().encode(inputs.map((item: any) => item.type), values).slice(2)
    : "";
  return { name, sourceName, address, standardInput, constructorArguments, libraries, sourceCount: Object.keys(sources).length };
}

async function explorerConfig() {
  const response = await fetch(`${EXPLORER}/api/v2/smart-contracts/verification/config`);
  if (!response.ok) fail(`Blockscout verifier config returned HTTP ${response.status}`);
  const config = await response.json() as any;
  if (!config.is_rust_verifier_microservice_enabled
    || !config.verification_options?.includes("standard-input")
    || !config.solidity_compiler_versions?.includes(COMPILER)) {
    fail("Blockscout does not expose the required standard-input verifier and compiler");
  }
}

async function status(target: Prepared) {
  const response = await fetch(`${EXPLORER}/api/v2/smart-contracts/${target.address}`);
  if (!response.ok) fail(`Blockscout contract read returned HTTP ${response.status} for ${target.name}`);
  const result = await response.json() as any;
  return {
    verified: result.is_verified === true,
    full: result.is_fully_verified === true,
    explorerName: result.name,
    compiler: result.compiler_version,
    evmVersion: result.evm_version,
    optimization: result.optimization_enabled,
    runs: result.optimization_runs,
    libraries: result.external_libraries,
  };
}

async function submit(target: Prepared) {
  const before = await status(target);
  if (before.verified) return before;
  const form = new FormData();
  form.set("contractaddress", target.address);
  form.set("contractname", `${target.sourceName}:${target.name}`);
  form.set("codeformat", "solidity-standard-json-input");
  form.set("compilerversion", COMPILER);
  form.set("sourceCode", JSON.stringify(target.standardInput));
  form.set("constructorArguments", target.constructorArguments);
  form.set("autodetectConstructorArguments", "false");
  form.set("licenseType", "mit");
  target.libraries.forEach((library, index) => {
    form.set(`libraryname${index + 1}`, `${library.sourceName}:${library.name}`);
    form.set(`libraryaddress${index + 1}`, library.address);
  });
  const response = await fetch(`${EXPLORER}/api?module=contract&action=verifysourcecode`, { method: "POST", body: form });
  if (!response.ok) fail(`Blockscout submission returned HTTP ${response.status} for ${target.name}`);
  const receipt = await response.json() as any;
  if (receipt.message === "Smart-contract already verified.") return status(target);
  if (receipt.status !== "1" || typeof receipt.result !== "string") fail(`${target.name} submission failed: ${receipt.result ?? receipt.message}`);

  for (let attempt = 0; attempt < 20; attempt++) {
    if (attempt) await new Promise(resolveWait => setTimeout(resolveWait, 2_000));
    const check = await fetch(`${EXPLORER}/api?module=contract&action=checkverifystatus&guid=${encodeURIComponent(receipt.result)}`);
    if (!check.ok) fail(`Blockscout status returned HTTP ${check.status} for ${target.name}`);
    const result = await check.json() as any;
    if (String(result.result).toLowerCase().includes("pending")) continue;
    if (result.status !== "1") fail(`${target.name} verification failed: ${result.result ?? result.message}`);
    break;
  }
  const final = await status(target);
  if (!final.verified) fail(`${target.name} verification did not become visible after the bounded status wait`);
  return final;
}

async function main() {
  const options = parseArgs();
  const manifest = await json("deployments/testnet.json");
  if (manifest.target?.chainId !== "102031") fail("Target manifest is not Creditcoin Testnet chain 102031");
  const prepared = [];
  for (const name of TARGETS) prepared.push(await prepare(name, manifest));

  if (options.outputDir) {
    const outputDir = isAbsolute(options.outputDir) ? options.outputDir : resolve(ROOT, options.outputDir);
    await mkdir(outputDir, { recursive: true });
    for (const target of prepared) {
      await writeFile(resolve(outputDir, `${target.name}.standard-input.json`), `${JSON.stringify(target.standardInput, null, 2)}\n`);
    }
    await writeFile(resolve(outputDir, "submission.json"), `${JSON.stringify(prepared.map(target => ({
      contract: `${target.sourceName}:${target.name}`, address: target.address,
      compiler: COMPILER, constructorArguments: target.constructorArguments, libraries: target.libraries,
    })), null, 2)}\n`);
  }

  const summary: any = {
    checkedAt: new Date().toISOString(),
    explorer: EXPLORER, chainId: manifest.target.chainId, compiler: COMPILER,
    mode: options.submit ? "submit" : options.check ? "check" : "prepare",
    targets: prepared.map(target => ({
      name: target.name, address: target.address, sourceCount: target.sourceCount,
      constructorBytes: target.constructorArguments.length / 2, libraries: target.libraries,
      artifactReproduced: true, deployedRuntimeCorrespondence: true,
    })),
  };
  if (options.submit || options.check) {
    await explorerConfig();
    summary.results = [];
    for (const target of prepared) summary.results.push({ name: target.name, address: target.address, ...(options.submit ? await submit(target) : await status(target)) });
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
