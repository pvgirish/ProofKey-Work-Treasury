import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { id } from "ethers";

const cdpPort = Number(process.env.CDP_PORT ?? 9227);
const appUrl = process.env.UI_URL ?? "http://127.0.0.1:4173/";
const outputDir = new URL("../evidence/ui-live-qa/", import.meta.url).pathname;
const deployment = JSON.parse(await readFile(new URL("../deployments/ui-testnet.json", import.meta.url), "utf8"));
const publicDemo = JSON.parse(await readFile(new URL("../evidence/public-demo.json", import.meta.url), "utf8"));
await mkdir(outputDir, { recursive: true });

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No isolated Chrome page target found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });

let requestId = 0;
const pending = new Map();
const browserErrors = [];
const rpcCalls = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") browserErrors.push(message.params.entry.text);
  if (message.method === "Network.requestWillBeSent" && message.params.request.postData) {
    try {
      const body = JSON.parse(message.params.request.postData);
      for (const call of Array.isArray(body) ? body : [body]) if (call?.method) rpcCalls.push({ url: message.params.request.url, method: call.method, params: call.params });
    } catch {}
  }
});
function send(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
}
async function waitFor(expression, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function click(selector) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing ${selector}'); node.click(); })()`);
}
async function text(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`); }
async function screenshot(name) {
  await evaluate("new Promise(resolve => { window.scrollTo({top:0,left:0,behavior:'instant'}); requestAnimationFrame(() => requestAnimationFrame(resolve)); })");
  const capture = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(join(outputDir, name), Buffer.from(capture.data, "base64"));
}
const checks = [];
function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail });
  if (!condition) throw new Error(`${name}: ${detail}`);
}

await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
await send("Network.clearBrowserCache");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: appUrl });
await waitFor("document.readyState === 'complete' && document.querySelector('#abi-status')?.textContent.includes('compiled contract interfaces loaded')");
await evaluate("localStorage.removeItem('proofkey-work-treasury.workspace.v1'); localStorage.removeItem('proofkey-work-treasury.draft.v1'); location.reload()");
await waitFor("document.readyState === 'complete' && document.querySelector('#abi-status')?.textContent.includes('compiled contract interfaces loaded')");

check("GitHub Pages asset paths are relative", await evaluate("[...document.querySelectorAll('link[href],script[src]')].every(node => (node.getAttribute('href') ?? node.getAttribute('src')).startsWith('./'))"), "All five built assets use ./ paths");
check("Public configuration loaded", (await text("#rail-status")).includes("Ethereum Sepolia") && (await text("#rail-status")).includes("Creditcoin Testnet"), await text("#rail-status"));
check("Funded demo epoch loaded", await evaluate(`document.querySelector('#active-epoch').value.toLowerCase() === ${JSON.stringify(publicDemo.epochId.toLowerCase())}`), publicDemo.epochId);
check("No injected wallet or profile", !(await evaluate("Boolean(window.ethereum)")), "window.ethereum is absent in the isolated profile");
check("Safe export is the documented default", (await text("#download-safe")).includes("Transaction Builder JSON") && (await text("#source-prepared .help")).includes("does not bundle the Safe Apps SDK"), "Transaction Builder JSON is offered without claiming bundled Safe Apps integration");

await click('[data-view="settings"]');
await click("#verify-settings");
await waitFor("document.querySelector('#source-config-signal').classList.contains('good') && document.querySelector('#target-config-signal').classList.contains('good')");
const setupMessage = await text("#toast");
check("Setup verification checks pinned domain", setupMessage.includes("target immutables match"), setupMessage);
await screenshot("live-settings-verified.png");

await click('[data-view="overview"]');
await click("#load-epoch");
await waitFor("['Exact epoch funded','Target unavailable'].includes(document.querySelector('#target-main')?.textContent)");
const targetMain = await text("#target-main"), targetDetail = await text("#target-detail"), targetMetrics = await text("#target-metrics");
const sourceMain = await text("#source-main"), sourceDetail = await text("#source-detail"), sourceMetrics = await text("#source-metrics");
const actionMain = await text("#action-main"), actionDetail = await text("#action-detail");
check("Finalized target funding displayed", targetMain === "Exact epoch funded" && targetDetail.includes("finalized block") && targetMetrics.includes("120.0 CTC") && targetMetrics.includes("Yes"), `${targetMain}; ${targetDetail}; ${targetMetrics}`);
check("Incomplete readback does not authorize an action", sourceMain !== "Source unavailable" || (actionMain === "Wait for complete readback" && actionDetail.includes("Refresh")), `${actionMain}; ${actionDetail}`);
await screenshot("live-funded-readback.png");

const selectors = ["epochAccount(bytes32)", "epochConfig(bytes32)", "SOURCE_CHAIN_ID()", "SOURCE_CHAIN_KEY()", "SOURCE_COORDINATOR()"].map(signature => id(signature).slice(0, 10));
const targetOrigin = new URL(deployment.target.rpcUrl).origin;
const targetCalls = rpcCalls.filter(call => { try { return new URL(call.url).origin === targetOrigin && call.method === "eth_call" && typeof call.params?.[0]?.data === "string"; } catch { return false; } });
const grouped = new Map();
for (const call of targetCalls) {
  const selector = call.params[0].data.slice(0, 10), blockTag = call.params[1];
  if (!selectors.includes(selector)) continue;
  const set = grouped.get(blockTag) ?? new Set(); set.add(selector); grouped.set(blockTag, set);
}
const sameBlock = [...grouped.entries()].find(([, found]) => selectors.every(selector => found.has(selector)));
check("Target account, config and immutables use one block", Boolean(sameBlock), sameBlock ? `All five reads used ${sameBlock[0]}` : `No complete same-block call group found: ${JSON.stringify(targetCalls.map(call => [call.params?.[0]?.data?.slice(0, 10), call.params?.[1]]))}`);
const forbidden = rpcCalls.filter(call => ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign", "eth_requestAccounts"].includes(call.method));
check("QA remained read-only", forbidden.length === 0, "No signing, account request, or transaction broadcast RPC method was observed");
check("No browser runtime errors", browserErrors.length === 0, browserErrors.join("\n") || "none");

const report = [
  "# Public testnet UI live-readback QA", "", `Run: ${new Date().toISOString()}`, "",
  "Chrome used a fresh isolated profile. The run loaded the public deployment configuration and performed read-only RPC calls only.", "",
  "## Result", "", ...checks.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.name}: ${item.detail}`), "",
  "## Observed readback", "", `- Epoch: ${publicDemo.epochId}`, `- Source: ${sourceMain} — ${sourceDetail} — ${sourceMetrics}`, `- Target: ${targetMain} — ${targetDetail} — ${targetMetrics}`, `- Next action: ${actionMain} — ${actionDetail}`, `- Same target block tag: ${sameBlock?.[0] ?? "not established"}`, "",
  "## Evidence", "", "- live-settings-verified.png", "- live-funded-readback.png", "",
  "No wallet provider was injected. The harness did not request accounts, sign data, prepare a broadcast through a wallet, or send a transaction.", "",
].join("\n");
await writeFile(join(outputDir, "report.md"), report);
socket.close();
console.log(JSON.stringify({ checks, sourceMain, sourceDetail, targetMain, targetDetail, sameBlockTag: sameBlock?.[0], observedRpcCalls: rpcCalls.length, browserErrors }, null, 2));
