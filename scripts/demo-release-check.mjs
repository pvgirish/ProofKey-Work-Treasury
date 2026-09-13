import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function read(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const expectedHashes = new Map([
  ["ui/demo.html", "cab78d13775d8277abf931a23c42a1aca2da10de971b433fb9616163048707cc"],
  ["ui/demo.css", "7caa0c222a22fa238b9c2f975b1e483ed48947ae9177695181b2f41bd8eaf77b"],
  ["ui/demo.js", "c2abb491f024900b7fc100d8ed01b645c6882d955bd39d5858ff5ae23932dbd9"],
]);

const demoFiles = new Map();
for (const relativePath of expectedHashes.keys()) {
  const source = await read(relativePath);
  demoFiles.set(relativePath, source);
  check(sha256(source) === expectedHashes.get(relativePath), `${relativePath} does not match the reviewed input hash`);
}

const demoHtml = demoFiles.get("ui/demo.html");
const demoJs = demoFiles.get("ui/demo.js");
const indexHtml = await read("ui/index.html");
const buildScript = await read("scripts/build-ui.mjs");
const workflow = await read(".github/workflows/ci.yml");

for (let step = 1; step <= 4; step += 1) {
  check(new RegExp(` id="story-step-${step}"[\\s\\S]*? id="step-${step}-title"`).test(demoHtml), `recorded story step ${step} is missing its panel and heading`);
  check(demoHtml.includes(`Recorded testnet · Story step ${step} of 4`), `recorded story step ${step} is missing its position label`);
  check(step === 1 || demoHtml.includes(` id="story-step-${step}" hidden`), `recorded story step ${step} must start hidden`);
}

check(demoHtml.includes("Of the 120 test CTC funded, 55 was paid for work and 65 was withdrawn by the funding account."), "the 120 = 55 + 65 accounting is missing");
check(demoHtml.includes("120 = 55 + 65 as transferred amounts, not including gas"), "the fee-exclusive accounting is missing");
check(demoHtml.includes("test-network records, not customer adoption or proof of work quality"), "the testnet and work-quality boundary is missing");
check(demoHtml.includes("Historical records, not re-verified in this walkthrough"), "the historical-record boundary is missing");
check(demoHtml.includes("Proof or operator availability can delay collection"), "the proof and operator availability boundary is missing");
check(demoHtml.includes("no bank payout or INR conversion"), "the payout boundary is missing");

const evidenceMatch = demoHtml.match(/<details class="evidence" id="demo-evidence">[\s\S]*?<\/details>/);
check(Boolean(evidenceMatch), "the evidence section is missing");
const evidenceAnchors = evidenceMatch?.[0].match(/<a\b[^>]*href="([^"]+)"[^>]*>/g) ?? [];
const transactionLinks = evidenceAnchors
  .map(anchor => anchor.match(/href="([^"]+)"/)?.[1] ?? "")
  .filter(href => /^https:\/\/(sepolia\.etherscan\.io|creditcoin-testnet\.blockscout\.com)\/tx\/0x[0-9a-f]{64}$/.test(href));
check(transactionLinks.length === 10, `expected 10 transaction evidence links, found ${transactionLinks.length}`);
check(new Set(transactionLinks).size === transactionLinks.length, "transaction evidence links are not unique");
check(transactionLinks.filter(href => href.startsWith("https://sepolia.etherscan.io/tx/")).length === 4, "expected four source-chain evidence links");
check(transactionLinks.filter(href => href.startsWith("https://creditcoin-testnet.blockscout.com/tx/")).length === 6, "expected six target-chain evidence links");
check(evidenceAnchors.every(anchor => anchor.includes('target="_blank"') && anchor.includes('rel="noreferrer"')), "evidence links must open safely in new tabs");

