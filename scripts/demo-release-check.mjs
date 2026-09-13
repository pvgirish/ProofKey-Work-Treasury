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
  ["ui/demo.html", "1c4c4553de86137b5b3597a2e48f6e13f8c0b0fe52413f9d9feb0b3f0fc208be"],
  ["ui/demo.css", "6571ce85395ca117866a5f9f8b6fc3a4a96ffb5d351438a8aa8d90a8757c735f"],
  ["ui/demo.js", "c2abb491f024900b7fc100d8ed01b645c6882d955bd39d5858ff5ae23932dbd9"],
]);
const publicMediaFiles = [
  "ProofKey-Work-Treasury-Final-2026-09-14.mp4",
  "ProofKey-Work-Treasury-Final-2026-09-14.pdf",
  "ProofKey-Work-Treasury-Final-2026-09-14.vtt",
  "ProofKey-Work-Treasury-Final-2026-09-14.srt",
  "ProofKey-Work-Treasury-Final-2026-09-14.md",
  "ProofKey-Work-Treasury-Final-2026-09-14.png",
];
const expectedPdfHash = "28a8b3dab252a0833fa862d2968cdf8000940e4f5ac624da6380f79cca972162";

const demoFiles = new Map();
for (const relativePath of expectedHashes.keys()) {
  const source = await read(relativePath);
  demoFiles.set(relativePath, source);
  check(sha256(source) === expectedHashes.get(relativePath), `${relativePath} does not match the reviewed input hash`);
}

const demoHtml = demoFiles.get("ui/demo.html");
const demoJs = demoFiles.get("ui/demo.js");
const indexHtml = await read("ui/index.html");
const readme = await read("README.md");
const videoHtml = await read("ui/video.html");
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
check(demoHtml.includes('<title>ProofKey · Guided Demo</title>'), "the public demo title is missing");
check(demoHtml.includes("ProofKey · Guided Demo · 14 September 2026"), "the public demo banner is missing");
check(demoHtml.includes('href="./video.html"') && demoHtml.includes('href="./media/ProofKey-Work-Treasury-Final-2026-09-14.pdf"'), "the demo must link the video player and PDF");
check(!demoHtml.includes("Copy v4"), "the public demo must not expose the old visible label");

const disputeLinks = demoHtml.match(/<a class="dispute-link" href="#dispute-title">Disagreement\? See who decides\.<\/a>/g) ?? [];
check(disputeLinks.length === 2, `expected two dispute-navigation links, found ${disputeLinks.length}`);
check(demoHtml.includes('<h3 id="dispute-title" tabindex="-1">'), "the dispute heading is not keyboard-focusable");

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
check(illustration.includes('id="dispute-title"') && illustration.includes("Three committee members are named in the accepted terms"), "the dispute target must retain its committee introduction");
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
check(buildScript.includes('await copyFile(join(ui, "video.html"), join(dist, "video.html"));'), "build script does not explicitly publish the video player");
check(buildScript.includes("const publicMediaFiles = [") && publicMediaFiles.every(file => buildScript.includes(`"${file}"`)), "build script media allowlist is incomplete");

check(videoHtml.includes('<title>ProofKey · Guided Demo</title>') && videoHtml.includes("<h1>ProofKey · Guided Demo</h1>"), "the public video title is missing");
check(videoHtml.includes("<strong>Recorded 14 September 2026 · Historical testnet evidence</strong>"), "the public video metadata is missing");
check(videoHtml.includes('poster="./media/ProofKey-Work-Treasury-Final-2026-09-14.png"') && videoHtml.includes('src="./media/ProofKey-Work-Treasury-Final-2026-09-14.mp4"'), "the public video poster/source paths are incorrect");
check(videoHtml.includes('src="./media/ProofKey-Work-Treasury-Final-2026-09-14.vtt"') && videoHtml.includes('href="./media/ProofKey-Work-Treasury-Final-2026-09-14.srt"') && videoHtml.includes('href="./media/ProofKey-Work-Treasury-Final-2026-09-14.md"'), "the public captions/transcript paths are incorrect");
check(videoHtml.includes('href="./media/ProofKey-Work-Treasury-Final-2026-09-14.pdf"') && videoHtml.includes('href="./demo.html"'), "the public PDF and guided-demo links are missing");
check(videoHtml.includes(">Submission PDF</a>"), "the public submission-PDF label is missing");
check(videoHtml.includes("Edited walkthrough") && videoHtml.includes("Synthetic local narration") && videoHtml.includes("historical testnet records"), "the edited/synthetic/historical video boundaries are missing");
check(videoHtml.includes("no wallet needed") && !videoHtml.includes("window.ethereum"), "the public video must not require a wallet");
check(!videoHtml.includes("autoplay"), "the public video must not autoplay");
check(!/(?:\/Users\/|media-work|MANIFEST\.json)/.test(videoHtml), "the public video contains a non-public path or manifest");
check(!videoHtml.includes("Copy v4"), "the public video must not expose the old visible label");
check(readme.includes("(https://pvgirish.github.io/ProofKey-Work-Treasury/demo.html)") && readme.includes("(https://pvgirish.github.io/ProofKey-Work-Treasury/video.html)"), "README review-package pages must use public URLs");
check(readme.includes("[Submission PDF]("), "README submission-PDF label is missing");

const distVideoHtml = await readFile(join(root, "ui/dist/video.html"), "utf8").catch(() => null);
check(distVideoHtml === videoHtml, "ui/dist/video.html is missing or differs from its source");
for (const file of publicMediaFiles) {
  const docsSource = await readFile(join(root, "docs/media", file)).catch(() => null);
  check(docsSource !== null && docsSource.length > 0, `docs/media/${file} is missing`);
  if (file.endsWith(".pdf") && docsSource) check(sha256(docsSource) === expectedPdfHash, `docs/media/${file} does not match the reviewed PDF hash`);
  const distSource = await readFile(join(root, "ui/dist/media", file)).catch(() => null);
  check(distSource !== null && distSource.length > 0, `ui/dist/media/${file} is missing from the build`);
  if (docsSource && distSource) check(sha256(distSource) === sha256(docsSource), `ui/dist/media/${file} differs from its reviewed source`);
}
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
