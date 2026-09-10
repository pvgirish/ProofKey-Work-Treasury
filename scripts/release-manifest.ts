import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { isHexString, keccak256 } from "ethers";
import { ROOT } from "./runtime.ts";

const execFileAsync=promisify(execFile);
const OUTPUT=resolve(ROOT,"evidence/release-manifest.json");
const LOCK=resolve(ROOT,"docs/ARCHITECTURE-LOCK.md");
const DEPLOYMENTS="deployments/testnet.json";

type TestRef={
  framework:"foundry"|"node-test";
  file:string;
  contract?:string;
  name:string;
  command:string;
};

type GateDefinition={
  gate:string;
  requiredObservation:string;
  tests:TestRef[];
  artifacts:string[];
  evidence:string[];
  observedStatus:string;
  pending:string[];
};

function foundry(file:string,contract:string,name:string):TestRef{
  return {
    framework:"foundry",
    file,
    contract,
    name,
    command:`bash scripts/forge.sh test --match-contract ${contract} --match-test ${name} -vv`,
  };
}

function nodeTest(file:string,name:string):TestRef{
  return {
    framework:"node-test",
    file,
    name,
    command:`node --test --test-name-pattern ${JSON.stringify(`^${name}$`)} ${file}`,
  };
}

const F=(file:string,contract:string)=>(name:string)=>foundry(file,contract,name);
const S=(file:string)=>(name:string)=>nodeTest(file,name);
const allocation=F("test/AllocationTree.t.sol","AllocationTreeTest");
const source=F("test/SourceCoordinator.t.sol","SourceCoordinatorTest");
const sourceInvariant=F("test/SourceAccountingInvariant.t.sol","SourceAccountingInvariantTest");
const sourceReuse=F("test/SourceAccountingInvariant.t.sol","SourceCapacityReuseFuzzTest");
const target=F("test/WorkTreasuryTarget.t.sol","WorkTreasuryTargetTest");
const endToEnd=F("test/EndToEnd.t.sol","EndToEndTest");
const adversarial=F("test/AdversarialIntegration.t.sol","AdversarialIntegrationTest");
const performance=F("test/Performance.t.sol","PerformanceTest");
const identity=F("test/IdentityConformance.t.sol","IdentityConformanceTest");
const sdkAllocation=S("sdk/allocation.test.ts");
const sdkIdentity=S("sdk/identity.test.ts");
const sdkConformance=S("sdk/conformance.test.ts");
const sdkProof=S("sdk/prover-client.test.ts");
const sdkSafe=S("sdk/safe-events.test.ts");

