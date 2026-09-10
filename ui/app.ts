declare const ethers: any;
declare global {
  interface Window { PROOFKEY_ABI_MANIFEST?: any; PROOFKEY_DEMO_CONFIG?: any; PROOFKEY_DEFAULT_CONFIG?: any; PROOFKEY_TRUSTED_DEPLOYMENTS?: any[]; PROOFKEY_SDK?: any; PROOFKEY_CONSENT_SDK?: any; ethereum?: any; }
  interface Document { modelContext?: { registerTool(tool: any, options?: { signal?: AbortSignal }): void | Promise<void> } }
}

const STORAGE_KEY = "proofkey-work-treasury.workspace.v1";
const DRAFT_KEY = "proofkey-work-treasury.draft.v1";
const SETTLEMENT_JOURNALS_KEY = "proofkey-work-treasury.settlement-journals.v1";
const PARTICIPANT_WORK_KEY = "proofkey-work-treasury.my-work.v1";
const PARTICIPANT_SEND_JOURNAL_KEY = "proofkey-work-treasury.participant-send-journal.v1";
const ZERO32 = `0x${"00".repeat(32)}`;
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const TREE_DEPTH = 7;
const LEAF_TYPEHASH = "0x0c0b09698524f69712b08b7d15b0b0905cae44a5014fe49c7d221a343d080a66";
const NODE_TYPEHASH = "0xb8ec434e179bde7da6b36cc81a26875509c52f3e5a4e39c7cbe9d77b7310a88b";
const EMPTY_TYPEHASH = "0x0721dfd2e1d57c54005918c3762eb76dcd3937a850be4d44c46f5da723f237de";
const MILESTONE_TYPEHASH = ethers.id("ProofKeyMilestoneV1(uint256 work,uint256 fee,uint256 timeoutWork,uint64 deliverBefore,uint64 reviewBefore,uint64 ruleBefore)");
const ORDER_TYPEHASH = ethers.id("ProofKeyOrderV1(bytes32 epochId,bytes32 termsHash,address worker,address claimOwner,address destination,address feeOwner,address feeDestination,bytes32 committeeHash,uint64 acceptBefore,uint64 nonce,bytes32 milestonesHash)");
const EPOCH_TYPEHASH = ethers.id("ProofKeyEpochV1(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)");
const SOURCE_VERSION = ethers.id("ProofKeySourceCoordinatorV1");
const SCHEMA_VERSION = ethers.id("ProofKeyAllocationSchemaV1");
const POLICY_HASH = ethers.id("ProofKeyWorkPolicyV1");
const EPOCH_TUPLE = "tuple(uint256 sourceChainId,uint64 sourceChainKey,address sourceCoordinator,bytes32 sourceVersion,uint256 targetChainId,address targetTreasury,bytes32 schemaVersion,address sourceSafe,address sponsor,address refundBeneficiary,address asset,uint256 cap,bytes32 policyHash,uint64 initializationCutoff,uint64 admissionCutoff,uint32 maxMilestones,uint32 maxActiveReturns,uint32 maxDrainingReturns,uint8 treeDepth,uint64 nonce)";
const EPOCH_FIELDS = ["sourceChainId", "sourceChainKey", "sourceCoordinator", "sourceVersion", "targetChainId", "targetTreasury", "schemaVersion", "sourceSafe", "sponsor", "refundBeneficiary", "asset", "cap", "policyHash", "initializationCutoff", "admissionCutoff", "maxMilestones", "maxActiveReturns", "maxDrainingReturns", "treeDepth", "nonce"];
const abi = ethers.AbiCoder.defaultAbiCoder();

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`Missing interface element: ${selector}`);
  return found as T;
};

function loadWorkspaceState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return { present: false, value: {} as any, error: "" };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Saved setup is not an object");
    return { present: true, value, error: "" };
  } catch (error) {
    return { present: true, value: {} as any, error: `Saved setup could not be read: ${(error as Error).message}` };
  }
}
const initialWorkspaceState = loadWorkspaceState();
let workspace: any = initialWorkspaceState.value;
let connected: { provider: any; signer: any; account: string; chainId: bigint } | null = null;
let currentDraft: any = loadJson(DRAFT_KEY, null);
let currentClaimPackage: any = null;
let currentProof: any = null;
let preparedSource: any = null;
let preparedFunding: any = null;
let preparedEvidence: any = null;
let lastPaymentLookup: any = null;
let currentOrderRead: any = null;
let draftRevision = 0;
let verifiedWorkspaceFingerprint: string | null = null;
let signingPending = false;
let walletEventsBound = false;
let walletSessionGeneration = 0;
let writeRevision = 0;
let settlementGeneration = 0;
let settlementExecutionBusy = false;
let currentSettlementPlan: any = null;
let currentSettlementPlanContext: any = null;
let currentCloseout: any = null;
let currentCloseoutResult: any = null;
let closeoutGeneration = 0;
let closeoutAuthorizations: any[] = [];
let participantPacket: any = null;
let participantReview: any = null;
let participantWorkRead: any = null;
let participantGeneration = 0;
let preparedParticipantDelivery: any = null;
let participantSendBusy = false;
let followupTemplate: any = null;
let followupGeneration = 0;
let paidWorkLocator: any = null;
let paidWorkLocatorFormFingerprint: string | null = null;
let paidWorkRecord: any = null;
let paidWorkGeneration = 0;
let paidWorkAuthorizations = new Map<string, any[]>();

const POLICY_ACTIONS = [
  ["Safe", "Create offer / accept quote", "Reserves complete terms; requires money and admission capacity."],
  ["Worker", "Accept offer · deliver · revise", "Consent before tAccept; delivery updates only before tDeliver."],
  ["Either party / anyone", "Decline · expire pending", "Releases an unagreed reservation once."],
  ["Safe", "Approve · challenge", "Acts on the current delivery before tReview."],
  ["Anyone", "No-delivery / monitoring default", "Available only at the exact source block cutoff."],
  ["Committee", "Vote for one exact ruling", "Two distinct members; stale and duplicate votes fail."],
  ["Anyone", "Committee timeout", "Uses the pre-agreed timeout amount at tRule."],
  ["Safe + worker", "Mutual settlement", "Both sign one current proposal; the first valid terminal wins."],
  ["Safe / anyone", "Release · drain · sweep", "Safe releases while active; anyone sweeps while draining."],
];

const SOURCE_HELP: Record<string, [string, string]> = {
  initializeEpoch: ["Source Safe", "Initialize the exact epoch before its initialization cutoff."],
  expireUninitializedEpoch: ["Anyone", "Materialize expiry at or after the initialization cutoff."],
  createOffer: ["Source Safe", "Reserve complete pending terms."], acceptOffer: ["Worker", "Accept the Safe's exact offer with the worker signature."],
  acceptQuote: ["Source Safe", "Accept an exact worker-signed quote in one operation."], revokeQuoteNonce: ["Worker", "Revoke one quote nonce."],
  declinePendingOrder: ["Safe or worker", "Decline a pending, unagreed order."], expirePendingOrder: ["Anyone", "Expire a pending order at its acceptance cutoff."],
  deliver: ["Worker", "Submit or revise the delivery before delivery cutoff."], approve: ["Source Safe", "Approve the current unchallenged delivery."],
  challenge: ["Source Safe", "Freeze the current delivery for committee review."], finalizeNoDelivery: ["Anyone", "Finalize no delivery at the delivery cutoff."],
  finalizeMonitoringDefault: ["Anyone", "Finalize full work after an unchallenged review cutoff."], submitRulingVote: ["Committee member", "Submit one vote for one exact current ruling proposal."],
  finalizeCommitteeTimeout: ["Anyone", "Apply the agreed timeout split at the rule cutoff."], settleMutually: ["Anyone with both signatures", "Submit the Safe and worker's exact current settlement."],
  invalidateMutualProposals: ["Safe or worker", "Raise the mutual proposal nonce and invalidate older queued proposals."], invalidateOwnRulingVotesBefore: ["Committee member", "Raise only this voter's ruling nonce floor; other committee votes remain intact."],
  releaseFree: ["Source Safe", "Append an authorized RETURN from available capacity."], startDraining: ["Source Safe or anyone after cutoff", "Stop new admissions."],
  sweepAvailable: ["Anyone", "Append the current positive available balance as RETURN while draining."], republishCheckpoint: ["Anyone", "Republish current stored state without financial mutation."],
};

const TARGET_HELP: Record<string, [string, string]> = {
  fundEpoch: ["Sponsor", "Fund the exact epoch cap with native CTC."], fundEpochFromFree: ["Free-balance owner", "Fund a fresh exact epoch from the caller's free balance."], deposit: ["Anyone", "Credit the sender's free balance with native CTC."],
  withdrawFor: ["Anyone", "Pay one recognized WORK/FEE claim to its fixed destination."], ownerWithdrawTo: ["Claim owner", "Redirect an unpaid claim once; the first successful withdrawal wins."],
  withdrawFreeFor: ["Anyone", "Pay free balance to its owner."], ownerWithdrawFreeTo: ["Free-balance owner", "Withdraw the caller's free balance to another destination."],
  recordPaidWork: ["Anyone", "Record a completed WORK withdrawal in the pinned invoice book."],
};

function loadJson(key: string, fallback: any) { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function saveJson(key: string, value: any) { localStorage.setItem(key, JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)); }
function short(value: unknown, size = 7) { const text = String(value ?? ""); return text.length > size * 2 + 3 ? `${text.slice(0, size + 2)}…${text.slice(-size)}` : text; }
function escapeHtml(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function plain(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") {
    if (typeof value.toObject === "function") { try { return plain(value.toObject(true)); } catch {} }
    if (Array.isArray(value)) return value.map(plain);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^\d+$/.test(key)).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}
function normalizeEpochConfig(value: any) {
  const converted = plain(value);
  const source = Array.isArray(converted) ? Object.fromEntries(EPOCH_FIELDS.map((field, index) => [field, converted[index]])) : converted;
  if (!source || EPOCH_FIELDS.some(field => source[field] === undefined)) throw new Error("Epoch configuration tuple is incomplete");
  const result = Object.fromEntries(EPOCH_FIELDS.map(field => [field, source[field]]));
  for (const field of ["maxMilestones", "maxActiveReturns", "maxDrainingReturns", "treeDepth"]) result[field] = Number(result[field]);
  return result;
}
function showResult(id: string, message: string, kind: "empty" | "success" | "error" = "success") { const node = $(`#${id}`); node.className = `result ${kind}`; node.textContent = message; }
function toast(message: string, error = false) { const node = $("#toast"); node.textContent = message; node.className = `toast show${error ? " error" : ""}`; window.setTimeout(() => node.className = "toast", 3400); }
function signal(id: string, status: "neutral" | "good" | "bad" | "wait") { const node = $(`#${id}`); node.className = `signal ${status}`; }
function format(value: bigint | number | string) { try { return BigInt(value).toLocaleString("en-US"); } catch { return String(value); } }
function formatNative(value: bigint | number | string) { return `${ethers.formatEther(BigInt(value))} CTC`; }
function setText(id: string, value: unknown) { const node = document.querySelector<HTMLElement>(`#${id}`); if (node) node.textContent = String(value ?? ""); }
function setDisabled(id: string, disabled: boolean) { const node = document.querySelector<HTMLButtonElement>(`#${id}`); if (node) node.disabled = disabled; }
function setField(form: HTMLFormElement, name: string, value: unknown) { const field = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null; if (field) field.value = String(value ?? ""); }
function formFingerprint(form: HTMLFormElement) { return fingerprint(Object.fromEntries(new FormData(form))); }
function clearProgramPaid() { setText("program-paid", "Not collected for this epoch"); }
function authorizationRows(packet: any, milestoneId = 0) {
  const parsed = consentSdk().parseWorkAuthorizationPackage(packet), terms = parsed.orderTerms, milestone = terms.milestones[milestoneId], commercial = parsed.authorization.commercialTerms;
  return [
    ["Selected milestone", `${milestoneId + 1} of ${terms.milestones.length}`],
    ["Buyer account", parsed.authorization.epochConfig.sourceSafe], ["Worker", terms.worker], ["Payment owner", terms.claimOwner], ["Paid destination", terms.destination],
    ["Scope", commercial.scope], ["Acceptance", commercial.acceptanceCriteria], ["Revisions", commercial.revisionTerms], ["Delivery", commercial.deliveryRequirements],
    ["Worker maximum", formatNative(milestone.work)], ["Committee fee", formatNative(milestone.fee)], ["Timeout worker amount", formatNative(milestone.timeoutWork)],
    ["Accept by source block", terms.acceptBefore], ["Deliver by source block", milestone.deliverBefore], ["Review by source block", milestone.reviewBefore], ["Rule by source block", milestone.ruleBefore],
    ["Ethereum domain", `${parsed.authorization.epochConfig.sourceChainId} · ${parsed.authorization.epochConfig.sourceCoordinator}`], ["Creditcoin domain", `${parsed.authorization.epochConfig.targetChainId} · ${parsed.authorization.epochConfig.targetTreasury}`],
  ];
}
function renderReviewGrid(id: string, rows: any[][]) { $(id).innerHTML = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join(""); }
function renderOfferReview(packet: any, target: "offer" | "my-work" = "offer") {
  const parsed = consentSdk().parseWorkAuthorizationPackage(packet), rows = authorizationRows(parsed, target === "my-work" ? selectedMilestoneId() : 0);
  if (target === "offer") {
    $("#offer-review").hidden = false; setText("offer-review-title", `Order ${short(parsed.orderId, 9)}`); setText("offer-review-state", parsed.workerSignature ? "Worker signed" : "Unsigned offer"); renderReviewGrid("#offer-review-grid", rows);
    const ack = $<HTMLInputElement>("#offer-worker-destination-ack"); ack.checked = false; ack.dataset.orderId = parsed.orderId; ack.dataset.termsHash = parsed.termsHash;
  } else {
    renderReviewGrid("#my-work-summary", rows); setText("my-work-stage", parsed.workerSignature ? "Waiting for buyer acceptance" : "Review the offer"); setText("my-work-actor", parsed.workerSignature ? "Buyer acts next" : "Worker acts next");
    const ack = $<HTMLInputElement>("#my-work-destination-ack"); ack.checked = false; ack.dataset.orderId = parsed.orderId; ack.dataset.termsHash = parsed.termsHash;
    renderParticipantJournal(parsed.orderId);
  }
  return parsed;
}
function workerAcknowledged(packet: any) { return ["#offer-worker-destination-ack", "#my-work-destination-ack"].some(selector => { const ack = document.querySelector<HTMLInputElement>(selector); return ack?.checked && ack.dataset.orderId?.toLowerCase() === packet.orderId.toLowerCase() && ack.dataset.termsHash?.toLowerCase() === packet.termsHash.toLowerCase(); }); }
function clearParticipantReadState() { participantGeneration++; participantWorkRead = null; preparedParticipantDelivery = null; setDisabled("my-work-continue", true); setDisabled("my-work-track-payment", true); setDisabled("my-work-send", true); $("#my-work-send").hidden = true; $("#my-work-delivery-wrap").hidden = true; }
function renderParticipantJournal(orderId?: string) { const node = document.querySelector<HTMLElement>("#my-work-journal"); if (!node) return; const profile = (() => { try { return trustedDeploymentProfile(); } catch { return null; } })(), entries = Object.values(loadJson(PARTICIPANT_SEND_JOURNAL_KEY, {})).filter((item: any) => !orderId || item.orderId?.toLowerCase() === orderId.toLowerCase()).sort((a: any, b: any) => String(b.submittedAt).localeCompare(String(a.submittedAt))) as any[]; if (!entries.length) { node.innerHTML = `<p class="help">No saved source submissions for this work.</p>`; return; } node.innerHTML = entries.map(item => `<div class="journal-item"><span><b>${escapeHtml(item.state)}</b> · milestone ${escapeHtml(Number(item.milestoneId) + 1)}<small>${escapeHtml(short(item.deliveryHash, 12))} · ${escapeHtml(short(item.transactionHash, 12))}</small></span><span class="receipt-links">${profile?.source.explorerUrl ? explorerLink(profile.source.explorerUrl, "tx", item.transactionHash, "Source transaction") : escapeHtml(item.transactionHash)}<button class="text-link" data-recheck-participant="${escapeHtml(`${item.orderId.toLowerCase()}:${item.milestoneId}:${item.deliveryHash.toLowerCase()}`)}">Recheck receipt</button></span></div>`).join(""); }
async function recheckParticipantSubmission(journalId: string) { requireVerifiedWorkspace(); const entry = loadJson(PARTICIPANT_SEND_JOURNAL_KEY, {})[journalId]; if (!entry?.transactionHash) throw new Error("Saved submission was not found"); const profile = trustedDeploymentProfile(); if (String(entry.sourceChainId) !== String(profile.source.chainId) || entry.sourceCoordinator.toLowerCase() !== profile.source.coordinator.toLowerCase()) throw new Error("Saved submission belongs to another pinned source deployment"); const provider = new ethers.JsonRpcProvider(sourceConfig().rpcUrl, BigInt(entry.sourceChainId), { staticNetwork: true }); try { if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(entry.sourceChainId)) throw new Error("Source receipt RPC reports another chain"); const receipt = await provider.getTransactionReceipt(entry.transactionHash); if (receipt && (receipt.to?.toLowerCase() !== entry.sourceCoordinator.toLowerCase() || receipt.from?.toLowerCase() !== entry.worker.toLowerCase())) throw new Error("The receipt does not match the saved source coordinator and worker"); if (receipt) { const latest = loadJson(PARTICIPANT_SEND_JOURNAL_KEY, {}), current = latest[journalId]; if (!current || current.transactionHash.toLowerCase() !== entry.transactionHash.toLowerCase()) throw new Error("The saved submission changed while its receipt was checked; the stale result was discarded"); latest[journalId] = { ...current, state: receipt.status === 1 ? "confirmed" : "failed", blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash }; saveJson(PARTICIPANT_SEND_JOURNAL_KEY, latest); } renderParticipantJournal(participantPacket?.orderId); toast(receipt ? `Receipt ${receipt.status === 1 ? "confirmed" : "failed"} at source block ${receipt.blockNumber}.` : "Receipt is still unknown or pending. It was not resent."); } finally { provider.destroy?.(); } }
function renderProgramBoard(state: any | null) {
  if (!state?.initialized) {
    for (const id of ["program-available", "program-unresolved", "program-earned", "program-returned"]) setText(id, "—");
    setText("program-phase", "Program not initialized"); setText("program-board-title", "No active source budget yet"); setText("program-next-action", "Fund and initialize the exact epoch before creating work."); setDisabled("create-followup", true); return;
  }
  const values = [BigInt(state.available), BigInt(state.unresolved), BigInt(state.earned), BigInt(state.returned)], total = values.reduce((sum, item) => sum + item, 0n), ids = ["program-available", "program-unresolved", "program-earned", "program-returned"];
  values.forEach((value, index) => { setText(ids[index], formatNative(value)); const segment = document.querySelector<HTMLElement>(`#program-budget-track .seg:nth-child(${index + 1})`); if (segment) { const percent = total > 0n ? Number(value * 10000n / total) / 100 : 25; segment.style.setProperty("--size", String(percent)); segment.classList.toggle("is-zero", value === 0n); segment.classList.toggle("is-small", value > 0n && percent < 14); } });
  const phase = Number(state.phase), label = ["Uninitialized", "Active", "Draining", "Closed"][phase] ?? `Phase ${phase}`;
  setText("program-phase", label); setText("program-board-title", `${formatNative(total)} tracked as A + U + E + R`);
  setDisabled("create-followup", phase !== 1 || values[0] === 0n);
  setText("program-next-action", phase === 1 ? values[0] > 0n ? "Available capacity can support a fresh follow-up after an unused worker nonce, new deadlines and new consent are checked." : "Resolve existing jobs or release capacity; no available amount remains for a new offer." : phase === 2 ? "This program is draining. Resolve existing jobs and sweep available capacity; new work is refused." : "This program is closed. Existing earned payments remain collectible, but new work must use a fresh epoch.");
}
function parseNative(value: unknown, label: string, positive = false) {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(text)) throw new Error(`${label} must be a nonnegative CTC amount with up to 18 decimal places`);
  const amount = ethers.parseEther(text);
  if (amount > ethers.MaxUint256) throw new Error(`${label} exceeds the uint256 CTC limit`);
  if (positive && amount === 0n) throw new Error(`${label} must be greater than zero CTC`);
  return amount;
}
function requireHex(value: any, bytes: number | undefined, label: string) { if (typeof value !== "string" || !ethers.isHexString(value, bytes)) throw new Error(`${label} must be valid${bytes ? ` ${bytes}-byte` : ""} hex`); return value; }
function requireAddress(value: any, label: string) { try { return ethers.getAddress(value); } catch { throw new Error(`${label} is not a valid address`); } }
function artifact(name: string) { const item = window.PROOFKEY_ABI_MANIFEST?.contracts?.[name]; if (!item?.abi?.length) throw new Error(`${name} compiled ABI is not in this UI build`); return item; }
function sourceConfig() {
  if (!workspace.source?.rpcUrl || !workspace.source?.coordinator || !workspace.source?.chainId) throw new Error("Complete the Ethereum source setup first");
  return workspace.source;
}
async function stableBlock(provider: any, confirmations: number) {
  try {
    const block = await provider.getBlock("finalized");
    if (block) return { blockTag: block.number, label: `finalized block ${block.number}` };
  } catch {}
  const head = await provider.getBlockNumber();
  const number = Math.max(0, head - Math.max(0, confirmations));
  return { blockTag: number, label: `block ${number} (${confirmations} confirmations behind head; finality not asserted)` };
}
async function finalizedTargetBlock(provider: any) {
  let block: any;
  try { block = await provider.getBlock("finalized"); } catch {}
  if (!block || !Number.isSafeInteger(block.number) || !block.hash || !ethers.isHexString(block.hash, 32)) throw new Error("Binding worker consent and delivery require a real finalized Creditcoin block with its hash. This RPC did not provide one; confirmation-depth fallback is available for inspection only.");
  return { blockTag: block.number, blockHash: block.hash, label: `finalized block ${block.number}`, finalityBasis: "rpc-finalized-tag" };
}
async function finalizedSourceBlock(provider: any) {
  let block: any;
  try { block = await provider.getBlock("finalized"); } catch {}
  if (!block || !Number.isSafeInteger(block.number) || !block.hash || !ethers.isHexString(block.hash, 32)) throw new Error("Consent-bound source capacity requires a real finalized Ethereum block with its hash. This RPC did not provide one; confirmation-depth fallback is available for inspection only.");
  return { blockTag: block.number, blockHash: block.hash, label: `finalized block ${block.number}`, finalityBasis: "rpc-finalized-tag" };
}
function targetConfig() {
  if (!workspace.target?.rpcUrl || !workspace.target?.treasury || !workspace.target?.chainId) throw new Error("Complete the Creditcoin target setup first");
  return workspace.target;
}
function activeEpoch() { const value = ($<HTMLInputElement>("#active-epoch").value || workspace.lastEpochId || "").trim(); return requireHex(value, 32, "Epoch ID"); }
function download(name: string, value: any) { const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }

