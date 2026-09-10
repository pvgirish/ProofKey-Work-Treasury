import { readFile } from "node:fs/promises";

const cdpPort = Number(process.env.CDP_PORT ?? 9244);
const appUrl = process.env.UI_URL ?? "http://127.0.0.1:4173/";
const deployment = JSON.parse(await readFile(new URL("../deployments/ui-testnet.json", import.meta.url), "utf8"));
const vector = JSON.parse(await readFile(new URL("../schema/work-authorization-v1-vectors.json", import.meta.url), "utf8"));
const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then(response => response.json());
const page = pages.find(item => item.type === "page");
if (!page) throw new Error("No isolated Chrome page target found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });

const browserVersion = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then(response => response.json());
const browserSocket = new WebSocket(browserVersion.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { browserSocket.addEventListener("open", resolve, { once: true }); browserSocket.addEventListener("error", reject, { once: true }); });

let requestId = 0;
const pending = new Map();
const rpcMethods = [], browserErrors = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception");
  if (message.method === "Network.requestWillBeSent" && message.params.request.postData) {
    try { const body = JSON.parse(message.params.request.postData); for (const call of Array.isArray(body) ? body : [body]) if (call?.method) rpcMethods.push(call.method); } catch {}
  }
});
function send(method, params = {}) { const id = ++requestId; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result?.value; }
async function waitFor(expression, timeoutMs = 90_000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out waiting for ${expression}`); }
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); }
const checks = [];
function check(name, condition, detail) { checks.push({ name, passed: Boolean(condition), detail }); if (!condition) throw new Error(`${name}: ${detail}`); }

let browserRequestId = 0;
const browserPending = new Map();
browserSocket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && browserPending.has(message.id)) { const waiter = browserPending.get(message.id); browserPending.delete(message.id); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text ?? "Runtime exception in isolated participant context");
});
function browserSend(method, params = {}, sessionId) {
  const id = ++browserRequestId;
  return new Promise((resolve, reject) => {
    browserPending.set(id, { resolve, reject });
    browserSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function isolatedParticipant() {
  const { browserContextId } = await browserSend("Target.createBrowserContext");
  const { targetId } = await browserSend("Target.createTarget", { url: appUrl, browserContextId });
  const { sessionId } = await browserSend("Target.attachToTarget", { targetId, flatten: true });
  await browserSend("Runtime.enable", {}, sessionId);
  const evaluateParticipant = async expression => {
    const response = await browserSend("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    if (await evaluateParticipant("Boolean(window.PROOFKEY_CONSENT_SDK && document.querySelector('#settings-result'))")) return { browserContextId, evaluate: evaluateParticipant };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Timed out loading isolated participant context");
}

await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.navigate", { url: appUrl });
await waitFor("window.PROOFKEY_CONSENT_SDK && document.querySelector('#settings-result')");
await evaluate(`(() => {
  const unsigned = window.PROOFKEY_CONSENT_SDK.createWorkAuthorizationDraft({authorization:${JSON.stringify(vector.authorization)},createdAt:'2026-09-10T10:00:00.000Z'});
  const signed = window.PROOFKEY_CONSENT_SDK.attachWorkerQuoteSignature(unsigned,{workerSignature:'0x01',signatureValidation:{sourceChainId:'11155111',sourceCoordinator:'0x1111111111111111111111111111111111111111',blockNumber:'101',blockHash:'0x'+'ff'.repeat(32)}});
  localStorage.setItem('proofkey-work-treasury.workspace.v1',${JSON.stringify(JSON.stringify(deployment))});
  localStorage.setItem('proofkey-work-treasury.draft.v1',JSON.stringify(signed));
  location.reload();
})()`);
const beforeRestoreRpc = rpcMethods.length;
await waitFor("document.querySelector('#settings-result')?.textContent.includes('Saved setup restored') && window.PROOFKEY_CONSENT_SDK");
await new Promise(resolve => setTimeout(resolve, 500));
const restored = await evaluate(`({
  rpcDelta:${rpcMethods.length - beforeRestoreRpc},
  sign:document.querySelector('#sign-quote').disabled,
  initialize:document.querySelector('#prepare-initialize').disabled,
  fund:document.querySelector('#fund-built-epoch').disabled,
  sourcePrepare:document.querySelector('#prepare-source').disabled,
  targetSend:document.querySelector('#execute-target').disabled,
  evidencePrepare:document.querySelector('#prepare-evidence').disabled,
  invoiceSend:document.querySelector('#record-invoice').disabled,
  prepared:document.querySelector('#source-prepared').hidden,
  text:document.querySelector('#draft-result').textContent
})`);
check("Restored signed work remains locked without current-session verification", restored.rpcDelta === 0 && restored.sign && restored.initialize && restored.fund && restored.sourcePrepare && restored.targetSend && restored.evidencePrepare && restored.invoiceSend && restored.prepared && restored.text.includes("Current-session verification is required"), JSON.stringify(restored));

await click("#load-public-demo");
await waitFor("document.querySelector('#settings-result')?.textContent.includes('write preparation is unlocked')");
const trusted = await evaluate("({trusted:verifiedWorkspaceFingerprint === workspaceFingerprint(),sourcePrepare:!document.querySelector('#prepare-source').disabled,targetSend:!document.querySelector('#execute-target').disabled,evidencePrepare:!document.querySelector('#prepare-evidence').disabled,invoiceSend:!document.querySelector('#record-invoice').disabled})");
check("Published runtime hashes unlock the current session", trusted.trusted && trusted.sourcePrepare && trusted.targetSend && trusted.evidencePrepare && trusted.invoiceSend, JSON.stringify(trusted));

const stale = await evaluate(`(() => {
  const select=document.querySelector('#source-function'), args=document.querySelector('#source-args');
  args.value='[]';
  preparedSource={chainId:String(workspace.source.chainId),to:workspace.source.coordinator,value:'0',data:'0x01',function:select.value,workspaceFingerprint:workspaceFingerprint(),inputFingerprint:fingerprint([select.value,args.value])};
  document.querySelector('#source-prepared').hidden=false; document.querySelector('#download-safe').disabled=false; document.querySelector('#execute-source').disabled=false;
  args.value='[1]'; args.dispatchEvent(new Event('input',{bubbles:true}));
  return {cleared:preparedSource===null,hidden:document.querySelector('#source-prepared').hidden,download:document.querySelector('#download-safe').disabled,execute:document.querySelector('#execute-source').disabled};
})()`);
check("Editing source inputs destroys the previous executable and download", stale.cleared && stale.hidden && stale.download && stale.execute, JSON.stringify(stale));

const walletCallsBeforeFunding = rpcMethods.filter(method => ["eth_requestAccounts", "eth_sendTransaction", "eth_signTypedData_v4"].includes(method)).length;
const funding = await evaluate(`(async () => {
  const c=targetConfig(), provider=new ethers.JsonRpcProvider(c.rpcUrl), contract=new ethers.Contract(c.treasury,artifact('WorkTreasury').abi,provider);
  try {
    const config=normalizeEpochConfig(await contract.epochConfig(${JSON.stringify(deployment.lastEpochId)}));
    workspace.epochConfig={config,epochId:${JSON.stringify(deployment.lastEpochId)},createdAt:new Date().toISOString(),authority:'none'};
    prepareBuiltEpochFunding();
    const decoded=new ethers.Interface(artifact('WorkTreasury').abi).decodeFunctionData('fundEpoch',preparedFunding.data);
    return {value:preparedFunding.value,cap:String(config.cap),epoch:ethers.keccak256(abi.encode(['bytes32',EPOCH_TUPLE],[EPOCH_TYPEHASH,plain(decoded[0])])),hidden:document.querySelector('#funding-prepared').hidden,sendDisabled:document.querySelector('#send-funding').disabled};
  } finally {provider.destroy?.();}
})()`);
const walletCallsAfterFunding = rpcMethods.filter(method => ["eth_requestAccounts", "eth_sendTransaction", "eth_signTypedData_v4"].includes(method)).length;
check("Funding preview makes no wallet call and encodes the exact epoch cap", walletCallsAfterFunding === walletCallsBeforeFunding && funding.value === funding.cap && funding.epoch.toLowerCase() === deployment.lastEpochId.toLowerCase() && !funding.hidden && !funding.sendDisabled, JSON.stringify(funding));

const participantInput = await evaluate(`({ config:workspace.epochConfig.config, epochId:workspace.epochConfig.epochId, workspace:plain(workspace) })`);
const workerContext = await isolatedParticipant();
const workerExport = await workerContext.evaluate(`(() => {
  localStorage.clear();
  const sdk=window.PROOFKEY_CONSENT_SDK, config=${JSON.stringify(participantInput.config)}, epochId=${JSON.stringify(participantInput.epochId)};
  const signingWallet=new ethers.Wallet('0x59c6995e998f97a5a0044976f7d2d171d0f9b7d7e4f2f6c43a7a7d0b18f3f231');
  const makeAuthorization=(epochConfig,observedEpochId)=>({commercialTerms:{scope:'Review one bounded remediation.',acceptanceCriteria:'The documented checks pass.',revisionTerms:'A changed scope requires a newly signed packet.',deliveryRequirements:'Supply the reviewed files and test evidence.',deliveryCommitmentFormat:'A later delivery uses keccak256 of canonical artifact bytes; no future delivery hash is committed here.'},epochConfig,order:{worker:signingWallet.address,claimOwner:'0x6666666666666666666666666666666666666666',destination:'0x6666666666666666666666666666666666666666',feeOwner:'0x8888888888888888888888888888888888888888',feeDestination:'0x8888888888888888888888888888888888888888',committee:['0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa','0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB','0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'],acceptBefore:'18446744073709551000',nonce:'77',milestones:[{work:'1',fee:'0',timeoutWork:'0',deliverBefore:'18446744073709551001',reviewBefore:'18446744073709551002',ruleBefore:'18446744073709551003'}]},targetFunding:{targetChainId:String(epochConfig.targetChainId),targetTreasury:epochConfig.targetTreasury,blockNumber:'1',blockHash:'0x'+'11'.repeat(32),finalityBasis:'rpc-finalized-tag',epochId:observedEpochId,cap:String(epochConfig.cap),reserve:String(epochConfig.cap),requiredMaximum:'1'},sourceCapacity:{sourceChainId:String(epochConfig.sourceChainId),sourceCoordinator:epochConfig.sourceCoordinator,blockNumber:'1',blockHash:'0x'+'22'.repeat(32),finalityBasis:'rpc-finalized-tag',epochId:observedEpochId,phase:1,available:String(epochConfig.cap),reservations:0,remainingMilestoneAdmissions:32,requiredMaximum:'1'}});
  const signAuthorization=(authorization)=>{const unsigned=sdk.createWorkAuthorizationDraft({authorization,createdAt:'2026-09-10T10:00:00.000Z'}),domain={name:'ProofKey Source Coordinator',version:'1',chainId:BigInt(authorization.epochConfig.sourceChainId),verifyingContract:authorization.epochConfig.sourceCoordinator},types={ProofKeyQuoteV1:[{name:'orderId',type:'bytes32'}]},digest=ethers.TypedDataEncoder.hash(domain,types,{orderId:unsigned.orderId}),signature=signingWallet.signingKey.sign(digest).serialized,signed=sdk.attachWorkerQuoteSignature(unsigned,{workerSignature:signature,signatureValidation:{sourceChainId:String(authorization.epochConfig.sourceChainId),sourceCoordinator:authorization.epochConfig.sourceCoordinator,blockNumber:'1',blockHash:'0x'+'22'.repeat(32)}});sdk.verifyEoaWorkerQuoteOffline(signed);return signed;};
  const signed=signAuthorization(makeAuthorization(config,epochId));
  const wrongConfig={...config,sourceCoordinator:'0x1111111111111111111111111111111111111111'};
  const wrongEpochId=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32',EPOCH_TUPLE],[EPOCH_TYPEHASH,wrongConfig]));
  const wrongDomain=signAuthorization(makeAuthorization(wrongConfig,wrongEpochId));
  localStorage.setItem('worker-export.json',sdk.stringifyWorkAuthorizationPackage(signed));
  return {raw:sdk.stringifyWorkAuthorizationPackage(signed),wrongDomain:sdk.stringifyWorkAuthorizationPackage(wrongDomain),worker:signingWallet.address,recovered:sdk.verifyEoaWorkerQuoteOffline(signed).recoveredWorker,storageKeys:Object.keys(localStorage)};
})()`);
check("Worker context exports a real EOA QuoteV1 signature validated by the shared SDK", workerExport.recovered.toLowerCase() === workerExport.worker.toLowerCase() && workerExport.storageKeys.includes("worker-export.json"), JSON.stringify({worker:workerExport.worker,recovered:workerExport.recovered,storageKeys:workerExport.storageKeys}));

const buyerContext = await isolatedParticipant();
const buyerHandoff = await buyerContext.evaluate(`(async () => {
  localStorage.clear(); workspace=${JSON.stringify(participantInput.workspace)}; saveJson(STORAGE_KEY,workspace); verifiedWorkspaceFingerprint=workspaceFingerprint(); syncWriteControls();
  const actual=window.PROOFKEY_CONSENT_SDK, packet=actual.parseWorkAuthorizationPackage(${JSON.stringify(workerExport.raw)});
  const validateEoa=(value)=>{const checked=actual.verifyEoaWorkerQuoteOffline(value);return {kind:'eoa',digest:checked.digest,blockNumber:1,blockHash:'0x'+'22'.repeat(32)}};
  const workFor=value=>({packet:value,milestoneId:0,stage:'awaiting-acceptance',nextActor:'buyer-safe',sourceBlock:{number:2,hash:'0x'+'22'.repeat(32)},orderExists:false,agreed:false,status:null,outcome:null,stateVersion:null,deliveryHash:null,finalWork:null,finalFee:null,workerAction:null,acceptanceEligibility:'eligible',sourceGasRequired:false,sourceExecutionAccount:value.authorization.epochConfig.sourceSafe,sourceExecutionNote:'Synthetic active-chain fixture.',deadlines:{acceptBefore:value.orderTerms.acceptBefore,deliverBefore:value.orderTerms.milestones[0].deliverBefore,reviewBefore:value.orderTerms.milestones[0].reviewBefore,ruleBefore:value.orderTerms.milestones[0].ruleBefore},payment:{epochId:value.orderTerms.epochId,orderId:value.orderId,milestoneId:0,worker:value.orderTerms.worker,claimOwner:value.orderTerms.claimOwner,destination:value.orderTerms.destination,expectedWorkAmount:value.orderTerms.milestones[0].work}});
  const fixtureSdk={...actual,verifyCommittedChainObservations:async()=>({sourceBlock:{number:1,hash:'0x'+'22'.repeat(32)},targetBlock:{number:1,hash:'0x'+'11'.repeat(32)}}),verifyWorkerQuoteSignatureAtSource:async value=>validateEoa(value),verifyWorkerQuoteSignatureCurrent:async value=>validateEoa(value),verifyCurrentWorkAuthorization:async()=>({sourceBlock:{number:1,hash:'0x'+'22'.repeat(32)},targetBlock:{number:1,hash:'0x'+'11'.repeat(32)}}),reviewSignedParticipantWork:async value=>{const parsed=actual.parseWorkAuthorizationPackage(value);validateEoa(parsed);return{packet:parsed,summary:{},work:workFor(parsed),verification:{acceptanceReady:true,historicalSignature:validateEoa(parsed)}}}};
  window.PROOFKEY_SDK=fixtureSdk; window.PROOFKEY_CONSENT_SDK=fixtureSdk;
  let walletRequests=0; window.ethereum={request:async()=>{walletRequests++;throw new Error('wallet must not be requested')},on(){}};
  await importSignedAuthorization(${JSON.stringify(workerExport.raw)}); const acceptedOrder=currentDraft.orderId;
  await prepareSignedQuote(); const iface=new ethers.Interface(artifact('SourceCoordinator').abi), expected=iface.encodeFunctionData('acceptQuote',[currentDraft.orderTerms,currentDraft.workerSignature]), exact=expected===preparedSource.data;
  const baseline=currentDraft.orderId, failures={};
  const changedTerms=JSON.parse(${JSON.stringify(workerExport.raw)}); changedTerms.authorization.commercialTerms.scope+=' changed';
  try{await importSignedAuthorization(JSON.stringify(changedTerms));}catch(error){failures.terms=error.message;}
  const changedSignature=JSON.parse(${JSON.stringify(workerExport.raw)}), rawSignature=changedSignature.workerSignature; changedSignature.workerSignature=rawSignature.slice(0,4)+(rawSignature[4]==='0'?'1':'0')+rawSignature.slice(5);
  try{await importSignedAuthorization(JSON.stringify(changedSignature));}catch(error){failures.signature=error.message;}
  try{await importSignedAuthorization(${JSON.stringify(workerExport.wrongDomain)});}catch(error){failures.domain=error.message;}
  return {chainState:'synthetic-active-fixture',walletRequests,acceptedOrder,currentOrder:currentDraft.orderId,exact,prepared:Boolean(preparedSource),failures,storageKeys:Object.keys(localStorage),baseline};
})()`);
check("Fresh buyer context imports the EOA packet under explicit synthetic active-chain state and prepares ABI-exact Safe calldata without a wallet", buyerHandoff.chainState === "synthetic-active-fixture" && buyerHandoff.walletRequests === 0 && buyerHandoff.acceptedOrder === buyerHandoff.currentOrder && buyerHandoff.exact && buyerHandoff.prepared && buyerHandoff.storageKeys.includes("proofkey-work-treasury.draft.v1"), JSON.stringify(buyerHandoff));
check("Fresh buyer context refuses terms, signature, and domain changes before replacing the accepted packet", buyerHandoff.currentOrder === buyerHandoff.baseline && buyerHandoff.failures.terms.includes("termsHash does not match") && /recover|signature|worker/i.test(buyerHandoff.failures.signature) && buyerHandoff.failures.domain.includes("does not match the verified workspace"), JSON.stringify(buyerHandoff.failures));
await browserSend("Target.disposeBrowserContext", { browserContextId: workerContext.browserContextId });
await browserSend("Target.disposeBrowserContext", { browserContextId: buyerContext.browserContextId });

const walletReset = await evaluate(`(() => {
  const handlers={}; window.ethereum={on:(name,fn)=>handlers[name]=fn,request:async()=>{throw new Error('unexpected wallet request')}}; walletEventsBound=false; bindWalletEvents();
  preparedSource={data:'0x01'}; document.querySelector('#source-prepared').hidden=false; const before=walletSessionGeneration; handlers.accountsChanged([]);
  return {generation:walletSessionGeneration-before,cleared:preparedSource===null,hidden:document.querySelector('#source-prepared').hidden,workspaceStored:Boolean(localStorage.getItem('proofkey-work-treasury.workspace.v1')),draftStored:Boolean(localStorage.getItem('proofkey-work-treasury.draft.v1'))};
})()`);
check("Wallet lifecycle invalidates pending work without deleting storage", walletReset.generation === 1 && walletReset.cleared && walletReset.hidden && walletReset.workspaceStored && walletReset.draftStored, JSON.stringify(walletReset));

await evaluate(`(() => {
  const sdk=window.PROOFKEY_CONSENT_SDK;
  const packet=sdk.createWorkAuthorizationDraft({authorization:${JSON.stringify(vector.authorization)},createdAt:'2026-09-10T10:00:00.000Z'});
  changeDraft(packet); saveJson(DRAFT_KEY,currentDraft);
  document.querySelector('#offer-worker-destination-ack').checked=true;
  const fixtureSdk={...sdk,reviewUnsignedParticipantOffer:async value=>({packet:sdk.parseWorkAuthorizationPackage(value),sourceBlock:{number:1,hash:'0x'+'22'.repeat(32)},targetBlock:{number:1,hash:'0x'+'11'.repeat(32)}}),signReviewedParticipantOffer:async(review,{requestSignature})=>{await requestSignature({expectedWorker:review.packet.orderTerms.worker,domain:{name:'ProofKey Source Coordinator',version:'1',chainId:BigInt(review.packet.authorization.epochConfig.sourceChainId),verifyingContract:review.packet.authorization.epochConfig.sourceCoordinator},types:{ProofKeyQuoteV1:[{name:'orderId',type:'bytes32'}]},value:{orderId:review.packet.orderId}});return review.packet;}};
  window.PROOFKEY_SDK=fixtureSdk; window.PROOFKEY_CONSENT_SDK=fixtureSdk;
  const signer={getAddress:async()=>packet.orderTerms.worker,signTypedData:async()=>new Promise(resolve=>window.__resolveSignature=resolve)};
  const provider={getSigner:async()=>signer,getNetwork:async()=>({chainId:BigInt(workspace.source.chainId)})};
  connected={provider,signer,account:packet.orderTerms.worker,chainId:BigInt(workspace.source.chainId)}; walletSessionGeneration++;
  window.__signDone=false; window.__signError=''; signQuote().catch(error=>window.__signError=error.message).finally(()=>window.__signDone=true);
})()`);
await waitFor("Boolean(window.__resolveSignature)");
await evaluate(`(() => { changeDraft({id:'draft-b'}); saveJson(DRAFT_KEY,currentDraft); window.__resolveSignature('0x01'); })()`);
await waitFor("window.__signDone");
const race = await evaluate(`({draft:currentDraft,stored:JSON.parse(localStorage.getItem(DRAFT_KEY)),prepared:preparedSource,error:window.__signError})`);
check("A signature returned after draft replacement cannot attach to draft B", race.draft.id === "draft-b" && race.stored.id === "draft-b" && !race.draft.workerSignature && race.prepared === null && race.error.includes("changed while the request was pending"), JSON.stringify(race));

const sendRace = await evaluate(`(async () => {
  const originalConnect=connectWallet, same={id:'same-draft'}; changeDraft(same); let resolveConnect, sent=0;
  connected=null; connectWallet=async()=>new Promise(resolve=>resolveConnect=()=>{const signer={getAddress:async()=>workspace.source.safe,sendTransaction:async()=>{sent++;return {hash:'0x'+'11'.repeat(32),wait:async()=>({status:1})}}};connected={provider:{getSigner:async()=>signer,getNetwork:async()=>({chainId:BigInt(workspace.source.chainId)})},signer,account:workspace.source.safe,chainId:BigInt(workspace.source.chainId)};walletSessionGeneration++;resolve();});
  let done=false,error=''; const pendingSend=sendPrepared({chainId:String(workspace.source.chainId),to:workspace.source.coordinator,value:'0',data:'0x',function:'qa'},true).catch(e=>error=e.message).finally(()=>done=true);
  await new Promise(resolve=>setTimeout(resolve,0)); changeDraft({id:'other'}); changeDraft(same); resolveConnect(); await pendingSend; connectWallet=originalConnect;
  return {sent,done,error,final:currentDraft.id};
})()`);
check("A held wallet connection cannot send after A→B→A state changes", sendRace.sent === 0 && sendRace.done && sendRace.final === "same-draft" && sendRace.error.includes("changed while connecting"), JSON.stringify(sendRace));

const forbidden = rpcMethods.filter(method => ["eth_requestAccounts", "eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "eth_signTypedData_v4", "personal_sign"].includes(method));
check("The QA made no real wallet or broadcast request", forbidden.length === 0, JSON.stringify(forbidden));
check("No browser runtime exception escaped", browserErrors.length === 0, browserErrors.join("\n") || "none");

socket.close();
browserSocket.close();
console.log(JSON.stringify({ checks, observedRpcCalls: rpcMethods.length }, null, 2));