const gates:GateDefinition[]=[
  {
    gate:"ABI/codec",
    requiredObservation:"Published full leaf/event vectors, canonical padding/length refusal, ordered-tree reconstruction, separate domains and ID=index+1 across both adapters",
    tests:[
      allocation("test_frozenGoldenEventsDecodeToExactHashesAndOrderedProofs"),
      allocation("test_codecRejectsTruncationExtraDataAndDirtyStaticPadding"),
      sdkAllocation("matches every frozen AllocationV1 encoding, event and hash"),
      sdkAllocation("rebuilds the frozen ordered tree and all seven-level witnesses"),
      sdkAllocation("rejects reordered leaves, changed amounts and noncanonical events"),
      sdkIdentity("domain constants are the literal WorkTypes domains"),
      identity("testSdkEncodedEpochAndOrderedMilestonesMatchSolidity"),
      sdkConformance("released SDK preserves the committed Solidity-conformance vectors"),
    ],
    artifacts:["out/WorkTypes.sol/WorkTypes.json","out/AllocationCodec.sol/AllocationCodec.json","out/AllocationTree.sol/AllocationTree.json"],
    evidence:["schema/schema-v1.json","schema/schema-v1-vectors.json","schema/identity-v1-vectors.json"],
    observedStatus:"Exact test names, frozen vectors, schema and compiled artifacts are present and validated; this generator does not claim a current-revision test execution.",
    pending:["Attach the current-revision CI or local execution result."],
  },
  {
    gate:"Source policy",
    requiredObservation:"Every terminal conserves M; U is released once; pending expiry, no delivery, approval, monitoring default, quorum, committee timeout and mutual settlement all execute with boundary/stale/duplicate refusals; both mutual/default transaction orderings preserve the first valid terminal",
    tests:[
      source("testInitializationAndUninitializedExpiryAreExclusive"),
      source("testPendingOfferAcceptDeclineExpiryAndReservationCapPersistence"),
      source("testApprovalNoDeliveryAndMonitoringDefaultAtExactBoundaries"),
      source("testCommitteeVotesDoNotPoolAcrossProposalsAndDuplicateFails"),
      source("testCommitteeTimeoutAndMutualDefaultFirstWriterWins"),
      source("testActiveReturnDrainSweepAndNoEmptyLeaf"),
      adversarial("test_exactDeadlinesSelectOnlyTheSpecifiedTerminalTransition"),
      adversarial("test_zeroSignerAndStaleMutualAuthorizationsAreRejected"),
      sourceInvariant("invariant_sourceAccountingMatchesIndependentGhostModel"),
      sourceInvariant("invariant_irreversibleTotalsEqualCanonicalAllocations"),
      sourceInvariant("invariant_closedEpochHasNoReusableCapacityOrCommitment"),
      sourceReuse("testFuzz_declineExpiryAndNoDeliveryRestoreCapacityForNewReservations"),
      sourceReuse("testFuzz_returnDoesNotBecomeReusableCapacityInTheSameEpoch"),
    ],
    artifacts:["out/SourceCoordinator.sol/SourceCoordinator.json","out/SourcePolicyV1Lib.sol/SourcePolicyV1Lib.json","out/SourceAccountingLib.sol/SourceAccountingLib.json","out/SourceSignatureLib.sol/SourceSignatureLib.json"],
    evidence:["evidence/source-demo.json","evidence/source-branches.json"],
    observedStatus:"The public source journals record the main policy path and branch terminals, including stale, duplicate and both first-writer refusal observations; target follow-through is reported by separate gates.",
    pending:["Attach the current-revision test execution result."],
  },
  {
    gate:"Capacity",
    requiredObservation:"Reachable 113-leaf trace through actual policy/append; separate declined/unagreed, tiny early-return and late-draining traces; accepted obligations and protected returns remain appendable",
    tests:[
      source("testReachable113LeafTraceAndIndependentRootRebuild"),
      source("testPendingOfferAcceptDeclineExpiryAndReservationCapPersistence"),
      source("testActiveReturnDrainSweepAndNoEmptyLeaf"),
      allocation("test_productionTreeAll128AppendsMatchIndependentFullRebuild"),
      sourceInvariant("invariant_reservationPartitionAndCapacityRemainBounded"),
    ],
    artifacts:["out/SourceCoordinator.sol/SourceCoordinator.json","out/AllocationTree.sol/AllocationTree.json"],
    evidence:["evidence/source-branches.json"],
    observedStatus:"The actual 113-leaf production-policy test and 128-leaf production-tree harness are reference-validated; the public branch journal separately records smaller live traces.",
    pending:["Attach the current-revision test execution result."],
  },
  {
    gate:"Incremental tree/readback",
    requiredObservation:"Independent rebuild from same-block public full allocations equals real stored root after every operation; actual emitted-event roundtrip; production tree harness covers 114/128, carry boundaries and append-129 refusal; no hand-seeded substitute",
    tests:[
      source("testReachable113LeafTraceAndIndependentRootRebuild"),
      source("testAllocationEventRoundTripAndAtomicWorkFeeCheckpoint"),
      allocation("test_productionTreeAll128AppendsMatchIndependentFullRebuild"),
      allocation("test_failedAppendAndInitializationCannotChangeTree"),
    ],
    artifacts:["out/SourceCoordinator.sol/SourceCoordinator.json","out/AllocationTree.sol/AllocationTree.json"],
    evidence:["evidence/source-demo.json","evidence/source-branches.json"],
    observedStatus:"Independent rebuild and event-roundtrip test references are validated; the public journals contain allocation/checkpoint receipt ordinals but do not record a maximum-size same-block rebuild.",
    pending:["Attach the current-revision test execution result."],
  },
  {
    gate:"Atomic publication",
    requiredObservation:"Multi-leaf calls publish their final consistent root; no later source transaction is needed to prove a new allocation; reverted calls leave no partial state/logs",
    tests:[
      source("testAllocationEventRoundTripAndAtomicWorkFeeCheckpoint"),
      source("testReachable113LeafTraceAndIndependentRootRebuild"),
      allocation("test_failedAppendAndInitializationCannotChangeTree"),
      target("test_checkpointThenReceiptReplayFails_andBadCombinedClaimRollsBackNewCache"),
    ],
    artifacts:["out/SourceCoordinator.sol/SourceCoordinator.json","out/WorkTreasury.sol/WorkTreasury.json"],
    evidence:["evidence/source-demo.json","evidence/source-branches.json"],
    observedStatus:"Public source receipts retain allocation and checkpoint ordinals from the same operations; atomic rollback remains locally executable evidence.",
    pending:["Attach the current-revision test execution result."],
  },
  {
    gate:"Republish",
    requiredObservation:"Same-state payload equality, changed/phase-only state correctness, no caller root or repair input, no financial/leaf mutation, and independent full-leaf rebuild matches storage",
    tests:[
      source("testAdmissionCutoffAllowsPermissionlessDrainAndRepublishDoesNotMutate"),
      source("testReachable113LeafTraceAndIndependentRootRebuild"),
    ],
    artifacts:["out/SourceCoordinator.sol/SourceCoordinator.json"],
    evidence:["evidence/source-demo.json"],
    observedStatus:"The main source journal records its republish observation; exact equality, phase transition and no-mutation assertions remain mapped to the named tests.",
    pending:["Attach the current-revision test execution result."],
  },
  {
    gate:"Native necessity",
    requiredObservation:"Without a valid native authentication or matching persisted record, plausible checkpoints/allocations cannot introduce claims; authentic evidence for the wrong application fact also fails",
    tests:[
      target("test_cachedReceiptChecksExactBytesEmitterOrdinalAndSupportsTwoEpochs"),
      target("test_checkpointThenReceiptReplayFails_andBadCombinedClaimRollsBackNewCache"),
      adversarial("test_sourceAmountCannotBeSubstitutedInCheckpointOrAuthenticatedReceipt"),
      target("test_nativeVerifierFalseRejectsForgedMatchingReceiptAndLeavesNoState"),
      target("test_nativeBatchVerifierFalseFailsClosedWithoutAuthentication"),
      target("test_nativeVerifierRevertRollsBackEarlierSegmentedAuthentication"),
    ],
    artifacts:["out/WorkTreasury.sol/WorkTreasury.json","out/NativeReceiptAuth.sol/NativeReceiptAuth.json"],
    evidence:["evidence/public-demo.json","evidence/native-recovery-verification-33642ef4.json"],
    observedStatus:"A real fixed-0xFD2 read-only verification returned true and a public batch authentication is mined; negative authentication cases are local executable tests.",
    pending:["Attach the current-revision negative-path test execution result."],
  },
  {
    gate:"Persisted cache",
    requiredObservation:"Warm with epoch A; reject same-receipt foreign-emitter look-alike and B-as-A; accept genuine B correctly without another native call; receipt-local selection differs from block-global logIndex; test both parsers and preserve state after failures",
    tests:[
      target("test_cachedReceiptChecksExactBytesEmitterOrdinalAndSupportsTwoEpochs"),
      target("test_batchAndSegmentedAuthenticate_thenCachedClaimsNeedNoVerifier"),
      target("test_checkpointThenReceiptReplayFails_andBadCombinedClaimRollsBackNewCache"),
    ],
    artifacts:["out/WorkTreasury.sol/WorkTreasury.json"],
    evidence:["evidence/public-demo.json","evidence/public-branches.json"],
    observedStatus:"The public main journal records an authenticated receipt cache and an exact receipt recognition; the two-epoch, parser, wrong-emitter and failure-preservation matrix remains local executable evidence.",
    pending:["The public branch target journal is incomplete.","Attach the current-revision test execution result."],
  },
  {
    gate:"Evidence equivalence",
    requiredObservation:"Receipt→root and root→receipt/new-root replay cannot duplicate value; reject wrong first amount/kind/owner/domain/index and verify mixed WORK/FEE/RETURN",
    tests:[
      target("test_returnBeforeUnseenWorkPreservesBothAndCrossRouteReplayFails"),
      target("test_checkpointThenReceiptReplayFails_andBadCombinedClaimRollsBackNewCache"),
      endToEnd("test_actualSourceWorkFeeReceiptNeedsNoSiblings_andReceiptToRootReplayFails"),
      adversarial("test_sourceAmountCannotBeSubstitutedInCheckpointOrAuthenticatedReceipt"),
    ],
    artifacts:["out/WorkTreasury.sol/WorkTreasury.json","out/SourceCoordinator.sol/SourceCoordinator.json"],
    evidence:["evidence/public-demo.json","evidence/public-branches.json"],
    observedStatus:"The public journal states and receipt identifiers are captured below; both replay directions, mixed kinds and substitution refusals are mapped to exact executable tests.",
    pending:["Public cross-route and mixed-kind evidence is incomplete.","Attach the current-revision test execution result."],
  },
  {
    gate:"Accounting/recovery",
    requiredObservation:"RETURN-before-unseen-WORK preserves both claims; rejecting recipients do not block other payouts; target-owner redirection succeeds for claims and free balances; accepting-fixed-destination-first and owner-redirection-first each pay exactly once, and later attempts fail; a fixture that accepts and locks funds demonstrates the stated absence of post-payment recovery",
    tests:[
      target("test_returnBeforeUnseenWorkPreservesBothAndCrossRouteReplayFails"),
      target("test_rejectingFixedDestinationLeavesClaim_thenOwnerRedirects"),
      target("test_unauthorizedClaimRedirectAndRejectingFreeWithdrawalPreserveBalances"),
      target("test_firstSuccessfulWithdrawalWinsBothOrderings_andConsumerRecordsActualDestination"),
      endToEnd("test_locked120Journey_realSourceSafeRotation_cachedRootAndCrossRouteReplay"),
    ],
    artifacts:["out/WorkTreasury.sol/WorkTreasury.json","out/PaidInvoiceBook.sol/PaidInvoiceBook.json"],
    evidence:["evidence/public-demo.json","evidence/source-demo.json"],
    observedStatus:"The public main journal records RETURN 50 recognized before B settled; its current state below determines whether final worker collection, total RETURN recognition and withdrawal are complete.",
    pending:["Final public accounting and withdrawals are incomplete.","Attach the current-revision test execution result."],
  },
  {
    gate:"Combined operations",
    requiredObservation:"Successful combined/separate flows have identical financial results; their documented failure/cache atomicity differs correctly",
    tests:[
      source("testAllocationEventRoundTripAndAtomicWorkFeeCheckpoint"),
      target("test_checkpointThenReceiptReplayFails_andBadCombinedClaimRollsBackNewCache"),
      endToEnd("test_locked120Journey_realSourceSafeRotation_cachedRootAndCrossRouteReplay"),
    ],
    artifacts:["out/SourceCoordinator.sol/SourceCoordinator.json","out/WorkTreasury.sol/WorkTreasury.json"],
    evidence:["evidence/source-demo.json","evidence/public-demo.json"],
    observedStatus:"Combined and separate operation behavior is mapped to exact executable tests; the public journals do not by themselves establish the full comparison.",
    pending:["Attach the current-revision test execution result."],
  },
  {
    gate:"Availability",
    requiredObservation:"Show cached collection without new native proof and native-receipt collection without application siblings; show unavailable cases honestly",
    tests:[
      target("test_batchAndSegmentedAuthenticate_thenCachedClaimsNeedNoVerifier"),
      endToEnd("test_locked120Journey_realSourceSafeRotation_cachedRootAndCrossRouteReplay"),
      endToEnd("test_actualSourceWorkFeeReceiptNeedsNoSiblings_andReceiptToRootReplayFails"),
      sdkAllocation("receipt package contains a directly usable SingleProof and exact transaction bytes"),
      sdkProof("proof client binds and validates the requested chain and transaction"),
    ],
    artifacts:["out/WorkTreasury.sol/WorkTreasury.json"],
    evidence:["evidence/native-recovery-verification-33642ef4.json","evidence/public-refusal-checks.json","evidence/public-demo.json","evidence/public-branches.json"],
    observedStatus:"The first raw recovery report used unchanged continuity. The later public refusal/replacement report separately records older and regenerated witness outcomes at one target block; only its observed result supports changed-witness recovery.",
    pending:["Public cached-root collection and receipt-without-siblings journeys are incomplete.","Attach the current-revision test execution result."],
  },
  {
    gate:"Performance",
    requiredObservation:"Publish source allocation/tree cost, marginal allocation/checkpoint event cost, target costs and actions for 1/4/16/32 claims through both forms; include first writes, carry boundaries, late tree, WORK+FEE and largest supported source batch",
    tests:[
      performance("test_sourceMarginalCanonicalEventGas"),
      performance("test_sourceLargestOrderAndAllocationGas"),
      performance("test_targetCheckpointAndReceiptClaimGas_localNativeStubExcluded"),
      performance("test_sourceLateCarryBoundaryWorkFeeGas"),
    ],
    artifacts:["out/Performance.t.sol/PerformanceTest.json","out/SourceCoordinator.sol/SourceCoordinator.json","out/WorkTreasury.sol/WorkTreasury.json"],
    evidence:["evidence/local-performance.json","evidence/public-demo.json"],
    observedStatus:"The local performance matrix records all required sizes and source positions. Its target figures explicitly exclude native verification; the public journal records actual batch and receipt-recognition gas only.",
    pending:["Attach the current-revision performance test execution result."],
  },
  {
    gate:"Product",
    requiredObservation:"Full 120-unit journey, capacity exhaustion/successor funding, wallet resume, proof-provider replacement and owner-change scenario are operable without private instructions",
    tests:[
      endToEnd("test_locked120Journey_realSourceSafeRotation_cachedRootAndCrossRouteReplay"),
      target("test_fundingUsesOwnDepositAndFree_andSuccessorUsesReturnedFree"),
      source("testReachable113LeafTraceAndIndependentRootRebuild"),
      sdkProof("proof client uses the pinned endpoint and returns directly usable fields"),
      sdkSafe("Safe helper ABI remains a canonical subset of the pinned Safe 1.4.1 artifact"),
      sdkSafe("decodes pinned indexed Safe success and failure transaction hashes"),
    ],
    artifacts:["out/SourceCoordinator.sol/SourceCoordinator.json","out/WorkTreasury.sol/WorkTreasury.json","out/PaidInvoiceBook.sol/PaidInvoiceBook.json"],
    evidence:["evidence/source-demo.json","evidence/public-demo.json","evidence/source-branches.json","evidence/public-branches.json","evidence/public-safe-rotation.json","evidence/native-recovery-verification-33642ef4.json"],
    observedStatus:"The source main and branch journals and the real read-only proof replacement are recorded; the current target and Safe-rotation journal states below determine the remaining product evidence.",
    pending:["Full target 120-unit journey is incomplete.","Target capacity/successor journey is incomplete.","Public Safe owner rotation is incomplete.","Attach the current-revision test execution result."],
  },
  {
    gate:"Consumer/users",
    requiredObservation:"Separate consumer rejects nonpayments; two consented independent settlements and repeat operation disclose actual assistance and control",
    tests:[
      target("test_consumerRejectsPendingFeeReturnAndWrongBuyerOrderAssetPolicy"),
      target("test_firstSuccessfulWithdrawalWinsBothOrderings_andConsumerRecordsActualDestination"),
    ],
    artifacts:["out/PaidInvoiceBook.sol/PaidInvoiceBook.json","out/WorkTreasury.sol/WorkTreasury.json"],
    evidence:["evidence/public-demo.json","evidence/public-branches.json","evidence/public-safe-rotation.json"],
    observedStatus:"Consumer rejection and completed-WORK behavior are executable local tests. All current public journals disclose team control and do not claim independent settlements.",
    pending:["Two consented independent settlements are not recorded.","Repeat independent operation without a target reservation operator is not recorded.","A real buyer reason is not recorded.","Attach the current-revision test execution result."],
  },
];