function consentSdk() { if (!window.PROOFKEY_CONSENT_SDK) throw new Error("The shared Work Authorization SDK has not loaded"); return window.PROOFKEY_CONSENT_SDK; }
function sharedSdk() { if (!window.PROOFKEY_SDK) throw new Error("The shared operator SDK has not loaded"); return window.PROOFKEY_SDK; }
function participantDomain() { const profile = trustedDeploymentProfile(); return { sourceChainId: String(profile.source.chainId), sourceChainKey: String(profile.source.chainKey), sourceCoordinator: profile.source.coordinator, sourceRuntimeHash: profile.source.deployedCodeHash, sourceDeploymentBlock: String(profile.source.deploymentBlock), targetChainId: String(profile.target.chainId), targetTreasury: profile.target.treasury, targetRuntimeHash: profile.target.deployedCodeHash, targetDeploymentBlock: String(profile.target.deploymentBlock) }; }
function loadParticipantStore() { const empty = sharedSdk().emptyParticipantWorkStore(); return sharedSdk().parseParticipantWorkStore(loadJson(PARTICIPANT_WORK_KEY, empty)); }
function selectedMilestoneId() { return Number(document.querySelector<HTMLSelectElement>("#my-work-milestone")?.value ?? 0); }
function populateSavedWork(selectedOrderId?: string) { const select = document.querySelector<HTMLSelectElement>("#my-work-saved"); if (!select) return; const store = loadParticipantStore(), selected = selectedOrderId ?? participantPacket?.orderId ?? ""; select.innerHTML = `<option value="">Choose saved work</option>${store.records.map((record: any) => `<option value="${escapeHtml(record.orderId)}">${escapeHtml(short(record.orderId, 10))} · ${record.packet.workerSignature ? "signed" : "unsigned"}</option>`).join("")}`; select.value = store.records.some((item: any) => item.orderId.toLowerCase() === selected.toLowerCase()) ? selected : ""; }
function populateMilestones(packet: any, selected = 0) { const select = $<HTMLSelectElement>("#my-work-milestone"), count = packet.orderTerms.milestones.length; select.innerHTML = packet.orderTerms.milestones.map((_item: any, index: number) => `<option value="${index}">Milestone ${index + 1}</option>`).join(""); select.value = String(Math.min(Math.max(selected, 0), count - 1)); select.disabled = count <= 1; }
function saveParticipantPacket(packet: any) { const store = sharedSdk().upsertParticipantWork(loadParticipantStore(), packet, { lastMilestoneId: selectedMilestoneId() }); saveJson(PARTICIPANT_WORK_KEY, store); populateSavedWork(packet.orderId); return store; }
function fingerprint(value: unknown) { return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item))); }
function workspaceFingerprint(value = workspace) {
  return fingerprint({ source: { chainId: String(value.source?.chainId ?? ""), chainKey: String(value.source?.chainKey ?? ""), coordinator: String(value.source?.coordinator ?? "").toLowerCase(), safe: String(value.source?.safe ?? "").toLowerCase(), rpcUrl: String(value.source?.rpcUrl ?? ""), confirmations: String(value.source?.confirmations ?? "") }, target: { chainId: String(value.target?.chainId ?? ""), treasury: String(value.target?.treasury ?? "").toLowerCase(), rpcUrl: String(value.target?.rpcUrl ?? ""), confirmations: String(value.target?.confirmations ?? "") } });
}
function requireVerifiedWorkspace() {
  if (!verifiedWorkspaceFingerprint || verifiedWorkspaceFingerprint !== workspaceFingerprint()) throw new Error("Verify this trusted deployment in the current browser session before preparing, downloading, signing or sending a write action");
}
function workspaceWriteReady() { return Boolean(verifiedWorkspaceFingerprint && verifiedWorkspaceFingerprint === workspaceFingerprint()); }
function trustedDeploymentProfile() {
  const source = sourceConfig(), target = targetConfig();
  const profile = (window.PROOFKEY_TRUSTED_DEPLOYMENTS ?? []).find(item => String(item.source.chainId) === String(source.chainId)
    && String(item.source.chainKey) === String(source.chainKey) && item.source.coordinator.toLowerCase() === source.coordinator.toLowerCase()
    && String(item.target.chainId) === String(target.chainId) && item.target.treasury.toLowerCase() === target.treasury.toLowerCase());
  if (!profile) throw new Error("This workspace does not match a deployment pinned in this build");
  if (!profile.source.deployedCodeHash || !profile.target.deployedCodeHash || !profile.source.deploymentBlock || !profile.target.deploymentBlock) throw new Error("The trusted deployment record is missing runtime or deployment-block pins");
  return profile;
}
function syncWriteControls() {
  const ready = workspaceWriteReady();
  const sign = document.querySelector<HTMLButtonElement>("#sign-quote"); if (sign) sign.disabled = !ready || signingPending || !isConsentPackage(currentDraft) || Boolean(currentDraft?.workerSignature);
  const mySign = document.querySelector<HTMLButtonElement>("#my-work-sign"); if (mySign) mySign.disabled = !ready || signingPending || !participantPacket || Boolean(participantPacket?.workerSignature);
  const prepareQuote = document.querySelector<HTMLElement>("#prepare-quote"); if (prepareQuote) prepareQuote.hidden = !isConsentPackage(currentDraft) || !currentDraft?.workerSignature;
  const exportDraft = document.querySelector<HTMLButtonElement>("#export-draft"); if (exportDraft) exportDraft.disabled = !currentDraft;
  const initialize = document.querySelector<HTMLButtonElement>("#prepare-initialize"); if (initialize) initialize.disabled = !ready || !workspace.epochConfig;
  const fund = document.querySelector<HTMLButtonElement>("#fund-built-epoch"); if (fund) fund.disabled = !ready || !workspace.epochConfig;
  for (const id of ["#prepare-source", "#execute-target", "#record-invoice", "#prepare-evidence"]) { const button = document.querySelector<HTMLButtonElement>(id); if (button) button.disabled = !ready; }
  for (const id of ["#build-settlement-plan", "#collect-closeout", "#inspect-lifecycle", "#collect-paid-work"]) { const button = document.querySelector<HTMLButtonElement>(id); if (button) button.disabled = !ready; }
  const settlement = document.querySelector<HTMLButtonElement>("#execute-settlement"); if (settlement) settlement.disabled = settlementExecutionBusy || !ready || !currentSettlementPlan || currentSettlementPlan.actions.length === 0;
}
function renderStoredSettlementJournal(planId?: string) {
  const journals = loadJson(SETTLEMENT_JOURNALS_KEY, {}), journal = planId ? journals[planId.toLowerCase()] : null;
  const node = document.querySelector<HTMLElement>("#settlement-journal"); if (!node) return;
  if (!journal) { showResult("settlement-journal", planId ? "No stored submissions for this plan." : "No journal for the current plan.", "empty"); return; }
  const rows = Object.entries(journal.entries ?? {}).map(([id, entry]: [string, any]) => `${id}\n${entry.state} · ${entry.transactionHash}${entry.blockNumber ? ` · block ${entry.blockNumber}` : " · receipt pending or unknown"}`);
  showResult("settlement-journal", `Durable journal for ${journal.planId}\n${rows.join("\n\n") || "No submissions yet."}`, "success");
}
function invalidateSettlementPlan(reason = "inputs changed") {
  settlementGeneration++; currentSettlementPlan = null; currentSettlementPlanContext = null;
  const actions = document.querySelector<HTMLElement>("#settlement-actions"); if (actions) actions.innerHTML = "";
  const result = document.querySelector<HTMLElement>("#settlement-result"); if (result) showResult("settlement-result", `Plan cleared: ${reason}. Build a fresh finalized plan before execution.`, "empty");
  syncWriteControls();
}
function invalidateCloseout(reason = "inputs changed") {
  closeoutGeneration++; currentCloseout = null; currentCloseoutResult = null;
  const exportButton = document.querySelector<HTMLButtonElement>("#export-closeout"); if (exportButton) exportButton.disabled = true;
  const rows = document.querySelector<HTMLElement>("#closeout-allocations"); if (rows) rows.innerHTML = "";
  const result = document.querySelector<HTMLElement>("#closeout-result"); if (result) showResult("closeout-result", `Fresh report cleared: ${reason}. Imported data remains a locator only.`, "empty");
  const lifecycle = document.querySelector<HTMLElement>("#lifecycle-result"); if (lifecycle) showResult("lifecycle-result", `Payment evidence cleared: ${reason}. Check the payment again for fresh evidence.`, "empty");
  const links = document.querySelector<HTMLElement>("#lifecycle-links"); if (links) links.innerHTML = "";
}
function invalidatePreparedSource(_reason = "inputs changed") {
  writeRevision++;
  preparedSource = null;
  preparedParticipantDelivery = null;
  const panel = document.querySelector<HTMLElement>("#source-prepared"); if (panel) panel.hidden = true;
  const code = document.querySelector<HTMLElement>("#source-calldata"); if (code) code.textContent = "";
  for (const id of ["#download-safe", "#execute-source"]) { const button = document.querySelector<HTMLButtonElement>(id); if (button) button.disabled = true; }
  const participantSend = document.querySelector<HTMLButtonElement>("#my-work-send"); if (participantSend) { participantSend.disabled = true; participantSend.hidden = true; }
}
function invalidatePreparedFunding() {
  writeRevision++;
  preparedFunding = null;
  const panel = document.querySelector<HTMLElement>("#funding-prepared"); if (panel) panel.hidden = true;
  const send = document.querySelector<HTMLButtonElement>("#send-funding"); if (send) send.disabled = true;
}
function invalidateWriteState(reason = "state changed") { verifiedWorkspaceFingerprint = null; clearProgramPaid(); invalidatePreparedSource(reason); invalidatePreparedFunding(); invalidateSettlementPlan(reason); invalidateCloseout(reason); syncWriteControls(); }
function changeDraft(next: any) { currentDraft = next; draftRevision++; invalidatePreparedSource("draft changed"); syncWriteControls(); }
function assertDraftSnapshot(revision: number, workspaceId: string) { if (draftRevision !== revision || workspaceFingerprint() !== workspaceId) throw new Error("The draft or verified workspace changed while the request was pending; the returned result was discarded"); }
function isConsentPackage(value: any) { return value?.version === "proofkey.work-treasury.work-authorization.v1"; }

function hashNode(left: string, right: string) { return ethers.keccak256(abi.encode(["bytes32", "bytes32", "bytes32"], [NODE_TYPEHASH, left, right])); }
function emptyNodes() { const values = [ethers.keccak256(abi.encode(["bytes32"], [EMPTY_TYPEHASH]))]; for (let i = 0; i < TREE_DEPTH; i++) values.push(hashNode(values[i], values[i])); return values; }
function normalizeAllocation(value: any) {
  const a = { epochId: requireHex(value.epochId, 32, "epochId"), allocationId: BigInt(value.allocationId), treeIndex: Number(value.treeIndex), kind: Number(value.kind), orderId: requireHex(value.orderId, 32, "orderId"), milestoneId: Number(value.milestoneId), role: Number(value.role), asset: requireAddress(value.asset, "asset"), amount: BigInt(value.amount), claimOwner: requireAddress(value.claimOwner, "claimOwner"), destination: requireAddress(value.destination, "destination"), policyHash: requireHex(value.policyHash, 32, "policyHash"), evidenceHash: requireHex(value.evidenceHash, 32, "evidenceHash") };
  if (!Number.isInteger(a.treeIndex) || a.treeIndex < 0 || a.treeIndex >= 128 || a.allocationId !== BigInt(a.treeIndex) + 1n) throw new Error("allocationId must equal treeIndex + 1 and fit the tree");
  if (a.amount <= 0n || a.claimOwner === ZERO_ADDRESS || a.destination === ZERO_ADDRESS) throw new Error("allocation amount and recipients must be nonzero");
  if (!((a.kind === 1 && a.role === 1) || (a.kind === 2 && a.role === 2) || (a.kind === 3 && a.role === 0))) throw new Error("allocation kind/role is not canonical");
  if (a.kind === 3 && (a.orderId !== ZERO32 || a.milestoneId !== 0)) throw new Error("RETURN must use zero order and milestone IDs");
  return a;
}
function hashAllocation(value: any) { const a = normalizeAllocation(value); return ethers.keccak256(abi.encode(["bytes32", "bytes32", "uint64", "uint32", "uint8", "bytes32", "uint32", "uint8", "address", "uint256", "address", "address", "bytes32", "bytes32"], [LEAF_TYPEHASH, a.epochId, a.allocationId, a.treeIndex, a.kind, a.orderId, a.milestoneId, a.role, a.asset, a.amount, a.claimOwner, a.destination, a.policyHash, a.evidenceHash])); }
function buildRoot(leaves: string[]) { if (leaves.length > 128) throw new Error("Tree exceeds 128 leaves"); const zero = emptyNodes(); let level = Array.from({ length: 128 }, (_, i) => leaves[i] ?? zero[0]); for (let depth = 0; depth < 7; depth++) { const next = []; for (let i = 0; i < level.length; i += 2) next.push(hashNode(level[i], level[i + 1])); level = next; } return level[0]; }
function orderedProof(leaves: string[], index: number) { if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new Error("Allocation index is outside the committed prefix"); const zero = emptyNodes(); let level = Array.from({ length: 128 }, (_, i) => leaves[i] ?? zero[0]), cursor = index; const siblings: string[] = []; for (let depth = 0; depth < 7; depth++) { siblings.push(level[cursor ^ 1]); const next = []; for (let i = 0; i < level.length; i += 2) next.push(hashNode(level[i], level[i + 1])); level = next; cursor >>= 1; } return siblings; }
function verifyProof(leaf: string, index: number, siblings: string[], root: string, leafCount: number) { if (siblings.length !== 7 || index < 0 || index >= leafCount || leafCount > 128) return false; let node = leaf; for (let level = 0; level < 7; level++) { requireHex(siblings[level], 32, `Sibling ${level}`); node = ((index >> level) & 1) === 0 ? hashNode(node, siblings[level]) : hashNode(siblings[level], node); } return node.toLowerCase() === root.toLowerCase(); }

function parseClaimPackage(raw: any) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || value.version !== "proofkey.work-treasury.claim-package.v1" || !["checkpoint", "receipt"].includes(value.route)) throw new Error("Unsupported or malformed claim package");
  const allocation = normalizeAllocation(value.allocation);
  const leaf = hashAllocation(allocation);
  if (value.route === "checkpoint") {
    requireHex(value.checkpoint?.root, 32, "Checkpoint root");
    requireHex(value.checkpoint?.checkpointId, 32, "Checkpoint ID");
    if (!Array.isArray(value.siblings) || !verifyProof(leaf, allocation.treeIndex, value.siblings, value.checkpoint.root, Number(value.checkpoint.leafCount))) throw new Error("Allocation is not in the supplied ordered checkpoint");
    // checkpointId is the directly usable target cache reference; optional proof material can recreate it.
  } else {
    requireHex(value.encodedTransaction, undefined, "Exact encoded transaction");
    if (!value.material && !value.authentication) throw new Error("Receipt route needs exact native proof material or a target authentication reference");
    if (value.material && String(value.material.encodedTransaction).toLowerCase() !== String(value.encodedTransaction).toLowerCase()) throw new Error("Receipt material and package encoded transaction differ");
  }
  return { ...value, allocation: { ...allocation, allocationId: allocation.allocationId.toString(), amount: allocation.amount.toString() }, leaf };
}
function serializeAllocation(value: any) { const a = normalizeAllocation(value); return { ...a, allocationId: a.allocationId.toString(), amount: a.amount.toString() }; }

function navigate(name: string) {
  document.querySelectorAll(".view").forEach(node => node.classList.toggle("active", node.id === `view-${name}`));
  document.querySelectorAll(".nav-item").forEach(node => node.classList.toggle("active", (node as HTMLElement).dataset.view === name));
  $(".rail").classList.remove("open"); $("#menu-button").setAttribute("aria-expanded", "false"); window.scrollTo({ top: 0, behavior: "smooth" });
}

function populatePolicy() { $("#policy-list").innerHTML = POLICY_ACTIONS.map(([actor, action, note]) => `<div class="policy-row"><b>${actor}</b><div><span>${action}</span><small>${note}</small></div></div>`).join(""); }
function writableFunctions(contractName: string, include?: string[]) { const iface = new ethers.Interface(artifact(contractName).abi); return iface.fragments.filter((fragment: any) => fragment.type === "function" && !["view", "pure"].includes(fragment.stateMutability) && (!include || include.includes(fragment.name))).sort((a: any, b: any) => a.name.localeCompare(b.name)); }
function populateActions() {
  try {
    const source = writableFunctions("SourceCoordinator");
    const select = $<HTMLSelectElement>("#source-function"); select.innerHTML = source.map((fn: any) => `<option value="${fn.format("sighash")}">${fn.name}</option>`).join(""); updateActionHelp("source");
    const evidenceNames = ["authenticateTransaction", "authenticateBatch", "authenticateSegmented", "importCheckpoint", "authenticateCheckpoint", "recognizeFromCheckpoint", "authenticateAndRecognizeCheckpoint", "recognizeFromReceipt", "authenticateAndRecognizeReceipt"];
    const evidence = writableFunctions("WorkTreasury", evidenceNames); const eSelect = $<HTMLSelectElement>("#evidence-function"); eSelect.innerHTML = evidence.map((fn: any) => `<option value="${fn.format("sighash")}">${fn.name}</option>`).join("");
    const paymentNames = ["deposit", "fundEpoch", "fundEpochFromFree", "withdrawFor", "ownerWithdrawTo", "withdrawFreeFor", "ownerWithdrawFreeTo"];
    const target = writableFunctions("WorkTreasury", paymentNames); const tSelect = $<HTMLSelectElement>("#target-function"); tSelect.innerHTML = target.map((fn: any) => `<option value="${fn.format("sighash")}">${fn.name}</option>`).join(""); updateActionHelp("target");
  } catch (error) { $("#abi-status").textContent = "Contract artifacts are not ready"; $("#abi-detail").textContent = String((error as Error).message); }
}
function updateActionHelp(area: "source" | "target") { const select = $<HTMLSelectElement>(`#${area}-function`); const fn = select.options[select.selectedIndex]?.textContent ?? ""; const help = area === "source" ? SOURCE_HELP[fn] : TARGET_HELP[fn]; if (area === "source") { $("#source-actor").textContent = help?.[0] ?? "Contract-defined actor"; $("#source-help").textContent = help?.[1] ?? "This function comes from the compiled SourceCoordinator interface."; } else { $("#target-actor").textContent = help?.[0] ?? "Contract-defined actor"; $("#target-help").textContent = help?.[1] ?? "This function comes from the compiled WorkTreasury interface."; } }