const disputeId = demoHtml.indexOf('id="dispute-rules"');
const illustrationStart = disputeId === -1 ? -1 : demoHtml.lastIndexOf("<section ", disputeId);
const evidenceStart = demoHtml.indexOf('id="demo-evidence"');
const illustrationEnd = evidenceStart === -1 ? -1 : demoHtml.lastIndexOf("<details ", evidenceStart);
check(illustrationStart !== -1 && illustrationEnd > illustrationStart, "the dispute-rule illustration is missing");
const illustration = illustrationStart === -1 || illustrationEnd === -1 ? "" : demoHtml.slice(illustrationStart, illustrationEnd);
check(illustration.includes("Illustration of existing rules—not another recorded transaction"), "the dispute section does not identify itself as an illustration");
check(illustration.includes("These are example terms, not another recorded payment"), "the dispute section does not separate its example from recorded payments");
check(illustration.includes("One illustrative job reserves 10 test CTC"), "the separate ten-token example is missing");
check(!/0x[0-9a-f]{64}/.test(illustration), "the illustration must not claim a transaction hash");
check(!illustration.includes("120 = 55 + 65"), "the illustration must not absorb the recorded 120-token accounting");

for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "window.ethereum", "provider", "wallet", "sendTransaction", "request(", "import "]) {
  check(!demoJs.includes(forbidden), `demo JavaScript contains forbidden dependency indicator: ${forbidden}`);
}
for (const elementId of ["demo-start", "demo-back", "demo-next", "demo-replay", "demo-position", "story-progress", "demo-evidence"]) {
  check(demoJs.includes(`getElementById("${elementId}")`) && demoHtml.includes(`id="${elementId}"`), `demo controls are not wired to HTML element ${elementId}`);
}
check(demoJs.includes('getElementById("step-" + step + "-title")') && demoJs.includes('getElementById("story-step-" + index)'), "demo JavaScript does not wire all four story panels and headings");

const mainMatch = indexHtml.match(/<main>([\s\S]*?)<\/main>/);
check(Boolean(mainMatch), "homepage main content is missing");
const mainOpening = mainMatch?.[1] ?? "";
check((mainOpening.match(/href="\.\/demo\.html"/g) ?? []).length === 1, "homepage must contain exactly one demo link");
check(mainOpening.indexOf('href="./demo.html"') < mainOpening.indexOf('id="startup-status"'), "homepage demo link must precede the first status notice");
check(mainOpening.includes(">Start the recorded demo</a>"), "homepage demo link label is missing");
check(mainOpening.includes("No wallet needed · practice tokens · historical records"), "homepage demo link qualifier is missing");
check(!indexHtml.includes('http-equiv="refresh"') && !indexHtml.includes("window.location"), "homepage must not redirect to the walkthrough");
const styles = await read("ui/styles.css");
check(styles.includes(".demo-entry-link:focus-visible"), "homepage demo entry lacks a visible focus style");
check(!styles.includes("@import"), "homepage must not import additional stylesheets");

check(buildScript.includes('["index.html", "styles.css", "demo.html", "demo.css", "demo.js"]'), "build script does not include all demo files");
for (const relativePath of expectedHashes.keys()) {
  const distPath = relativePath.replace("ui/", "ui/dist/");
  const distSource = await read(distPath).catch(() => null);
  check(distSource !== null, `${distPath} is missing from the build`);
  check(distSource === demoFiles.get(relativePath), `${distPath} differs from its source`);
}

const buildStepLine = "      - run: npm run ui:build\n";
const buildStep = workflow.indexOf(buildStepLine);
const checkStep = workflow.indexOf("      - run: node scripts/demo-release-check.mjs\n");
const uploadStep = workflow.indexOf("      - uses: actions/upload-artifact@v4\n");
check(buildStep !== -1 && checkStep === buildStep + buildStepLine.length && uploadStep > checkStep, "CI must run the demo release check between UI build and artifact upload");
check((workflow.match(/node scripts\/demo-release-check\.mjs/g) ?? []).length === 1, "CI must contain exactly one demo release check step");

if (failures.length > 0) {
  console.error(`Demo release check failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Demo release check passed: reviewed assets, four recorded steps, ten transaction links, boundaries, homepage entry, and build equality.");
}