const productionSources=[
  "src/AllocationCodec.sol",
  "src/AllocationTree.sol",
  "src/NativeReceiptAuth.sol",
  "src/PaidInvoiceBook.sol",
  "src/SourceAccountingLib.sol",
  "src/SourceCoordinator.sol",
  "src/SourcePolicyV1Lib.sol",
  "src/SourceSignatureLib.sol",
  "src/SourceStorage.sol",
  "src/WorkTreasury.sol",
  "src/WorkTypes.sol",
];

const pinnedInputs=[
  "schema/schema-v1.json",
  "schema/schema-v1-vectors.json",
  "schema/identity-v1-vectors.json",
  "schema/work-authorization-v1.json",
  "schema/work-authorization-v1-vectors.json",
  "schema/work-authorization-conformance-v1.json",
  "verification/source-compiler-input.json",
  "docs/compiler.json",
  "foundry.toml",
  "package-lock.json",
];

function escapeRegExp(value:string):string{
  return value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}

async function readJson(path:string):Promise<any>{
  return JSON.parse(await readFile(resolve(ROOT,path),"utf8"));
}

async function readOptionalJson(path:string):Promise<any|null>{
  try{return await readJson(path);}catch(error:any){if(error.code==="ENOENT")return null;throw error;}
}

async function assertFile(path:string):Promise<void>{
  await readFile(resolve(ROOT,path));
}

