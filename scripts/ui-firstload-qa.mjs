import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cdpPort = Number(process.env.CDP_PORT ?? 9237);
const appUrl = process.env.UI_URL ?? "http://127.0.0.1:4173/";
const outputDir = process.env.UI_QA_OUTPUT ?? new URL("../evidence/ui-firstload-qa/", import.meta.url).pathname;
const deployment = JSON.parse(await readFile(new URL("../deployments/ui-testnet.json", import.meta.url), "utf8"));
await mkdir(outputDir, { recursive: true });

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No isolated Chrome page target found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
const pending = new Map();
const browserErrors = [];
const failedRequests = [];
const badResponses = [];
const rpcCalls = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") browserErrors.push(message.params.entry.text);
  if (message.method === "Network.loadingFailed") failedRequests.push(`${message.params.errorText} ${message.params.blockedReason ?? ""}`.trim());
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) badResponses.push(`${message.params.response.status} ${message.params.response.url}`);
  if (message.method === "Network.requestWillBeSent" && message.params.request.postData) {
    try {
      const body = JSON.parse(message.params.request.postData);
      for (const call of Array.isArray(body) ? body : [body]) if (call?.method) rpcCalls.push({ url: message.params.request.url, method: call.method });
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
async function waitFor(expression, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); }
async function text(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`); }
async function screenshot(name) {
  await new Promise(resolve => setTimeout(resolve, 250));
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
await waitFor("document.querySelector('#settings-result')?.classList.contains('success') && document.querySelector('#target-main')?.textContent === 'Exact epoch funded'");

const freshStatus = await text("#settings-result");
const freshTarget = `${await text("#target-main")} · ${await text("#target-detail")} · ${await text("#target-metrics")}`;
const freshSource = `${await text("#source-main")} · ${await text("#source-detail")} · ${await text("#source-metrics")}`;
check("Fresh browser verifies the public demo automatically", freshStatus.includes("built-in public demo loaded automatically") && freshStatus.includes("immutable source domain matches"), freshStatus);
check("Fresh browser performs both read-only chain reads", freshStatus.includes("Budget page now shows read-only state from both chains") && freshTarget.includes("Exact epoch funded"), `${freshSource} / ${freshTarget}`);
check("Automatic fresh load does not persist settings", await evaluate("localStorage.getItem('proofkey-work-treasury.workspace.v1') === null"), "workspace localStorage remains absent");
check("Fresh storage label is truthful", (await text("#settings-storage-tag")) === "Temporary public demo", await text("#settings-storage-tag"));
check("No injected wallet is needed", !(await evaluate("Boolean(window.ethereum)")), "window.ethereum is absent");
await click('[data-view="evidence"]');
await click("#rebuild-tree");
await waitFor("document.querySelector('#tree-result')?.classList.contains('success')");
const treeResult = await text("#tree-result");
check("Independent tree action rebuilds all public leaves", treeResult.includes("finalized block") && treeResult.includes("Leaves 4 / 128") && treeResult.includes("✓ Roots match") && treeResult.includes("✓ Every public allocation hashes to its stored leaf"), treeResult);
await evaluate("document.querySelector('#tree-result').scrollIntoView({block:'center'})");
await screenshot("independent-tree-rebuild.png");
await click('[data-view="settings"]');
await screenshot("fresh-public-demo.png");

const stale = structuredClone(deployment);
stale.source = { ...stale.source, label: "Stale reviewer setup", chainId: "1", confirmations: 12 };
stale.target = { ...stale.target, label: "Saved Creditcoin", confirmations: 12 };
const staleRaw = JSON.stringify(stale);
const callsBeforeStale = rpcCalls.length;
await evaluate(`localStorage.setItem('proofkey-work-treasury.workspace.v1', ${JSON.stringify(staleRaw)}); location.reload()`);
await waitFor("document.readyState === 'complete' && document.querySelector('#settings-result')?.textContent.includes('Saved setup restored')");
await new Promise(resolve => setTimeout(resolve, 1000));
const restoredStatus = await text("#settings-result");
check("Saved setup is restored without automatic verification", restoredStatus.includes("without making a network request"), restoredStatus);
check("Restored storage label is truthful", (await text("#settings-storage-tag")) === "Saved on this device", await text("#settings-storage-tag"));
check("Saved setup is not silently replaced", await evaluate(`localStorage.getItem('proofkey-work-treasury.workspace.v1') === ${JSON.stringify(staleRaw)}`), await evaluate("localStorage.getItem('proofkey-work-treasury.workspace.v1')"));
check("Saved setup triggered no RPC calls on load", rpcCalls.length === callsBeforeStale, `${rpcCalls.length - callsBeforeStale} calls`);

await click('[data-view="settings"]');
await click("#verify-settings");
await waitFor("document.querySelector('#settings-result')?.classList.contains('error')");
const staleError = await text("#settings-result");
check("Stale setup error remains visible", staleError.includes("Verification failed") && staleError.includes("reports chain 11155111, not 1") && staleError.includes("were not treated as verified"), staleError);
check("Failed verification does not change saved setup", await evaluate(`localStorage.getItem('proofkey-work-treasury.workspace.v1') === ${JSON.stringify(staleRaw)}`), "stale value still present");
await screenshot("stale-settings-error.png");

await click("#load-public-demo");
await waitFor("document.querySelector('#settings-result')?.classList.contains('success') && document.querySelector('#settings-result')?.textContent.includes('Public demo defaults selected') && document.querySelector('#target-main')?.textContent === 'Exact epoch funded'");
const recoveredStatus = await text("#settings-result");
const recovered = JSON.parse(await evaluate("localStorage.getItem('proofkey-work-treasury.workspace.v1')"));
check("Explicit public-demo action recovers stale setup", recoveredStatus.includes("Budget page now shows read-only state from both chains"), recoveredStatus);
check("Explicit public demo is labeled saved", (await text("#settings-storage-tag")) === "Saved on this device", await text("#settings-storage-tag"));
check("Public defaults replace settings only after the click", String(recovered.source.chainId) === String(deployment.source.chainId) && recovered.source.coordinator.toLowerCase() === deployment.source.coordinator.toLowerCase() && recovered.target.treasury.toLowerCase() === deployment.target.treasury.toLowerCase(), JSON.stringify(recovered));
await screenshot("public-demo-recovered.png");

const injection = await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  let current;
  Object.defineProperty(window, 'PROOFKEY_DEFAULT_CONFIG', {
    configurable: true,
    get() { return current; },
    set(value) {
      if (!window.__PROOFKEY_ORIGINAL_DEFAULT_CONFIG) {
        window.__PROOFKEY_ORIGINAL_DEFAULT_CONFIG = structuredClone(value);
        current = {...value, source:{...value.source, label:'Injected fresh-boot test', chainId:'1'}};
      } else current = value;
    }
  });
})()` });
await evaluate("localStorage.removeItem('proofkey-work-treasury.workspace.v1'); localStorage.removeItem('proofkey-work-treasury.draft.v1'); location.reload()");
await waitFor("document.readyState === 'complete' && !document.querySelector('#startup-status')?.hidden");
const startupFailure = await text("#startup-status");
const failedFreshCards = `${await text("#source-main")} / ${await text("#target-main")} / ${await text("#action-main")}`;
check("Injected configuration changed only the fresh-boot source domain", await evaluate("window.PROOFKEY_DEFAULT_CONFIG.source.label === 'Injected fresh-boot test' && String(window.PROOFKEY_DEFAULT_CONFIG.source.chainId) === '1' && String(window.__PROOFKEY_ORIGINAL_DEFAULT_CONFIG.source.chainId) === '11155111'"), await evaluate("JSON.stringify(window.PROOFKEY_DEFAULT_CONFIG.source)"));
check("Actual fresh-boot failure stays visible on Budget", !(await evaluate("document.querySelector('#startup-status').hidden")) && startupFailure.includes("Public demo could not be verified") && startupFailure.includes("reports chain 11155111, not 1") && startupFailure.includes("did not request a wallet"), startupFailure);
check("Failed fresh boot shows no stale chain state", failedFreshCards === "Not read yet / Not read yet / Connect the workspace" && await evaluate("document.querySelector('#source-metrics').textContent === '' && document.querySelector('#target-metrics').textContent === ''"), failedFreshCards);
check("Failed fresh boot does not save the injected default", await evaluate("localStorage.getItem('proofkey-work-treasury.workspace.v1') === null"), "workspace localStorage remains absent");
await screenshot("fresh-default-failure.png");
await evaluate("window.PROOFKEY_DEFAULT_CONFIG = window.__PROOFKEY_ORIGINAL_DEFAULT_CONFIG");
await click('[data-view="settings"]');
await click("#load-public-demo");
await waitFor("document.querySelector('#settings-result')?.classList.contains('success') && document.querySelector('#target-main')?.textContent === 'Exact epoch funded'");
check("Actual UI retry clears the Budget failure", await evaluate("document.querySelector('#startup-status').hidden") && (await text("#settings-result")).includes("Public demo defaults selected"), await text("#settings-result"));
await screenshot("fresh-default-retry.png");
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });

