import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cdpPort = Number(process.env.CDP_PORT ?? 9229);
const publicUrl = "https://pvgirish.github.io/ProofKey-Work-Treasury/";
const outputDir = new URL("../evidence/ui-public-qa/", import.meta.url).pathname;
const deployment = JSON.parse(await readFile(new URL("../deployments/ui-testnet.json", import.meta.url), "utf8"));
await mkdir(outputDir, { recursive: true });

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No isolated Chrome page target found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let requestId = 0;
const pending = new Map(), runtimeErrors = [], consoleErrors = [], failedRequests = [], badResponses = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); }
  if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
  if (message.method === "Network.loadingFailed") failedRequests.push(`${message.params.errorText} ${message.params.blockedReason ?? ""}`.trim());
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) badResponses.push(`${message.params.response.status} ${message.params.response.url}`);
});
function send(method, params = {}) { const id = ++requestId; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result?.value; }
async function waitFor(expression, timeoutMs = 30_000) { const start = Date.now(); while (Date.now() - start < timeoutMs) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error(`Timed out waiting for ${expression}`); }
async function screenshot(name) { await evaluate("new Promise(resolve=>{window.scrollTo({top:0,left:0,behavior:'instant'});requestAnimationFrame(()=>requestAnimationFrame(resolve))})"); await new Promise(resolve => setTimeout(resolve, 300)); const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }); await writeFile(join(outputDir, name), Buffer.from(result.data, "base64")); }
const checks = [];
function check(name, condition, detail) { checks.push({ name, passed: Boolean(condition), detail }); if (!condition) throw new Error(`${name}: ${detail}`); }

await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Network.clearBrowserCache");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: publicUrl });
await waitFor("document.readyState === 'complete' && document.querySelector('#abi-status')?.textContent.includes('compiled contract interfaces loaded')");
check("Published app URL loaded", await evaluate(`location.href === ${JSON.stringify(publicUrl)}`), publicUrl);
const assets = await evaluate("[...document.querySelectorAll('link[href],script[src]')].map(node => node.href || node.src)");
check("Published assets resolve under the project subpath", assets.length === 5 && assets.every(url => url.startsWith(publicUrl)), assets.join("\n"));
check("Three compiled interfaces loaded", (await evaluate("document.querySelector('#abi-status').textContent")) === "3 compiled contract interfaces loaded", await evaluate("document.querySelector('#abi-status').textContent"));
await evaluate("document.querySelector('[data-view=settings]').click()");
await waitFor("document.querySelector('#view-settings').classList.contains('active')");
const displayed = await evaluate("Object.fromEntries(['coordinator','safe','treasury'].map(name => [name, document.querySelector(`[name=${name}]`).value]))");
check("Published SourceCoordinator address matches deployment", displayed.coordinator.toLowerCase() === deployment.source.coordinator.toLowerCase(), displayed.coordinator);
check("Published Safe address matches deployment", displayed.safe.toLowerCase() === deployment.source.safe.toLowerCase(), displayed.safe);
check("Published WorkTreasury address matches deployment", displayed.treasury.toLowerCase() === deployment.target.treasury.toLowerCase(), displayed.treasury);
const criticalFailures = badResponses.filter(item => !item.endsWith("/favicon.ico"));
check("No JavaScript or critical asset errors", runtimeErrors.length === 0 && failedRequests.length === 0 && criticalFailures.length === 0, [...runtimeErrors, ...failedRequests, ...criticalFailures].join("\n") || "none");
await screenshot("published-network-configuration.png");
const report = [
  "# Published operator app QA", "", `Run: ${new Date().toISOString()}`, `URL: ${publicUrl}`, "",
  ...checks.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.name}: ${item.detail}`), "",
  "## Displayed deployment", "", `- SourceCoordinator: ${displayed.coordinator}`, `- Safe: ${displayed.safe}`, `- WorkTreasury: ${displayed.treasury}`, "",
  ...(badResponses.length ? ["## Non-critical browser resources", "", ...badResponses.map(item => `- ${item}`), ""] : []),
  "The check used a fresh isolated browser profile. It performed no wallet connection, signature, or transaction broadcast.", "",
].join("\n");
await writeFile(join(outputDir, "report.md"), report);
socket.close();
console.log(JSON.stringify({ checks, assets, displayed, runtimeErrors, consoleErrors, failedRequests, badResponses }, null, 2));