async function validateTest(ref:TestRef):Promise<void>{
  const body=await readFile(resolve(ROOT,ref.file),"utf8");
  const expression=ref.framework==="foundry"
    ?new RegExp(`\\bfunction\\s+${escapeRegExp(ref.name)}\\s*\\(`)
    :new RegExp(`\\btest\\(\\s*[\"']${escapeRegExp(ref.name)}[\"']\\s*,`);
  if(!expression.test(body))throw new Error(`Missing exact test ${ref.file} :: ${ref.name}`);
}

async function hashPath(path:string,absolute=resolve(ROOT,path)){
  const bytes=await readFile(absolute);
  return {
    path,
    bytes:bytes.byteLength,
    sha256:`0x${createHash("sha256").update(bytes).digest("hex")}`,
    keccak256:keccak256(bytes),
  };
}

function operationSummary(operation:any,fallbackChain:"source"|"target"){
  const chain=operation.chain==="source"||operation.chain==="target"?operation.chain:fallbackChain;
  const transactionHash=operation.transactionHash??operation.outerTransactionHash??null;
  return {
    chain,
    chainId:chain==="source"?"11155111":"102031",
    label:operation.label??null,
    transactionHash,
    blockNumber:operation.blockNumber??null,
    gasUsed:operation.gasUsed===undefined?null:String(operation.gasUsed),
    receiptStatus:operation.status===undefined?null:Number(operation.status),
    receiptIdentifiers:{
      allocationOrdinals:operation.allocationOrdinals??[],
      checkpointOrdinals:operation.checkpointOrdinals??[],
      safeTransactionHash:operation.safe?.safeTransactionHash??null,
      safeExecutionSuccessOrdinal:operation.safe?.executionSuccessOrdinal??null,
    },
  };
}