const forbidden = rpcCalls.filter(call => ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign", "eth_requestAccounts"].includes(call.method));
const criticalResponses = badResponses.filter(item => !item.endsWith("/favicon.ico"));
const criticalBrowserErrors = browserErrors.filter(item => !item.startsWith("Failed to load resource: the server responded with a status of 404"));
check("All automatic and recovery work remained read only", forbidden.length === 0, JSON.stringify(forbidden));
check("No browser runtime or critical request errors", criticalBrowserErrors.length === 0 && failedRequests.length === 0 && criticalResponses.length === 0, [...criticalBrowserErrors, ...failedRequests, ...criticalResponses].join("\n") || "none");

const report = [
  "# Public-demo first-load and stale-settings UI QA", "", `Run: ${new Date().toISOString()}`, `URL: ${appUrl}`, "",
  "Chrome used a new isolated profile. The run exercised the normal app UI with public read-only RPCs and no injected wallet. For the negative fresh-boot case, a CDP document-start setter changed the built-in source chain ID from 11155111 to 1 and added a test-only source label before demo-config.js completed; contract addresses, RPC URLs, target configuration and published files were not changed.", "",
  "## Result", "", ...checks.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.name}: ${String(item.detail).replaceAll("\n", " · ")}`), "",
  "## Fresh readback", "", `- Source: ${freshSource.replaceAll("\n", " · ")}`, `- Target: ${freshTarget.replaceAll("\n", " · ")}`, `- Setup status: ${freshStatus.replaceAll("\n", " · ")}`, `- Independent tree: ${treeResult.replaceAll("\n", " · ")}`, "",
  "## Stale and recovery behavior", "", `- Restored: ${restoredStatus.replaceAll("\n", " · ")}`, `- Visible error: ${staleError.replaceAll("\n", " · ")}`, `- Recovery: ${recoveredStatus.replaceAll("\n", " · ")}`, `- Forced fresh-load failure: ${startupFailure.replaceAll("\n", " · ")}`, "",
  "## Screenshots", "", "- fresh-public-demo.png", "- independent-tree-rebuild.png", "- stale-settings-error.png", "- public-demo-recovered.png", "- fresh-default-failure.png", "- fresh-default-retry.png", "",
  "No account request, signing method or transaction broadcast was observed. The public demo remains team controlled; this QA does not claim independent settlement.", "",
].join("\n");
await writeFile(join(outputDir, "report.md"), report);
socket.close();
console.log(JSON.stringify({ checks, freshStatus, freshSource, freshTarget, restoredStatus, staleError, recoveredStatus, observedRpcCalls: rpcCalls.length }, null, 2));
