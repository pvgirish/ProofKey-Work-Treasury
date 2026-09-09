import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cdpPort = Number(process.env.CDP_PORT ?? 9228);
const appUrl = process.env.UI_URL ?? "http://127.0.0.1:4173/";
const outputDir = new URL("../evidence/ui-proof-qa/", import.meta.url).pathname;
const sourceDemo = JSON.parse(await readFile(new URL("../evidence/source-demo.json", import.meta.url), "utf8"));
const operation = sourceDemo.operations.find(item => item.label === "approve-A") ?? sourceDemo.operations.find(item => item.label === "release-free-50");
if (!operation?.transactionHash) throw new Error("No completed approve-A or release-free-50 transaction was found");
await mkdir(outputDir, { recursive: true });
const filesBefore = new Set(await readdir(outputDir));

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No isolated Chrome page target found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let requestId = 0;
const pending = new Map();
const browserErrors = [], rpcMethods = [], proofResponses = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
  if (message.method === "Network.requestWillBeSent" && message.params.request.postData) {
    try { const body = JSON.parse(message.params.request.postData); for (const call of Array.isArray(body) ? body : [body]) if (call?.method) rpcMethods.push(call.method); } catch {}
  }
  if (message.method === "Network.responseReceived" && message.params.response.url.includes("/api/v1/proof-by-tx/")) proofResponses.push({ url: message.params.response.url, status: message.params.response.status, headers: message.params.response.headers });
});
function send(method, params = {}) { const id = ++requestId; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result?.value; }
async function waitFor(expression, timeoutMs = 45_000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error(`Timed out waiting for ${expression}`); }
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function value(selector, next) { await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); node.value=${JSON.stringify(next)}; node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true})); })()`); }
async function text(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`); }
async function screenshot(name) { await evaluate("new Promise(resolve=>{window.scrollTo({top:0,left:0,behavior:'instant'});requestAnimationFrame(()=>requestAnimationFrame(resolve))})"); const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }); await writeFile(join(outputDir, name), Buffer.from(result.data, "base64")); }
const checks = [];
function check(name, condition, detail) { checks.push({ name, passed: Boolean(condition), detail }); if (!condition) throw new Error(`${name}: ${detail}`); }

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Network.clearBrowserCache");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: outputDir });
await send("Page.navigate", { url: appUrl });
await waitFor("document.readyState === 'complete' && document.querySelector('#view-evidence')");
await evaluate("localStorage.removeItem('proofkey-work-treasury.workspace.v1'); localStorage.removeItem('proofkey-work-treasury.draft.v1'); location.reload()");
await waitFor("document.readyState === 'complete' && document.querySelector('#view-evidence')");
await click('[data-view="evidence"]');
const configuredUrl = await evaluate("document.querySelector('#proof-url').value");
const configuredChainKey = await evaluate("document.querySelector('#proof-chain-key').value");
check("Public proof service is configured", configuredUrl === "https://prover.cc3-testnet.creditcoin.network", configuredUrl);
check("Native source chain key is configured", configuredChainKey === "1", configuredChainKey);
await value("#proof-tx", operation.transactionHash);
await click("#fetch-proof");
await waitFor("document.querySelector('#proof-result').classList.contains('success') || document.querySelector('#proof-result').classList.contains('error')");
const proofResult = await text("#proof-result");
await screenshot("browser-proof-response.png");
check("Browser fetched and validated proof", await evaluate("document.querySelector('#proof-result').classList.contains('success')"), proofResult);
check("Export control is enabled", !(await evaluate("document.querySelector('#export-proof').disabled")), "Export proof material is enabled after validation");
check("Proof response matches completed source transaction", proofResult.includes(`Block ${operation.blockNumber}`) && proofResult.includes("Encoded transaction") && proofResult.includes("continuity roots"), proofResult);
await click("#export-proof");
const expectedName = `proofkey-native-proof-${operation.transactionHash.slice(2, 10)}.json`;
await waitFor(`true`, 500);
let downloaded;
for (let attempt = 0; attempt < 60; attempt++) {
  const files = await readdir(outputDir);
  downloaded = files.find(name => name === expectedName && !filesBefore.has(name));
  if (downloaded) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
check("Validated proof material downloaded", Boolean(downloaded), expectedName);
const exported = JSON.parse(await readFile(join(outputDir, downloaded), "utf8"));
check("Export has directly usable SingleProof fields", exported.transactionHash.toLowerCase() === operation.transactionHash.toLowerCase() && exported.chainKey === "1" && String(exported.blockHeight) === String(operation.blockNumber) && /^0x[0-9a-f]+$/i.test(exported.encodedTransaction) && Array.isArray(exported.merkleProof?.siblings) && Array.isArray(exported.continuityProof?.roots) && exported.continuityProof.roots.length > 0, `block ${exported.blockHeight}; ${exported.merkleProof?.siblings?.length} siblings; ${exported.continuityProof?.roots?.length} roots`);
const response = proofResponses.at(-1);
const corsHeader = Object.entries(response?.headers ?? {}).find(([name]) => name.toLowerCase() === "access-control-allow-origin")?.[1];
check("Proof service permits browser CORS", response?.status === 200 && Boolean(corsHeader), `HTTP ${response?.status}; Access-Control-Allow-Origin ${corsHeader ?? "missing"}`);
check("No target transaction was submitted", !rpcMethods.some(method => ["eth_sendTransaction", "eth_sendRawTransaction", "eth_requestAccounts", "eth_sign", "personal_sign"].includes(method)), "No account, signing, or broadcast RPC method was observed");
check("No browser runtime errors", browserErrors.length === 0, browserErrors.join("\n") || "none");

const report = [
  "# Browser proof-service integration QA", "", `Run: ${new Date().toISOString()}`, "",
  `Source operation: ${operation.label}`, `Transaction: ${operation.transactionHash}`, `Source block: ${operation.blockNumber}`, "",
  "## Result", "", ...checks.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.name}: ${item.detail}`), "",
  "## Browser evidence", "", `- Service response: HTTP ${response?.status}; Access-Control-Allow-Origin ${corsHeader}`, `- UI result: ${proofResult.replaceAll("\n", " · ")}`, `- Export: ${downloaded}`, "- Screenshot: browser-proof-response.png", "",
  "The browser used a fresh isolated profile. It did not inject a wallet, request accounts, sign, or submit a target transaction.", "",
].join("\n");
await writeFile(join(outputDir, "report.md"), report);
socket.close();
console.log(JSON.stringify({ checks, proofResult, responseStatus: response?.status, corsHeader, downloaded, browserErrors }, null, 2));
