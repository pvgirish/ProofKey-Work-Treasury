// Isolated supplemental check — closes ui-qa's remaining unique assertions.
// Unlocks the session via the app's OWN public-demo verification (REAL read-only chain reads),
// then exercises the epoch builder. No wallet, no signing, no broadcast. Writes nothing to the repo.
const cdpPort = Number(process.env.CDP_PORT ?? 9246);
const appUrl = process.env.UI_URL ?? "http://127.0.0.1:4173/";
const v = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(r => r.json());
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 0; const pending = new Map(); const walletCalls = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const w = pending.get(m.id); pending.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
  if (m.method === "Network.requestWillBeSent" && m.params.request.postData) {
    try { const b = JSON.parse(m.params.request.postData); for (const c of Array.isArray(b) ? b : [b]) if (c?.method && ["eth_requestAccounts","eth_sendTransaction","eth_sendRawTransaction","eth_signTypedData_v4","personal_sign"].includes(c.method)) walletCalls.push(c.method); } catch {}
  }
});
const send = (method, params = {}, sessionId) => { const rid = ++id; return new Promise((resolve, reject) => { pending.set(rid, { resolve, reject }); ws.send(JSON.stringify({ id: rid, method, params, ...(sessionId ? { sessionId } : {}) })); }); };

const { browserContextId } = await send("Target.createBrowserContext");
const { targetId } = await send("Target.createTarget", { url: appUrl, browserContextId });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Runtime.enable", {}, sessionId);
await send("Network.enable", {}, sessionId);
const ev = async expr => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const waitFor = async (expr, ms = 90000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(`Boolean(${expr})`)) return true; await new Promise(r => setTimeout(r, 150)); } return false; };

const results = {};
await waitFor("document.readyState === 'complete' && document.querySelector('#view-overview')");

// 1. Locked before verification.
await ev(`document.querySelector('[data-view="settings"]')?.click()`);
await waitFor("document.querySelector('#view-settings')?.classList.contains('active')");
results.lockedBeforeVerification = await ev(`(()=>{try{requireVerifiedWorkspace();return false;}catch(e){return String(e.message).includes('Verify this trusted deployment');}})()`);

// 2. Unlock using the app's own published-runtime-hash verification (REAL read-only chain reads).
await ev(`document.querySelector('#load-public-demo')?.click()`);
const unlocked = await waitFor("document.querySelector('#settings-result')?.textContent.includes('write preparation is unlocked')", 120000);
results.sessionUnlocked = unlocked;
results.fingerprintVerified = await ev(`verifiedWorkspaceFingerprint === workspaceFingerprint()`);
if (!unlocked) { results.settingsText = await ev(`document.querySelector('#settings-result')?.textContent ?? ''`); }

// 3. Epoch preparation AFTER valid session verification.
const setV = async (sel, val) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 'MISSING'; el.value=${JSON.stringify(val)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()`);
async function submitEpoch(cap) {
  await setV("#epoch-form [name=sponsor]", "0x5555555555555555555555555555555555555555");
  await setV("#epoch-form [name=refundBeneficiary]", "0x6666666666666666666666666666666666666666");
  await setV("#epoch-form [name=cap]", cap);
  await setV("#epoch-form [name=initializationCutoff]", "12000000");
  await setV("#epoch-form [name=admissionCutoff]", "12001000");
  await setV("#epoch-form [name=nonce]", "7");
  await ev(`document.querySelector('#epoch-form button[type=submit]')?.click()`);
  await new Promise(r => setTimeout(r, 900));
  return { text: await ev(`document.querySelector('#epoch-result')?.textContent ?? ''`), cls: await ev(`document.querySelector('#epoch-result')?.className ?? ''`) };
}

const valid = await submitEpoch("120");
results.validEpochPrepared = valid.text.includes("Exact epoch ID") && valid.cls.includes("success");
results.epochIdShape = /Exact epoch ID 0x[0-9a-f]{64}/.test(valid.text);
results.canonicalBaseUnits = valid.text.includes("120000000000000000000 base units");
results.statesNoWriteOccurred = valid.text.includes("No source initialization or target funding has occurred.");
results.validEpochText = valid.text.split("\n")[0];

const over18 = await submitEpoch("1.0000000000000000001"); // 19 decimals
results.rejects19Decimals = over18.cls.includes("error") && over18.text.includes("up to 18 decimal places");
results.over18Text = over18.text;

const huge = await submitEpoch("115792089237316195423570985008687907853269984665640564039458"); // > uint256 after 1e18 scaling
results.rejectsUint256Overflow = huge.cls.includes("error");
results.hugeText = huge.text;

const negative = await submitEpoch("-5");
results.rejectsNegative = negative.cls.includes("error");

results.walletCalls = walletCalls;
results.noWalletCalls = walletCalls.length === 0;
results.observedAt = new Date().toISOString();

console.log(JSON.stringify(results, null, 2));
await send("Target.disposeBrowserContext", { browserContextId });
ws.close();
