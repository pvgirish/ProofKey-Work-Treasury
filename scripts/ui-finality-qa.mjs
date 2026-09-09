import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cdpPort = Number(process.env.CDP_PORT ?? 9238);
const appUrl = process.env.UI_URL ?? "http://127.0.0.1:4173/";
const outputDir = process.env.UI_QA_OUTPUT ?? new URL("../evidence/ui-finality-qa/", import.meta.url).pathname;
const deployment = JSON.parse(await readFile(new URL("../deployments/ui-testnet.json", import.meta.url), "utf8"));
await mkdir(outputDir, { recursive: true });

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No isolated Chrome page target found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });

let requestId = 0;
const pending = new Map();
const browserErrors = [], failedRequests = [], badResponses = [], rpcCalls = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") browserErrors.push(message.params.entry.text);
  if (message.method === "Network.loadingFailed") failedRequests.push(`${message.params.errorText} ${message.params.blockedReason ?? ""}`.trim());
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) badResponses.push(`${message.params.response.status} ${message.params.response.url}`);
  if (message.method === "Network.requestWillBeSent" && message.params.request.postData) {
    try { const body = JSON.parse(message.params.request.postData); for (const call of Array.isArray(body) ? body : [body]) if (call?.method) rpcCalls.push(call.method); } catch {}
  }
});
function send(method, params = {}) { const id = ++requestId; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result?.value; }
async function waitFor(expression, timeoutMs = 90_000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error(`Timed out waiting for ${expression}`); }
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); }
async function text(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`); }
async function screenshot(name, selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`); await new Promise(resolve => setTimeout(resolve, 200)); const capture = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }); await writeFile(join(outputDir, name), Buffer.from(capture.data, "base64")); }
const checks = [];
function check(name, condition, detail) { checks.push({ name, passed: Boolean(condition), detail }); if (!condition) throw new Error(`${name}: ${detail}`); }
function stage(name) { console.log(`[ui-finality-qa] ${name}`); }

stage("loading public read-only state");
await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
await send("Network.clearBrowserCache"); await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: appUrl });
await waitFor("document.readyState === 'complete' && document.querySelector('#settings-result')?.classList.contains('success') && document.querySelector('#target-main')?.textContent === 'Exact epoch funded'");
check("Public demo loaded without a wallet", !(await evaluate("Boolean(window.ethereum)")) && (await text("#target-main")) === "Exact epoch funded", await text("#target-detail"));

stage("forcing finalized-tag unavailability for quote");
await click('[data-view="orders"]');
await evaluate(`(() => {
  window.__walletCalls = [];
  window.ethereum = {request: async args => { window.__walletCalls.push(args.method); throw new Error('QA wallet must not be called'); }, on() {}, removeListener() {}};
  currentDraft = {version:'proofkey.work-treasury.draft.v1', authority:'none', orderId:'0x'+'11'.repeat(32), terms:{epochId:${JSON.stringify(deployment.lastEpochId)}, worker:'0x'+'22'.repeat(20), milestones:[{work:'0',fee:'0'}]}};
  document.querySelector('#sign-quote').disabled=false;
  window.__realGetBlock = ethers.JsonRpcProvider.prototype.getBlock;
  window.__realSourceCapacity = sourceCapacity;
  window.__sourceCapacityCalls = 0;
  sourceCapacity = async (...args) => { window.__sourceCapacityCalls++; return window.__realSourceCapacity(...args); };
  ethers.JsonRpcProvider.prototype.getBlock = async function(tag) { if (tag === 'finalized') return null; return window.__realGetBlock.call(this, tag); };
})()`);

await click("#sign-quote");
await waitFor("document.querySelector('#draft-result')?.classList.contains('error')");
const quoteError = await text("#draft-result");
check("Unavailable finalized tag blocks quote before source-capacity or wallet access", quoteError.includes("Binding worker consent and delivery require a real finalized Creditcoin block") && quoteError.includes("confirmation-depth fallback is available for inspection only") && await evaluate("window.__sourceCapacityCalls === 0 && window.__walletCalls.length === 0"), `${quoteError} Source-capacity calls: ${await evaluate("window.__sourceCapacityCalls")}.`);
check("Failed quote remains unsigned and has no observation", await evaluate("currentDraft.authority === 'none' && !currentDraft.workerSignature && !currentDraft.targetFundingRead"), await evaluate("JSON.stringify(currentDraft)"));
await screenshot("quote-finality-required.png", "#draft-result");

stage("forcing finalized-tag unavailability for delivery");
await evaluate(`(() => {
  currentOrderRead = {orderId:'0x'+'33'.repeat(32), milestoneId:0, order:{epochId:${JSON.stringify(deployment.lastEpochId)}}, milestone:{deliveryHash:'0x'+'00'.repeat(32),stateVersion:'1'}, stable:{label:'QA state read'}};
  document.querySelector('#delivery-content').value='ipfs://qa-delivery';
  document.querySelector('#action-deliver').disabled=false;
  window.__beforeDelivery = {signature:document.querySelector('#source-function').value,args:document.querySelector('#source-args').value};
  preparedSource = null;
})()`);
await click("#action-deliver");
await waitFor("document.querySelector('#order-result')?.classList.contains('error')");
const deliveryError = await text("#order-result");
check("Unavailable finalized tag blocks delivery persistently", deliveryError.includes("Delivery was not prepared") && deliveryError.includes("require a real finalized Creditcoin block"), deliveryError);
check("Failed delivery changes no prepared call", await evaluate("preparedSource === null && document.querySelector('#source-function').value === window.__beforeDelivery.signature && document.querySelector('#source-args').value === window.__beforeDelivery.args"), await evaluate("JSON.stringify({preparedSource,signature:document.querySelector('#source-function').value,args:document.querySelector('#source-args').value})"));
await screenshot("delivery-finality-required.png", "#order-result");