function fillSettings() {
  const form = $<HTMLFormElement>("#settings-form"); form.reset(); const values: Record<string, any> = { sourceLabel: workspace.source?.label, sourceChainId: workspace.source?.chainId, sourceConfirmations: workspace.source?.confirmations, sourceRpc: workspace.source?.rpcUrl, coordinator: workspace.source?.coordinator, safe: workspace.source?.safe, sourceChainKey: workspace.source?.chainKey, targetLabel: workspace.target?.label, targetChainId: workspace.target?.chainId, targetConfirmations: workspace.target?.confirmations, targetRpc: workspace.target?.rpcUrl, treasury: workspace.target?.treasury, invoiceBook: workspace.target?.invoiceBook, proofService: workspace.proofServiceUrl };
  for (const [name, value] of Object.entries(values)) if (value !== undefined) (form.elements.namedItem(name) as HTMLInputElement).value = String(value);
  const epoch = String(workspace.lastEpochId ?? ""); $<HTMLInputElement>("#active-epoch").value = epoch; $<HTMLInputElement>("#payment-epoch").value = epoch; $<HTMLInputElement>("#invoice-epoch").value = epoch; $<HTMLInputElement>("#lifecycle-epoch").value = epoch; $<HTMLInputElement>("#closeout-epoch").value = epoch;
  $<HTMLInputElement>("#proof-url").value = String(workspace.proofServiceUrl ?? "");
  $<HTMLInputElement>("#proof-chain-key").value = String(workspace.source?.chainKey ?? "");
  const hasDemo = Boolean(window.PROOFKEY_DEMO_CONFIG?.source && window.PROOFKEY_DEMO_CONFIG?.target); $<HTMLElement>("#load-local-demo").hidden = !hasDemo;
  const hasPublicDemo = Boolean(window.PROOFKEY_DEFAULT_CONFIG?.source && window.PROOFKEY_DEFAULT_CONFIG?.target); $<HTMLElement>("#load-public-demo").hidden = !hasPublicDemo;
  const stored = loadWorkspaceState(); $("#settings-storage-tag").textContent = stored.error ? "Saved setup unreadable" : stored.present ? "Saved on this device" : "Temporary public demo";
  const configured = Boolean(workspace.source?.rpcUrl && workspace.target?.rpcUrl); $("#rail-status").textContent = configured ? `${workspace.source.label} ↔ ${workspace.target.label}` : "No networks configured"; signal("rail-signal", configured ? "good" : "neutral"); $("#environment-tag").textContent = configured ? "Configured readback · verify before action" : "Configuration required";
}
function readSettingsForm() { const form = new FormData($<HTMLFormElement>("#settings-form")); const positive = (name: string) => { const n = Number(form.get(name)); if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a nonnegative integer`); return n; }; return { source: { label: String(form.get("sourceLabel") || "Ethereum source"), chainId: positive("sourceChainId"), confirmations: positive("sourceConfirmations"), rpcUrl: String(form.get("sourceRpc") || "").trim(), coordinator: requireAddress(form.get("coordinator"), "SourceCoordinator"), safe: requireAddress(form.get("safe"), "Safe"), chainKey: BigInt(String(form.get("sourceChainKey"))) }, target: { label: String(form.get("targetLabel") || "Creditcoin target"), chainId: positive("targetChainId"), confirmations: positive("targetConfirmations"), rpcUrl: String(form.get("targetRpc") || "").trim(), treasury: requireAddress(form.get("treasury"), "WorkTreasury"), invoiceBook: String(form.get("invoiceBook") || "").trim() ? requireAddress(form.get("invoiceBook"), "PaidInvoiceBook") : "", }, proofServiceUrl: String(form.get("proofService") || "").trim() }; }
function buildEpochConfiguration(form: HTMLFormElement) {
  const source = sourceConfig(), target = targetConfig(), value: any = Object.fromEntries(new FormData(form));
  const integer = (name: string, nonzero = false) => { const text = String(value[name]); if (!/^(0|[1-9][0-9]*)$/.test(text) || (nonzero && text === "0")) throw new Error(`${name} must be ${nonzero ? "a positive" : "a nonnegative"} integer`); return text; };
  const config = {
    sourceChainId: String(source.chainId), sourceChainKey: String(source.chainKey), sourceCoordinator: source.coordinator, sourceVersion: SOURCE_VERSION,
    targetChainId: String(target.chainId), targetTreasury: target.treasury, schemaVersion: SCHEMA_VERSION, sourceSafe: source.safe,
    sponsor: requireAddress(value.sponsor, "Sponsor"), refundBeneficiary: requireAddress(value.refundBeneficiary, "Refund beneficiary"), asset: ZERO_ADDRESS,
    cap: parseNative(value.cap, "Budget cap", true).toString(), policyHash: POLICY_HASH, initializationCutoff: integer("initializationCutoff", true), admissionCutoff: integer("admissionCutoff", true),
    maxMilestones: 32, maxActiveReturns: 16, maxDrainingReturns: 33, treeDepth: 7, nonce: integer("nonce"),
  };
  if (BigInt(config.admissionCutoff) <= BigInt(config.initializationCutoff)) throw new Error("Admission cutoff must follow initialization cutoff");
  const epochId = ethers.keccak256(abi.encode(["bytes32", EPOCH_TUPLE], [EPOCH_TYPEHASH, config]));
  return { config, epochId, createdAt: new Date().toISOString(), authority: "none" };
}
function prepareBuiltEpochFunding() {
  requireVerifiedWorkspace(); invalidatePreparedFunding();
  if (!workspace.epochConfig) throw new Error("Build an exact epoch configuration first");
  const c = targetConfig();
  const tx = prepare("WorkTreasury", c.treasury, c.chainId, "fundEpoch", JSON.stringify([workspace.epochConfig.config]), workspace.epochConfig.config.cap);
  preparedFunding = { ...tx, workspaceFingerprint: workspaceFingerprint(), epochFingerprint: fingerprint(workspace.epochConfig) };
  $("#funding-calldata").textContent = `Target ${c.chainId} · Treasury ${c.treasury} · Sponsor ${workspace.epochConfig.config.sponsor} · Epoch ${workspace.epochConfig.epochId} · Amount ${formatNative(tx.value)} (${tx.value} base units) · Calldata ${tx.data}`;
  $("#funding-prepared").hidden = false; $<HTMLButtonElement>("#send-funding").disabled = false;
  toast("Exact funding prepared without requesting a wallet.");
}
async function sendBuiltEpochFunding() {
  requireVerifiedWorkspace();
  if (!preparedFunding || preparedFunding.workspaceFingerprint !== workspaceFingerprint() || preparedFunding.epochFingerprint !== fingerprint(workspace.epochConfig)) throw new Error("Funding preview is stale; prepare it again");
  const submittedEpoch = workspace.epochConfig.epochId, submittedSponsor = workspace.epochConfig.config.sponsor, funding = structuredClone(preparedFunding);
  await sendPrepared(funding, false, submittedSponsor);
  invalidatePreparedFunding();
  showResult("epoch-result", `Funding transaction confirmed for ${submittedEpoch}. Refresh finalized Creditcoin readback before treating the epoch as funded.`, "success");
}
function prepareEpochInitialization() {
  requireVerifiedWorkspace(); invalidatePreparedSource("preparing epoch initialization");
  if (!workspace.epochConfig) throw new Error("Build an exact epoch configuration first");
  const c = sourceConfig();
  const signature = writableFunctions("SourceCoordinator").find((fn: any) => fn.name === "initializeEpoch")?.format("sighash");
  if (!signature) throw new Error("Compiled coordinator has no initializeEpoch function");
  $<HTMLSelectElement>("#source-function").value = signature;
  $<HTMLInputElement>("#source-args").value = JSON.stringify([workspace.epochConfig.config]);
  navigate("orders");
  toast("Exact initialization loaded. Review it and prepare the Safe transaction.");
}
async function verifySettings(candidate: any) {
  signal("source-config-signal", "wait"); signal("target-config-signal", "wait");
  const sourceProvider = new ethers.JsonRpcProvider(candidate.source.rpcUrl), targetProvider = new ethers.JsonRpcProvider(candidate.target.rpcUrl);
  try {
    const [sourceNetwork, targetNetwork, sourceRawChainId, targetRawChainId, sourceStable, targetStable] = await Promise.all([
      sourceProvider.getNetwork(), targetProvider.getNetwork(), sourceProvider.send("eth_chainId", []), targetProvider.send("eth_chainId", []), stableBlock(sourceProvider, Number(candidate.source.confirmations ?? 12)), stableBlock(targetProvider, Number(candidate.target.confirmations ?? 12)),
    ]);
    if (sourceNetwork.chainId !== BigInt(candidate.source.chainId) || BigInt(sourceRawChainId) !== BigInt(candidate.source.chainId)) throw new Error(`${candidate.source.label} RPC reports another chain, not ${candidate.source.chainId}`);
    if (targetNetwork.chainId !== BigInt(candidate.target.chainId) || BigInt(targetRawChainId) !== BigInt(candidate.target.chainId)) throw new Error(`${candidate.target.label} RPC reports another chain, not ${candidate.target.chainId}`);
    const treasury = new ethers.Contract(candidate.target.treasury, artifact("WorkTreasury").abi, targetProvider);
    const [sourceCode, sourceSafeCode, targetCode, pinnedChainId, pinnedChainKey, pinnedCoordinator] = await Promise.all([
      sourceProvider.getCode(candidate.source.coordinator, sourceStable.blockTag), sourceProvider.getCode(candidate.source.safe, sourceStable.blockTag), targetProvider.getCode(candidate.target.treasury, targetStable.blockTag),
      treasury.SOURCE_CHAIN_ID.staticCall({ blockTag: targetStable.blockTag }), treasury.SOURCE_CHAIN_KEY.staticCall({ blockTag: targetStable.blockTag }), treasury.SOURCE_COORDINATOR.staticCall({ blockTag: targetStable.blockTag }),
    ]);
    if (sourceCode === "0x") throw new Error("No SourceCoordinator code exists at the selected stable source block");
    if (sourceSafeCode === "0x") throw new Error("The configured source authority has no contract code at the selected stable source block");
    if (targetCode === "0x") throw new Error("No WorkTreasury code exists at the selected stable target block");
    if (BigInt(pinnedChainId) !== BigInt(candidate.source.chainId) || BigInt(pinnedChainKey) !== BigInt(candidate.source.chainKey) || String(pinnedCoordinator).toLowerCase() !== candidate.source.coordinator.toLowerCase()) throw new Error("WorkTreasury immutable source domain does not match this workspace");
    const trusted = (window.PROOFKEY_TRUSTED_DEPLOYMENTS ?? []).find(profile => String(profile.source.chainId) === String(candidate.source.chainId)
      && String(profile.source.chainKey) === String(candidate.source.chainKey)
      && profile.source.coordinator.toLowerCase() === candidate.source.coordinator.toLowerCase()
      && profile.source.deployedCodeHash.toLowerCase() === ethers.keccak256(sourceCode).toLowerCase()
      && String(profile.target.chainId) === String(candidate.target.chainId)
      && profile.target.treasury.toLowerCase() === candidate.target.treasury.toLowerCase()
      && profile.target.deployedCodeHash.toLowerCase() === ethers.keccak256(targetCode).toLowerCase());
    signal("source-config-signal", "good"); signal("target-config-signal", "good");
    return { trusted, detail: `Verified source chain ${sourceNetwork.chainId} and target chain ${targetNetwork.chainId}. WorkTreasury's immutable source domain matches at target ${targetStable.label}; source code was present at ${sourceStable.label}.${trusted ? ` Runtime hashes match ${trusted.label}; write preparation is unlocked for this session.` : " This deployment is not in the build's trusted release registry, so it remains inspection-only."}` };
  } catch (error) {
    signal("source-config-signal", "bad"); signal("target-config-signal", "bad"); throw error;
  } finally {
    sourceProvider.destroy?.(); targetProvider.destroy?.();
  }
}

async function verifySettingsWithStatus(candidate: any, prefix: string) {
  showResult("settings-result", `${prefix}\nChecking both RPC chain IDs, deployed code and the target's immutable source domain…`, "empty");
  try {
    const result = await verifySettings(candidate);
    verifiedWorkspaceFingerprint = result.trusted ? workspaceFingerprint(candidate) : null;
    syncWriteControls();
    $("#startup-status").hidden = true;
    showResult("settings-result", `${prefix}\n${result.detail}\nNo wallet account, signature or transaction was requested.`, "success");
    return result.detail;
  } catch (error) {
    verifiedWorkspaceFingerprint = null;
    syncWriteControls();
    showResult("settings-result", `${prefix}\nVerification failed: ${(error as Error).message}\nThese settings were not treated as verified. Choose Use public demo defaults to recover without connecting a wallet.`, "error");
    throw error;
  }
}

function clearWalletSession(reason: string) { walletSessionGeneration++; connected = null; invalidatePreparedSource(reason); invalidatePreparedFunding(); $("#connect-wallet span:last-child").textContent = "Connect wallet"; $("#network-context").textContent = "Wallet changed · reconnect explicitly"; $(".wallet-dot").classList.remove("good"); }
function bindWalletEvents() {
  if (walletEventsBound || !window.ethereum?.on) return;
  walletEventsBound = true;
  for (const event of ["accountsChanged", "chainChanged", "disconnect"]) window.ethereum.on(event, () => clearWalletSession(`wallet ${event}`));
}
async function connectWallet() { if (!window.ethereum) throw new Error("No browser wallet was found. Read-only RPC access remains available."); bindWalletEvents(); const provider = new ethers.BrowserProvider(window.ethereum); await provider.send("eth_requestAccounts", []); const signer = await provider.getSigner(); const network = await provider.getNetwork(); connected = { provider, signer, account: ethers.getAddress(await signer.getAddress()), chainId: network.chainId }; walletSessionGeneration++; $("#connect-wallet span:last-child").textContent = short(connected.account); $("#network-context").textContent = `Wallet on chain ${connected.chainId}`; $(".wallet-dot").classList.add("good"); toast("Wallet connected. Contract state will still be read from the configured RPCs."); }

