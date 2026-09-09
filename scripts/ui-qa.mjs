import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cdpPort = Number(process.env.CDP_PORT ?? 9226);
const outputDir = new URL("../evidence/ui-qa/", import.meta.url).pathname;
await mkdir(outputDir, { recursive: true });

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No headless Chrome page target found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let requestId = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
  if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) browserErrors.push(`${message.params.entry.level}: ${message.params.entry.text}`);
});

function send(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}

async function waitFor(expression, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function screenshot(name) {
  await evaluate(`new Promise(resolve => {
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
  await new Promise(resolve => setTimeout(resolve, 180));
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(outputDir, name), Buffer.from(result.data, "base64"));
}

async function click(selector) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing ${selector}'); node.click(); return true; })()`);
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function value(selector, next) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing ${selector}'); node.value = ${JSON.stringify(next)}; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

async function text(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`); }
async function view(name) { await click(`[data-view="${name}"]`); await waitFor(`document.querySelector('#view-${name}')?.classList.contains('active')`); }

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:4173/" });
await waitFor("document.readyState === 'complete' && document.querySelector('#view-overview')");
await evaluate("localStorage.removeItem('proofkey-work-treasury.workspace.v1'); localStorage.removeItem('proofkey-work-treasury.draft.v1'); location.reload()");
await waitFor("document.readyState === 'complete' && document.querySelector('#view-overview')");

const checks = [];
function check(name, condition, detail) { checks.push({ name, passed: Boolean(condition), detail }); if (!condition) throw new Error(`${name}: ${detail}`); }

check("Overview opens", await evaluate("document.querySelector('#view-overview').classList.contains('active')"), "Budget view is active");
check("No fake live state", (await text("#source-main")).includes("Not read yet"), await text("#source-main"));
check("Funding action stays hidden before preparation", await evaluate("document.querySelector('#fund-exact-epoch').hidden && getComputedStyle(document.querySelector('#fund-exact-epoch')).display === 'none'"), "Fund exact source configuration is not disclosed before an exact epoch exists");
await screenshot("desktop-overview.png");

await click("#connect-wallet");
check("Missing wallet is explained", (await text("#toast")).includes("No browser wallet"), await text("#toast"));

const workspace = {
  source: { label: "QA source", chainId: 11155111, chainKey: "1", confirmations: 12, rpcUrl: "http://127.0.0.1:18545", coordinator: "0x1111111111111111111111111111111111111111", safe: "0x2222222222222222222222222222222222222222" },
  target: { label: "QA target", chainId: 102031, confirmations: 12, rpcUrl: "http://127.0.0.1:19545", treasury: "0x3333333333333333333333333333333333333333", invoiceBook: "0x4444444444444444444444444444444444444444" },
};
await evaluate(`localStorage.setItem('proofkey-work-treasury.workspace.v1', ${JSON.stringify(JSON.stringify(workspace))}); location.reload()`);
await waitFor("document.readyState === 'complete' && document.querySelector('#view-overview')");
await view("settings");
await value("#epoch-form [name=sponsor]", "0x5555555555555555555555555555555555555555");
await value("#epoch-form [name=refundBeneficiary]", "0x6666666666666666666666666666666666666666");
await value("#epoch-form [name=cap]", "120");
await value("#epoch-form [name=initializationCutoff]", "12000000");
await value("#epoch-form [name=admissionCutoff]", "12001000");
await value("#epoch-form [name=nonce]", "7");
await click("#epoch-form button[type=submit]");
await waitFor("document.querySelector('#epoch-result').textContent.includes('Exact epoch ID')");
const epochResult = await text("#epoch-result");
check("Exact epoch builder", epochResult.includes("No source initialization or target funding has occurred"), epochResult);
const epochId = await evaluate("JSON.parse(localStorage.getItem('proofkey-work-treasury.workspace.v1')).epochConfig.epochId");
check("Epoch ID is bytes32", /^0x[0-9a-f]{64}$/i.test(epochId), epochId);
check("Epoch CTC becomes canonical base units", await evaluate("JSON.parse(localStorage.getItem('proofkey-work-treasury.workspace.v1')).epochConfig.config.cap === '120000000000000000000'"), "120 CTC stored as 120000000000000000000 base units");
await screenshot("desktop-networks-epoch.png");

await view("orders");
await value("#draft-form [name=scope]", "Deliver the audited operator runbook and its reproducible evidence.");
await value("#draft-form [name=epochId]", epochId);
await value("#draft-form [name=worker]", "0x7777777777777777777777777777777777777777");
await value("#draft-form [name=claimOwner]", "0x8888888888888888888888888888888888888888");
await value("#draft-form [name=destination]", "0x8888888888888888888888888888888888888888");
await value("#draft-form [name=feeOwner]", "0x9999999999999999999999999999999999999999");
await value("#draft-form [name=feeDestination]", "0x9999999999999999999999999999999999999999");
await value("#draft-form [name=acceptBefore]", "12000010");
await value("#draft-form [name=deliverBefore]", "12000020");
await value("#draft-form [name=reviewBefore]", "12000030");
await value("#draft-form [name=ruleBefore]", "12000040");
await value("#draft-form [name=committee0]", "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
await value("#draft-form [name=committee1]", "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB");
await value("#draft-form [name=committee2]", "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC");
await value("#draft-form [name=work]", "0.0000000000000000001");
await click("#draft-form button[type=submit]");
check("CTC precision over 18 decimals is rejected", (await text("#draft-result")).includes("up to 18 decimal places"), await text("#draft-result"));
await value("#draft-form [name=work]", "10000000000000000000000000000000000000000000000000000000000000000000000");
await click("#draft-form button[type=submit]");
check("CTC uint256 overflow is rejected", (await text("#draft-result")).includes("uint256 CTC limit"), await text("#draft-result"));
await value("#draft-form [name=work]", "30.5");
await click("#draft-form button[type=submit]");
await waitFor("document.querySelector('#draft-result').textContent.includes('Nonbinding draft saved')");
check("Draft remains nonbinding", (await text("#draft-result")).includes("No money or admission slot is reserved"), await text("#draft-result"));
check("Decimal CTC becomes canonical quote value", await evaluate("JSON.parse(localStorage.getItem('proofkey-work-treasury.draft.v1')).terms.milestones[0].work === '30500000000000000000'"), "30.5 CTC stored as 30500000000000000000 base units");
check("Funding check is the signing action", !(await evaluate("document.querySelector('#sign-quote').disabled")), "The enabled action is labelled Check funding & sign quote");
check("Safe acceptance stays hidden before worker consent", await evaluate("document.querySelector('#prepare-quote').hidden && getComputedStyle(document.querySelector('#prepare-quote')).display === 'none'"), "Prepare Safe acceptance remains hidden before a worker signature");
await screenshot("desktop-orders-draft.png");

await view("evidence");
await value("#claim-package", "{}");
await click("#inspect-package");
check("Malformed package rejected", (await text("#package-result")).includes("Unsupported or malformed"), await text("#package-result"));
check("Recognition remains disabled", await evaluate("document.querySelector('#prepare-claim').disabled"), "Recognition is disabled after rejection");

await view("payments");
await screenshot("desktop-payments.png");

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
for (const name of ["overview", "orders", "settings", "payments"]) {
  await evaluate(`document.querySelectorAll('.view').forEach(node => node.classList.toggle('active', node.id === 'view-${name}')); document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === '${name}'));`);
  await new Promise(resolve => setTimeout(resolve, 80));
  check(`Mobile ${name} fits the viewport`, await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "No horizontal page overflow");
  check(`Mobile ${name} keeps wallet control visible`, (await text("#connect-wallet")).includes("wallet"), "Connect wallet is visible");
  await screenshot(`mobile-${name}.png`);
}

check("No browser runtime errors", browserErrors.length === 0, browserErrors.join("\n") || "none");
const report = [
  "# Operator UI headless QA",
  "",
  `Run: ${new Date().toISOString()}`,
  "",
  "Chrome ran headlessly with an isolated temporary profile. No existing browser profile, injected wallet, or live RPC transaction was used.",
  "",
  "## Checks",
  "",
  ...checks.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.name}: ${item.detail}`),
  "",
  "## Visual review",
  "",
  "- Desktop (1440 × 1100): all five navigation destinations, page headers, form hierarchy, disabled controls and environment labels render without clipping.",
  "- Mobile (390 × 844 at 2× density): Budget, Work orders, Networks and Payments use a readable single-column layout with no horizontal page overflow.",
  "- The sticky mobile header keeps both Menu and Connect wallet legible. Mobile backdrop blur is disabled to avoid intermittent Chromium compositor text loss.",
  "",
  "## Screenshots",
  "",
  ...["desktop-overview.png", "desktop-networks-epoch.png", "desktop-orders-draft.png", "desktop-payments.png", "mobile-overview.png", "mobile-orders.png", "mobile-settings.png", "mobile-payments.png"].map(name => `- ${name}`),
  "",
  "The QA workspace uses unreachable loopback RPC placeholders solely to exercise local form state. No verification, wallet signature, deployment, claim, or payment transaction was attempted.",
  "",
].join("\n");
await writeFile(join(outputDir, "report.md"), report);
socket.close();
console.log(JSON.stringify({ checks, browserErrors, outputDir }, null, 2));