const fallback = await evaluate(`(async () => { const provider=new ethers.JsonRpcProvider(${JSON.stringify(deployment.target.rpcUrl)}); try { return await stableBlock(provider, 12); } finally { provider.destroy?.(); } })()`);
check("Read-only inspection retains labeled fallback", fallback.label.includes("confirmations behind head; finality not asserted"), JSON.stringify(fallback));
await evaluate("refreshReadback({persistEpoch:false})");
const fallbackReadback = { main: await text("#target-main"), detail: await text("#target-detail") };
check("Default target inspection still works through the labeled fallback", fallbackReadback.main === "Exact epoch funded" && fallbackReadback.detail.includes("confirmations behind head; finality not asserted"), JSON.stringify(fallbackReadback));

stage("restoring genuine finalized target reads");
await evaluate("ethers.JsonRpcProvider.prototype.getBlock = window.__realGetBlock; sourceCapacity = window.__realSourceCapacity");
const finalized = await evaluate(`(async () => { const result=await targetFunding(${JSON.stringify(deployment.lastEpochId)},0n); return {block:result.block,blockHash:result.blockHash,blockLabel:result.blockLabel,finalityBasis:result.finalityBasis,reserve:String(result.reserve)}; })()`);
check("Finalized funding path returns block hash and basis", Number.isSafeInteger(finalized.block) && /^0x[0-9a-f]{64}$/i.test(finalized.blockHash) && finalized.blockLabel === `finalized block ${finalized.block}` && finalized.finalityBasis === "rpc-finalized-tag", JSON.stringify(finalized));

await click("#action-deliver");
await waitFor("document.querySelector('#source-function')?.selectedOptions[0]?.textContent === 'deliver' && document.querySelector('#source-args')?.value.includes('0x')");
const preparedDelivery = await evaluate("({signature:document.querySelector('#source-function').value,args:JSON.parse(document.querySelector('#source-args').value),walletCalls:window.__walletCalls})");
check("Genuine finalized gate permits synthetic delivery-call preparation without wallet", preparedDelivery.signature.startsWith("deliver(") && preparedDelivery.args.length === 3 && preparedDelivery.walletCalls.length === 0, JSON.stringify(preparedDelivery));

stage("writing report");
const forbidden = rpcCalls.filter(method => ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "eth_signTypedData_v4", "personal_sign", "eth_requestAccounts"].includes(method));
const criticalResponses = badResponses.filter(item => !item.endsWith("/favicon.ico")), criticalBrowserErrors = browserErrors.filter(item => !item.startsWith("Failed to load resource: the server responded with a status of 404"));
check("QA made no signing, account or broadcast request", forbidden.length === 0 && await evaluate("window.__walletCalls.length === 0"), JSON.stringify({ forbidden, walletCalls: await evaluate("window.__walletCalls") }));
check("No browser runtime or critical request errors", criticalBrowserErrors.length === 0 && failedRequests.length === 0 && criticalResponses.length === 0, [...criticalBrowserErrors, ...failedRequests, ...criticalResponses].join("\n") || "none");

const report = [
  "# Binding-consent target finality UI QA", "", `Run: ${new Date().toISOString()}`, `URL: ${appUrl}`, "",
  "An isolated browser loaded the public read-only configuration. The negative case then replaced JsonRpcProvider.getBlock only inside that page so `finalized` returned null while ordinary block-number reads remained available. A recording EIP-1193 wallet stub would fail any wallet request; it recorded none. A source-capacity spy delegated to the real function if called and proved that the finality error happened first. The successful case restored ethers' original provider method and read the real public finalized target block.", "",
  "The quote draft was an injected unsigned, zero-amount fixture used only to exercise the real Sign Quote button's gate ordering. The pending order was also an injected UI fixture used only to exercise the real Deliver button and calldata-preparation boundary. The live public epoch is complete with zero reserve; no source capacity, worker account, live pending order, funded worker consent, or live deliverability is claimed. No source-capacity or account result was mocked.", "",
  "## Result", "", ...checks.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.name}: ${String(item.detail).replaceAll("\n", " · ")}`), "",
  "## Finalized observation", "", `- Block: ${finalized.block}`, `- Hash: ${finalized.blockHash}`, `- Basis: ${finalized.finalityBasis}`, `- Reserve at completed public epoch: ${finalized.reserve} base units`, "",
  "The funding observation is unsigned metadata stored only after a quote is signed; it does not change EpochConfig, OrderTerms, termsHash, orderId or the ProofKeyQuoteV1 payload. Existing saved drafts are not re-signed or rewritten. The positive delivery assertion means only that a genuine finalized target gate allowed local calldata preparation for the injected UI fixture; it is not evidence of a currently deliverable public order.", "",
  "## Screenshots", "", "- quote-finality-required.png", "- delivery-finality-required.png", "",
  "No real wallet was present. The harness made no account request, signature request or transaction broadcast.", "",
].join("\n");
await writeFile(join(outputDir, "report.md"), report);
socket.close();
console.log(JSON.stringify({ checks, quoteError, deliveryError, fallback, finalized, preparedDelivery, observedRpcCalls: rpcCalls.length }, null, 2));