function setMetrics(id: string, entries: [string, unknown][]) { $(id).innerHTML = entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${format(value as any)}</dd></div>`).join(""); }
async function refreshReadback(options: { persistEpoch?: boolean } = {}) {
  clearProgramPaid();
  const epoch = activeEpoch(); workspace.lastEpochId = epoch; if (options.persistEpoch !== false) saveJson(STORAGE_KEY, workspace); $<HTMLInputElement>("#payment-epoch").value = epoch; $<HTMLInputElement>("#invoice-epoch").value = epoch;
  let sourceState: any = null, targetState: any = null, targetBlockLabel = "the selected target block";
  try { signal("source-signal", "wait"); const c = sourceConfig(); const provider = new ethers.JsonRpcProvider(c.rpcUrl); const stable = await stableBlock(provider, Number(c.confirmations ?? 12)); const contract = new ethers.Contract(c.coordinator, artifact("SourceCoordinator").abi, provider); sourceState = await contract.epochState.staticCall(epoch, { blockTag: stable.blockTag }); signal("source-signal", "good"); $("#source-main").textContent = sourceState.initialized ? ["Unknown", "Active", "Draining", "Closed"][Number(sourceState.phase)] ?? `Phase ${sourceState.phase}` : sourceState.expiredUninitialized ? "Expired before initialization" : "Not initialized"; $("#source-detail").textContent = `Read at source ${stable.label}. Root ${short(sourceState.root)}.`; setMetrics("#source-metrics", [["Available", formatNative(sourceState.available)], ["Unresolved", formatNative(sourceState.unresolved)], ["Leaves", sourceState.leafCount]]); renderProgramBoard(sourceState); provider.destroy?.(); } catch (error) { renderProgramBoard(null); signal("source-signal", "bad"); $("#source-main").textContent = "Source unavailable"; $("#source-detail").textContent = (error as Error).message; }
  try {
    signal("target-signal", "wait"); const c = targetConfig(), source = sourceConfig(); const provider = new ethers.JsonRpcProvider(c.rpcUrl); const stable = await stableBlock(provider, Number(c.confirmations ?? 12)); const contract = new ethers.Contract(c.treasury, artifact("WorkTreasury").abi, provider);
    const [network, account, rawConfig, pinnedChainId, pinnedChainKey, pinnedCoordinator] = await Promise.all([
      provider.getNetwork(), contract.epochAccount.staticCall(epoch, { blockTag: stable.blockTag }), contract.epochConfig.staticCall(epoch, { blockTag: stable.blockTag }),
      contract.SOURCE_CHAIN_ID.staticCall({ blockTag: stable.blockTag }), contract.SOURCE_CHAIN_KEY.staticCall({ blockTag: stable.blockTag }), contract.SOURCE_COORDINATOR.staticCall({ blockTag: stable.blockTag }),
    ]);
    if (network.chainId !== BigInt(c.chainId)) throw new Error("Target RPC chain changed");
    const config = normalizeEpochConfig(rawConfig); const derived = ethers.keccak256(abi.encode(["bytes32", EPOCH_TUPLE], [EPOCH_TYPEHASH, config]));
    if (derived.toLowerCase() !== epoch.toLowerCase()) throw new Error("Target stored configuration does not derive this epoch ID");
    if (BigInt(pinnedChainId) !== BigInt(source.chainId) || BigInt(pinnedChainKey) !== BigInt(source.chainKey) || String(pinnedCoordinator).toLowerCase() !== source.coordinator.toLowerCase()) throw new Error("Target immutable source domain does not match the configured source");
    if (BigInt(config.sourceChainId) !== BigInt(source.chainId) || BigInt(config.sourceChainKey) !== BigInt(source.chainKey) || config.sourceCoordinator.toLowerCase() !== source.coordinator.toLowerCase() || config.sourceSafe.toLowerCase() !== source.safe.toLowerCase() || BigInt(config.targetChainId) !== BigInt(c.chainId) || config.targetTreasury.toLowerCase() !== c.treasury.toLowerCase() || config.sourceVersion.toLowerCase() !== SOURCE_VERSION || config.schemaVersion.toLowerCase() !== SCHEMA_VERSION || config.policyHash.toLowerCase() !== POLICY_HASH) throw new Error("Target funded configuration does not match the pinned workspace domain");
    targetState = account; targetBlockLabel = stable.label; signal("target-signal", account.funded ? "good" : "wait"); $("#target-main").textContent = account.funded ? "Exact epoch funded" : "Epoch not funded"; $("#target-detail").textContent = `Epoch account, configuration and source-domain immutables read together at target ${stable.label}.`; setMetrics("#target-metrics", [["Reserve", formatNative(account.reserve)], ["Recognized", formatNative(account.recognized)], ["Funded", account.funded ? "Yes" : "No"]]); provider.destroy?.();
  } catch (error) { signal("target-signal", "bad"); $("#target-main").textContent = "Target unavailable"; $("#target-detail").textContent = (error as Error).message; }
  signal("action-signal", sourceState && targetState ? "good" : sourceState || targetState ? "wait" : "neutral"); if (!sourceState || !targetState) { $("#action-main").textContent = "Wait for complete readback"; $("#action-detail").textContent = targetState?.funded ? `Target funding was observed at ${targetBlockLabel}, but the stable source state is unavailable or still lagging. Refresh before treating any source action as authorized.` : "Both stable chain reads must succeed before this app identifies an authorized next action."; } else if (!targetState.funded) { $("#action-main").textContent = "Sponsor funds exact epoch"; $("#action-detail").textContent = "Funding must be observed on Creditcoin before requesting binding worker consent."; } else if (!sourceState.initialized) { $("#action-main").textContent = "Safe initializes source"; $("#action-detail").textContent = "The target cap is funded. The source Safe may initialize the matching configuration before its cutoff."; } else if (Number(sourceState.phase) === 1) { $("#action-main").textContent = "Review orders and cutoffs"; $("#action-detail").textContent = "The epoch is active. Read each order and milestone to identify the current authorized actor."; } else if (Number(sourceState.phase) === 2) { $("#action-main").textContent = "Resolve and sweep"; $("#action-detail").textContent = "Admissions are closed. Existing obligations remain; anyone may sweep positive available capacity."; } else { $("#action-main").textContent = "Collect remaining claims"; $("#action-detail").textContent = "The source is closed. Old earned allocations remain collectible on Creditcoin."; }
  return { sourceRead: Boolean(sourceState), targetRead: Boolean(targetState) };
}

function readAuthorizationOrder(form: HTMLFormElement) {
  const value: any = Object.fromEntries(new FormData(form));
  const integer = (name: string) => { if (!/^(0|[1-9][0-9]*)$/.test(String(value[name]))) throw new Error(`${name} must be a nonnegative integer`); return String(value[name]); };
  const worker = requireAddress(value.worker, "Worker"), claimOwner = requireAddress(value.claimOwner, "Claim owner"), destination = requireAddress(value.destination, "Destination");
  if (destination.toLowerCase() !== claimOwner.toLowerCase() && !value.destinationAck) throw new Error("A different fixed destination requires the standing-payment acknowledgement");
  const milestone = { work: parseNative(value.work, "Worker maximum", true).toString(), fee: parseNative(value.fee, "Committee fee").toString(), timeoutWork: parseNative(value.timeoutWork, "Timeout worker amount").toString(), deliverBefore: integer("deliverBefore"), reviewBefore: integer("reviewBefore"), ruleBefore: integer("ruleBefore") };
  const acceptBefore = integer("acceptBefore");
  const order = { worker, claimOwner, destination, feeOwner: requireAddress(value.feeOwner, "Fee owner"), feeDestination: requireAddress(value.feeDestination, "Fee destination"), committee: [requireAddress(value.committee0, "Committee 1"), requireAddress(value.committee1, "Committee 2"), requireAddress(value.committee2, "Committee 3")], acceptBefore, nonce: integer("nonce"), milestones: [milestone] };
  if (new Set(order.committee.map((item: string) => item.toLowerCase())).size !== 3) throw new Error("Committee members must be distinct");
  return { value, order, epochId: requireHex(value.epochId, 32, "Epoch ID"), required: BigInt(milestone.work) + BigInt(milestone.fee) };
}
async function targetFunding(epochId: string, required: bigint) {
  const c = targetConfig(), source = sourceConfig(), provider = new ethers.JsonRpcProvider(c.rpcUrl);
  try {
    const finalized = await finalizedTargetBlock(provider), contract = new ethers.Contract(c.treasury, artifact("WorkTreasury").abi, provider);
    const [network, account, config] = await Promise.all([provider.getNetwork(), contract.epochAccount.staticCall(epochId, { blockTag: finalized.blockTag }), contract.epochConfig.staticCall(epochId, { blockTag: finalized.blockTag })]);
    if (network.chainId !== BigInt(c.chainId)) throw new Error("Target RPC chain changed");
    if (!account.funded) throw new Error("Exact epoch is not funded on Creditcoin");
    if (BigInt(account.reserve) < required) throw new Error("Target remaining reserve is below this milestone maximum");
    const normalized = normalizeEpochConfig(config), derived = ethers.keccak256(abi.encode(["bytes32", EPOCH_TUPLE], [EPOCH_TYPEHASH, normalized]));
    if (derived.toLowerCase() !== epochId.toLowerCase()) throw new Error("Target stored configuration does not derive this epoch ID");
    if (BigInt(normalized.sourceChainId) !== BigInt(source.chainId) || BigInt(normalized.sourceChainKey) !== BigInt(source.chainKey) || normalized.sourceCoordinator.toLowerCase() !== source.coordinator.toLowerCase() || normalized.sourceSafe.toLowerCase() !== source.safe.toLowerCase() || BigInt(normalized.targetChainId) !== BigInt(c.chainId) || normalized.targetTreasury.toLowerCase() !== c.treasury.toLowerCase() || normalized.sourceVersion.toLowerCase() !== SOURCE_VERSION || normalized.schemaVersion.toLowerCase() !== SCHEMA_VERSION || normalized.policyHash.toLowerCase() !== POLICY_HASH) throw new Error("Target funded configuration does not match the pinned workspace domain");
    return { block: finalized.blockTag, blockHash: finalized.blockHash, blockLabel: finalized.label, finalityBasis: finalized.finalityBasis, reserve: account.reserve, config: normalized, targetChainId: c.chainId };
  } finally { provider.destroy?.(); }
}
async function sourceCapacity(epochId: string, required: bigint) { const c = sourceConfig(), provider = new ethers.JsonRpcProvider(c.rpcUrl); try { const finalized = await finalizedSourceBlock(provider), contract = new ethers.Contract(c.coordinator, artifact("SourceCoordinator").abi, provider); const [state, rawConfig] = await Promise.all([contract.epochState.staticCall(epochId, { blockTag: finalized.blockTag }), contract.epochConfig.staticCall(epochId, { blockTag: finalized.blockTag })]); if (!state.initialized || Number(state.phase) !== 1) throw new Error("Source epoch is not active for new reservations"); if (BigInt(state.available) < required) throw new Error("Source available capacity is below this order maximum"); const remainingAdmissions = 32 - Number(state.reservations); if (remainingAdmissions < 1) throw new Error("Source milestone admission capacity is exhausted even though money may remain"); return { block: finalized.blockTag, blockHash: finalized.blockHash, blockLabel: finalized.label, finalityBasis: finalized.finalityBasis, available: state.available, reservations: Number(state.reservations), remainingAdmissions, config: normalizeEpochConfig(rawConfig) }; } finally { provider.destroy?.(); } }
async function createDraft(form: HTMLFormElement) {
  requireVerifiedWorkspace();
  const { value, order, epochId, required } = readAuthorizationOrder(form);
  const [funding, capacity] = await Promise.all([targetFunding(epochId, required), sourceCapacity(epochId, required)]);
  if (fingerprint(funding.config) !== fingerprint(capacity.config)) throw new Error("Finalized source and target epoch configurations differ");
  const authorization = {
    commercialTerms: { scope: String(value.scope), acceptanceCriteria: String(value.acceptanceCriteria), revisionTerms: String(value.revisionTerms), deliveryRequirements: String(value.deliveryRequirements), deliveryCommitmentFormat: String(value.deliveryCommitmentFormat) },
    epochConfig: funding.config,
    order,
    targetFunding: { targetChainId: String(funding.targetChainId), targetTreasury: targetConfig().treasury, blockNumber: String(funding.block), blockHash: funding.blockHash, finalityBasis: funding.finalityBasis, epochId, cap: String(funding.config.cap), reserve: String(funding.reserve), requiredMaximum: required.toString() },
    sourceCapacity: { sourceChainId: String(sourceConfig().chainId), sourceCoordinator: sourceConfig().coordinator, blockNumber: String(capacity.block), blockHash: capacity.blockHash, finalityBasis: capacity.finalityBasis, epochId, phase: 1, available: String(capacity.available), reservations: capacity.reservations, remainingMilestoneAdmissions: capacity.remainingAdmissions, requiredMaximum: required.toString() },
  };
  return consentSdk().createWorkAuthorizationDraft({ authorization });
}
function assertAuthorizationDomain(packet: any) {
  const parsed = consentSdk().parseWorkAuthorizationPackage(packet), source = sourceConfig(), target = targetConfig(), epoch = parsed.authorization.epochConfig;
  if (String(epoch.sourceChainId) !== String(source.chainId) || epoch.sourceCoordinator.toLowerCase() !== source.coordinator.toLowerCase() || epoch.sourceSafe.toLowerCase() !== source.safe.toLowerCase() || String(epoch.targetChainId) !== String(target.chainId) || epoch.targetTreasury.toLowerCase() !== target.treasury.toLowerCase()) throw new Error("Imported authorization domain does not match the verified workspace");
  return parsed;
}
async function useFollowupTemplate() {
  requireVerifiedWorkspace();
  const form = $<HTMLFormElement>("#draft-form"), generation = ++followupGeneration, workspaceId = workspaceFingerprint(), draftAtStart = draftRevision, formAtStart = formFingerprint(form), templateAtStart = followupTemplate?.orderId?.toLowerCase(), packet = assertAuthorizationDomain(structuredClone(followupTemplate));
  const assertFresh = () => { if (followupGeneration !== generation || workspaceFingerprint() !== workspaceId || draftRevision !== draftAtStart || formFingerprint(form) !== formAtStart || followupTemplate?.orderId?.toLowerCase() !== templateAtStart) throw new Error("The workspace, selected template, current offer or form changed while checking follow-up work; the stale result was discarded"); };
  if (!packet.workerSignature) throw new Error("Follow-up work must start from a signed prior authorization");
  const source = sourceConfig(), provider = new ethers.JsonRpcProvider(source.rpcUrl);
  try {
    const finalized = await finalizedSourceBlock(provider); assertFresh(); const contract = new ethers.Contract(source.coordinator, artifact("SourceCoordinator").abi, provider), milestoneId = 0;
    const [state, epochConfig, order, milestone, finalCode, head] = await Promise.all([
      contract.epochState.staticCall(packet.orderTerms.epochId, { blockTag: finalized.blockTag }), contract.epochConfig.staticCall(packet.orderTerms.epochId, { blockTag: finalized.blockTag }),
      contract.order.staticCall(packet.orderId, { blockTag: finalized.blockTag }), contract.milestone.staticCall(packet.orderId, milestoneId, { blockTag: finalized.blockTag }), contract.MILESTONE_FINAL.staticCall({ blockTag: finalized.blockTag }), provider.getBlockNumber(),
    ]);
    assertFresh();
    if (!order.exists || !order.agreed || Number(milestone.status) !== Number(finalCode) || Number(order.milestoneCount) < 1 || Number(order.finalizedCount) !== Number(order.milestoneCount)) throw new Error("Every milestone in the selected accepted job must be final before it can be used as a follow-up template; unfinished work remains available for tracking");
    if (!state.initialized || Number(state.phase) !== 1) throw new Error(Number(state.phase) === 2 ? "This program is draining and refuses new work" : "This program is closed or unavailable for new work");
    if (BigInt(head) >= BigInt(epochConfig.admissionCutoff)) throw new Error("The source admission cutoff has passed; use a fresh epoch for new work");
    if (Number(state.reservations) >= 32) throw new Error("This program has used its lifetime milestone admission capacity");
    if (BigInt(state.available) === 0n) throw new Error("This program has no available capacity for a follow-up");
    let nonce = BigInt(packet.orderTerms.nonce) + 1n, nonceState = 1;
    for (let attempts = 0; attempts < 64 && nonce <= 18_446_744_073_709_551_615n; attempts++, nonce++) {
      nonceState = Number(await contract.quoteNonceState.staticCall(packet.orderTerms.epochId, packet.orderTerms.worker, nonce, { blockTag: finalized.blockTag }));
      assertFresh();
      if (nonceState === 0) break;
    }
    if (nonceState !== 0) throw new Error("No fresh unused worker nonce was found in the next 64 values");
    const terms = packet.orderTerms, previous = terms.milestones[0], commercial = packet.authorization.commercialTerms;
    const latest = BigInt(head), acceptanceWindow = 120n, oldDeliveryWindow = BigInt(previous.deliverBefore) > BigInt(terms.acceptBefore) ? BigInt(previous.deliverBefore) - BigInt(terms.acceptBefore) : 1n, oldReviewWindow = BigInt(previous.reviewBefore) > BigInt(previous.deliverBefore) ? BigInt(previous.reviewBefore) - BigInt(previous.deliverBefore) : 1n, oldRuleWindow = BigInt(previous.ruleBefore) > BigInt(previous.reviewBefore) ? BigInt(previous.ruleBefore) - BigInt(previous.reviewBefore) : 1n;
    const acceptBefore = latest + acceptanceWindow < BigInt(epochConfig.admissionCutoff) ? latest + acceptanceWindow : BigInt(epochConfig.admissionCutoff) - 1n;
    if (acceptBefore <= latest) throw new Error("There is no safe block window left before the admission cutoff");
    const deliverBefore = acceptBefore + oldDeliveryWindow, reviewBefore = deliverBefore + oldReviewWindow, ruleBefore = reviewBefore + oldRuleWindow;
    const nextFields: Record<string, unknown> = { scope: commercial.scope, acceptanceCriteria: commercial.acceptanceCriteria, revisionTerms: commercial.revisionTerms, deliveryRequirements: commercial.deliveryRequirements, deliveryCommitmentFormat: commercial.deliveryCommitmentFormat, epochId: terms.epochId, worker: terms.worker, claimOwner: terms.claimOwner, destination: terms.destination, work: ethers.formatEther(previous.work), fee: ethers.formatEther(previous.fee), timeoutWork: ethers.formatEther(previous.timeoutWork), feeOwner: terms.feeOwner, feeDestination: terms.feeDestination, committee0: terms.committee[0], committee1: terms.committee[1], committee2: terms.committee[2], nonce, acceptBefore, deliverBefore, reviewBefore, ruleBefore };
    assertFresh();
    clearParticipantReadState(); changeDraft(null); localStorage.removeItem(DRAFT_KEY); participantReview = null; participantPacket = null;
    for (const [name, value] of Object.entries(nextFields)) setField(form, name, value);
    const ack = form.elements.namedItem("destinationAck") as HTMLInputElement | null; if (ack) ack.checked = false;
    $("#offer-review").hidden = true;
    showResult("followup-result", `Fresh template loaded from finalized order ${packet.orderId}.\nUnused nonce ${nonce} selected at source finalized block ${finalized.blockTag}.\nNew editable block deadlines: accept ${acceptBefore}, deliver ${deliverBefore}, review ${reviewBefore}, rule ${ruleBefore}.\nReview every term before creating the offer. The old signature was not copied.`, "success");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  } finally { provider.destroy?.(); }
}
async function signQuote() {
  requireVerifiedWorkspace();
  if (signingPending) throw new Error("A worker signature request is already pending");
  if (!isConsentPackage(currentDraft)) throw new Error("Legacy drafts remain inspectable and exportable. Create and review a new consent-bound packet before signing.");
  const revision = draftRevision, workspaceId = workspaceFingerprint(), snapshot = consentSdk().parseWorkAuthorizationPackage(structuredClone(currentDraft));
  if (snapshot.workerSignature) throw new Error("This work authorization is already signed");
  if (!workerAcknowledged(snapshot)) throw new Error("The named worker must acknowledge the exact payment owner and destination for this exact offer before signing");
  signingPending = true; syncWriteControls();
  const source = sourceConfig(), target = targetConfig(), sourceProvider = new ethers.JsonRpcProvider(source.rpcUrl), targetProvider = new ethers.JsonRpcProvider(target.rpcUrl);
  try {
    const assertFresh = () => assertDraftSnapshot(revision, workspaceId);
    const review = participantReview?.packet?.orderId?.toLowerCase() === snapshot.orderId.toLowerCase() ? participantReview : await sharedSdk().reviewUnsignedParticipantOffer(snapshot, { trusted: participantDomain(), source: sourceProvider, target: targetProvider, assertFresh });
    const signed = await sharedSdk().signReviewedParticipantOffer(review, { trusted: participantDomain(), source: sourceProvider, target: targetProvider, assertFresh, requestSignature: async (request: any) => {
      if (!connected) await connectWallet(); assertFresh();
      const session = connected!, walletGeneration = walletSessionGeneration, signer = await session.provider.getSigner(), network = await session.provider.getNetwork(), account = ethers.getAddress(await signer.getAddress()); assertFresh();
      if (walletSessionGeneration !== walletGeneration || connected !== session) throw new Error("Wallet changed before signing; no signature was accepted");
      if (account.toLowerCase() !== request.expectedWorker.toLowerCase()) throw new Error("The connected wallet is not the worker named in this offer");
      if (network.chainId !== BigInt(source.chainId)) throw new Error(`Switch the wallet to source chain ${source.chainId}`);
      const signature = await signer.signTypedData(request.domain, request.types, request.value); assertFresh();
      const [accountAfter, networkAfter] = await Promise.all([signer.getAddress(), session.provider.getNetwork()]); assertFresh();
      if (walletSessionGeneration !== walletGeneration || connected !== session || ethers.getAddress(accountAfter).toLowerCase() !== account.toLowerCase() || networkAfter.chainId !== network.chainId) throw new Error("Wallet account or chain changed during signing; the returned signature was discarded");
      return { signature, account, chainId: network.chainId };
    } });
    assertFresh(); clearParticipantReadState(); changeDraft(signed); participantPacket = signed; participantReview = null; populateMilestones(signed, selectedMilestoneId()); saveJson(DRAFT_KEY, currentDraft); saveParticipantPacket(signed); renderOfferReview(signed); renderOfferReview(signed, "my-work");
    showResult("draft-result", `Consent-bound worker quote signed.\nOrder ${signed.orderId}\nTerms ${signed.termsHash}\nCommitted target block ${signed.authorization.targetFunding.blockNumber} · ${signed.authorization.targetFunding.blockHash}\nThe Safe must still recheck current eligibility and accept it on Ethereum.`, "success");
    showResult("my-work-result", `Signed offer saved for this worker. Return the saved file to the buyer for Safe acceptance. No transaction was sent.`, "success");
    $<HTMLElement>("#prepare-quote").hidden = false; toast("Worker authorization signed and ready for buyer handoff.");
  } finally { signingPending = false; sourceProvider.destroy?.(); targetProvider.destroy?.(); syncWriteControls(); }
}

async function importParticipantAuthorization(raw: string, destination: "orders" | "my-work" = "orders") {
  requireVerifiedWorkspace();
  const generation = ++participantGeneration, revision = draftRevision, workspaceId = workspaceFingerprint(), parsed = assertAuthorizationDomain(consentSdk().parseWorkAuthorizationPackage(raw));
  const assertFresh = () => { if (participantGeneration !== generation) throw new Error("Another work file replaced this review; the stale result was discarded"); assertDraftSnapshot(revision, workspaceId); };
  const source = sourceConfig(), target = targetConfig();
  const sourceProvider = new ethers.JsonRpcProvider(source.rpcUrl), targetProvider = new ethers.JsonRpcProvider(target.rpcUrl);
  try {
    let signedReview: any = null;
    if (parsed.workerSignature) {
      signedReview = await sharedSdk().reviewSignedParticipantWork(parsed, { trusted: participantDomain(), source: sourceProvider, target: targetProvider, milestoneId: 0, assertFresh }); assertFresh();
      participantReview = null;
    } else participantReview = await sharedSdk().reviewUnsignedParticipantOffer(parsed, { trusted: participantDomain(), source: sourceProvider, target: targetProvider, assertFresh });
    assertFresh(); clearParticipantReadState(); changeDraft(parsed); participantPacket = parsed; populateMilestones(parsed, 0); saveJson(DRAFT_KEY, currentDraft); saveParticipantPacket(parsed); renderOfferReview(parsed); renderOfferReview(parsed, "my-work"); if (signedReview) { participantWorkRead = signedReview.work; renderParticipantWorkRead(signedReview.work); }
    const message = parsed.workerSignature ? `Signed authorization imported and independently rechecked.\nOrder ${parsed.orderId}\nWorker ${parsed.orderTerms.worker}\n${signedReview.verification.acceptanceReady ? "Current buyer acceptance checks pass." : signedReview.work.orderExists ? "Accepted source work is available for continuing actions." : `Buyer acceptance is blocked: ${signedReview.verification.acceptanceBlockingReason}`}\nNo wallet was requested.` : `Unsigned offer independently rechecked.\nOrder ${parsed.orderId}\nWorker ${parsed.orderTerms.worker}\nFull terms are visible. Review the payment acknowledgement before signing.`;
    showResult(destination === "orders" ? "draft-result" : "my-work-result", message, "success");
    $("#my-work-destination-ack-wrap").hidden = Boolean(parsed.workerSignature); setDisabled("my-work-sign", Boolean(parsed.workerSignature)); setDisabled("my-work-refresh", !parsed.workerSignature); setDisabled("my-work-save", false);
    $<HTMLElement>("#prepare-quote").hidden = !parsed.workerSignature; syncWriteControls();
  } finally { sourceProvider.destroy?.(); targetProvider.destroy?.(); }
}
async function importSignedAuthorization(raw: string) { return importParticipantAuthorization(raw, "orders"); }

async function prepareSignedQuote() {
  requireVerifiedWorkspace();
  invalidatePreparedSource("signed quote preparation started");
  if (!isConsentPackage(currentDraft) || !currentDraft.workerSignature) throw new Error("Import or sign a consent-bound worker authorization first");
  const snapshot = consentSdk().parseWorkAuthorizationPackage(structuredClone(currentDraft)), revision = draftRevision, workspaceId = workspaceFingerprint();
  const sourceProvider = new ethers.JsonRpcProvider(sourceConfig().rpcUrl), targetProvider = new ethers.JsonRpcProvider(targetConfig().rpcUrl);
  try { await consentSdk().verifyWorkerQuoteSignatureCurrent(snapshot, sourceProvider); await consentSdk().verifyCurrentWorkAuthorization(snapshot, { source: sourceProvider, target: targetProvider }); assertDraftSnapshot(revision, workspaceId); } finally { sourceProvider.destroy?.(); targetProvider.destroy?.(); }
  const fn = writableFunctions("SourceCoordinator").find((item: any) => item.name === "acceptQuote");
  if (!fn) throw new Error("Compiled coordinator has no acceptQuote function");
  $<HTMLSelectElement>("#source-function").value = fn.format("sighash");
  $<HTMLInputElement>("#source-args").value = JSON.stringify([snapshot.orderTerms, snapshot.workerSignature]);
  const tx = prepare("SourceCoordinator", sourceConfig().coordinator, sourceConfig().chainId, fn.format("sighash"), $<HTMLInputElement>("#source-args").value);
  preparedSource = { ...tx, workspaceFingerprint: workspaceId, inputFingerprint: fingerprint([fn.format("sighash"), $<HTMLInputElement>("#source-args").value]) };
  $<HTMLElement>("#source-prepared").hidden = false; $("#source-calldata").textContent = preparedSource.data; $<HTMLButtonElement>("#download-safe").disabled = false; $<HTMLButtonElement>("#execute-source").disabled = false;
  navigate("orders"); toast("Exact Safe acceptance prepared after fresh finalized checks. No wallet was requested.");
}

function prepareClaimRecognition() {
  requireVerifiedWorkspace();
  if (!currentClaimPackage) throw new Error("Inspect a claim package first");
  const claim = currentClaimPackage;
  let name: string, args: any[];
  if (claim.route === "checkpoint") {
    if (claim.checkpoint.material) {
      name = "authenticateAndRecognizeCheckpoint";
      if (claim.checkpoint.receiptLocalLogOrdinal === undefined) throw new Error("Fresh checkpoint proof needs its receipt-local checkpoint log ordinal");
      args = [claim.checkpoint.material, claim.checkpoint.receiptLocalLogOrdinal, claim.allocation, claim.siblings];
    } else {
      name = "recognizeFromCheckpoint";
      args = [claim.checkpoint.checkpointId, claim.allocation, claim.siblings];
    }
  } else if (claim.material) {
    name = "authenticateAndRecognizeReceipt";
    args = [claim.material, claim.receiptLocalLogOrdinal];
  } else {
    if (!claim.authentication) throw new Error("Cached receipt route needs its authenticated source position");
    name = "recognizeFromReceipt";
    args = [[claim.authentication.blockHeight, claim.authentication.transactionIndex], claim.encodedTransaction, claim.receiptLocalLogOrdinal];
  }
  const fn = writableFunctions("WorkTreasury").find((item: any) => item.name === name);
  if (!fn) throw new Error(`Compiled treasury has no ${name} function`);
  $<HTMLSelectElement>("#evidence-function").value = fn.format("sighash");
  $<HTMLInputElement>("#evidence-args").value = JSON.stringify(args);
  toast(`${name} loaded from the validated package.`);
}

function prepare(contractName: string, address: string, chainId: any, signature: string, rawArgs: string, value = "0") { const iface = new ethers.Interface(artifact(contractName).abi); let args; try { args = JSON.parse(rawArgs); } catch { throw new Error("Arguments must be a JSON array"); } if (!Array.isArray(args)) throw new Error("Arguments must be a JSON array"); return { chainId: String(chainId), to: requireAddress(address, contractName), value: String(value), data: iface.encodeFunctionData(signature, args), function: signature, args, builtFrom: `${contractName} compiled ABI`, createdAt: new Date().toISOString() }; }
async function sendPrepared(tx: any, sourceSafe = false, requiredAccount?: string) { requireVerifiedWorkspace(); const transaction = structuredClone(tx), workspaceId = workspaceFingerprint(), revision = writeRevision, safe = String(workspace.source?.safe ?? ""), required = requiredAccount ? String(requiredAccount) : undefined; if (!connected) await connectWallet(); if (writeRevision !== revision || workspaceFingerprint() !== workspaceId) throw new Error("Workspace or prepared action changed while connecting; nothing was sent"); const session = connected!, walletGeneration = walletSessionGeneration, signer = await session.provider.getSigner(); if (writeRevision !== revision || walletSessionGeneration !== walletGeneration || connected !== session) throw new Error("Wallet or prepared action changed while resolving the signer; nothing was sent"); const [network, signerAddress] = await Promise.all([session.provider.getNetwork(), signer.getAddress()]); if (writeRevision !== revision || walletSessionGeneration !== walletGeneration || connected !== session || workspaceFingerprint() !== workspaceId) throw new Error("Wallet, workspace or prepared action changed before send; nothing was sent"); const account = ethers.getAddress(signerAddress); if (network.chainId !== BigInt(transaction.chainId)) throw new Error(`Switch the wallet to chain ${transaction.chainId}`); if (sourceSafe && account.toLowerCase() !== safe.toLowerCase()) throw new Error("Direct Safe execution requires an injected Safe-compatible wallet whose active account is the configured Safe. This app does not bundle the Safe Apps SDK; download the Safe Transaction Builder JSON by default."); if (required && account.toLowerCase() !== required.toLowerCase()) throw new Error(`This action requires ${short(required)}; the connected wallet is ${short(account)}`); if (writeRevision !== revision || walletSessionGeneration !== walletGeneration) throw new Error("Prepared action changed before send; nothing was sent"); const sent = await signer.sendTransaction({ to: transaction.to, value: BigInt(transaction.value), data: transaction.data }); toast(`Submitted ${short(sent.hash)}. Waiting for confirmation…`); await sent.wait(); toast(`Confirmed ${short(sent.hash)}`); return sent.hash; }

function readSettlementClaims() {
  const raw = $<HTMLTextAreaElement>("#settlement-packages").value.trim();
  if (!raw) throw new Error("Import at least one payment claim");
  let values: any; try { values = JSON.parse(raw); } catch { throw new Error("Imported payment claims are not valid JSON"); }
  const claims = (Array.isArray(values) ? values : [values]).map((value, index) => { try { return sharedSdk().parseClaimPackage(value); } catch (error) { throw new Error(`Payment claim ${index + 1}: ${(error as Error).message}`); } });
  if (claims.length === 0 || claims.length > 32) throw new Error("A settlement plan requires 1–32 payment claims");
  return claims;
}
async function finalizedSettlementPin(provider: any, chainId: any, deploymentBlock: any, label: string) {
  const [block, rawChainId] = await Promise.all([provider.getBlock("finalized"), provider.send("eth_chainId", [])]);
  if (!block?.hash || !Number.isSafeInteger(block.number)) throw new Error(`${label} RPC did not return a finalized block with its hash`);
  if (BigInt(block.number) < BigInt(deploymentBlock)) throw new Error(`${label} finalized block predates the pinned deployment`);
  if (BigInt(rawChainId) !== BigInt(chainId)) throw new Error(`${label} raw RPC chain ID differs from the trusted deployment`);
  if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error(`${label} RPC chain changed`);
  return { chainId: String(chainId), blockNumber: String(block.number), blockHash: block.hash };
}
function renderSettlementPlan(plan: any) {
  const rows = plan.actions.map((action: any) => `<div class="lifecycle-row"><b>${escapeHtml(action.kind === "recognize" ? "Recognize" : "Withdraw")}</b><span>${escapeHtml(action.id)}<small>Exact zero-value call to ${escapeHtml(action.transaction.to)} · fixed allocation ${escapeHtml(action.allocationId)} · committed destination ${escapeHtml(action.expectedAllocation.destination)}</small></span><span class="amount">${escapeHtml(formatNative(action.expectedAllocation.amount))}</span></div>`);
  for (const issue of plan.issues) rows.push(`<div class="lifecycle-row"><b>Owner action needed</b><span>${escapeHtml(issue.detail)}<small>The replacement operator will not choose or sign a redirect destination.</small></span><span class="amount">Allocation ${escapeHtml(issue.allocationId)}</span></div>`);
  $("#settlement-actions").innerHTML = rows.join("");
  showResult("settlement-result", `Fresh plan ${plan.planId}\nFinalized source ${plan.sourceSnapshot.blockNumber} · target ${plan.targetSnapshot.blockNumber}\n${plan.actions.length} exact action(s) · ${plan.alreadyComplete.length} already complete · ${plan.issues.length} owner issue(s)\nExecution digest ${plan.executionDigest}\nNo key or wallet was requested.`, "success");
  renderStoredSettlementJournal(plan.planId);
}
async function buildFreshSettlementPlan() {
  requireVerifiedWorkspace();
  const generation = ++settlementGeneration, workspaceId = workspaceFingerprint(), profile = trustedDeploymentProfile(), claims = readSettlementClaims();
  currentSettlementPlan = null; currentSettlementPlanContext = null; syncWriteControls();
  showResult("settlement-result", "Reading finalized source and target state and simulating exact actions…", "empty");
  const sourceProvider = new ethers.JsonRpcProvider(sourceConfig().rpcUrl), targetProvider = new ethers.JsonRpcProvider(targetConfig().rpcUrl);
  try {
    const [sourceFinalized, targetFinalized] = await Promise.all([
      finalizedSettlementPin(sourceProvider, profile.source.chainId, profile.source.deploymentBlock, "Source"),
      finalizedSettlementPin(targetProvider, profile.target.chainId, profile.target.deploymentBlock, "Target"),
    ]);
    const packet = { version: sharedSdk().SETTLEMENT_PACKET_VERSION, source: { chainId: profile.source.chainId, chainKey: profile.source.chainKey, coordinator: { address: profile.source.coordinator, deployedCodeHash: profile.source.deployedCodeHash }, finalized: sourceFinalized }, target: { chainId: profile.target.chainId, treasury: { address: profile.target.treasury, deployedCodeHash: profile.target.deployedCodeHash }, finalized: targetFinalized }, claims };
    const trusted = { sourceChainId: profile.source.chainId, sourceChainKey: profile.source.chainKey, sourceCoordinator: packet.source.coordinator, targetChainId: profile.target.chainId, targetTreasury: packet.target.treasury };
    const plan = await sharedSdk().buildSettlementPlan(packet, sharedSdk().ethersSettlementReadAdapter(sourceProvider, targetProvider, profile.target.treasury), trusted);
    const [sourceAgain, targetAgain] = await Promise.all([sourceProvider.getBlock(Number(sourceFinalized.blockNumber)), targetProvider.getBlock(Number(targetFinalized.blockNumber))]);
    if (sourceAgain?.hash?.toLowerCase() !== sourceFinalized.blockHash.toLowerCase() || targetAgain?.hash?.toLowerCase() !== targetFinalized.blockHash.toLowerCase()) throw new Error("A finalized block hash changed while the plan was built");
    if (settlementGeneration !== generation || workspaceFingerprint() !== workspaceId) throw new Error("Settlement inputs or workspace changed while planning; the stale result was discarded");
    currentSettlementPlan = structuredClone(plan); currentSettlementPlanContext = { generation, workspaceId, profile: structuredClone(profile), targetRpcUrl: targetConfig().rpcUrl, builtAt: new Date().toISOString() };
    renderSettlementPlan(currentSettlementPlan); syncWriteControls();
  } finally { sourceProvider.destroy?.(); targetProvider.destroy?.(); }
}
function preflightJournalStorage() {
  const key = `${SETTLEMENT_JOURNALS_KEY}.preflight`; const marker = `${Date.now()}:${Math.random()}`;
  localStorage.setItem(key, marker); if (localStorage.getItem(key) !== marker) throw new Error("Browser journal storage is unavailable"); localStorage.removeItem(key);
}
async function executeOrResumeSettlement() {
  if (settlementExecutionBusy) throw new Error("A settlement action is already in progress. Wait for its wallet result before continuing.");
  settlementExecutionBusy = true; syncWriteControls();
  let targetProvider: any = null;
  try {
    requireVerifiedWorkspace(); preflightJournalStorage();
    if (!currentSettlementPlan || !currentSettlementPlanContext) throw new Error("Build a fresh settlement plan first");
    const plan = structuredClone(currentSettlementPlan), context = structuredClone(currentSettlementPlanContext), generation = settlementGeneration, workspaceId = workspaceFingerprint();
    if (context.generation !== generation || context.workspaceId !== workspaceId) throw new Error("Settlement plan is stale; build it again");
    const walletBeforeConnect = walletSessionGeneration, neededConnection = !connected; if (neededConnection) await connectWallet();
    if (walletSessionGeneration !== walletBeforeConnect + (neededConnection ? 1 : 0) || !currentSettlementPlan || settlementGeneration !== generation || workspaceFingerprint() !== workspaceId) throw new Error("Wallet, settlement plan or workspace changed while connecting; nothing was sent");
    const session = connected!, walletGeneration = walletSessionGeneration, signer = await session.provider.getSigner();
    const [network, account] = await Promise.all([session.provider.getNetwork(), signer.getAddress()]);
    if (network.chainId !== BigInt(context.profile.target.chainId)) throw new Error(`Switch the wallet to target chain ${context.profile.target.chainId}`);
    const originalAccount = ethers.getAddress(account);
    const assertBeforeBroadcast = async () => {
      if (settlementGeneration !== generation || walletSessionGeneration !== walletGeneration || connected !== session || workspaceFingerprint() !== workspaceId) throw new Error("Wallet, workspace or plan changed before broadcast; nothing was sent");
      const [liveNetwork, liveAccount] = await Promise.all([session.provider.getNetwork(), signer.getAddress()]);
      if (liveNetwork.chainId !== network.chainId || ethers.getAddress(liveAccount) !== originalAccount || settlementGeneration !== generation || walletSessionGeneration !== walletGeneration || connected !== session || workspaceFingerprint() !== workspaceId) throw new Error("Wallet account, chain, workspace or plan changed before broadcast; nothing was sent");
    };
    targetProvider = new ethers.JsonRpcProvider(context.targetRpcUrl ?? targetConfig().rpcUrl, BigInt(context.profile.target.chainId), { staticNetwork: true });
    if (BigInt(await targetProvider.send("eth_chainId", [])) !== BigInt(context.profile.target.chainId)) throw new Error("Target receipt RPC chain ID differs from the trusted settlement plan");
    const readOnlySigner = new ethers.VoidSigner(originalAccount, targetProvider);
    const base = sharedSdk().ethersSettlementExecutionAdapter(readOnlySigner, context.profile.target.treasury);
    const adapter = { ...base, async send(transaction: any) {
      await assertBeforeBroadcast();
      const request = { from: originalAccount, to: transaction.to, data: transaction.data, value: ethers.toQuantity(BigInt(transaction.value)), chainId: ethers.toQuantity(network.chainId) };
      try {
        const hash = await session.provider.send("eth_sendTransaction", [request]);
        return { hash: requireHex(hash, 32, "Wallet transaction hash") };
      } catch (error) {
        const knownHash = (error as any)?.info?.sendTransactionHash ?? (error as any)?.transactionHash;
        if (typeof knownHash === "string" && ethers.isHexString(knownHash, 32)) return { hash: knownHash };
        throw error;
      }
    } };
    const journals = loadJson(SETTLEMENT_JOURNALS_KEY, {}), stored = journals[plan.planId.toLowerCase()];
    const persist = async (journal: any) => { const latest = loadJson(SETTLEMENT_JOURNALS_KEY, {}); latest[plan.planId.toLowerCase()] = plain(journal); saveJson(SETTLEMENT_JOURNALS_KEY, latest); renderStoredSettlementJournal(plan.planId); };
    const journal = await sharedSdk().executeSettlementPlan({ plan, trustedTreasury: context.profile.target.treasury, trustedCoordinator: context.profile.source.coordinator, journal: stored, adapter, persist, maxActions: 1 });
    if (settlementGeneration !== generation || workspaceFingerprint() !== workspaceId || walletSessionGeneration !== walletGeneration) {
      showResult("settlement-result", `The current view changed after wallet interaction. Any known transaction hash remains stored under original plan ${plan.planId}; build a fresh plan before another action.`, "empty"); return;
    }
    const entries = Object.values(journal.entries ?? {}) as any[], pending = entries.filter(entry => entry.state === "pending").length, complete = entries.filter(entry => entry.state === "complete").length;
    showResult("settlement-result", `Plan ${plan.planId}\n${complete} completed journal action(s) · ${pending} pending or receipt-unknown action(s).\nOne action maximum was considered for this explicit click. Rebuild fresh state before further execution when chain state changed.`, pending ? "empty" : "success");
  } finally { targetProvider?.destroy?.(); settlementExecutionBusy = false; syncWriteControls(); }
}

function collectorDeployment(profile: any) { return { sourceChainId: profile.source.chainId, sourceChainKey: profile.source.chainKey, sourceCoordinator: profile.source.coordinator, sourceRuntimeHash: profile.source.deployedCodeHash, sourceDeploymentBlock: Number(profile.source.deploymentBlock), targetChainId: profile.target.chainId, targetTreasury: profile.target.treasury, targetRuntimeHash: profile.target.deployedCodeHash, targetDeploymentBlock: Number(profile.target.deploymentBlock) }; }
async function collectFreshEpoch(epochId: string, authorizationPackets: any[], assertFresh?: () => void) {
  requireVerifiedWorkspace(); const profile = trustedDeploymentProfile(), sourceProvider = new ethers.JsonRpcProvider(sourceConfig().rpcUrl), targetProvider = new ethers.JsonRpcProvider(targetConfig().rpcUrl);
  try {
    const chainInfo = new ethers.Contract("0x0000000000000000000000000000000000000fd3", ["function get_latest_attestation_height_and_hash(uint64) view returns((uint64 height,bytes32 hash,bool isAttestation,bool exists))"], targetProvider);
    assertFresh?.();
    const collected = await sharedSdk().collectProgramCloseout({ source: sourceProvider, target: targetProvider, sourceAbi: artifact("SourceCoordinator").abi, targetAbi: artifact("WorkTreasury").abi, deployment: collectorDeployment(profile), epochId, authorizationPackets, getNativeFrontier: async (chainKey: bigint, targetBlock: number) => { const row = await chainInfo.get_latest_attestation_height_and_hash.staticCall(chainKey, { blockTag: targetBlock }); return { height: BigInt(row.height), hash: row.hash, exists: Boolean(row.exists) }; } });
    assertFresh?.(); return collected;
  } finally { sourceProvider.destroy?.(); targetProvider.destroy?.(); }
}
async function collectFreshProgram(epochId: string, authorizationPackets: any[], generation: number, workspaceId: string) {
  return collectFreshEpoch(epochId, authorizationPackets, () => { if (closeoutGeneration !== generation || workspaceFingerprint() !== workspaceId || $<HTMLInputElement>("#closeout-epoch").value.trim().toLowerCase() !== epochId.toLowerCase()) throw new Error("Closeout epoch, workspace or inputs changed during collection; the stale result was discarded"); });
}
function renderCloseout(collected: any) {
  const epoch = collected.epoch, result = collected.result, limitations = [...(collected.limitations ?? []), collected.returnAccounting];
  showResult("closeout-result", `${collected.label}\nFinalized source ${collected.closeout.source.snapshot.blockNumber} · target ${collected.closeout.target.snapshot.blockNumber}\nCap ${formatNative(epoch.cap)} · earned ${formatNative(epoch.earned)} · returned ${formatNative(epoch.returned)}\nRecognized ${formatNative(epoch.recognized)} · paid ${formatNative(epoch.paid)} · outstanding ${formatNative(epoch.outstanding)}\nConservation ${epoch.conservation ? "passes" : "fails"} · complete source prefix ${epoch.prefixComplete ? "yes" : "no"}\nConsent-bound orders ${result.consent.boundOrders} · legacy orders ${result.consent.legacyOrders.length}\n${limitations.join("\n")}\n${[...(collected.errors ?? []), ...(result.errors ?? []), ...(result.incomplete ?? [])].join("\n")}`, collected.status === "complete" ? "success" : collected.status === "invalid" ? "error" : "empty");
  $("#closeout-allocations").innerHTML = collected.allocations.map((row: any) => `<div class="lifecycle-row"><b>${escapeHtml(row.status)}</b><span>Allocation ${escapeHtml(row.allocationId)} · ${escapeHtml(row.policyOutcome?.label ?? "unknown policy outcome")}<small>${Number(row.kind) === 3 ? "Return allocation; work-order consent does not apply." : row.legacyConsent ? "Legacy: no independently collected consent-bound authorization." : "Consent-bound authorization evidence collected."} ${escapeHtml(row.nativeAuthentication?.classification ? `Native ${row.nativeAuthentication.classification}.` : "Native authentication unknown.")} ${escapeHtml(row.errors?.join(" ") || "")}</small></span><span class="amount">${escapeHtml(formatNative(row.amount))}</span></div>`).join("");
  $<HTMLButtonElement>("#export-closeout").disabled = false;
  const active = $<HTMLInputElement>("#active-epoch").value.trim();
  if (collected.status !== "invalid" && active && active.toLowerCase() === collected.epoch.epochId.toLowerCase()) setText("program-paid", formatNative(epoch.paid)); else clearProgramPaid();
}
async function collectCloseoutFromUi() {
  requireVerifiedWorkspace();
  clearProgramPaid();
  const epochId = requireHex($<HTMLInputElement>("#closeout-epoch").value.trim(), 32, "Closeout epoch"), generation = ++closeoutGeneration, workspaceId = workspaceFingerprint(), packets = structuredClone(closeoutAuthorizations);
  currentCloseout = null; currentCloseoutResult = null; $<HTMLButtonElement>("#export-closeout").disabled = true; $("#closeout-allocations").innerHTML = "";
  showResult("closeout-result", "Collecting fresh finalized source, native authentication, recognition and withdrawal evidence…", "empty");
  const collected = await collectFreshProgram(epochId, packets, generation, workspaceId);
  currentCloseout = structuredClone(collected); currentCloseoutResult = collected.result; renderCloseout(collected);
}
function paymentHistoryDomain(profile: any) { return { sourceChainId: String(profile.source.chainId), sourceCoordinator: profile.source.coordinator, sourceRuntimeHash: profile.source.deployedCodeHash, targetChainId: String(profile.target.chainId), targetTreasury: profile.target.treasury, targetRuntimeHash: profile.target.deployedCodeHash, sourceChainKey: String(profile.source.chainKey) }; }
function assertPaymentHistoryDomain(locator: any) { const expected = paymentHistoryDomain(trustedDeploymentProfile()), actual = locator.domain; if (actual.sourceChainId !== expected.sourceChainId || actual.targetChainId !== expected.targetChainId || actual.sourceChainKey !== expected.sourceChainKey || actual.sourceCoordinator.toLowerCase() !== expected.sourceCoordinator.toLowerCase() || actual.targetTreasury.toLowerCase() !== expected.targetTreasury.toLowerCase() || actual.sourceRuntimeHash.toLowerCase() !== expected.sourceRuntimeHash.toLowerCase() || actual.targetRuntimeHash.toLowerCase() !== expected.targetRuntimeHash.toLowerCase()) throw new Error("Payment-history locator belongs to a different trusted deployment"); return locator; }
function currentPaymentHistoryFormFingerprint() { return fingerprint({ subject: $<HTMLInputElement>("#paid-work-subject").value.trim().toLowerCase(), role: $<HTMLSelectElement>("#paid-work-role").value, epochs: $<HTMLTextAreaElement>("#paid-work-epochs").value.split(/\r?\n/).map(item => item.trim().toLowerCase()).filter(Boolean) }); }
function readPaymentHistoryLocatorForm() {
  if (paidWorkLocator && paidWorkLocatorFormFingerprint === currentPaymentHistoryFormFingerprint()) return assertPaymentHistoryDomain(sharedSdk().parsePaymentHistoryLocator(paidWorkLocator));
  const profile = trustedDeploymentProfile(), subject = requireAddress($<HTMLInputElement>("#paid-work-subject").value.trim(), "Payment-history subject"), role = $<HTMLSelectElement>("#paid-work-role").value;
  const epochs = $<HTMLTextAreaElement>("#paid-work-epochs").value.split(/\r?\n/).map(item => item.trim()).filter(Boolean).map((item, index) => requireHex(item, 32, `Epoch ${index + 1}`));
  if (!epochs.length) throw new Error("Enter at least one epoch ID"); if (new Set(epochs.map(item => item.toLowerCase())).size !== epochs.length) throw new Error("Remove duplicate epoch IDs");
  return sharedSdk().parsePaymentHistoryLocator({ version: sharedSdk().PAYMENT_HISTORY_LOCATOR_VERSION, subject: { address: subject, role }, domain: paymentHistoryDomain(profile), selections: epochs.map(epochId => ({ epochId })) });
}
function renderPaidWork(record: any) {
  $("#paid-work-fix-rpc").hidden = true;
  const total = (kind: "WORK" | "FEE") => record.totals.filter((item: any) => item.kind === kind).reduce((sum: bigint, item: any) => sum + BigInt(item.amount), 0n);
  const filtered = record.locator.selections.some((item: any) => item.orderIds?.length || item.economicIds?.length);
  setText("paid-work-total-work", formatNative(total("WORK"))); setText("paid-work-total-fee", formatNative(total("FEE"))); setText("paid-work-scope", `${record.records.length} paid claim${record.records.length === 1 ? "" : "s"} · ${filtered ? "filtered selection" : "selected epochs"}`);
  const explorer = trustedDeploymentProfile().target.explorerUrl;
  $("#paid-work-records").innerHTML = record.records.map((item: any) => `<div class="lifecycle-row receipt-row"><b>${escapeHtml(item.kind)}</b><span>Order ${escapeHtml(short(item.orderId, 8))} · allocation ${escapeHtml(item.allocationId)}<small>Worker ${escapeHtml(item.sourceWorker ?? "not established by supplied authorization")} · owner ${escapeHtml(item.claimOwner)} · paid ${escapeHtml(item.paidDestination)} via ${escapeHtml(item.withdrawalRoute)}</small><span class="receipt-links"><button class="text-link" data-check-paid-epoch="${escapeHtml(item.epochId)}" data-check-paid-allocation="${escapeHtml(item.allocationId)}">Check payment</button>${explorer ? explorerLink(explorer, "tx", item.withdrawal.transactionHash, "Withdrawal receipt") : ""}</span></span><span class="amount">${escapeHtml(formatNative(item.amount))}</span></div>`).join("");
  const technical = [...record.unresolvedSelections, ...record.errors], archiveGap = technical.some((item: string) => /historical|archive|missing trie|header not found|eth_getCode|could not coalesce|requested data is not available/i.test(item));
  $("#paid-work-fix-rpc").hidden = !archiveGap;
  const summary = record.status === "verified" ? `Verified ${record.records.length} successful WORK/FEE withdrawal(s) in this selected scope from ${record.snapshots.length} fresh epoch snapshot(s). WORK and FEE are separate; RETURN is excluded.` : record.status === "partial" ? `${record.records.length} payment(s) were verified, but the selected record is incomplete.${archiveGap ? " Historical Ethereum evidence was unavailable. Choose an archive-capable source RPC in Networks and retry." : " Open Technical details to see which selected evidence is still unavailable."}` : `The selected record could not be verified because fresh evidence contradicted the trusted selection. No imported total or verdict was retained.`;
  showResult("paid-work-result", summary, record.status === "verified" ? "success" : record.status === "invalid" ? "error" : "empty");
  const technicalPanel = $<HTMLDetailsElement>("#paid-work-technical"); technicalPanel.hidden = technical.length === 0; $<HTMLElement>("#paid-work-technical-detail").textContent = [...technical, ...record.limitations].join("\n");
  const exportButton = $<HTMLButtonElement>("#export-paid-work"); exportButton.disabled = record.status === "invalid"; exportButton.textContent = record.status === "partial" ? "Save incomplete record" : "Save selected record";
}
function showPaidWorkCollectionError(error: unknown) { const detail = (error as Error).message, archiveGap = /historical|archive|missing trie|header not found|eth_getCode|could not coalesce|requested data is not available/i.test(detail); showResult("paid-work-result", archiveGap ? "The selected record is incomplete because historical Ethereum evidence was unavailable. Choose an archive-capable source RPC in Networks and retry. No imported total or verdict was retained." : "The selected record could not be rebuilt from fresh evidence. Open Technical details, check the pinned Networks setup and retry.", "error"); $("#paid-work-fix-rpc").hidden = !archiveGap; const panel = $<HTMLDetailsElement>("#paid-work-technical"); panel.hidden = false; $<HTMLElement>("#paid-work-technical-detail").textContent = detail; setDisabled("export-paid-work", true); setText("export-paid-work", "Save selected record"); }
async function collectPaidWorkFromUi() {
  requireVerifiedWorkspace(); const locator = readPaymentHistoryLocatorForm(), profile = trustedDeploymentProfile(), generation = ++paidWorkGeneration, workspaceId = workspaceFingerprint();
  paidWorkRecord = null; setDisabled("export-paid-work", true); $("#paid-work-records").innerHTML = ""; showResult("paid-work-result", "Rebuilding selected epochs from fresh finalized source, native, recognition and withdrawal evidence…", "empty");
  const assertFresh = () => { if (paidWorkGeneration !== generation || workspaceFingerprint() !== workspaceId) throw new Error("The payment-history selection or workspace changed; the stale result was discarded"); };
  const record = await sharedSdk().collectSelectedPaymentHistory({ locator, trusted: paymentHistoryDomain(profile), collectEpoch: async (epochId: string) => collectFreshEpoch(epochId, structuredClone(paidWorkAuthorizations.get(epochId.toLowerCase()) ?? []), assertFresh) });
  assertFresh(); paidWorkLocator = locator; paidWorkLocatorFormFingerprint = currentPaymentHistoryFormFingerprint(); paidWorkRecord = record; renderPaidWork(record);
}
function explorerLink(base: string, kind: "tx" | "address", value: string, label: string) { return `<a href="${escapeHtml(`${base}/${kind}/${value}`)}" target="_blank" rel="noreferrer">${escapeHtml(label)} ↗</a>`; }
function renderLifecycle(collected: any, allocationId: string, profile: any) {
  const row = collected.allocations.find((item: any) => BigInt(item.allocationId) === BigInt(allocationId));
  if (!row) throw new Error(`Allocation ${allocationId} is outside the collected source prefix`);
  const safeDetail = row.source?.executionKind === "safe-call" ? row.source?.safeRuntime ? ` · Safe ${row.source.safeRuntime.version} runtime checked at source block ${row.source.safeRuntime.blockNumber}` : " · Safe runtime proof missing" : "";
  const overallErrors = [...(collected.errors ?? []), ...(collected.result?.errors ?? []), ...(collected.result?.incomplete ?? [])];
  const rowErrors = [...row.source.errors, ...row.nativeAuthentication.errors, ...row.recognition.errors, ...row.withdrawal.errors, ...row.errors];
  const consentLine = Number(row.kind) === 3 ? "Return allocation; work-order consent does not apply." : row.legacyConsent ? "Legacy order: no independently collected consent-bound authorization." : "Consent-bound authorization evidence collected.";
  const lines = [`Program collection: ${collected.status} · accounting ${collected.accountingStatus}`, `${row.status} · ${formatNative(row.amount)}`, `Policy outcome: ${row.policyOutcome?.label ?? "unknown"}${row.policyOutcome?.approval === true ? " · approval" : ""}`, `Source: ${row.source?.executionKind ?? "unknown"}${row.source?.function ? ` · ${row.source.function}` : ""}${safeDetail}`, `Native authentication: ${row.nativeAuthentication?.classification ?? "unknown"}${row.nativeAuthentication?.blockHeight ? ` · source block ${row.nativeAuthentication.blockHeight}` : ""}`, `Recognition: ${row.recognition?.successful ? `${formatNative(row.recognition.amount)} · economic ID ${row.recognition.economicId}` : "not proven"}`, `Withdrawal: ${row.withdrawal?.successful ? `successful · ${row.withdrawal.destination}` : Number(row.kind) === 3 ? "RETURN becomes owner-level fungible free balance; no epoch-specific withdrawal is claimed" : "not proven"}`, consentLine, ...rowErrors, ...overallErrors];
  showResult("lifecycle-result", lines.filter(Boolean).join("\n"), collected.status === "complete" && (row.status === "paid" || row.status === "returned-credit") && rowErrors.length === 0 && overallErrors.length === 0 ? "success" : collected.status === "invalid" || row.status === "error" || rowErrors.length || overallErrors.length ? "error" : "empty");
  const links = [];
  if (row.source?.transactionHash) links.push(explorerLink(profile.source.explorerUrl, "tx", row.source.transactionHash, "Source outcome transaction"));
  if (row.nativeAuthentication?.transactionHash) links.push(explorerLink(profile.target.explorerUrl, "tx", row.nativeAuthentication.transactionHash, "Native authentication transaction"));
  if (row.recognition?.transactionHash) links.push(explorerLink(profile.target.explorerUrl, "tx", row.recognition.transactionHash, "Recognition transaction"));
  if (row.withdrawal?.transactionHash) links.push(explorerLink(profile.target.explorerUrl, "tx", row.withdrawal.transactionHash, "Withdrawal transaction"));
  $("#lifecycle-links").innerHTML = links.join("");
}
async function inspectLifecycle() {
  requireVerifiedWorkspace();
  const rawAllocationId = $<HTMLInputElement>("#lifecycle-allocation").value.trim(); if (!/^[1-9][0-9]*$/.test(rawAllocationId)) throw new Error("Allocation ID must be a positive integer");
  const epochId = requireHex($<HTMLInputElement>("#lifecycle-epoch").value.trim(), 32, "Lifecycle epoch"), allocationId = String(BigInt(rawAllocationId));
  invalidateCloseout("lifecycle inspection started"); $<HTMLInputElement>("#closeout-epoch").value = epochId; const generation = closeoutGeneration, workspaceId = workspaceFingerprint();
  showResult("lifecycle-result", "Collecting the complete epoch prefix so this allocation is checked against conservation and target accounting…", "empty"); $("#lifecycle-links").innerHTML = "";
  const collected = await collectFreshProgram(epochId, structuredClone(closeoutAuthorizations), generation, workspaceId);
  currentCloseout = structuredClone(collected); currentCloseoutResult = collected.result; renderCloseout(collected); renderLifecycle(collected, allocationId, trustedDeploymentProfile());
}

function targetRequiredAccount(signature: string) {
  const name = signature.slice(0, signature.indexOf("("));
  if (name === "ownerWithdrawTo") return lastPaymentLookup?.claim?.allocation?.claimOwner;
  if (name === "ownerWithdrawFreeTo") return lastPaymentLookup?.owner;
  if (name === "fundEpoch" || name === "fundEpochFromFree") return workspace.epochConfig?.config?.sponsor;
  return undefined;
}

async function inspectTree() {
  const c = sourceConfig(), epoch = activeEpoch(); showResult("tree-result", "Reading one stable source block…", "empty");
  const provider = new ethers.JsonRpcProvider(c.rpcUrl);
  try {
    const stable = await stableBlock(provider, Number(c.confirmations ?? 12)), block = stable.blockTag;
    const contract = new ethers.Contract(c.coordinator, artifact("SourceCoordinator").abi, provider);
    const state = await contract.epochState.staticCall(epoch, { blockTag: block }), count = Number(state.leafCount);
    if (count < 0 || count > 128) throw new Error("Source returned an impossible leaf count");
    const allocations: any[] = [], storedLeaves: string[] = [];
    for (let i = 0; i < count; i++) {
      const item = await contract.allocationAt.staticCall(epoch, i, { blockTag: block }), normalized = normalizeAllocation(item);
      if (normalized.treeIndex !== i) throw new Error(`Allocation ${i} declares index ${normalized.treeIndex}`);
      allocations.push(normalized); storedLeaves.push(await contract.leafHashAt.staticCall(epoch, i, { blockTag: block }));
    }
    const leaves = allocations.map(hashAllocation), rebuilt = buildRoot(leaves);
    const leafMatch = leaves.every((leaf, i) => leaf.toLowerCase() === storedLeaves[i].toLowerCase()), rootMatch = rebuilt.toLowerCase() === state.root.toLowerCase();
    showResult("tree-result", `${stable.label}\nLeaves ${count} / 128\nRebuilt root ${rebuilt}\nStored root  ${state.root}\n${rootMatch ? "✓ Roots match" : "✕ ROOT MISMATCH"}\n${leafMatch ? "✓ Every public allocation hashes to its stored leaf" : "✕ STORED LEAF MISMATCH"}`, rootMatch && leafMatch ? "success" : "error");
  } finally { provider.destroy?.(); }
}

async function readAllocationPrefix(count: number) {
  const c = sourceConfig(), epoch = activeEpoch(), provider = new ethers.JsonRpcProvider(c.rpcUrl), stable = await stableBlock(provider, Number(c.confirmations ?? 12));
  const contract = new ethers.Contract(c.coordinator, artifact("SourceCoordinator").abi, provider);
  const sourceState = await contract.epochState.staticCall(epoch, { blockTag: stable.blockTag });
  if (Number(sourceState.leafCount) < count) throw new Error("Stable source history does not contain the requested checkpoint prefix");
  const allocations = [];
  for (let index = 0; index < count; index++) allocations.push(normalizeAllocation(await contract.allocationAt.staticCall(epoch, index, { blockTag: stable.blockTag })));
  return { allocations, leaves: allocations.map(hashAllocation), stable };
}

async function exportCachedCheckpointPackage() {
  const index = Number($<HTMLInputElement>("#export-tree-index").value), target = targetConfig(), epoch = activeEpoch();
  if (!Number.isInteger(index) || index < 0) throw new Error("Allocation tree index must be a nonnegative integer");
  const provider = new ethers.JsonRpcProvider(target.rpcUrl), stable = await stableBlock(provider, Number(target.confirmations ?? 12));
  const treasury = new ethers.Contract(target.treasury, artifact("WorkTreasury").abi, provider);
  const checkpointId = await treasury.latestCheckpointId.staticCall(epoch, { blockTag: stable.blockTag });
  if (checkpointId === ZERO32) throw new Error("Target has no authenticated checkpoint for this epoch");
  const record = await treasury.checkpoint.staticCall(checkpointId, { blockTag: stable.blockTag });
  if (!record.exists) throw new Error("Target checkpoint cache entry is missing");
  const count = Number(record.checkpoint.leafCount); if (index >= count) throw new Error("Allocation is newer than the target's latest authenticated checkpoint");
  const prefix = await readAllocationPrefix(count); const root = buildRoot(prefix.leaves);
  if (root.toLowerCase() !== record.checkpoint.root.toLowerCase()) throw new Error("Independent source prefix does not match the target-authenticated checkpoint");
  const claimPackage = { version: "proofkey.work-treasury.claim-package.v1", route: "checkpoint", createdAt: new Date().toISOString(), allocation: serializeAllocation(prefix.allocations[index]), siblings: orderedProof(prefix.leaves, index), checkpoint: { checkpointId, root, leafCount: count } };
  currentClaimPackage = parseClaimPackage(claimPackage); $<HTMLTextAreaElement>("#claim-package").value = JSON.stringify(currentClaimPackage, null, 2); $<HTMLButtonElement>("#prepare-claim").disabled = false; download(`proofkey-checkpoint-claim-${index + 1}.json`, currentClaimPackage); toast("Exported a claim package against the target's authenticated checkpoint cache.");
}

async function exportReceiptClaimPackage() {
  if (!currentProof) throw new Error("Fetch and validate the allocation transaction proof first");
  const index = Number($<HTMLInputElement>("#export-tree-index").value), ordinal = Number($<HTMLInputElement>("#export-receipt-ordinal").value);
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(ordinal) || ordinal < 0) throw new Error("Allocation index and receipt-local ordinal must be nonnegative integers");
  const source = sourceConfig(), provider = new ethers.JsonRpcProvider(source.rpcUrl), receipt = await provider.getTransactionReceipt(currentProof.transactionHash);
  if (!receipt || receipt.status !== 1) throw new Error("Source RPC cannot confirm a successful receipt for this proof transaction");
  if (BigInt(receipt.blockNumber) !== BigInt(currentProof.blockHeight)) throw new Error("Source receipt block does not match the proof-service block");
  const log = receipt.logs[ordinal]; if (!log) throw new Error("Receipt-local log ordinal is outside the source receipt");
  if (log.address.toLowerCase() !== source.coordinator.toLowerCase()) throw new Error("Selected receipt log was not emitted by the pinned SourceCoordinator");
  const decoded = new ethers.Interface(artifact("SourceCoordinator").abi).parseLog(log);
  if (!decoded || decoded.name !== "AllocationCreated") throw new Error("Selected receipt log is not AllocationCreated");
  const allocation = normalizeAllocation(decoded.args);
  if (allocation.treeIndex !== index) throw new Error(`Selected log commits tree index ${allocation.treeIndex}, not ${index}`);
  const material = { blockHeight: currentProof.blockHeight, encodedTransaction: currentProof.encodedTransaction, merkleProof: currentProof.merkleProof, continuityProof: currentProof.continuityProof };
  const claimPackage = { version: "proofkey.work-treasury.claim-package.v1", route: "receipt", createdAt: new Date().toISOString(), allocation: serializeAllocation(allocation), receiptLocalLogOrdinal: ordinal, encodedTransaction: currentProof.encodedTransaction, material };
  currentClaimPackage = parseClaimPackage(claimPackage); $<HTMLTextAreaElement>("#claim-package").value = JSON.stringify(currentClaimPackage, null, 2); $<HTMLButtonElement>("#prepare-claim").disabled = false; download(`proofkey-receipt-claim-${index + 1}.json`, currentClaimPackage); toast("Exported a receipt-route claim package with exact native proof material.");
}

async function fetchProof() { const base = $<HTMLInputElement>("#proof-url").value.trim().replace(/\/+$/, ""), chainKey = BigInt($<HTMLInputElement>("#proof-chain-key").value), txHash = requireHex($<HTMLInputElement>("#proof-tx").value.trim(), 32, "Transaction hash"); if (!base) throw new Error("Enter a proof service URL"); const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 30000); showResult("proof-result", "Waiting for the proof service…", "empty"); try { const response = await fetch(`${base}/api/v1/proof-by-tx/${chainKey}/${txHash}`, { signal: controller.signal }); if (!response.ok) throw new Error(`Proof service returned HTTP ${response.status}`); const value = await response.json(); if (BigInt(value.chainKey) !== chainKey || String(value.txHash).toLowerCase() !== txHash.toLowerCase()) throw new Error("Proof response does not match the requested chain key and transaction"); requireHex(value.txBytes, undefined as any, "Encoded transaction"); requireHex(value.merkleProof?.root, 32, "Merkle root"); if (!Array.isArray(value.merkleProof?.siblings) || !Array.isArray(value.continuityProof?.roots) || value.continuityProof.roots.length === 0) throw new Error("Proof response is missing Merkle or continuity material"); value.merkleProof.siblings.forEach((item: any, i: number) => { requireHex(item.hash, 32, `Merkle sibling ${i}`); if (typeof item.isLeft !== "boolean") throw new Error(`Merkle sibling ${i} has no side`); }); value.continuityProof.roots.forEach((item: any, i: number) => requireHex(item, 32, `Continuity root ${i}`)); currentProof = { fetchedAt: new Date().toISOString(), prover: base, chainKey: chainKey.toString(), transactionHash: txHash, blockHeight: String(value.headerNumber), proverTransactionIndex: value.txIndex ?? null, encodedTransaction: value.txBytes, merkleProof: value.merkleProof, continuityProof: value.continuityProof }; $<HTMLButtonElement>("#export-proof").disabled = false; showResult("proof-result", `Response matches the request.\nBlock ${currentProof.blockHeight}\nEncoded transaction ${ethers.getBytes(value.txBytes).length} bytes\n${value.merkleProof.siblings.length} transaction siblings · ${value.continuityProof.roots.length} continuity roots\n\nThe prover's transaction index is metadata. The Creditcoin verifier derives the authoritative position.`, "success"); } finally { clearTimeout(timeout); } }

async function lookupPayment() { const c = targetConfig(), epoch = requireHex($<HTMLInputElement>("#payment-epoch").value.trim(), 32, "Epoch ID"), allocationId = BigInt($<HTMLInputElement>("#payment-allocation").value), ownerText = $<HTMLInputElement>("#payment-owner").value.trim(); const provider = new ethers.JsonRpcProvider(c.rpcUrl), treasury = new ethers.Contract(c.treasury, artifact("WorkTreasury").abi, provider); const [claim, completed, free] = await Promise.all([treasury.claim(epoch, allocationId), treasury.completedClaim(epoch, allocationId), ownerText ? treasury.freeBalance(requireAddress(ownerText, "Free-balance owner")) : Promise.resolve(null)]); const result: any = { claim: plain(claim), completedWithdrawal: plain(completed) }; if (free !== null) result.freeBalance = String(free); if (c.invoiceBook) { const book = new ethers.Contract(c.invoiceBook, artifact("PaidInvoiceBook").abi, provider); result.paidInvoiceBook = plain(await book.invoice(epoch, allocationId)); } lastPaymentLookup = { epoch, allocationId: allocationId.toString(), owner: ownerText, claim: result.claim, freeBalance: free === null ? null : String(free) }; const claimAvailable = !result.claim?.withdrawn && BigInt(result.claim?.allocation?.amount ?? 0) > 0n, freeAvailable = Boolean(ownerText) && BigInt(free ?? 0) > 0n; $<HTMLButtonElement>("#prepare-fixed-payment").disabled = !claimAvailable; $<HTMLButtonElement>("#prepare-claim-redirect").disabled = !claimAvailable; $<HTMLButtonElement>("#prepare-free-withdrawal").disabled = !freeAvailable; $<HTMLButtonElement>("#prepare-free-redirect").disabled = !freeAvailable; const lines = [`Claim ${allocationId}`, `Amount ${formatNative(result.claim?.allocation?.amount ?? 0)}`, `Claim owner ${result.claim?.allocation?.claimOwner ?? "Not recognized"}`, `Fixed destination ${result.claim?.allocation?.destination ?? "Not recognized"}`, `Withdrawn ${result.claim?.withdrawn ? `Yes · paid to ${result.claim.paidDestination}` : "No"}`]; if (free !== null) lines.push(`Free owner balance ${formatNative(free)}`); if (result.paidInvoiceBook) lines.push(`Invoice ${result.paidInvoiceBook.recorded ? `recorded · ${formatNative(result.paidInvoiceBook.amount)}` : "not recorded"}`); showResult("payment-result", lines.join("\n"), "success"); provider.destroy?.(); }

function preparePayment(kind: "fixed" | "claim-redirect" | "free" | "free-redirect") {
  requireVerifiedWorkspace();
  if (!lastPaymentLookup) throw new Error("Read payment state first");
  const destination = kind.includes("redirect") ? requireAddress($<HTMLInputElement>("#payment-destination").value.trim(), "Alternate destination") : null;
  const name = kind === "fixed" ? "withdrawFor" : kind === "claim-redirect" ? "ownerWithdrawTo" : kind === "free" ? "withdrawFreeFor" : "ownerWithdrawFreeTo";
  const args = kind === "fixed" ? [lastPaymentLookup.epoch, lastPaymentLookup.allocationId] : kind === "claim-redirect" ? [lastPaymentLookup.epoch, lastPaymentLookup.allocationId, destination] : kind === "free" ? [lastPaymentLookup.owner, lastPaymentLookup.freeBalance] : [lastPaymentLookup.freeBalance, destination];
  const fn = writableFunctions("WorkTreasury").find((item: any) => item.name === name);
  if (!fn) throw new Error(`Compiled treasury has no ${name} function`);
  $<HTMLSelectElement>("#target-function").value = fn.format("sighash");
  $<HTMLInputElement>("#target-args").value = JSON.stringify(args);
  updateActionHelp("target");
  toast(`${name} loaded. Review the fixed amount and destination before sending.`);
}

async function readCurrentOrder() {
  invalidatePreparedSource("order read changed");
  const c = sourceConfig(), orderId = requireHex($<HTMLInputElement>("#current-order").value.trim(), 32, "Order ID"), milestoneId = Number($<HTMLInputElement>("#current-milestone").value);
  if (!Number.isInteger(milestoneId) || milestoneId < 0) throw new Error("Milestone ID must be a nonnegative integer");
  const provider = new ethers.JsonRpcProvider(c.rpcUrl), stable = await stableBlock(provider, Number(c.confirmations ?? 12));
  const contract = new ethers.Contract(c.coordinator, artifact("SourceCoordinator").abi, provider);
  const [order, milestone, agreed, delivered, challenged, final, head] = await Promise.all([
    contract.order.staticCall(orderId, { blockTag: stable.blockTag }), contract.milestone.staticCall(orderId, milestoneId, { blockTag: stable.blockTag }),
    contract.MILESTONE_AGREED.staticCall({ blockTag: stable.blockTag }), contract.MILESTONE_DELIVERED.staticCall({ blockTag: stable.blockTag }), contract.MILESTONE_CHALLENGED.staticCall({ blockTag: stable.blockTag }), contract.MILESTONE_FINAL.staticCall({ blockTag: stable.blockTag }), provider.getBlockNumber(),
  ]);
  if (!order.exists) throw new Error("Order does not exist at the selected stable block");
  currentOrderRead = { orderId, milestoneId, order: plain(order), milestone: plain(milestone), codes: { agreed: Number(agreed), delivered: Number(delivered), challenged: Number(challenged), final: Number(final) }, stable, head };
  const status = Number(milestone.status), enable = (id: string, yes: boolean) => { $<HTMLButtonElement>(`#${id}`).disabled = !yes; };
  enable("action-deliver", (status === Number(agreed) || status === Number(delivered)) && BigInt(head) < BigInt(milestone.deliverBefore)); enable("action-approve", status === Number(delivered) && BigInt(head) < BigInt(milestone.reviewBefore)); enable("action-challenge", status === Number(delivered) && BigInt(head) < BigInt(milestone.reviewBefore)); enable("action-no-delivery", status === Number(agreed) && BigInt(head) >= BigInt(milestone.deliverBefore)); enable("action-monitoring", status === Number(delivered) && BigInt(head) >= BigInt(milestone.reviewBefore)); enable("action-committee-timeout", status === Number(challenged) && BigInt(head) >= BigInt(milestone.ruleBefore));
  showResult("order-result", `${stable.label}\nCurrent source head ${head}\nStatus code ${milestone.status} · state version ${milestone.stateVersion}\nDelivery ${milestone.deliveryHash}\nBlock cutoffs: deliver ${milestone.deliverBefore} · review ${milestone.reviewBefore} · rule ${milestone.ruleBefore}\nFinal work ${formatNative(milestone.finalWork)} · final fee ${formatNative(milestone.finalFee)}`, "success");
}

const PARTICIPANT_STAGE_COPY: Record<string, [string, string]> = {
  "unsigned-review": ["Review and sign the offer", "The named worker must review every term and the payment destination before signing. Signing uses no gas."],
  "awaiting-acceptance": ["Buyer acceptance is next", "Return the signed file to the buyer. Their Ethereum Safe must recheck and accept the exact quote before the acceptance block."],
  "acceptance-blocked": ["Buyer acceptance is blocked", "Current funding, capacity, nonce or admission checks no longer support this offer. Ask the buyer to prepare a fresh offer."],
  "acceptance-expired": ["Offer acceptance expired", "This offer cannot start work. Ask the buyer for a fresh offer with new terms, nonce, deadlines and consent."],
  "ready-to-deliver": ["Delivery is ready", "Add the delivery content below. Preparing it makes no wallet request; sending is a separate explicit action from the worker address."],
  "ready-to-revise": ["A revision can be delivered", "Review the buyer feedback, then commit the replacement delivery before the delivery cutoff."],
  "awaiting-buyer-review": ["Buyer review is next", "The current delivery is waiting for the buyer Safe to approve or challenge it before the review cutoff."],
  "awaiting-committee": ["Committee review is next", "The challenged delivery is waiting for the agreed committee or the rule cutoff."],
  "awaiting-source-finalization": ["Source finalization is available", "The named next actor can finalize the source outcome at the applicable block cutoff."],
  "source-final": ["Track the payment", "The source outcome is final. Proof, native authentication, recognition and successful withdrawal remain separate steps."],
};
function renderParticipantWorkRead(read: any) {
  const [title, guidance] = PARTICIPANT_STAGE_COPY[read.stage] ?? [read.stage, "Check the current source state before acting."];
  setText("my-work-stage", title); setText("my-work-actor", read.nextActor.replaceAll("-", " ")); setText("my-work-guidance", guidance);
  setText("my-work-gas", `${read.sourceExecutionNote} Cutoffs: accept ${read.deadlines.acceptBefore}, deliver ${read.deadlines.deliverBefore}, review ${read.deadlines.reviewBefore}, rule ${read.deadlines.ruleBefore}.`);
  if (read.stage === "source-final" && BigInt(read.finalWork ?? 0) === 0n) { setText("my-work-stage", "Work closed with no WORK payment"); setText("my-work-guidance", "The source outcome is terminal and earned zero WORK for this milestone. There is no worker WORK payment to track; any FEE is a separate claim."); }
  $("#my-work-delivery-wrap").hidden = !read.workerAction; setDisabled("my-work-continue", !read.workerAction); setDisabled("my-work-track-payment", read.stage !== "source-final" || BigInt(read.finalWork ?? 0) === 0n); setDisabled("my-work-refresh", false);
  showResult("my-work-result", `Order ${read.packet.orderId}\nHash-pinned latest source block ${read.sourceBlock.number} · ${read.sourceBlock.hash}\nStage ${read.stage}\nNext actor ${read.nextActor}${read.blockingReason ? `\nBlocked: ${read.blockingReason}` : ""}\n${read.sourceGasRequired ? "Worker source transaction requires Ethereum gas." : "No worker source transaction is currently required."}`, "success");
}
async function refreshParticipantWork() {
  requireVerifiedWorkspace(); if (!participantPacket) throw new Error("Open a work file first");
  const packet = assertAuthorizationDomain(participantPacket), milestoneId = selectedMilestoneId(), generation = ++participantGeneration, workspaceId = workspaceFingerprint(), source = sourceConfig(), target = targetConfig(), provider = new ethers.JsonRpcProvider(source.rpcUrl), targetProvider = new ethers.JsonRpcProvider(target.rpcUrl);
  const assertFresh = () => { if (generation !== participantGeneration || workspaceId !== workspaceFingerprint() || participantPacket?.orderId?.toLowerCase() !== packet.orderId.toLowerCase()) throw new Error("The selected work or workspace changed while reading; the stale result was discarded"); };
  try {
    showResult("my-work-result", "Reading the selected job at one hash-pinned latest Ethereum block…", "empty");
    const read = await sharedSdk().readParticipantWork(packet, { trusted: participantDomain(), source: provider, target: targetProvider, milestoneId, assertFresh }); assertFresh(); participantWorkRead = read; saveParticipantPacket(packet);
    renderParticipantWorkRead(read);
    return read;
  } finally { provider.destroy?.(); targetProvider.destroy?.(); }
}
function prepareParticipantWorkAction() {
  requireVerifiedWorkspace(); if (!participantWorkRead) throw new Error("Check the live job first");
  if (!participantPacket || participantWorkRead.packet.orderId.toLowerCase() !== participantPacket.orderId.toLowerCase()) throw new Error("The live work read belongs to another selected order; check this job again");
  invalidatePreparedSource("participant delivery prepared");
  const plan = sharedSdk().prepareParticipantDelivery(participantWorkRead, $<HTMLTextAreaElement>("#my-work-delivery").value);
  const fn = writableFunctions("SourceCoordinator").find((item: any) => item.name === "deliver"); if (!fn) throw new Error("Compiled coordinator has no delivery function");
  const args = [plan.orderId, plan.milestoneId, plan.deliveryHash], signature = fn.format("sighash"); $<HTMLSelectElement>("#source-function").value = signature; $<HTMLInputElement>("#source-args").value = JSON.stringify(args);
  preparedSource = { ...prepare("SourceCoordinator", plan.sourceCoordinator, plan.sourceChainId, signature, JSON.stringify(args)), workspaceFingerprint: workspaceFingerprint(), inputFingerprint: fingerprint([signature, JSON.stringify(args)]), requiredAccount: plan.requiredAccount };
  preparedParticipantDelivery = { ...plan, workspaceFingerprint: workspaceFingerprint(), packetOrderId: participantPacket.orderId };
  setDisabled("my-work-send", false); $("#my-work-send").hidden = false; setText("my-work-gas", `Prepared ${plan.kind} commitment ${plan.deliveryHash}. Sending requires another click, the named worker address and Ethereum source gas.`); toast("Delivery prepared. Nothing was sent.");
}
async function sendParticipantWorkAction() {
  if (participantSendBusy) throw new Error("A worker transaction is already in progress. Its pending result will not be sent again.");
  requireVerifiedWorkspace(); preflightJournalStorage(); const plan = structuredClone(preparedParticipantDelivery); if (!plan || !participantPacket) throw new Error("Prepare the worker action first");
  if (plan.workspaceFingerprint !== workspaceFingerprint() || plan.packetOrderId.toLowerCase() !== participantPacket.orderId.toLowerCase()) throw new Error("Prepared worker action is stale");
  participantSendBusy = true; setDisabled("my-work-send", true);
  const packet = structuredClone(participantPacket), participantRevision = participantGeneration, provider = new ethers.JsonRpcProvider(sourceConfig().rpcUrl, BigInt(plan.sourceChainId), { staticNetwork: true }), targetProvider = new ethers.JsonRpcProvider(targetConfig().rpcUrl), workspaceId = workspaceFingerprint(), orderId = packet.orderId, journalId = `${orderId.toLowerCase()}:${plan.milestoneId}:${plan.deliveryHash.toLowerCase()}`;
  try {
    const journals = loadJson(PARTICIPANT_SEND_JOURNAL_KEY, {}), existing = journals[journalId]; if (existing?.transactionHash) throw new Error(`This exact delivery already has a stored ${existing.state} transaction ${existing.transactionHash}. Check its receipt; it will not be sent again.`);
    const assertSelection = () => { if (participantGeneration !== participantRevision || workspaceFingerprint() !== workspaceId || participantPacket?.orderId?.toLowerCase() !== orderId.toLowerCase() || preparedParticipantDelivery?.deliveryHash?.toLowerCase() !== plan.deliveryHash.toLowerCase()) throw new Error("Worker selection, workspace or prepared delivery changed; nothing was sent"); };
    if (BigInt(await provider.send("eth_chainId", [])) !== BigInt(plan.sourceChainId)) throw new Error("Pinned source receipt RPC reports another chain"); assertSelection();
    let read = await sharedSdk().readParticipantWork(packet, { trusted: participantDomain(), source: provider, target: targetProvider, milestoneId: plan.milestoneId, assertFresh: assertSelection }); assertSelection();
    let refreshed = sharedSdk().prepareParticipantDelivery(read, plan.content); if (refreshed.transaction.data.toLowerCase() !== plan.transaction.data.toLowerCase() || refreshed.requiredAccount.toLowerCase() !== plan.requiredAccount.toLowerCase()) throw new Error("The live job changed; prepare the delivery again");
    if (!connected) await connectWallet(); assertSelection(); const session = connected!, walletGeneration = walletSessionGeneration, signer = await session.provider.getSigner();
    const [network, accountValue] = await Promise.all([session.provider.getNetwork(), signer.getAddress()]); assertSelection(); const account = ethers.getAddress(accountValue);
    if (network.chainId !== BigInt(plan.sourceChainId)) throw new Error(`Switch the wallet to source chain ${plan.sourceChainId}`); if (account.toLowerCase() !== plan.requiredAccount.toLowerCase()) throw new Error(`This delivery requires worker ${short(plan.requiredAccount)}; the connected wallet is ${short(account)}`);
    read = await sharedSdk().readParticipantWork(packet, { trusted: participantDomain(), source: provider, target: targetProvider, milestoneId: plan.milestoneId, assertFresh: assertSelection }); assertSelection(); refreshed = sharedSdk().prepareParticipantDelivery(read, plan.content);
    const [liveNetwork, liveAccountValue, liveSourceChainId] = await Promise.all([session.provider.getNetwork(), signer.getAddress(), provider.send("eth_chainId", [])]); assertSelection(); const liveAccount = ethers.getAddress(liveAccountValue);
    if (refreshed.transaction.data.toLowerCase() !== plan.transaction.data.toLowerCase() || walletSessionGeneration !== walletGeneration || connected !== session || liveNetwork.chainId !== BigInt(plan.sourceChainId) || liveAccount.toLowerCase() !== plan.requiredAccount.toLowerCase() || BigInt(liveSourceChainId) !== BigInt(plan.sourceChainId)) throw new Error("Wallet, source RPC or live work state changed immediately before submission; nothing was sent");
    const request = { from: liveAccount, to: plan.transaction.to, data: plan.transaction.data, value: ethers.toQuantity(BigInt(plan.transaction.value)), chainId: ethers.toQuantity(liveNetwork.chainId) }; assertSelection();
    let transactionHash: string;
    try { transactionHash = requireHex(await session.provider.send("eth_sendTransaction", [request]), 32, "Worker transaction hash"); }
    catch (error) { const known = (error as any)?.info?.sendTransactionHash ?? (error as any)?.transactionHash; if (typeof known !== "string" || !ethers.isHexString(known, 32)) throw error; transactionHash = known; }
    const latest = loadJson(PARTICIPANT_SEND_JOURNAL_KEY, {}); latest[journalId] = { state: "pending", orderId, milestoneId: plan.milestoneId, deliveryHash: plan.deliveryHash, transactionHash, submittedAt: new Date().toISOString(), sourceChainId: String(plan.sourceChainId), sourceCoordinator: plan.sourceCoordinator, worker: plan.requiredAccount }; saveJson(PARTICIPANT_SEND_JOURNAL_KEY, latest);
    const originalActionStillSelected = participantGeneration === participantRevision && workspaceFingerprint() === workspaceId && participantPacket?.orderId?.toLowerCase() === orderId.toLowerCase() && preparedParticipantDelivery?.deliveryHash?.toLowerCase() === plan.deliveryHash.toLowerCase();
    if (originalActionStillSelected) { preparedParticipantDelivery = null; preparedSource = null; $("#my-work-send").hidden = true; }
    renderParticipantJournal(participantPacket?.orderId);
    let receipt: any = null, receiptError = ""; try { receipt = await provider.getTransactionReceipt(transactionHash); } catch (error) { receiptError = (error as Error).message; }
    const saved = loadJson(PARTICIPANT_SEND_JOURNAL_KEY, {}); if (receipt) { saved[journalId] = { ...saved[journalId], state: receipt.status === 1 ? "confirmed" : "failed", blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash }; saveJson(PARTICIPANT_SEND_JOURNAL_KEY, saved); }
    const selectionStillCurrent = participantGeneration === participantRevision && workspaceFingerprint() === workspaceId && participantPacket?.orderId?.toLowerCase() === orderId.toLowerCase();
    renderParticipantJournal(participantPacket?.orderId);
    if (selectionStillCurrent) showResult("my-work-result", receipt ? `Worker transaction ${transactionHash} ${receipt.status === 1 ? "confirmed" : "failed"} at source block ${receipt.blockNumber}. Check the job again for current state.` : `Worker transaction ${transactionHash} is saved as pending or receipt-unknown${receiptError ? ` (${receiptError})` : ""}. Check this hash later; the app will not resend the same delivery.`, receipt?.status === 0 ? "error" : receipt ? "success" : "empty");
    else toast(`Original order ${short(orderId)} journal updated for ${short(transactionHash)}; the current work selection was left unchanged.`);
  } finally { participantSendBusy = false; provider.destroy?.(); targetProvider.destroy?.(); if (preparedParticipantDelivery) setDisabled("my-work-send", false); }
}
async function trackParticipantPayment() {
  if (!participantWorkRead || participantWorkRead.stage !== "source-final") throw new Error("The source outcome is not final yet");
  if (!participantPacket || participantWorkRead.packet.orderId.toLowerCase() !== participantPacket.orderId.toLowerCase()) throw new Error("The payment locator belongs to another selected order; check this job again");
  if (BigInt(participantWorkRead.finalWork ?? 0) === 0n) { showResult("my-work-result", "This source-final milestone earned no WORK amount. There is no worker WORK payment to track for this milestone; any separately earned FEE remains a different claim.", "empty"); return; }
  const packet = structuredClone(participantPacket), locator = structuredClone(participantWorkRead.payment), milestoneId = selectedMilestoneId(), participantRevision = participantGeneration, workspaceId = workspaceFingerprint(), closeoutRevision = ++closeoutGeneration;
  const assertFresh = () => { if (participantGeneration !== participantRevision || closeoutGeneration !== closeoutRevision || workspaceFingerprint() !== workspaceId || participantPacket?.orderId?.toLowerCase() !== packet.orderId.toLowerCase() || selectedMilestoneId() !== milestoneId) throw new Error("The selected work, milestone or workspace changed while checking its payment; the stale result was discarded"); };
  $<HTMLInputElement>("#lifecycle-epoch").value = locator.epochId; $<HTMLInputElement>("#closeout-epoch").value = locator.epochId; $<HTMLInputElement>("#lifecycle-allocation").value = ""; $("#lifecycle-links").innerHTML = ""; currentCloseout = null; currentCloseoutResult = null; setDisabled("export-closeout", true);
  showResult("lifecycle-result", `Collecting fresh evidence for this exact order and milestone…`, "empty"); navigate("payments");
  const collected = await collectFreshEpoch(locator.epochId, [packet], assertFresh); assertFresh();
  const sourceEpoch = collected.closeout.epochs.find((item: any) => item.epochId.toLowerCase() === locator.epochId.toLowerCase());
  const matches = (sourceEpoch?.source?.allocations ?? []).filter((item: any) => Number(item.kind) === 1 && item.orderId.toLowerCase() === locator.orderId.toLowerCase() && Number(item.milestoneId) === Number(locator.milestoneId ?? milestoneId));
  currentCloseout = structuredClone(collected); currentCloseoutResult = collected.result; renderCloseout(collected);
  if (matches.length === 0) { showResult("lifecycle-result", `This finalized milestone has no WORK allocation in the fresh finalized source prefix yet. It may not have been allocated or checkpointed yet. No earlier allocation ID was reused.`, "empty"); return; }
  if (matches.length !== 1) { showResult("lifecycle-result", `Fresh evidence contained ${matches.length} WORK allocations for the exact order and milestone, so no payment was selected automatically. Open Technical evidence before relying on this program.`, "error"); return; }
  const allocationId = String(matches[0].allocationId); $<HTMLInputElement>("#lifecycle-allocation").value = allocationId; renderLifecycle(collected, allocationId, trustedDeploymentProfile());
}

async function prepareGuidedSource(name: string) {
  requireVerifiedWorkspace(); invalidatePreparedSource("guided source action changed");
  if (!currentOrderRead) throw new Error("Read the current order and milestone first");
  const { orderId, milestoneId, milestone } = currentOrderRead;
  let args: any[];
  if (name === "deliver") {
    await targetFunding(currentOrderRead.order.epochId, 0n);
    const content = $<HTMLInputElement>("#delivery-content").value.trim();
    if (!content) throw new Error("Enter the new delivery content before preparing delivery");
    args = [orderId, milestoneId, ethers.keccak256(ethers.toUtf8Bytes(content))];
  } else if (name === "approve" || name === "challenge") {
    args = [orderId, milestoneId, milestone.deliveryHash, milestone.stateVersion];
  } else {
    args = [orderId, milestoneId];
  }
  const fn = writableFunctions("SourceCoordinator").find((item: any) => item.name === name);
  if (!fn) throw new Error(`Compiled coordinator has no ${name} function`);
  $<HTMLSelectElement>("#source-function").value = fn.format("sighash");
  $<HTMLInputElement>("#source-args").value = JSON.stringify(args);
  updateActionHelp("source");
  toast(`${name} loaded from the state read at ${currentOrderRead.stable.label}. Review before sending.`);
}

function sourceActionNeedsSafe(signature: string) {
  const name = signature.slice(0, signature.indexOf("("));
  return ["initializeEpoch", "createOffer", "acceptQuote", "approve", "challenge", "releaseFree"].includes(name);
}

function registerWebMcp() { const context = document.modelContext; if (!context?.registerTool) return; const lifecycle = new AbortController(); const safe = (promise: any) => Promise.resolve(promise).catch(() => undefined); safe(context.registerTool({ name: "inspect_claim_package", title: "Inspect claim package", description: "Validate a ProofKey Work Treasury claim package and show its route and allocation leaf without submitting a transaction.", inputSchema: { type: "object", properties: { package: { type: "object" } }, required: ["package"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input: any) { const parsed = parseClaimPackage(input.package); currentClaimPackage = parsed; $<HTMLTextAreaElement>("#claim-package").value = JSON.stringify(parsed, (_, item) => typeof item === "bigint" ? item.toString() : item, 2); showResult("package-result", `Valid ${parsed.route} package\nAllocation ${parsed.allocation.allocationId}\nLeaf ${parsed.leaf}`, "success"); navigate("evidence"); return { route: parsed.route, allocationId: parsed.allocation.allocationId, leaf: parsed.leaf }; } }, { signal: lifecycle.signal })); safe(context.registerTool({ name: "load_epoch", title: "Load epoch", description: "Set the visible epoch and refresh its finalized source and target readback.", inputSchema: { type: "object", properties: { epochId: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }, required: ["epochId"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, async execute(input: any) { requireHex(input.epochId, 32, "Epoch ID"); $<HTMLInputElement>("#active-epoch").value = input.epochId; await refreshReadback(); navigate("overview"); return { epochId: input.epochId, refreshed: true }; } }, { signal: lifecycle.signal })); }

async function activatePublicDemo(persist: boolean) {
  const defaults = window.PROOFKEY_DEFAULT_CONFIG;
  if (!defaults?.source || !defaults?.target) throw new Error("This build has no public demo configuration");
  invalidateWriteState("workspace replaced");
  workspace = structuredClone(defaults);
  if (persist) saveJson(STORAGE_KEY, workspace);
  fillSettings(); populateActions();
  const detail = await verifySettingsWithStatus(workspace, persist ? "Public demo defaults selected." : "Fresh browser: checking the built-in public demo.");
  const reads = await refreshReadback({ persistEpoch: persist });
  const complete = reads.sourceRead && reads.targetRead;
  showResult("settings-result", `${persist ? "Public demo defaults selected." : "Fresh browser: built-in public demo loaded automatically."}\n${detail}\n${complete ? "The Budget page now shows read-only state from both chains." : "At least one Budget read is unavailable. Its card shows the exact error; retry when the RPC or finality view recovers."}\nNo wallet account, signature or transaction was requested.`, complete ? "success" : "error");
  if (persist) toast("Public demo defaults verified and saved on this device.");
}

function showPublicDemoStartupFailure(error: unknown) {
  $("#startup-status-detail").textContent = `${(error as Error).message} The app did not request a wallet or infer live state.`;
  $("#startup-status").hidden = false;
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach(node => node.addEventListener("click", () => navigate((node as HTMLElement).dataset.view!))); document.querySelectorAll("[data-go]").forEach(node => node.addEventListener("click", () => navigate((node as HTMLElement).dataset.go!)));
  $("#menu-button").addEventListener("click", () => { const rail = $(".rail"); rail.classList.toggle("open"); $("#menu-button").setAttribute("aria-expanded", String(rail.classList.contains("open"))); });
  $("#connect-wallet").addEventListener("click", () => connectWallet().catch(error => toast(error.message, true)));
  $("#active-epoch").addEventListener("input", () => { clearProgramPaid(); invalidatePreparedSource("epoch input changed"); invalidatePreparedFunding(); });
  $("#load-epoch").addEventListener("click", () => { invalidatePreparedSource("epoch changed"); refreshReadback().catch(error => toast(error.message, true)); }); $("#refresh-readback").addEventListener("click", () => refreshReadback().catch(error => toast(error.message, true)));
  $("#pilot-form").addEventListener("submit", event => { event.preventDefault(); try { const values: any = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement)), orderId = values.orderId ? requireHex(String(values.orderId).trim(), 32, "Order ID") : undefined, epochId = activeEpoch(); const observation = { version: "proofkey.work-treasury.pilot-observation.v1", observedAt: new Date().toISOString(), locator: { epochId, ...(orderId ? { orderId } : {}) }, labels: { organizationAlias: String(values.organizationAlias ?? "").trim(), participantAlias: String(values.participantAlias ?? "").trim() }, walletControl: String(values.walletControl ?? "").trim(), assistance: String(values.assistance ?? "").trim(), fees: String(values.fees ?? "").trim(), repeatDecision: String(values.repeatDecision ?? "").trim(), notes: String(values.notes ?? "").trim(), limitations: ["Aliases are unverified labels.", "Wallet addresses are not counted as people or organizations.", "This local observation does not establish adoption, identity or publication permission."] }; download(`proofkey-pilot-observation-${Date.now()}.json`, observation); toast("Saved a local pilot observation file."); } catch (error) { toast((error as Error).message, true); } });
  $("#settings-form").addEventListener("input", () => invalidateWriteState("workspace form changed"));
  $("#settings-form").addEventListener("submit", event => { event.preventDefault(); (async () => { invalidateWriteState("workspace verification started"); const candidate = readSettingsForm(); await verifySettingsWithStatus(candidate, "Checking the setup entered in this form."); workspace = { ...workspace, ...candidate }; saveJson(STORAGE_KEY, workspace); fillSettings(); populateActions(); syncWriteControls(); toast("Network setup verified and saved on this device."); })().catch(error => toast(error.message, true)); });
  $("#epoch-form").addEventListener("input", () => { invalidatePreparedSource("epoch form changed"); invalidatePreparedFunding(); });
  $("#epoch-form").addEventListener("submit", event => { event.preventDefault(); try { requireVerifiedWorkspace(); invalidatePreparedSource("epoch changed"); invalidatePreparedFunding(); const built = buildEpochConfiguration(event.currentTarget as HTMLFormElement); workspace.epochConfig = built; workspace.lastEpochId = built.epochId; saveJson(STORAGE_KEY, workspace); fillSettings(); $<HTMLInputElement>("#active-epoch").value = built.epochId; $<HTMLButtonElement>("#prepare-initialize").disabled = false; $<HTMLButtonElement>("#fund-built-epoch").disabled = false; showResult("epoch-result", `Exact epoch ID ${built.epochId}\nCap ${formatNative(built.config.cap)} · canonical ${built.config.cap} base units\nNo source initialization or target funding has occurred.`, "success"); } catch (error) { showResult("epoch-result", (error as Error).message, "error"); } });
  $("#prepare-initialize").addEventListener("click", () => { try { prepareEpochInitialization(); } catch (error) { toast((error as Error).message, true); } });
  $("#fund-built-epoch").addEventListener("click", () => { try { prepareBuiltEpochFunding(); } catch (error) { toast((error as Error).message, true); } });
  $("#fund-exact-epoch").addEventListener("click", () => { try { prepareBuiltEpochFunding(); navigate("settings"); } catch (error) { toast((error as Error).message, true); } });
  $("#send-funding").addEventListener("click", () => sendBuiltEpochFunding().catch(error => toast(error.message, true)));
  $("#verify-settings").addEventListener("click", () => { try { verifySettingsWithStatus(readSettingsForm(), "Checking without changing saved settings.").catch(error => toast(error.message, true)); } catch (error) { showResult("settings-result", `Verification could not start: ${(error as Error).message}\nSaved settings were not changed.`, "error"); toast((error as Error).message, true); } });
  $("#load-public-demo").addEventListener("click", () => activatePublicDemo(true).catch(error => toast(error.message, true)));
  $("#clear-settings").addEventListener("click", () => { invalidateWriteState("workspace cleared"); localStorage.removeItem(STORAGE_KEY); workspace = {}; fillSettings(); showResult("settings-result", "Saved setup cleared. Choose Use public demo defaults or enter another setup; no network request was made.", "empty"); toast("Saved workspace setup cleared."); });
  $("#load-local-demo").addEventListener("click", () => { invalidateWriteState("workspace replaced"); workspace = structuredClone(window.PROOFKEY_DEMO_CONFIG); saveJson(STORAGE_KEY, workspace); fillSettings(); $("#environment-tag").textContent = "Local fixture · real chain reads"; showResult("settings-result", "Real local fixture settings loaded and saved. Verify them while the local chains are running. Unknown runtime profiles remain inspection-only.", "empty"); toast("Loaded the real local-chain fixture configuration."); });
  $("#draft-form").addEventListener("input", () => { draftRevision++; invalidatePreparedSource("draft form changed"); $<HTMLButtonElement>("#sign-quote").disabled = true; });
  $("#draft-form").addEventListener("submit", event => { event.preventDefault(); const form = event.currentTarget as HTMLFormElement; changeDraft(null); const revision = draftRevision, workspaceId = workspaceFingerprint(); createDraft(form).then(created => { assertDraftSnapshot(revision, workspaceId); clearParticipantReadState(); changeDraft(created); participantPacket = created; participantReview = null; populateMilestones(created, 0); saveJson(DRAFT_KEY, currentDraft); saveParticipantPacket(created); renderOfferReview(created); const milestone = created.orderTerms.milestones[0]; showResult("draft-result", `Unsigned offer file saved.\nOrder ${created.orderId}\nTerms ${created.termsHash}\nWorker maximum ${formatNative(milestone.work)} · fee ${formatNative(milestone.fee)} · timeout ${formatNative(milestone.timeoutWork)}\nTarget and source observations are committed. No signature, money or admission slot exists yet.`, "success"); syncWriteControls(); }).catch(error => showResult("draft-result", error.message, "error")); });
  $("#sign-quote").addEventListener("click", () => signQuote().catch(error => showResult("draft-result", error.message, "error"))); $("#export-draft").addEventListener("click", () => currentDraft && download(`proofkey-draft-${currentDraft.orderId.slice(2, 10)}.json`, currentDraft));
  $("#authorization-file").addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; draftRevision++; invalidatePreparedSource("authorization import started"); try { await importSignedAuthorization(await file.text()); } catch (error) { showResult("draft-result", `Import refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#followup-template-file").addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { const candidate = assertAuthorizationDomain(consentSdk().parseWorkAuthorizationPackage(await file.text())); if (!candidate.workerSignature) throw new Error("Choose a signed prior work file"); followupTemplate = candidate; setDisabled("use-followup-template", false); showResult("followup-result", `Selected prior order ${candidate.orderId}. Click Start fresh follow-up to check that it is finalized and that this program can accept another job.`, "empty"); } catch (error) { showResult("followup-result", `Template refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#use-followup-template").addEventListener("click", () => useFollowupTemplate().catch(error => showResult("followup-result", error.message, "error")));
  $("#my-work-file").addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { await importParticipantAuthorization(await file.text(), "my-work"); } catch (error) { showResult("my-work-result", `Work file refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#my-work-saved").addEventListener("change", event => { const orderId = (event.target as HTMLSelectElement).value; if (!orderId) return; try { const record = loadParticipantStore().records.find((item: any) => item.orderId.toLowerCase() === orderId.toLowerCase()); if (!record) throw new Error("Saved work is no longer available"); const packet = consentSdk().parseWorkAuthorizationPackage(record.packet); clearParticipantReadState(); changeDraft(packet); participantPacket = packet; participantReview = null; populateMilestones(packet, record.lastMilestoneId); renderOfferReview(packet); renderOfferReview(packet, "my-work"); $("#my-work-destination-ack-wrap").hidden = Boolean(packet.workerSignature); setDisabled("my-work-refresh", !packet.workerSignature); setDisabled("my-work-save", false); showResult("my-work-result", `Saved work ${packet.orderId} selected from local storage. Its stored packet is not current chain state; click Check live job for a fresh read.`, "empty"); syncWriteControls(); } catch (error) { showResult("my-work-result", (error as Error).message, "error"); } });
  $("#my-work-milestone").addEventListener("change", () => { clearParticipantReadState(); if (participantPacket) { renderOfferReview(participantPacket, "my-work"); saveParticipantPacket(participantPacket); } showResult("my-work-result", "Milestone changed. The selected milestone terms are shown above; check the live job before acting.", "empty"); });
  $("#my-work-sign").addEventListener("click", () => signQuote().catch(error => showResult("my-work-result", error.message, "error")));
  $("#my-work-refresh").addEventListener("click", () => refreshParticipantWork().catch(error => showResult("my-work-result", error.message, "error")));
  $("#my-work-save").addEventListener("click", () => participantPacket ? download(`proofkey-work-${participantPacket.orderId.slice(2, 10)}.json`, participantPacket) : toast("Open a work file first", true));
  $("#my-work-delivery").addEventListener("input", () => { preparedParticipantDelivery = null; setDisabled("my-work-send", true); $("#my-work-send").hidden = true; invalidatePreparedSource("participant delivery content changed"); });
  $("#my-work-continue").addEventListener("click", () => { try { prepareParticipantWorkAction(); } catch (error) { showResult("my-work-result", (error as Error).message, "error"); } });
  $("#my-work-send").addEventListener("click", () => sendParticipantWorkAction().catch(error => showResult("my-work-result", error.message, "error")));
  $("#my-work-track-payment").addEventListener("click", () => trackParticipantPayment().catch(error => showResult("my-work-result", error.message, "error")));
  $("#my-work-journal").addEventListener("click", event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-recheck-participant]"); if (button) recheckParticipantSubmission(button.dataset.recheckParticipant!).catch(error => toast(error.message, true)); });
  $("#prepare-quote").addEventListener("click", () => prepareSignedQuote().catch(error => toast(error.message, true)));
  for (const id of ["#current-order", "#current-milestone", "#delivery-content"]) $(id).addEventListener("input", () => invalidatePreparedSource("order input changed"));
  $("#read-order").addEventListener("click", () => readCurrentOrder().catch(error => showResult("order-result", error.message, "error")));
  for (const [id, name] of [["action-deliver", "deliver"], ["action-approve", "approve"], ["action-challenge", "challenge"], ["action-no-delivery", "finalizeNoDelivery"], ["action-monitoring", "finalizeMonitoringDefault"], ["action-committee-timeout", "finalizeCommitteeTimeout"]]) $("#" + id).addEventListener("click", () => prepareGuidedSource(name).catch(error => { if (name === "deliver") showResult("order-result", `Delivery was not prepared.\n${error.message}`, "error"); else toast(error.message, true); }));
  $<HTMLSelectElement>("#source-function").addEventListener("change", () => { invalidatePreparedSource("source function changed"); updateActionHelp("source"); }); $<HTMLInputElement>("#source-args").addEventListener("input", () => invalidatePreparedSource("source arguments changed")); $<HTMLSelectElement>("#target-function").addEventListener("change", () => updateActionHelp("target"));
  $("#prepare-source").addEventListener("click", () => { invalidatePreparedSource("new source preparation"); try { requireVerifiedWorkspace(); const c = sourceConfig(), signature = $<HTMLSelectElement>("#source-function").value, rawArgs = $<HTMLInputElement>("#source-args").value; preparedSource = { ...prepare("SourceCoordinator", c.coordinator, c.chainId, signature, rawArgs), workspaceFingerprint: workspaceFingerprint(), inputFingerprint: fingerprint([signature, rawArgs]) }; $<HTMLElement>("#source-prepared").hidden = false; $("#source-calldata").textContent = preparedSource.data; $<HTMLButtonElement>("#download-safe").disabled = false; $<HTMLButtonElement>("#execute-source").disabled = false; toast("Source call prepared from the compiled ABI."); } catch (error) { toast((error as Error).message, true); } });
  $("#download-safe").addEventListener("click", () => { try { requireVerifiedWorkspace(); const controlFingerprint = fingerprint([$<HTMLSelectElement>("#source-function").value, $<HTMLInputElement>("#source-args").value]); if (!preparedSource || preparedSource.workspaceFingerprint !== workspaceFingerprint() || preparedSource.inputFingerprint !== controlFingerprint) throw new Error("Prepared source action is stale"); const safeFile = { version: "1.0", chainId: preparedSource.chainId, createdAt: Date.now(), meta: { name: `ProofKey ${preparedSource.function}`, description: "Ordinary SourceCoordinator call", txBuilderVersion: "1.18.0", createdFromSafeAddress: workspace.source.safe }, transactions: [{ to: preparedSource.to, value: preparedSource.value, data: preparedSource.data, contractMethod: null, contractInputsValues: null }] }; download(`proofkey-safe-${Date.now()}.json`, safeFile); } catch (error) { toast((error as Error).message, true); } });
  $("#execute-source").addEventListener("click", () => { const controlFingerprint = fingerprint([$<HTMLSelectElement>("#source-function").value, $<HTMLInputElement>("#source-args").value]); if (preparedSource && preparedSource.workspaceFingerprint === workspaceFingerprint() && preparedSource.inputFingerprint === controlFingerprint) sendPrepared(preparedSource, sourceActionNeedsSafe(preparedSource.function), preparedSource.requiredAccount).catch(error => toast(error.message, true)); else toast("Prepare this source action again", true); });
  $("#claim-file").addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) $<HTMLTextAreaElement>("#claim-package").value = await file.text(); });
  $("#inspect-package").addEventListener("click", () => { try { currentClaimPackage = parseClaimPackage($<HTMLTextAreaElement>("#claim-package").value); $<HTMLButtonElement>("#prepare-claim").disabled = !workspaceWriteReady(); const availability = currentClaimPackage.route === "checkpoint" ? "Requires the cached checkpoint reference and these seven siblings." : "Requires exact encoded receipt bytes and native proof/cache material."; showResult("package-result", `Application package is internally consistent.\nRoute ${currentClaimPackage.route}\nAllocation ${currentClaimPackage.allocation.allocationId} · tree index ${currentClaimPackage.allocation.treeIndex}\nAmount ${formatNative(currentClaimPackage.allocation.amount)}\nLeaf ${currentClaimPackage.leaf}\n${availability}\n\nThis check does not claim native authenticity or payment.`, "success"); } catch (error) { $<HTMLButtonElement>("#prepare-claim").disabled = true; showResult("package-result", (error as Error).message, "error"); } });
  $("#prepare-claim").addEventListener("click", () => { try { prepareClaimRecognition(); } catch (error) { toast((error as Error).message, true); } });
  $("#save-package").addEventListener("click", () => currentClaimPackage ? download(`proofkey-claim-${currentClaimPackage.allocation.allocationId}.json`, currentClaimPackage) : toast("Inspect a package before saving it", true));
  $("#fetch-proof").addEventListener("click", () => fetchProof().catch(error => showResult("proof-result", error.name === "AbortError" ? "Proof service timed out after 30 seconds. Cached evidence remains usable; uncached evidence is delayed." : error.message, "error"))); $("#export-proof").addEventListener("click", () => currentProof && download(`proofkey-native-proof-${currentProof.transactionHash.slice(2, 10)}.json`, currentProof));
  $("#rebuild-tree").addEventListener("click", () => inspectTree().catch(error => showResult("tree-result", error.message, "error")));
  $("#export-checkpoint-package").addEventListener("click", () => exportCachedCheckpointPackage().catch(error => showResult("tree-result", error.message, "error")));
  $("#export-receipt-package").addEventListener("click", () => exportReceiptClaimPackage().catch(error => showResult("tree-result", error.message, "error")));
  $("#prepare-evidence").addEventListener("click", () => { try { const c = targetConfig(); preparedEvidence = prepare("WorkTreasury", c.treasury, c.chainId, $<HTMLSelectElement>("#evidence-function").value, $<HTMLInputElement>("#evidence-args").value); const select = $<HTMLSelectElement>("#target-function"); if (![...select.options].some(option => option.value === preparedEvidence.function)) select.add(new Option(preparedEvidence.function.slice(0, preparedEvidence.function.indexOf("(")), preparedEvidence.function)); select.value = preparedEvidence.function; $<HTMLInputElement>("#target-args").value = JSON.stringify(preparedEvidence.args); $<HTMLInputElement>("#target-value").value = "0"; updateActionHelp("target"); toast("Evidence transaction prepared. Review and send it in Payments."); navigate("payments"); } catch (error) { toast((error as Error).message, true); } });
  $("#lookup-payment").addEventListener("click", () => lookupPayment().catch(error => showResult("payment-result", error.message, "error")));
  $("#prepare-fixed-payment").addEventListener("click", () => { try { preparePayment("fixed"); } catch (error) { toast((error as Error).message, true); } });
  $("#prepare-claim-redirect").addEventListener("click", () => { try { preparePayment("claim-redirect"); } catch (error) { toast((error as Error).message, true); } });
  $("#prepare-free-withdrawal").addEventListener("click", () => { try { preparePayment("free"); } catch (error) { toast((error as Error).message, true); } });
  $("#prepare-free-redirect").addEventListener("click", () => { try { preparePayment("free-redirect"); } catch (error) { toast((error as Error).message, true); } });
  $("#settlement-packages").addEventListener("input", () => invalidateSettlementPlan("ClaimPackages changed"));
  $("#settlement-files").addEventListener("change", async event => { const files = [...((event.target as HTMLInputElement).files ?? [])]; if (!files.length) return; invalidateSettlementPlan("payment claims imported"); try { const claims = await Promise.all(files.map(async file => sharedSdk().parseClaimPackage(await file.text()))); $<HTMLTextAreaElement>("#settlement-packages").value = JSON.stringify(claims, (_, item) => typeof item === "bigint" ? item.toString() : item, 2); showResult("settlement-result", `${claims.length} payment claim file(s) passed structural parsing. Check them against native authenticity and current target state next.`, "empty"); } catch (error) { showResult("settlement-result", `Import refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#build-settlement-plan").addEventListener("click", () => buildFreshSettlementPlan().catch(error => showResult("settlement-result", error.message, "error")));
  $("#execute-settlement").addEventListener("click", () => executeOrResumeSettlement().catch(error => { showResult("settlement-result", error.message, "error"); toast(error.message, true); }));
  $("#paid-work-form").addEventListener("input", () => { paidWorkGeneration++; setDisabled("export-paid-work", true); });
  $("#paid-work-form").addEventListener("submit", event => { event.preventDefault(); collectPaidWorkFromUi().catch(error => showPaidWorkCollectionError(error)); });
  $("#paid-work-locator-file").addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; try { const candidate = assertPaymentHistoryDomain(sharedSdk().parsePaymentHistoryLocator(await file.text())); paidWorkGeneration++; $<HTMLInputElement>("#paid-work-subject").value = candidate.subject.address; $<HTMLSelectElement>("#paid-work-role").value = candidate.subject.role; $<HTMLTextAreaElement>("#paid-work-epochs").value = candidate.selections.map((item: any) => item.epochId).join("\n"); paidWorkLocator = candidate; paidWorkLocatorFormFingerprint = currentPaymentHistoryFormFingerprint(); setDisabled("export-paid-work", true); const filters = candidate.selections.reduce((sum: number, item: any) => sum + (item.orderIds?.length ?? 0) + (item.economicIds?.length ?? 0), 0); setText("paid-work-scope", filters ? `${filters} retained payment filter${filters === 1 ? "" : "s"}` : `${candidate.selections.length} selected epoch${candidate.selections.length === 1 ? "" : "s"}`); showResult("paid-work-result", `Imported ${candidate.selections.length} selection locator(s)${filters ? ` with ${filters} exact order/payment filter(s)` : ""}. Prior totals, records, snapshots and verdicts were discarded. Rebuild from fresh receipts for a result.`, "empty"); } catch (error) { showResult("paid-work-result", `Locator refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#paid-work-authorizations").addEventListener("change", async event => { const files = [...((event.target as HTMLInputElement).files ?? [])]; if (!files.length) return; try { const packets = await Promise.all(files.map(async file => { const packet = assertAuthorizationDomain(consentSdk().parseWorkAuthorizationPackage(await file.text())); if (!packet.workerSignature || !packet.signatureValidation) throw new Error(`${file.name} is not a signed authorization`); return packet; })); const candidate = new Map<string, any[]>(); for (const packet of packets) { const key = packet.orderTerms.epochId.toLowerCase(), list = candidate.get(key) ?? []; list.push(packet); candidate.set(key, list); } paidWorkAuthorizations = candidate; paidWorkGeneration++; setDisabled("export-paid-work", true); showResult("paid-work-result", `${packets.length} signed authorization file(s) loaded for fresh source-worker attribution. No imported status or total was retained.`, "empty"); } catch (error) { showResult("paid-work-result", `Authorization files refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#export-paid-work").addEventListener("click", () => { if (paidWorkRecord) download(`proofkey-paid-work-${paidWorkRecord.artifactDigest.slice(2, 10)}.json`, sharedSdk().stringifySelectedPaymentHistory(paidWorkRecord)); });
  $("#paid-work-fix-rpc").addEventListener("click", () => { navigate("settings"); const field = $<HTMLFormElement>("#settings-form").elements.namedItem("sourceRpc") as HTMLInputElement | null; field?.focus(); field?.scrollIntoView({ behavior: "smooth", block: "center" }); });
  $("#paid-work-records").addEventListener("click", event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-check-paid-epoch]"); if (!button) return; $<HTMLInputElement>("#lifecycle-epoch").value = button.dataset.checkPaidEpoch!; $<HTMLInputElement>("#lifecycle-allocation").value = button.dataset.checkPaidAllocation!; $<HTMLInputElement>("#closeout-epoch").value = button.dataset.checkPaidEpoch!; navigate("payments"); inspectLifecycle().catch(error => showResult("lifecycle-result", error.message, "error")); });
  for (const id of ["#closeout-epoch", "#lifecycle-epoch", "#lifecycle-allocation"]) $(id).addEventListener("input", () => invalidateCloseout("epoch or allocation input changed"));
  $("#closeout-file").addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; invalidateCloseout("report locator imported"); try { const locator = sharedSdk().parseProgramCloseoutLocator(await file.text()), profile = trustedDeploymentProfile(); if (locator.source.chainId !== profile.source.chainId || locator.source.coordinator.toLowerCase() !== profile.source.coordinator.toLowerCase() || locator.source.runtimeHash.toLowerCase() !== profile.source.deployedCodeHash.toLowerCase() || locator.target.chainId !== profile.target.chainId || locator.target.sourceChainKey !== profile.source.chainKey || locator.target.treasury.toLowerCase() !== profile.target.treasury.toLowerCase() || locator.target.runtimeHash.toLowerCase() !== profile.target.deployedCodeHash.toLowerCase()) throw new Error("Imported locator differs from this build's trusted deployment"); $<HTMLInputElement>("#closeout-epoch").value = locator.epochId; closeoutAuthorizations = locator.authorizationPackets; closeoutGeneration++; showResult("closeout-result", `Imported epoch ${locator.epochId} and ${closeoutAuthorizations.length} authorization locator(s). The prior status was ignored; collect fresh reads for any result.`, "empty"); } catch (error) { showResult("closeout-result", `Locator import refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#closeout-authorizations").addEventListener("change", async event => { const files = [...((event.target as HTMLInputElement).files ?? [])]; if (!files.length) return; invalidateCloseout("authorization locators changed"); try { closeoutAuthorizations = await Promise.all(files.map(async file => { const packet = sharedSdk().parseWorkAuthorizationPackage(await file.text()); if (!packet.workerSignature || !packet.signatureValidation) throw new Error(`${file.name} is not signed`); return packet; })); showResult("closeout-result", `${closeoutAuthorizations.length} signed authorization packet locator(s) loaded. Their historical acceptance will be collected independently.`, "empty"); } catch (error) { closeoutAuthorizations = []; showResult("closeout-result", `Authorization import refused: ${(error as Error).message}`, "error"); } finally { (event.target as HTMLInputElement).value = ""; } });
  $("#collect-closeout").addEventListener("click", () => collectCloseoutFromUi().catch(error => showResult("closeout-result", error.message, "error")));
  $("#export-closeout").addEventListener("click", () => { if (currentCloseout) download(`proofkey-closeout-${currentCloseout.epoch.epochId.slice(2, 10)}.json`, sharedSdk().stringifyCollectedProgramCloseout(currentCloseout)); });
  $("#inspect-lifecycle").addEventListener("click", () => inspectLifecycle().catch(error => showResult("lifecycle-result", error.message, "error")));
  $("#execute-target").addEventListener("click", () => { try { const c = targetConfig(), signature = $<HTMLSelectElement>("#target-function").value; const tx = prepare("WorkTreasury", c.treasury, c.chainId, signature, $<HTMLInputElement>("#target-args").value, $<HTMLInputElement>("#target-value").value); sendPrepared(tx, false, targetRequiredAccount(signature)).catch(error => toast(error.message, true)); } catch (error) { toast((error as Error).message, true); } });
  $("#record-invoice").addEventListener("click", () => { try { const c = targetConfig(); if (!c.invoiceBook) throw new Error("Configure a PaidInvoiceBook address first"); const tx = prepare("PaidInvoiceBook", c.invoiceBook, c.chainId, "recordPaidWork(bytes32,uint64)", JSON.stringify([$<HTMLInputElement>("#invoice-epoch").value, $<HTMLInputElement>("#invoice-allocation").value])); sendPrepared(tx).catch(error => toast(error.message, true)); } catch (error) { toast((error as Error).message, true); } });
}

function boot() {
  const useFreshPublicDemo = !initialWorkspaceState.present && !Object.keys(workspace).length && Boolean(window.PROOFKEY_DEFAULT_CONFIG);
  if (useFreshPublicDemo) workspace = structuredClone(window.PROOFKEY_DEFAULT_CONFIG);
  populatePolicy(); fillSettings(); bindEvents(); renderProgramBoard(null);
  const contracts = Object.keys(window.PROOFKEY_ABI_MANIFEST?.contracts ?? {}); if (contracts.length) { $("#abi-status").textContent = `${contracts.length} compiled contract interfaces loaded`; $("#abi-contracts").textContent = contracts.join(" · "); populateActions(); } else { $("#abi-status").textContent = "No compiled contract interfaces in this build"; }
  if (currentDraft) { const modern = isConsentPackage(currentDraft), milestone = (modern ? currentDraft.orderTerms : currentDraft.terms)?.milestones?.[0]; const amount = milestone ? `\nStored canonical worker maximum ${formatNative(milestone.work)} (${milestone.work} base units).` : ""; showResult("draft-result", `${modern ? currentDraft.workerSignature ? "Signed consent-bound authorization" : "Unsigned consent-bound review packet" : "Legacy draft (inspect/export only)"} restored from this device.\nOrder ${currentDraft.orderId}${amount}\nCurrent-session verification is required before any write preparation.`, "success"); if (modern) { participantPacket = currentDraft; populateMilestones(currentDraft, 0); renderOfferReview(currentDraft); renderOfferReview(currentDraft, "my-work"); setDisabled("my-work-refresh", !currentDraft.workerSignature); setDisabled("my-work-save", false); $("#my-work-destination-ack-wrap").hidden = Boolean(currentDraft.workerSignature); showResult("my-work-result", `Saved work ${currentDraft.orderId} restored without a network or wallet request. Check live job when ready.`, "empty"); } }
  if (!participantPacket) { try { const store = loadParticipantStore(), record = store.records[0]; if (record) { participantPacket = record.packet; populateMilestones(record.packet, record.lastMilestoneId); renderOfferReview(record.packet, "my-work"); setDisabled("my-work-refresh", !record.packet.workerSignature); setDisabled("my-work-save", false); $("#my-work-destination-ack-wrap").hidden = Boolean(record.packet.workerSignature); showResult("my-work-result", `Saved work ${record.orderId} restored without a network or wallet request. Check live job when ready.`, "empty"); } } catch (error) { showResult("my-work-result", `Saved work could not be restored: ${(error as Error).message}`, "error"); } }
  try { populateSavedWork(participantPacket?.orderId); } catch {}
  if (workspace.epochConfig) { $<HTMLElement>("#fund-exact-epoch").hidden = false; showResult("epoch-result", `Exact epoch restored.\n${workspace.epochConfig.epochId}\nNo funding or initialization is inferred from device storage. Verify this session before preparing a write.`, "success"); }
  syncWriteControls();
  registerWebMcp();
  if (initialWorkspaceState.error) showResult("settings-result", `${initialWorkspaceState.error}\nThe unreadable value was not replaced. Choose Use public demo defaults or clear the saved setup.`, "error");
  else if (useFreshPublicDemo) void activatePublicDemo(false).catch(error => { showPublicDemoStartupFailure(error); toast(`Automatic public-demo check failed: ${error.message}`, true); });
  else if (initialWorkspaceState.present) showResult("settings-result", "Saved setup restored without making a network request. Verify it, or choose Use public demo defaults to replace it explicitly.", "empty");
}

if (window.PROOFKEY_CONSENT_SDK) boot();
else window.addEventListener("proofkey-consent-ready", boot, { once: true });
