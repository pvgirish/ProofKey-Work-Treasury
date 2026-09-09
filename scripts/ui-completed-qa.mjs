import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cdpPort = Number(process.env.CDP_PORT ?? 9234);
const appUrl = process.env.UI_URL ?? "http://127.0.0.1:4173/";
const outputDir = process.env.UI_QA_OUTPUT ?? new URL("../evidence/ui-completed-qa/", import.meta.url).pathname;
const deployment = JSON.parse(await readFile(new URL("../deployments/ui-testnet.json", import.meta.url), "utf8"));
const publicDemo = JSON.parse(await readFile(new URL("../evidence/public-demo.json", import.meta.url), "utf8"));
const claim1 = JSON.parse(await readFile(new URL("../evidence/claim-1.json", import.meta.url), "utf8"));
await mkdir(outputDir, { recursive: true });

if (publicDemo.stage !== "main-journey-complete") throw new Error(`Main journey is not frozen complete: ${publicDemo.stage}`);
if (!deployment.target.invoiceBook) throw new Error("Published UI config has no PaidInvoiceBook address");

const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No isolated Chrome page target found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => {
  socket.addEventListener("open", resolveOpen, { once: true });
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
      for (const call of Array.isArray(body) ? body : [body]) if (call?.method) rpcCalls.push({ url: message.params.request.url, method: call.method, params: call.params });
    } catch {}
  }
});
function send(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolveSend, reject) => { pending.set(id, { resolve: resolveSend, reject }); socket.send(JSON.stringify({ id, method, params })); });
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
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
async function click(selector) {
  await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing ${selector}'); node.click(); })()`);
}
async function text(selector) { return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? ''`); }
async function screenshot(name, selector) {
  await evaluate(`new Promise(resolveShot => { const node=document.querySelector(${JSON.stringify(selector)}); if(node) window.scrollTo({top:Math.max(0,window.scrollY+node.getBoundingClientRect().top-100),behavior:'instant'}); requestAnimationFrame(() => requestAnimationFrame(resolveShot)); })`);
  await new Promise(resolveWait => setTimeout(resolveWait, 250));
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

check("Completed public configuration loaded", await evaluate(`document.querySelector('#active-epoch').value.toLowerCase() === ${JSON.stringify(publicDemo.epochId.toLowerCase())}`), publicDemo.epochId);
check("PaidInvoiceBook default loaded", await evaluate(`document.querySelector('[name=invoiceBook]').value.toLowerCase() === ${JSON.stringify(deployment.target.invoiceBook.toLowerCase())}`), deployment.target.invoiceBook);
check("No injected wallet", !(await evaluate("Boolean(window.ethereum)")), "window.ethereum is absent in the isolated profile");

await click('[data-view="settings"]');
await click("#verify-settings");
await waitFor("document.querySelector('#settings-result').classList.contains('success')");
check("Configured domains verify", (await text("#settings-result")).includes("immutable source domain matches"), await text("#settings-result"));

const finalized = await evaluate(`(async () => {
  const provider = new ethers.JsonRpcProvider(${JSON.stringify(deployment.target.rpcUrl)});
  try {
    const block = await provider.getBlock('finalized');
    if (!block) throw new Error('Target RPC returned no finalized block');
    const treasury = new ethers.Contract(${JSON.stringify(deployment.target.treasury)}, window.PROOFKEY_ABI_MANIFEST.contracts.WorkTreasury.abi, provider);
    const invoiceBook = new ethers.Contract(${JSON.stringify(deployment.target.invoiceBook)}, window.PROOFKEY_ABI_MANIFEST.contracts.PaidInvoiceBook.abi, provider);
    const options = {blockTag:block.number};
    const [account, claim1, complete1, claim3, complete3, invoice1] = await Promise.all([
      treasury.epochAccount.staticCall(${JSON.stringify(publicDemo.epochId)}, options),
      treasury.claim.staticCall(${JSON.stringify(publicDemo.epochId)}, 1, options),
      treasury.completedClaim.staticCall(${JSON.stringify(publicDemo.epochId)}, 1, options),
      treasury.claim.staticCall(${JSON.stringify(publicDemo.epochId)}, 3, options),
      treasury.completedClaim.staticCall(${JSON.stringify(publicDemo.epochId)}, 3, options),
      invoiceBook.invoice.staticCall(${JSON.stringify(publicDemo.epochId)}, 1, options),
    ]);
    return {
      blockNumber:block.number, blockHash:block.hash,
      account:{reserve:String(account.reserve),recognized:String(account.recognized),funded:account.funded},
      claim1:{amount:String(claim1.allocation.amount),withdrawn:claim1.withdrawn,paidDestination:claim1.paidDestination},
      complete1:{amount:String(complete1.allocation.amount),withdrawn:complete1.withdrawn,paidDestination:complete1.paidDestination},
      claim3:{amount:String(claim3.allocation.amount),withdrawn:claim3.withdrawn,paidDestination:claim3.paidDestination},
      complete3:{amount:String(complete3.allocation.amount),withdrawn:complete3.withdrawn,paidDestination:complete3.paidDestination},
      invoice1:{amount:String(invoice1.amount),recorded:invoice1.recorded,paidDestination:invoice1.paidDestination},
    };
  } finally { provider.destroy?.(); }
})()`);
check("One finalized target block has zero reserve and 120 recognized", finalized.account.reserve === "0" && finalized.account.recognized === "120000000000000000000" && finalized.account.funded, `block ${finalized.blockNumber}; reserve ${finalized.account.reserve}; recognized ${finalized.account.recognized}`);
check("Worker A claim 1 is paid", finalized.claim1.withdrawn && finalized.complete1.withdrawn && finalized.claim1.amount === "30000000000000000000" && finalized.complete1.amount === finalized.claim1.amount, `${finalized.claim1.amount}; ${finalized.claim1.paidDestination}`);
check("Worker B claim 3 is paid", finalized.claim3.withdrawn && finalized.complete3.withdrawn && finalized.claim3.amount === "25000000000000000000" && finalized.complete3.amount === finalized.claim3.amount, `${finalized.claim3.amount}; ${finalized.claim3.paidDestination}`);
check("Completed WORK invoice is recorded", finalized.invoice1.recorded && finalized.invoice1.amount === finalized.claim1.amount && finalized.invoice1.paidDestination.toLowerCase() === finalized.claim1.paidDestination.toLowerCase(), `${finalized.invoice1.amount}; ${finalized.invoice1.paidDestination}`);

await click('[data-view="overview"]');
await click("#load-epoch");
await waitFor("['Exact epoch funded','Target unavailable'].includes(document.querySelector('#target-main')?.textContent)");
const targetMain = await text("#target-main"), targetDetail = await text("#target-detail"), targetMetrics = await text("#target-metrics");
const sourceMain = await text("#source-main"), sourceDetail = await text("#source-detail"), actionMain = await text("#action-main"), actionDetail = await text("#action-detail");
check("Completed target totals render in Budget", targetMain === "Exact epoch funded" && targetDetail.includes("finalized block") && targetMetrics.includes("0.0 CTC") && targetMetrics.includes("120.0 CTC"), `${targetMain}; ${targetDetail}; ${targetMetrics}`);
check("Source lag cannot authorize a guessed action", sourceMain !== "Source unavailable" || (actionMain === "Wait for complete readback" && actionDetail.includes("Refresh")), `${sourceMain}; ${sourceDetail}; ${actionMain}; ${actionDetail}`);
await screenshot("completed-budget.png", "#view-overview");

await click('[data-view="payments"]');
await evaluate(`document.querySelector('#payment-epoch').value=${JSON.stringify(publicDemo.epochId)}; document.querySelector('#payment-allocation').value='1'`);
await click("#lookup-payment");
await waitFor("document.querySelector('#payment-result').classList.contains('success')");
const payment1 = await text("#payment-result");
check("Payment UI renders paid worker A", payment1.includes("30.0 CTC") && payment1.includes("Withdrawn Yes") && payment1.includes("Invoice recorded"), payment1);
await screenshot("completed-payment-claim-1.png", ".lookup-card");

await evaluate("document.querySelector('#payment-allocation').value='3'");
await click("#lookup-payment");
await waitFor("document.querySelector('#payment-result').classList.contains('success') && document.querySelector('#payment-result').textContent.includes('25.0 CTC')");
const payment3 = await text("#payment-result");
check("Payment UI renders paid worker B", payment3.includes("25.0 CTC") && payment3.includes("Withdrawn Yes"), payment3);

await click('[data-view="evidence"]');
await evaluate(`(() => {
  const input=document.querySelector('#claim-file');
  const transfer=new DataTransfer();
  transfer.items.add(new File([${JSON.stringify(JSON.stringify(claim1))}], 'claim-1.json', {type:'application/json'}));
  input.files=transfer.files;
  input.dispatchEvent(new Event('change',{bubbles:true}));
})()`);
await waitFor("document.querySelector('#claim-package').value.includes('proofkey.work-treasury.claim-package.v1')");
await click("#inspect-package");
await waitFor("document.querySelector('#package-result').classList.contains('success')");
const imported = await text("#package-result");
check("Claim 1 file imports and validates", imported.includes("Application package is internally consistent") && imported.includes("Route checkpoint") && imported.includes("Allocation 1") && imported.includes("Amount 30.0 CTC") && imported.includes("does not claim native authenticity or payment"), imported);
check("Imported package prepares no broadcast", !(await evaluate("document.querySelector('#prepare-claim').disabled")), "Prepare is available, but was not selected");
await screenshot("imported-claim-1.png", ".evidence-cols");

const forbidden = rpcCalls.filter(call => ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign", "eth_requestAccounts"].includes(call.method));
const criticalResponses = badResponses.filter(item => !item.endsWith("/favicon.ico"));
const criticalBrowserErrors = browserErrors.filter(item => !item.startsWith("Failed to load resource: the server responded with a status of 404"));
check("QA remained read only", forbidden.length === 0, "No account request, signing, or broadcast RPC method was observed");
check("No browser runtime or critical request errors", criticalBrowserErrors.length === 0 && failedRequests.length === 0 && criticalResponses.length === 0, [...criticalBrowserErrors, ...failedRequests, ...criticalResponses].join("\n") || "none");

const report = [
  "# Completed public journey UI QA", "", `Run: ${new Date().toISOString()}`, "",
  "Chrome used a new isolated profile against the rebuilt local UI and public read-only RPCs. No wallet provider was injected.", "",
  "## Result", "", ...checks.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.name}: ${String(item.detail).replaceAll("\n", " · ")}`), "",
  "## One-block target snapshot", "", `- Finalized block: ${finalized.blockNumber}`, `- Block hash: ${finalized.blockHash}`, `- Epoch: ${publicDemo.epochId}`, `- Reserve: ${finalized.account.reserve}`, `- Recognized: ${finalized.account.recognized}`, `- Claim 1: ${finalized.claim1.amount}; withdrawn ${finalized.claim1.withdrawn}; paid ${finalized.claim1.paidDestination}`, `- Claim 3: ${finalized.claim3.amount}; withdrawn ${finalized.claim3.withdrawn}; paid ${finalized.claim3.paidDestination}`, `- Invoice 1 recorded: ${finalized.invoice1.recorded}`, "",
  "All values in this snapshot were requested with the same explicit finalized target block tag. The payment cards were then exercised through the normal UI read path.", "",
  "## UI readback", "", `- Target: ${targetMain} — ${targetDetail} — ${targetMetrics}`, `- Source: ${sourceMain} — ${sourceDetail}`, `- Next action: ${actionMain} — ${actionDetail}`, `- Claim 1 payment: ${payment1.replaceAll("\n", " · ")}`, `- Claim 3 payment: ${payment3.replaceAll("\n", " · ")}`, `- Imported claim: ${imported.replaceAll("\n", " · ")}`, "",
  "## Screenshots", "", "- completed-budget.png", "- completed-payment-claim-1.png", "- imported-claim-1.png", "",
  "The harness did not connect a wallet, request an account, sign, prepare a wallet broadcast, or submit a transaction. The public run remains team controlled and does not satisfy the independent-participant gates.", "",
].join("\n");
await writeFile(join(outputDir, "report.md"), report);
socket.close();
console.log(JSON.stringify({ checks, finalized, targetMain, targetDetail, sourceMain, sourceDetail, payment1, payment3, imported, observedRpcCalls: rpcCalls.length, browserErrors: criticalBrowserErrors, failedRequests, nonCriticalResponses: badResponses.filter(item => item.endsWith("/favicon.ico")) }, null, 2));