function evidenceState(document:any):string|null{
  return document?.stage??document?.status??null;
}

async function journalSummary(path:string,fallbackChain:"source"|"target"){
  const document=await readOptionalJson(path);
  if(!document)return {path,present:false,state:null,scope:null,pendingTransaction:null,operations:[],semanticRefusals:[]};
  const pendingTransaction=document.pendingSourceTransaction??document.pendingTargetTransaction??document.pendingTransaction??null;
  const semanticRefusals=[...(document.refusals??[])];
  if(document.minedSemanticRefusal)semanticRefusals.push({...document.minedSemanticRefusal,observation:"Mined semantic refusal recorded separately from successful operations."});
  return {
    path,
    present:true,
    state:evidenceState(document),
    scope:document.scope??null,
    transactionJournalVersion:document.transactionJournalVersion??null,
    epochId:document.epochId??null,
    pendingTransaction,
    operations:(document.operations??[]).map((operation:any)=>operationSummary(operation,fallbackChain)),
    semanticRefusals,
  };
}

function countTests(body:string,framework:"foundry"|"node-test"):number{
  const expression=framework==="foundry"?/\bfunction\s+(?:test\w*|invariant_\w*)\s*\(/g:/\btest\(\s*["']/g;
  return [...body.matchAll(expression)].length;
}

async function main(){
  const lockBody=await readFile(LOCK,"utf8");
  for(const gate of gates){
    const row=`| ${gate.gate} | ${gate.requiredObservation} |`;
    if(!lockBody.includes(row))throw new Error(`Final lock gate changed or missing: ${gate.gate}`);
  }
  if(gates.length!==15)throw new Error(`Expected 15 final-lock gates, found ${gates.length}`);

  const productUpgradeTests=[
    foundry("test/WorkAuthorizationConformance.t.sol","WorkAuthorizationConformanceTest","testPortableAuthorizationMatchesSolidityAndFrozenQuoteDomain"),
    nodeTest("sdk/work-authorization.test.ts","fixed cross-language vector covers canonical termsHash and orderId"),
    nodeTest("sdk/work-authorization.test.ts","parser refuses changes to commercial, observation, order and domain commitments"),
  ];
  const uniqueTests=[...new Map([...gates.flatMap(gate=>gate.tests),...productUpgradeTests].map(test=>[`${test.file}\0${test.name}`,test])).values()];
  await Promise.all(uniqueTests.map(validateTest));
  const requiredFiles=[...new Set([...gates.flatMap(gate=>gate.artifacts),...productionSources,...pinnedInputs,DEPLOYMENTS,"evidence/public-refusal-checks.json"])];
  await Promise.all(requiredFiles.map(assertFile));

  const [{stdout:revision},{stdout:status},deploymentManifest,productionSourceHashes,pinnedInputHashes,compiledArtifacts,journals,nativeRecovery,releaseReadback,performanceEvidence,publicCi]=await Promise.all([
    execFileAsync("git",["rev-parse","HEAD"],{cwd:ROOT}),
    execFileAsync("git",["status","--porcelain=v1","--untracked-files=all"],{cwd:ROOT}),
    readJson(DEPLOYMENTS),
    Promise.all(productionSources.map(path=>hashPath(path))),
    Promise.all(pinnedInputs.map(path=>hashPath(path))),
    Promise.all([...new Set(gates.flatMap(gate=>gate.artifacts))].sort().map(path=>hashPath(path))),
    Promise.all([
      journalSummary("evidence/source-demo.json","source"),
      journalSummary("evidence/public-demo.json","target"),
      journalSummary("evidence/source-branches.json","source"),
      journalSummary("evidence/public-branches.json","target"),
      journalSummary("evidence/public-safe-rotation.json","source"),
    ]),
    readOptionalJson("evidence/native-recovery-verification-33642ef4.json"),
    readOptionalJson("evidence/release-readback.json"),
    readOptionalJson("evidence/local-performance.json"),
    readOptionalJson("evidence/public-ci.json"),
  ]);

  const implementationRevision=revision.trim();
  const refusalChecks=await readJson("evidence/public-refusal-checks.json");
  const ciAdministrativePaths=new Set(["evidence/public-ci.json","evidence/release-manifest.json"]);
  const dirtyEntries=status.split("\n").filter(Boolean);
  const dirtyImplementation=dirtyEntries.filter(entry=>!ciAdministrativePaths.has(entry.slice(3)));
  const currentRevisionCiPassed=Boolean(
    publicCi
    &&dirtyImplementation.length===0
    &&publicCi.status==="completed"
    &&publicCi.conclusion==="success"
    &&String(publicCi.headSha).toLowerCase()===implementationRevision.toLowerCase()
  );
  const journalByPath=new Map(journals.map(journal=>[journal.path,journal]));
  const mainTargetComplete=journalByPath.get("evidence/public-demo.json")?.state==="main-journey-complete";
  const branchTargetComplete=journalByPath.get("evidence/public-branches.json")?.state==="public-branches-and-expiry-complete";
  const safeRotationComplete=journalByPath.get("evidence/public-safe-rotation.json")?.state==="disposable-safe-rotation-complete";

  function resolvedPending(gate:GateDefinition):string[]{
    let pending=[...gate.pending];
    if(currentRevisionCiPassed)pending=pending.filter(item=>!item.startsWith("Attach the current-revision"));
    if(mainTargetComplete){
      pending=pending.filter(item=>item!=="Final public accounting and withdrawals are incomplete."&&item!=="Full target 120-unit journey is incomplete.");
    }
    if(branchTargetComplete){
      pending=pending.filter(item=>item!=="The public branch target journal is incomplete."&&item!=="Target capacity/successor journey is incomplete.");
    }
    if(mainTargetComplete&&branchTargetComplete){
      pending=pending.filter(item=>item!=="Public cross-route and mixed-kind evidence is incomplete."&&item!=="Public cached-root collection and receipt-without-siblings journeys are incomplete.");
    }
    if(safeRotationComplete)pending=pending.filter(item=>item!=="Public Safe owner rotation is incomplete.");
    return pending;
  }

  const deployedRuntimeRecords=(deploymentManifest.records??[]).map((record:any)=>({
    chain:record.chain,
    chainId:record.chain==="source"?deploymentManifest.source?.chainId:deploymentManifest.target?.chainId,
    name:record.name,
    address:record.address,
    deploymentTransactionHash:record.transactionHash,
    deploymentBlockNumber:record.blockNumber,
    deploymentGasUsed:record.gasUsed,
    runtimeBytes:record.runtimeBytes,
    deployedCodeHash:record.deployedCodeHash,
    matchesCompiledRuntimeOutsideImmutableSlots:record.matchesCompiledRuntimeOutsideImmutableSlots,
    libraries:record.libraries??{},
  }));
  for(const record of deployedRuntimeRecords){
    if(!isHexString(record.deployedCodeHash,32))throw new Error(`Invalid deployed runtime hash for ${record.chain}:${record.name}`);
    if(!isHexString(record.deploymentTransactionHash,32))throw new Error(`Invalid deployment transaction for ${record.chain}:${record.name}`);
  }

  const contractFiles=[...new Set(uniqueTests.filter(test=>test.framework==="foundry").map(test=>test.file))];
  const sdkFiles=[...new Set(uniqueTests.filter(test=>test.framework==="node-test").map(test=>test.file))];
  const [allContractFiles,allSdkFiles]=await Promise.all([
    readdir(resolve(ROOT,"test")).then(names=>Promise.all(names.filter(name=>name.endsWith(".t.sol")).map(name=>readFile(resolve(ROOT,"test",name),"utf8")))),
    readdir(resolve(ROOT,"sdk")).then(names=>Promise.all(names.filter(name=>name.endsWith(".test.ts")).map(name=>readFile(resolve(ROOT,"sdk",name),"utf8")))),
  ]);

  const manifest={
    schema:"proofkey.release-manifest.v1",
    generatedAt:new Date().toISOString(),
    releaseStatus:"pending",
    releaseBlockingReasons:[
      "Two consented independent settlements and repeat independent operation are not recorded.",
      "A real buyer reason is not recorded.",
      ...(!mainTargetComplete||!branchTargetComplete||!safeRotationComplete?["One or more public target or Safe-rotation journals are incomplete."]:[]),
      ...(!currentRevisionCiPassed?["No successful public CI evidence matches the current implementation revision."]:[]),
    ],
    reportedLimitations:[
      "The public traces are smaller than the local production-policy 113-leaf and production-tree 128-leaf tests.",
      "The local 1/4/16/32 target gas matrix excludes native verification; public journals supply actual native costs only for the forms they executed.",
      "The original standalone recovery report had unchanged continuity. The newer refusal/replacement report records a same-block older-proof refusal and changed-witness acceptance; this read-only observation does not guarantee future availability.",
    ],
    architectureLock:{
      section:"§11 Implementation sequence and acceptance gates",
      ...await hashPath(relative(ROOT,LOCK),LOCK),
      validatedGateCount:gates.length,
    },
    repository:{
      revision:implementationRevision,
      dirty:status.trim().length>0,
      dirtyEntries:status.trim()?status.trim().split("\n"):[],
    },
    validation:{
      testReferencesValidated:uniqueTests.length,
      artifactAndInputFilesValidated:requiredFiles.length,
      discoveredTests:{
        foundry:allContractFiles.reduce((sum,body)=>sum+countTests(body,"foundry"),0),
        nodeTest:allSdkFiles.reduce((sum,body)=>sum+countTests(body,"node-test"),0),
        counting:"Named test and invariant assertion functions; Foundry groups the four source invariants into one campaign in its execution total.",
      },
      mappedFiles:{foundry:contractFiles,nodeTest:sdkFiles},
      executionStatus:currentRevisionCiPassed?"passed-current-revision-public-ci":"not-verified-for-current-revision",
      note:currentRevisionCiPassed
        ?"The optional public CI record reports a completed successful run whose headSha exactly matches this implementation revision."
        :"Presence and exact-name validation is not a passing test result. Public CI must match this revision. Only the fetched public-ci.json record and generated release-manifest.json may differ; a prior CI pass cannot validate other uncommitted changes.",
    },
    reproduction:{
      allContracts:"npm run test:contracts",
      allSdk:"npm run test:sdk",
      typecheck:"npm run typecheck",
      productionSizes:"bash scripts/forge.sh build --sizes",
      generateManifest:"node scripts/release-manifest.ts",
    },
    productionSources:productionSourceHashes,
    pinnedInputs:pinnedInputHashes,
    compiledArtifacts,
    deploymentManifest:{
      path:DEPLOYMENTS,
      compiler:deploymentManifest.compiler,
      optimizerRuns:deploymentManifest.optimizerRuns,
      viaIR:deploymentManifest.viaIR,
      evmVersion:deploymentManifest.evmVersion,
      source:deploymentManifest.source,
      target:deploymentManifest.target,
      immutableReadback:deploymentManifest.immutableReadback,
      deployedRuntimeRecords,
      provenance:"Hashes and runtime-match flags are copied from the checked-in deployment manifest; this generator performs no network readback.",
    },
    localExecutableEvidence:{
      productUpgrade:{
        tests:productUpgradeTests,
        scope:"Canonical authorization commitments, order identity and quote domain/digest conformance. The Solidity vector test does not claim cross-language signature acceptance; signature rules are covered separately by SDK and production-source tests.",
        executionReport:"evidence/product-upgrade-validation/report.json",
        note:"Named test presence is not execution. The local execution report binds the exact input bytes it checked and does not establish public CI or independent adoption.",
      },
      verifierBoundary:"Performance and native adapter tests use a clearly labeled local VM stub at the production-fixed 0x0000000000000000000000000000000000000FD2 address.",
      nativeCostIncluded:false,
      reportedRun:{
        baselineRevision:"da0495d6475aa8d0ed533f47f369a6e0085f9a83",
        foundryPassed:46,
        nodeTestsPassed:15,
        invariantCampaign:{runs:128,depth:64,handlerCalls:8192,assertionFunctions:4,reverts:0,note:"Handler calls can be guarded no-ops; these are not 8,192 distinct financial state changes."},
        provenance:"Historical baseline release-session report, not the product upgrade test total. This generator does not execute tests or use this record to elevate gate status.",
      },
      performance:performanceEvidence,
      tests:uniqueTests,
    },
    publicCi:publicCi?{
      path:"evidence/public-ci.json",
      present:true,
      databaseId:publicCi.databaseId??null,
      url:publicCi.url??null,
      headSha:publicCi.headSha??null,
      status:publicCi.status??null,
      conclusion:publicCi.conclusion??null,
      jobs:publicCi.jobs??[],
      currentRevisionMatch:String(publicCi.headSha).toLowerCase()===implementationRevision.toLowerCase(),
      acceptedAsCurrentRevisionPass:currentRevisionCiPassed,
    }:{
      path:"evidence/public-ci.json",
      present:false,
      status:"pending",
      acceptedAsCurrentRevisionPass:false,
    },
    realNativeEvidence:nativeRecovery?{
      path:"evidence/native-recovery-verification-33642ef4.json",
      present:true,
      readOnly:nativeRecovery.readOnly,
      transaction:nativeRecovery.transaction,
      generator:nativeRecovery.generator,
      encodedTransaction:nativeRecovery.encodedTransaction,
      continuity:nativeRecovery.continuity,
      nativeSimulation:nativeRecovery.nativeSimulation,
      conclusion:nativeRecovery.conclusion,
      limitation:"Continuity was unchanged, so this proves provider-independent regeneration and native acceptance, not an aged or changed-witness recovery.",
    }:{path:"evidence/native-recovery-verification-33642ef4.json",present:false,status:"pending"},
    publicEvidence:{
      sourceExplorerVerification:{
        ...await hashPath("evidence/source-explorer-verification.json"),
        report:await readJson("evidence/source-explorer-verification.json"),
        scope:"Recorded public explorer readback, including explicit unverified contracts; not a fresh read made by this manifest generator.",
      },
      journals,
      refusalAndProofReplacement:{path:"evidence/public-refusal-checks.json",readOnly:refusalChecks.readOnly,
        targetBlock:refusalChecks.targetBlock,observations:refusalChecks.observations,
        proofReplacement:refusalChecks.proofReplacement?{comparison:refusalChecks.proofReplacement.comparison,
          priorRootCount:refusalChecks.proofReplacement.priorRootCount,replacementRootCount:refusalChecks.proofReplacement.replacementRootCount,
          priorProofOutcome:refusalChecks.proofReplacement.priorProofOutcome,replacementProofOutcome:refusalChecks.proofReplacement.replacementProofOutcome}:null},
      releaseReadback:releaseReadback?{
        path:"evidence/release-readback.json",
        present:true,
        checkedAt:releaseReadback.checkedAt??null,
        automatedJourneysComplete:releaseReadback.automatedJourneysComplete??null,
        summary:releaseReadback.summary??releaseReadback.status??null,
      }:{path:"evidence/release-readback.json",present:false,status:"pending"},
      explorers:{
        source:"https://sepolia.etherscan.io/tx/",
        target:"https://creditcoin-testnet.blockscout.com/tx/",
      },
      participantStatus:{
        status:"pending",
        independentSettlementsRecorded:0,
        required:2,
        disclosure:"All current public journals label Safe, worker, sponsor and relayers as team controlled. No independent settlement is claimed.",
      },
    },
    gates:gates.map((gate,index)=>{
      const pending=resolvedPending(gate);
      return {
        id:index+1,
        ...gate,
        evidence:gate.evidence.map(path=>({path,present:requiredFiles.includes(path)||journals.some(journal=>journal.path===path&&journal.present)||Boolean(nativeRecovery&&path==="evidence/native-recovery-verification-33642ef4.json")||Boolean(performanceEvidence&&path==="evidence/local-performance.json")})),
        pending,
        releaseGateStatus:pending.length?"pending":"observed",
      };
    }),
  };

  await writeFile(OUTPUT,`${JSON.stringify(manifest,null,2)}\n`);
  console.log(`Wrote ${relative(ROOT,OUTPUT)} for ${gates.length} locked gates at ${manifest.repository.revision}${manifest.repository.dirty?" (dirty)":""}.`);
  console.log(`Release remains pending: ${manifest.releaseBlockingReasons.join(" ")}`);
}

await main();
