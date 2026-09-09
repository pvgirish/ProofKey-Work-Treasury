declare const ethers: any;
declare global {
  interface Window { PROOFKEY_ABI_MANIFEST?: any; PROOFKEY_DEMO_CONFIG?: any; PROOFKEY_DEFAULT_CONFIG?: any; ethereum?: any; }
  interface Document { modelContext?: { registerTool(tool: any, options?: { signal?: AbortSignal }): void | Promise<void> } }
}

const STORAGE_KEY = "proofkey-work-treasury.workspace.v1";
const DRAFT_KEY = "proofkey-work-treasury.draft.v1";
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
let preparedEvidence: any = null;
let lastPaymentLookup: any = null;
let currentOrderRead: any = null;

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
  return Object.fromEntries(EPOCH_FIELDS.map(field => [field, source[field]]));
}
function showResult(id: string, message: string, kind: "empty" | "success" | "error" = "success") { const node = $(`#${id}`); node.className = `result ${kind}`; node.textContent = message; }
function toast(message: string, error = false) { const node = $("#toast"); node.textContent = message; node.className = `toast show${error ? " error" : ""}`; window.setTimeout(() => node.className = "toast", 3400); }
function signal(id: string, status: "neutral" | "good" | "bad" | "wait") { const node = $(`#${id}`); node.className = `signal ${status}`; }
function format(value: bigint | number | string) { try { return BigInt(value).toLocaleString("en-US"); } catch { return String(value); } }
function formatNative(value: bigint | number | string) { return `${ethers.formatEther(BigInt(value))} CTC`; }
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
function targetConfig() {
  if (!workspace.target?.rpcUrl || !workspace.target?.treasury || !workspace.target?.chainId) throw new Error("Complete the Creditcoin target setup first");
  return workspace.target;
}
function activeEpoch() { const value = ($<HTMLInputElement>("#active-epoch").value || workspace.lastEpochId || "").trim(); return requireHex(value, 32, "Epoch ID"); }
function download(name: string, value: any) { const blob = new Blob([typeof value === "string" ? value : JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }

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
  const epoch = String(workspace.lastEpochId ?? ""); $<HTMLInputElement>("#active-epoch").value = epoch; $<HTMLInputElement>("#payment-epoch").value = epoch; $<HTMLInputElement>("#invoice-epoch").value = epoch;
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
async function fundBuiltEpoch() {
  if (!workspace.epochConfig) throw new Error("Build an exact epoch configuration first");
  const c = targetConfig();
  const tx = prepare("WorkTreasury", c.treasury, c.chainId, "fundEpoch", JSON.stringify([workspace.epochConfig.config]), workspace.epochConfig.config.cap);
  await sendPrepared(tx, false, workspace.epochConfig.config.sponsor);
}
function prepareEpochInitialization() {
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
    const [sourceNetwork, targetNetwork, sourceStable, targetStable] = await Promise.all([
      sourceProvider.getNetwork(), targetProvider.getNetwork(), stableBlock(sourceProvider, Number(candidate.source.confirmations ?? 12)), stableBlock(targetProvider, Number(candidate.target.confirmations ?? 12)),
    ]);
    if (sourceNetwork.chainId !== BigInt(candidate.source.chainId)) throw new Error(`${candidate.source.label} RPC reports chain ${sourceNetwork.chainId}, not ${candidate.source.chainId}`);
    if (targetNetwork.chainId !== BigInt(candidate.target.chainId)) throw new Error(`${candidate.target.label} RPC reports chain ${targetNetwork.chainId}, not ${candidate.target.chainId}`);
    const treasury = new ethers.Contract(candidate.target.treasury, artifact("WorkTreasury").abi, targetProvider);
    const [sourceCode, targetCode, pinnedChainId, pinnedChainKey, pinnedCoordinator] = await Promise.all([
      sourceProvider.getCode(candidate.source.coordinator, sourceStable.blockTag), targetProvider.getCode(candidate.target.treasury, targetStable.blockTag),
      treasury.SOURCE_CHAIN_ID.staticCall({ blockTag: targetStable.blockTag }), treasury.SOURCE_CHAIN_KEY.staticCall({ blockTag: targetStable.blockTag }), treasury.SOURCE_COORDINATOR.staticCall({ blockTag: targetStable.blockTag }),
    ]);
    if (sourceCode === "0x") throw new Error("No SourceCoordinator code exists at the selected stable source block");
    if (targetCode === "0x") throw new Error("No WorkTreasury code exists at the selected stable target block");
    if (BigInt(pinnedChainId) !== BigInt(candidate.source.chainId) || BigInt(pinnedChainKey) !== BigInt(candidate.source.chainKey) || String(pinnedCoordinator).toLowerCase() !== candidate.source.coordinator.toLowerCase()) throw new Error("WorkTreasury immutable source domain does not match this workspace");
    signal("source-config-signal", "good"); signal("target-config-signal", "good");
    return `Verified source chain ${sourceNetwork.chainId} and target chain ${targetNetwork.chainId}. WorkTreasury's immutable source domain matches at target ${targetStable.label}; source code was present at ${sourceStable.label}.`;
  } catch (error) {
    signal("source-config-signal", "bad"); signal("target-config-signal", "bad"); throw error;
  } finally {
    sourceProvider.destroy?.(); targetProvider.destroy?.();
  }
}

async function verifySettingsWithStatus(candidate: any, prefix: string) {
  showResult("settings-result", `${prefix}\nChecking both RPC chain IDs, deployed code and the target's immutable source domain…`, "empty");
  try {
    const detail = await verifySettings(candidate);
    $("#startup-status").hidden = true;
    showResult("settings-result", `${prefix}\n${detail}\nNo wallet account, signature or transaction was requested.`, "success");
    return detail;
  } catch (error) {
    showResult("settings-result", `${prefix}\nVerification failed: ${(error as Error).message}\nThese settings were not treated as verified. Choose Use public demo defaults to recover without connecting a wallet.`, "error");
    throw error;
  }
}

async function connectWallet() { if (!window.ethereum) throw new Error("No browser wallet was found. Read-only RPC access remains available."); const provider = new ethers.BrowserProvider(window.ethereum); await provider.send("eth_requestAccounts", []); const signer = await provider.getSigner(); const network = await provider.getNetwork(); connected = { provider, signer, account: ethers.getAddress(await signer.getAddress()), chainId: network.chainId }; $("#connect-wallet span:last-child").textContent = short(connected.account); $("#network-context").textContent = `Wallet on chain ${connected.chainId}`; $(".wallet-dot").classList.add("good"); toast("Wallet connected. Contract state will still be read from the configured RPCs."); }

function setMetrics(id: string, entries: [string, unknown][]) { $(id).innerHTML = entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${format(value as any)}</dd></div>`).join(""); }
async function refreshReadback(options: { persistEpoch?: boolean } = {}) {
  const epoch = activeEpoch(); workspace.lastEpochId = epoch; if (options.persistEpoch !== false) saveJson(STORAGE_KEY, workspace); $<HTMLInputElement>("#payment-epoch").value = epoch; $<HTMLInputElement>("#invoice-epoch").value = epoch;
  let sourceState: any = null, targetState: any = null, targetBlockLabel = "the selected target block";
  try { signal("source-signal", "wait"); const c = sourceConfig(); const provider = new ethers.JsonRpcProvider(c.rpcUrl); const stable = await stableBlock(provider, Number(c.confirmations ?? 12)); const contract = new ethers.Contract(c.coordinator, artifact("SourceCoordinator").abi, provider); sourceState = await contract.epochState.staticCall(epoch, { blockTag: stable.blockTag }); signal("source-signal", "good"); $("#source-main").textContent = sourceState.initialized ? ["Unknown", "Active", "Draining", "Closed"][Number(sourceState.phase)] ?? `Phase ${sourceState.phase}` : sourceState.expiredUninitialized ? "Expired before initialization" : "Not initialized"; $("#source-detail").textContent = `Read at source ${stable.label}. Root ${short(sourceState.root)}.`; setMetrics("#source-metrics", [["Available", formatNative(sourceState.available)], ["Unresolved", formatNative(sourceState.unresolved)], ["Leaves", sourceState.leafCount]]); } catch (error) { signal("source-signal", "bad"); $("#source-main").textContent = "Source unavailable"; $("#source-detail").textContent = (error as Error).message; }
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

function milestoneHash(m: any) { return ethers.keccak256(abi.encode(["bytes32", "uint256", "uint256", "uint256", "uint64", "uint64", "uint64"], [MILESTONE_TYPEHASH, m.work, m.fee, m.timeoutWork, m.deliverBefore, m.reviewBefore, m.ruleBefore])); }
function computeOrderId(terms: any) { const milestoneHashes = terms.milestones.map(milestoneHash); const committeeHash = ethers.keccak256(abi.encode(["address[3]"], [terms.committee])); const milestonesHash = ethers.keccak256(abi.encode(["bytes32[]"], [milestoneHashes])); return ethers.keccak256(abi.encode(["bytes32", "bytes32", "bytes32", "address", "address", "address", "address", "address", "bytes32", "uint64", "uint64", "bytes32"], [ORDER_TYPEHASH, terms.epochId, terms.termsHash, terms.worker, terms.claimOwner, terms.destination, terms.feeOwner, terms.feeDestination, committeeHash, terms.acceptBefore, terms.nonce, milestonesHash])); }
function createDraft(form: HTMLFormElement) {
  const value: any = Object.fromEntries(new FormData(form));
  const integer = (name: string) => { if (!/^(0|[1-9][0-9]*)$/.test(String(value[name]))) throw new Error(`${name} must be a nonnegative integer`); return BigInt(value[name]); };
  const worker = requireAddress(value.worker, "Worker"), claimOwner = requireAddress(value.claimOwner, "Claim owner"), destination = requireAddress(value.destination, "Destination");
  if (destination.toLowerCase() !== claimOwner.toLowerCase() && !value.destinationAck) throw new Error("A different fixed destination requires the standing-payment acknowledgement");
  const milestone = { work: parseNative(value.work, "Worker maximum", true), fee: parseNative(value.fee, "Committee fee"), timeoutWork: parseNative(value.timeoutWork, "Timeout worker amount"), deliverBefore: integer("deliverBefore"), reviewBefore: integer("reviewBefore"), ruleBefore: integer("ruleBefore") };
  const acceptBefore = integer("acceptBefore");
  if (milestone.work === 0n || milestone.timeoutWork > milestone.work || !(acceptBefore < milestone.deliverBefore && milestone.deliverBefore < milestone.reviewBefore && milestone.reviewBefore < milestone.ruleBefore)) throw new Error("Worker maximum must be positive and block cutoffs must increase from acceptance through ruling");
  const terms = { epochId: requireHex(value.epochId, 32, "Epoch ID"), termsHash: ethers.keccak256(ethers.toUtf8Bytes(String(value.scope))), worker, claimOwner, destination, feeOwner: requireAddress(value.feeOwner, "Fee owner"), feeDestination: requireAddress(value.feeDestination, "Fee destination"), committee: [requireAddress(value.committee0, "Committee 1"), requireAddress(value.committee1, "Committee 2"), requireAddress(value.committee2, "Committee 3")], acceptBefore, nonce: integer("nonce"), milestones: [milestone] };
  if (new Set(terms.committee.map((item: string) => item.toLowerCase())).size !== 3) throw new Error("Committee members must be distinct");
  const orderId = computeOrderId(terms);
  return { version: "proofkey.work-treasury.draft.v1", authority: "none", createdAt: new Date().toISOString(), scope: String(value.scope), terms: plain(terms), orderId, destinationAcknowledged: Boolean(value.destinationAck) };
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
async function sourceCapacity(epochId: string, required: bigint) { const c = sourceConfig(), provider = new ethers.JsonRpcProvider(c.rpcUrl), stable = await stableBlock(provider, Number(c.confirmations ?? 12)), contract = new ethers.Contract(c.coordinator, artifact("SourceCoordinator").abi, provider), state = await contract.epochState.staticCall(epochId, { blockTag: stable.blockTag }); if (!state.initialized || Number(state.phase) !== 1) throw new Error("Source epoch is not active for new reservations"); if (BigInt(state.available) < required) throw new Error("Source available capacity is below this milestone maximum"); if (Number(state.reservations) >= 32) throw new Error("Source admission capacity is exhausted even though money may remain"); return { block: stable.blockTag, blockLabel: stable.label, available: state.available, remainingAdmissions: 32 - Number(state.reservations) }; }
async function signQuote() { if (!currentDraft) throw new Error("Create the draft first"); const required = BigInt(currentDraft.terms.milestones[0].work) + BigInt(currentDraft.terms.milestones[0].fee); const funding = await targetFunding(currentDraft.terms.epochId, required), capacity = await sourceCapacity(currentDraft.terms.epochId, required); if (!connected) await connectWallet(); if (connected!.account.toLowerCase() !== currentDraft.terms.worker.toLowerCase()) throw new Error("The connected wallet is not the worker named in this quote"); const c = sourceConfig(); if (connected!.chainId !== BigInt(c.chainId)) throw new Error(`Switch the wallet to source chain ${c.chainId}`); const signature = await connected!.signer.signTypedData({ name: "ProofKey Source Coordinator", version: "1", chainId: BigInt(c.chainId), verifyingContract: c.coordinator }, { ProofKeyQuoteV1: [{ name: "orderId", type: "bytes32" }] }, { orderId: currentDraft.orderId }); currentDraft = { ...currentDraft, authority: "worker-signature", workerSignature: signature, targetFundingRead: { observedAt: new Date().toISOString(), block: funding.block, blockHash: funding.blockHash, blockLabel: funding.blockLabel, finalityBasis: funding.finalityBasis, reserve: String(funding.reserve), chainId: String(funding.targetChainId) }, sourceCapacityRead: { block: capacity.block, blockLabel: capacity.blockLabel, available: String(capacity.available), remainingAdmissions: capacity.remainingAdmissions } }; saveJson(DRAFT_KEY, currentDraft); showResult("draft-result", `Binding worker quote signed after independent finalized target funding and source capacity reads.\nOrder ${currentDraft.orderId}\nTarget reserve ${formatNative(funding.reserve)} at ${funding.blockLabel} · ${funding.blockHash}\nSource available ${formatNative(capacity.available)} · ${capacity.remainingAdmissions} admission slots at ${capacity.blockLabel}`, "success"); $<HTMLElement>("#prepare-quote").hidden = false; toast("Worker quote signed. The Safe must still accept it on Ethereum."); }

function prepareSignedQuote() {
  if (!currentDraft?.workerSignature) throw new Error("The worker has not signed this quote");
  const fn = writableFunctions("SourceCoordinator").find((item: any) => item.name === "acceptQuote");
  if (!fn) throw new Error("Compiled coordinator has no acceptQuote function");
  $<HTMLSelectElement>("#source-function").value = fn.format("sighash");
  $<HTMLInputElement>("#source-args").value = JSON.stringify([currentDraft.terms, currentDraft.workerSignature]);
  toast("Safe acceptance loaded from the signed quote. Review and prepare it below.");
}

function prepareClaimRecognition() {
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
async function sendPrepared(tx: any, sourceSafe = false, requiredAccount?: string) { if (!connected) await connectWallet(); if (connected!.chainId !== BigInt(tx.chainId)) throw new Error(`Switch the wallet to chain ${tx.chainId}`); if (sourceSafe && connected!.account.toLowerCase() !== String(workspace.source.safe).toLowerCase()) throw new Error("Direct Safe execution requires an injected Safe-compatible wallet whose active account is the configured Safe. This app does not bundle the Safe Apps SDK; download the Safe Transaction Builder JSON by default."); if (requiredAccount && connected!.account.toLowerCase() !== requiredAccount.toLowerCase()) throw new Error(`This action requires ${short(requiredAccount)}; the connected wallet is ${short(connected!.account)}`); const sent = await connected!.signer.sendTransaction({ to: tx.to, value: BigInt(tx.value), data: tx.data }); toast(`Submitted ${short(sent.hash)}. Waiting for confirmation…`); await sent.wait(); toast(`Confirmed ${short(sent.hash)}`); return sent.hash; }

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

async function prepareGuidedSource(name: string) {
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
  $("#load-epoch").addEventListener("click", () => refreshReadback().catch(error => toast(error.message, true))); $("#refresh-readback").addEventListener("click", () => refreshReadback().catch(error => toast(error.message, true)));
  $("#settings-form").addEventListener("submit", event => { event.preventDefault(); (async () => { const candidate = readSettingsForm(); await verifySettingsWithStatus(candidate, "Checking the setup entered in this form."); workspace = { ...workspace, ...candidate }; saveJson(STORAGE_KEY, workspace); fillSettings(); populateActions(); toast("Network setup verified and saved on this device."); })().catch(error => toast(error.message, true)); });
  $("#epoch-form").addEventListener("submit", event => { event.preventDefault(); try { const built = buildEpochConfiguration(event.currentTarget as HTMLFormElement); workspace.epochConfig = built; workspace.lastEpochId = built.epochId; saveJson(STORAGE_KEY, workspace); fillSettings(); $<HTMLInputElement>("#active-epoch").value = built.epochId; $<HTMLButtonElement>("#prepare-initialize").disabled = false; $<HTMLButtonElement>("#fund-built-epoch").disabled = false; showResult("epoch-result", `Exact epoch ID ${built.epochId}\nCap ${formatNative(built.config.cap)} · canonical ${built.config.cap} base units\nNo source initialization or target funding has occurred.`, "success"); } catch (error) { showResult("epoch-result", (error as Error).message, "error"); } });
  $("#prepare-initialize").addEventListener("click", () => { try { prepareEpochInitialization(); } catch (error) { toast((error as Error).message, true); } });
  $("#fund-built-epoch").addEventListener("click", () => fundBuiltEpoch().catch(error => toast(error.message, true)));
  $("#fund-exact-epoch").addEventListener("click", () => fundBuiltEpoch().catch(error => toast(error.message, true)));
  $("#verify-settings").addEventListener("click", () => { try { verifySettingsWithStatus(readSettingsForm(), "Checking without changing saved settings.").catch(error => toast(error.message, true)); } catch (error) { showResult("settings-result", `Verification could not start: ${(error as Error).message}\nSaved settings were not changed.`, "error"); toast((error as Error).message, true); } });
  $("#load-public-demo").addEventListener("click", () => activatePublicDemo(true).catch(error => toast(error.message, true)));
  $("#clear-settings").addEventListener("click", () => { localStorage.removeItem(STORAGE_KEY); workspace = {}; fillSettings(); showResult("settings-result", "Saved setup cleared. Choose Use public demo defaults or enter another setup; no network request was made.", "empty"); toast("Saved workspace setup cleared."); });
  $("#load-local-demo").addEventListener("click", () => { workspace = structuredClone(window.PROOFKEY_DEMO_CONFIG); saveJson(STORAGE_KEY, workspace); fillSettings(); $("#environment-tag").textContent = "Local fixture · real chain reads"; showResult("settings-result", "Real local fixture settings loaded and saved. Verify them while the local chains are running.", "empty"); toast("Loaded the real local-chain fixture configuration."); });
  $("#draft-form").addEventListener("submit", event => { event.preventDefault(); try { currentDraft = createDraft(event.currentTarget as HTMLFormElement); saveJson(DRAFT_KEY, currentDraft); const milestone = currentDraft.terms.milestones[0]; showResult("draft-result", `Nonbinding draft saved on this device.\nOrder ${currentDraft.orderId}\nTerms ${currentDraft.terms.termsHash}\nWorker maximum ${formatNative(milestone.work)} · fee ${formatNative(milestone.fee)} · timeout ${formatNative(milestone.timeoutWork)}\nCanonical signed values remain ${milestone.work}, ${milestone.fee}, ${milestone.timeoutWork} base units.\nNo money or admission slot is reserved.`, "success"); $<HTMLButtonElement>("#sign-quote").disabled = false; $<HTMLButtonElement>("#export-draft").disabled = false; } catch (error) { showResult("draft-result", (error as Error).message, "error"); } });
  $("#sign-quote").addEventListener("click", () => signQuote().catch(error => showResult("draft-result", error.message, "error"))); $("#export-draft").addEventListener("click", () => currentDraft && download(`proofkey-draft-${currentDraft.orderId.slice(2, 10)}.json`, currentDraft));
  $("#prepare-quote").addEventListener("click", () => { try { prepareSignedQuote(); } catch (error) { toast((error as Error).message, true); } });
  $("#read-order").addEventListener("click", () => readCurrentOrder().catch(error => showResult("order-result", error.message, "error")));
  for (const [id, name] of [["action-deliver", "deliver"], ["action-approve", "approve"], ["action-challenge", "challenge"], ["action-no-delivery", "finalizeNoDelivery"], ["action-monitoring", "finalizeMonitoringDefault"], ["action-committee-timeout", "finalizeCommitteeTimeout"]]) $("#" + id).addEventListener("click", () => prepareGuidedSource(name).catch(error => { if (name === "deliver") showResult("order-result", `Delivery was not prepared.\n${error.message}`, "error"); else toast(error.message, true); }));
  $<HTMLSelectElement>("#source-function").addEventListener("change", () => updateActionHelp("source")); $<HTMLSelectElement>("#target-function").addEventListener("change", () => updateActionHelp("target"));
  $("#prepare-source").addEventListener("click", () => { try { const c = sourceConfig(); preparedSource = prepare("SourceCoordinator", c.coordinator, c.chainId, $<HTMLSelectElement>("#source-function").value, $<HTMLInputElement>("#source-args").value); $<HTMLElement>("#source-prepared").hidden = false; $("#source-calldata").textContent = preparedSource.data; toast("Source call prepared from the compiled ABI."); } catch (error) { toast((error as Error).message, true); } });
  $("#download-safe").addEventListener("click", () => { if (!preparedSource) return; const safeFile = { version: "1.0", chainId: preparedSource.chainId, createdAt: Date.now(), meta: { name: `ProofKey ${preparedSource.function}`, description: "Ordinary SourceCoordinator call", txBuilderVersion: "1.18.0", createdFromSafeAddress: workspace.source.safe }, transactions: [{ to: preparedSource.to, value: preparedSource.value, data: preparedSource.data, contractMethod: null, contractInputsValues: null }] }; download(`proofkey-safe-${Date.now()}.json`, safeFile); });
  $("#execute-source").addEventListener("click", () => preparedSource ? sendPrepared(preparedSource, sourceActionNeedsSafe(preparedSource.function)).catch(error => toast(error.message, true)) : toast("Prepare a source action first", true));
  $("#claim-file").addEventListener("change", async event => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) $<HTMLTextAreaElement>("#claim-package").value = await file.text(); });
  $("#inspect-package").addEventListener("click", () => { try { currentClaimPackage = parseClaimPackage($<HTMLTextAreaElement>("#claim-package").value); $<HTMLButtonElement>("#prepare-claim").disabled = false; const availability = currentClaimPackage.route === "checkpoint" ? "Requires the cached checkpoint reference and these seven siblings." : "Requires exact encoded receipt bytes and native proof/cache material."; showResult("package-result", `Application package is internally consistent.\nRoute ${currentClaimPackage.route}\nAllocation ${currentClaimPackage.allocation.allocationId} · tree index ${currentClaimPackage.allocation.treeIndex}\nAmount ${formatNative(currentClaimPackage.allocation.amount)}\nLeaf ${currentClaimPackage.leaf}\n${availability}\n\nThis check does not claim native authenticity or payment.`, "success"); } catch (error) { $<HTMLButtonElement>("#prepare-claim").disabled = true; showResult("package-result", (error as Error).message, "error"); } });
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
  $("#execute-target").addEventListener("click", () => { try { const c = targetConfig(), signature = $<HTMLSelectElement>("#target-function").value; const tx = prepare("WorkTreasury", c.treasury, c.chainId, signature, $<HTMLInputElement>("#target-args").value, $<HTMLInputElement>("#target-value").value); sendPrepared(tx, false, targetRequiredAccount(signature)).catch(error => toast(error.message, true)); } catch (error) { toast((error as Error).message, true); } });
  $("#record-invoice").addEventListener("click", () => { try { const c = targetConfig(); if (!c.invoiceBook) throw new Error("Configure a PaidInvoiceBook address first"); const tx = prepare("PaidInvoiceBook", c.invoiceBook, c.chainId, "recordPaidWork(bytes32,uint64)", JSON.stringify([$<HTMLInputElement>("#invoice-epoch").value, $<HTMLInputElement>("#invoice-allocation").value])); sendPrepared(tx).catch(error => toast(error.message, true)); } catch (error) { toast((error as Error).message, true); } });
}

function boot() {
  const useFreshPublicDemo = !initialWorkspaceState.present && !Object.keys(workspace).length && Boolean(window.PROOFKEY_DEFAULT_CONFIG);
  if (useFreshPublicDemo) workspace = structuredClone(window.PROOFKEY_DEFAULT_CONFIG);
  populatePolicy(); fillSettings(); bindEvents();
  const contracts = Object.keys(window.PROOFKEY_ABI_MANIFEST?.contracts ?? {}); if (contracts.length) { $("#abi-status").textContent = `${contracts.length} compiled contract interfaces loaded`; $("#abi-contracts").textContent = contracts.join(" · "); populateActions(); } else { $("#abi-status").textContent = "No compiled contract interfaces in this build"; }
  if (currentDraft) { const milestone = currentDraft.terms?.milestones?.[0]; const amount = milestone ? `\nStored canonical worker maximum ${formatNative(milestone.work)} (${milestone.work} base units).` : ""; showResult("draft-result", `${currentDraft.authority === "worker-signature" ? "Binding worker quote" : "Nonbinding draft"} restored from this device.\nOrder ${currentDraft.orderId}${amount}`, "success"); $<HTMLButtonElement>("#sign-quote").disabled = currentDraft.authority === "worker-signature"; $<HTMLElement>("#prepare-quote").hidden = currentDraft.authority !== "worker-signature"; $<HTMLButtonElement>("#export-draft").disabled = false; }
  if (workspace.epochConfig) { $<HTMLButtonElement>("#prepare-initialize").disabled = false; $<HTMLButtonElement>("#fund-built-epoch").disabled = false; $<HTMLElement>("#fund-exact-epoch").hidden = false; showResult("epoch-result", `Exact epoch restored.\n${workspace.epochConfig.epochId}\nNo funding or initialization is inferred from device storage.`, "success"); }
  registerWebMcp();
  if (initialWorkspaceState.error) showResult("settings-result", `${initialWorkspaceState.error}\nThe unreadable value was not replaced. Choose Use public demo defaults or clear the saved setup.`, "error");
  else if (useFreshPublicDemo) void activatePublicDemo(false).catch(error => { showPublicDemoStartupFailure(error); toast(`Automatic public-demo check failed: ${error.message}`, true); });
  else if (initialWorkspaceState.present) showResult("settings-result", "Saved setup restored without making a network request. Verify it, or choose Use public demo defaults to replace it explicitly.", "empty");
}

boot();
