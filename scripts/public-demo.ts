import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, Wallet, ZeroAddress, parseEther, keccak256 } from "ethers";
import { ROOT, loadEnvironment, required, testNetworks, signingWallet, artifact, saveReport, deploy, SOURCE_CHAIN_ID, SOURCE_CHAIN_KEY, TARGET_CHAIN_ID } from "./runtime.ts";
import { SOURCE_VERSION, SCHEMA_VERSION, POLICY_HASH, NATIVE_PROFILE, epochId } from "../sdk/identity.ts";
import { deserializeAllocation, serializeAllocation, rebuildAllocations, orderedProof } from "../sdk/allocation.ts";
import { stringifyClaimPackage } from "../sdk/claim-package.ts";
import { CLAIM_PACKAGE_VERSION } from "../sdk/types.ts";
import { runSourceDemo, SOURCE_TRANSACTION_JOURNAL_VERSION } from "./source-demo.ts";
import { fetchNativeBundle, singleProof, authenticatedPositions } from "./proofs.ts";

await loadEnvironment();
const {source,target}=await testNetworks();
try { await main(); } finally {source.destroy();target.destroy();}

async function readOptional(name:string) {
  try {return JSON.parse(await readFile(resolve(ROOT,name),"utf8"));} catch(e:any) {if(e.code!=="ENOENT") throw e; return null;}
}

async function main() {
  const deployment=await readOptional("deployments/testnet.json");
  if(!deployment?.target?.treasury) throw new Error("Deploy the pinned contracts first");
  const signer=signingWallet("CREDITCOIN_WALLET_PRIVATE_KEY",target);
  const treasury=new Contract(deployment.target.treasury,(await artifact("WorkTreasury")).abi,signer);
  const coordinator=new Contract(deployment.source.coordinator,(await artifact("SourceCoordinator")).abi,source);
  const workerKey=required("NEW_OWNER_PRIVATE_KEY");
  const worker=new Wallet(workerKey);
  let report=await readOptional("evidence/public-demo.json");
  if(!report) {
    const height=BigInt(await source.getBlockNumber());
    const config:any={sourceChainId:SOURCE_CHAIN_ID,sourceChainKey:SOURCE_CHAIN_KEY,sourceCoordinator:deployment.source.coordinator,sourceVersion:SOURCE_VERSION,
      targetChainId:TARGET_CHAIN_ID,targetTreasury:deployment.target.treasury,schemaVersion:SCHEMA_VERSION,sourceSafe:deployment.source.safe,
      sponsor:await signer.getAddress(),refundBeneficiary:await signer.getAddress(),asset:ZeroAddress,cap:parseEther("120"),policyHash:POLICY_HASH,
      initializationCutoff:height+720n,admissionCutoff:height+7200n,maxMilestones:32,maxActiveReturns:16,maxDrainingReturns:33,treeDepth:7,nonce:BigInt(Date.now())};
    report={version:1,startedAt:new Date().toISOString(),scope:"Public testnet; Safe, worker, sponsor and relayers are team controlled. No independent settlement is claimed.",config,epochId:epochId(config),worker:worker.address,operations:[],stage:"funding"};
    await saveReport("public-demo.json",report);
  }
  if(report.config.sourceCoordinator.toLowerCase()!==deployment.source.coordinator.toLowerCase()||report.config.targetTreasury.toLowerCase()!==deployment.target.treasury.toLowerCase()) throw new Error("Demo belongs to a different deployment");
  const persist=()=>saveReport("public-demo.json",report);
  const receiptRecord=(label:string,receipt:any)=>({label,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed),status:Number(receipt.status),logs:receipt.logs.map((log:any,ordinal:number)=>({ordinal,address:log.address,topics:Array.from(log.topics),data:log.data}))});
  const restoreReturn50Chronology=async(record:any,precondition:any,reconciled:boolean)=>{
    if(!precondition||BigInt(precondition.sourceUnresolved)!==parseEther("40")||BigInt(precondition.sourceEarned)!==parseEther("30")) throw new Error("RETURN50 transaction lacks the persisted unresolved-B source precondition");
    const targetAccount=await treasury.epochAccount(report.epochId);
    report.return50BeforeB={targetTransactionHash:record.transactionHash,targetBlock:record.blockNumber,observedSourceBlock:precondition.sourceBlockNumber,observedSourceBlockHash:precondition.sourceBlockHash,sourceUnresolved:precondition.sourceUnresolved,sourceEarned:precondition.sourceEarned,targetRecognized:String(targetAccount.recognized),journalBackedPrecondition:true,reconciledFromPendingJournal:reconciled};
  };
  const finalizePending=async(pending:any,receipt:any,reconciled=false)=>{
    const actualStatus=Number(receipt.status),expectedStatus=Number(pending.expectedStatus??1);
    if(actualStatus!==expectedStatus) {
      report.failedTransactions??=[];
      report.failedTransactions.push({label:pending.label,transactionHash:pending.hash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed),actualStatus,expectedStatus,observedAt:new Date().toISOString()});
      delete report.pendingTransaction;await persist();
      throw new Error(`Target transaction ${pending.label} mined with status ${actualStatus}; expected ${expectedStatus}: ${pending.hash}`);
    }
    if(expectedStatus===0) {
      report.minedSemanticRefusal={transactionHash:pending.hash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed),status:0,expectedSelector:pending.expectedSelector,description:pending.description,reconciledFromPendingJournal:reconciled};
      delete report.pendingTransaction;await persist();
      return report.minedSemanticRefusal;
    }
    const record=receiptRecord(pending.label,receipt);
    if(!report.operations.some((operation:any)=>operation.transactionHash.toLowerCase()===pending.hash.toLowerCase())) report.operations.push(record);
    if(pending.label==="receipt-recognize-return50-with-B-unresolved"&&!report.return50BeforeB) await restoreReturn50Chronology(record,pending.precondition,reconciled);
    delete report.pendingTransaction;await persist();
    return record;
  };
  const reconcilePending=async()=>{
    const pending=report.pendingTransaction;if(!pending)return;
    if(String(pending.chainId)!==String(TARGET_CHAIN_ID)) throw new Error(`Pending transaction belongs to unexpected chain ${pending.chainId}`);
    const receipt=await target.getTransactionReceipt(pending.hash);
    if(!receipt) throw new Error(`Target transaction ${pending.label} is still pending or unavailable; inspect ${pending.hash} before rerunning and do not submit a duplicate`);
    await finalizePending(pending,receipt,true);
    console.log(`${pending.label}: reconciled ${pending.hash} (${receipt.gasUsed} gas)`);
  };
  const send=async(label:string,promise:Promise<any>,precondition?:any)=>{
    const tx=await promise;
    report.pendingTransaction={label,hash:tx.hash,chainId:String(TARGET_CHAIN_ID),expectedStatus:1,precondition}; await persist();
    let receipt:any;try{receipt=await tx.wait();}catch(error:any){receipt=error.receipt;if(!receipt)throw error;}
    const record=await finalizePending(report.pendingTransaction,receipt);
    console.log(`${label}: ${tx.hash} (${receipt.gasUsed} gas)`);
    return record;
  };
  await reconcilePending();
  let account=await treasury.epochAccount(report.epochId);
  if(!account.funded) await send("fund-exact-120-epoch",treasury.fundEpoch(report.config,{value:report.config.cap}));
  if(!report.fundingFinalized) {
    const block=await target.getBlock("finalized");
    if(!block) throw new Error("Target RPC must expose finalized funding before binding source consent");
    const finalizedAccount=await treasury.epochAccount.staticCall(report.epochId,{blockTag:block.number});
    if(!finalizedAccount.funded) {report.stage="awaiting-finalized-target-funding";await persist();console.log(report.stage);return;}
    const fundedConfig=await treasury.epochConfig.staticCall(report.epochId,{blockTag:block.number});
    if(await coordinator.computeEpochId(fundedConfig.toObject())!==report.epochId) throw new Error("Finalized target funding does not match source agreement");
    report.fundingFinalized={blockNumber:block.number,blockHash:block.hash,observedAt:new Date().toISOString(),reserve:String(finalizedAccount.reserve)}; await persist();
  }
  let sourceReport=await readOptional("evidence/source-demo.json");
  if(SOURCE_TRANSACTION_JOURNAL_VERSION!==1||sourceReport&&sourceReport.transactionJournalVersion!==SOURCE_TRANSACTION_JOURNAL_VERSION) throw new Error("Source transaction journal is unavailable or incompatible; source execution remains gated");
  if(!sourceReport?.stages?.awaitingReturn50Recognition) sourceReport=await runSourceDemo({source,coordinator:deployment.source.coordinator,safe:deployment.source.safe,epochConfig:report.config,epochId:report.epochId,workerKey,existing:sourceReport??undefined});
  if(sourceReport.transactionJournalVersion!==SOURCE_TRANSACTION_JOURNAL_VERSION) throw new Error("Source runner did not persist its transaction journal version");
  const sourceOperation=(label:string)=>{
    const found=sourceReport.operations.find((op:any)=>op.label===label);if(!found)throw new Error(`Missing source receipt ${label}`);return found;
  };
  const a=sourceOperation("approve-A"), release50=sourceOperation("release-free-50");
  if(!report.firstNativeBundle) {
    const bundle=await fetchNativeBundle(source,target,[a.transactionHash,release50.transactionHash]);
    if(!bundle.ready) {report.stage="awaiting-first-native-attestation";report.wait=bundle;await persist();console.log(JSON.stringify(bundle));return;}
    report.firstNativeBundle=bundle;await persist();
  }
  const first=report.firstNativeBundle;
  if(!report.firstNativeAuthenticated) {
    await send("native-batch-authenticate-A-and-return50",treasury.authenticateBatch(first.proofs.map((p:any)=>p.blockHeight),first.proofs.map((p:any)=>p.encodedTransaction),first.proofs.map((p:any)=>p.merkleProof),first.continuityProof));
    report.firstPositions=await authenticatedPositions(treasury,first.proofs);report.firstNativeAuthenticated=true;await persist();
  }
  const position=(p:any)=>({blockHeight:p.blockHeight,transactionIndex:p.transactionIndex});
  if(!await treasury.recognizedEconomicId(await treasury.economicId(report.epochId,2))) {
    const sourceBlock=await source.getBlock("latest");if(!sourceBlock)throw new Error("Missing source block before RETURN50 recognition");
    const before=await coordinator.epochState.staticCall(report.epochId,{blockTag:sourceBlock.number});
    if(before.unresolved!==parseEther("40")||before.earned!==parseEther("30")) throw new Error("RETURN50 must be recognized while B is still unresolved");
    const precondition={sourceBlockNumber:sourceBlock.number,sourceBlockHash:sourceBlock.hash,sourceUnresolved:String(before.unresolved),sourceEarned:String(before.earned),observedAt:new Date().toISOString()};
    await send("receipt-recognize-return50-with-B-unresolved",treasury.recognizeFromReceipt(position(report.firstPositions[1]),first.proofs[1].encodedTransaction,release50.allocationOrdinals[0]),precondition);
  }
  if(process.argv.includes("--stop-after-return50")) {
    report.stage="first-native-return-complete-awaiting-source-resume";await persist();
    console.log("Native batch authentication and RETURN50 recognition complete; source B remains unresolved.");return;
  }
  if(!sourceReport.stages.sourceComplete) sourceReport=await runSourceDemo({source,coordinator:deployment.source.coordinator,safe:deployment.source.safe,epochConfig:report.config,epochId:report.epochId,workerKey,existing:sourceReport,resumeAfterReturn50:true});
  const finalOperation=sourceOperation("sweep-final-15");
  if(!report.finalNativeBundle) {
    const bundle=await fetchNativeBundle(source,target,[finalOperation.transactionHash]);
    if(!bundle.ready) {report.stage="awaiting-final-native-attestation";report.wait=bundle;await persist();console.log(JSON.stringify(bundle));return;}
    report.finalNativeBundle=bundle;await persist();
  }
  const finalProof=report.finalNativeBundle.proofs[0];
  if(!report.checkpointId) {
    await send("native-single-import-final-checkpoint",treasury.authenticateCheckpoint(singleProof(finalProof),finalOperation.checkpointOrdinals.at(-1)));
    report.finalPosition=(await authenticatedPositions(treasury,[finalProof]))[0];
    const authId=await treasury.authenticationId(position(report.finalPosition),keccak256(finalProof.encodedTransaction));
    report.checkpointId=await treasury.selectedLogId(authId,finalOperation.checkpointOrdinals.at(-1));await persist();
  }
  const checkpoint=await treasury.checkpoint(report.checkpointId);
  const allocations=sourceReport.readback.allocations.map(deserializeAllocation);
  const rebuilt=rebuildAllocations(allocations);
  if(rebuilt.root.toLowerCase()!==checkpoint.checkpoint.root.toLowerCase()||allocations.length!==Number(checkpoint.checkpoint.leafCount)) throw new Error("Independent public-leaf rebuild does not match native-authenticated final checkpoint");
  report.independentRebuild={root:rebuilt.root,leafCount:allocations.length,sourceReadBlock:sourceReport.readback.blockNumber,matchesAuthenticatedCheckpoint:true};
  // The remaining collection phase makes no proof service request and needs no new native authentication.
  report.cachedCollectionStartedAt??=new Date().toISOString();await persist();
  for(const allocation of allocations) {
    const pkg:any={version:CLAIM_PACKAGE_VERSION,route:"checkpoint",createdAt:new Date().toISOString(),allocation:serializeAllocation(allocation),siblings:orderedProof(rebuilt.leaves,allocation.treeIndex),checkpoint:{checkpointId:report.checkpointId,root:rebuilt.root,leafCount:allocations.length}};
    await writeFile(resolve(ROOT,`evidence/claim-${allocation.allocationId}.json`),stringifyClaimPackage(pkg)+"\n");
    if(!await treasury.recognizedEconomicId(await treasury.economicId(report.epochId,allocation.allocationId))) await send(`cached-root-recognize-${allocation.allocationId}`,treasury.recognizeFromCheckpoint(report.checkpointId,allocation,pkg.siblings));
    if(allocation.kind===1 && !(await treasury.claim(report.epochId,allocation.allocationId)).withdrawn) await send(`withdraw-work-${allocation.allocationId}`,treasury.withdrawFor(report.epochId,allocation.allocationId));
  }
  if(!report.replayChecks) {
    const refuses=async(fn:()=>Promise<any>,expected:string)=>{try{await fn();}catch(error:any){const data=error.data??error.info?.error?.data;const parsed=data?treasury.interface.parseError(data):null;if(parsed?.name!==expected)throw error;return {expectedError:expected,selector:data.slice(0,10)};}throw new Error(`Expected ${expected} refusal`);};
    const rootToReceipt=await refuses(()=>treasury.recognizeFromReceipt.staticCall(position(report.firstPositions[0]),first.proofs[0].encodedTransaction,a.allocationOrdinals[0]),"EconomicRightAlreadyRecognized");
    const receiptToRoot=await refuses(()=>treasury.recognizeFromCheckpoint.staticCall(report.checkpointId,allocations[1],orderedProof(rebuilt.leaves,1)),"EconomicRightAlreadyRecognized");
    report.replayChecks={rootToReceipt,receiptToRoot,observedAt:new Date().toISOString()}; await persist();
  }
  if(!report.minedSemanticRefusal) {
    // Already-authenticated, correct-source checkpoint bytes are not an AllocationCreated payment fact.
    const args=[position(report.finalPosition),finalProof.encodedTransaction,finalOperation.checkpointOrdinals.at(-1)];
    if(!await treasury.isAuthenticated(position(report.finalPosition),finalProof.encodedTransaction)) throw new Error("Semantic refusal requires persisted native authentication of these exact receipt bytes");
    const invalidEncodingError=treasury.interface.getError("InvalidEncoding");if(!invalidEncodingError)throw new Error("Compiled treasury ABI is missing InvalidEncoding");
    const expectedSelector=invalidEncodingError.selector;
    try {await treasury.recognizeFromReceipt.staticCall(...args);throw new Error("Wrong event unexpectedly accepted");} catch(error:any) {const data=error.data??error.info?.error?.data;if(!data||data==="0x"||data.slice(0,10).toLowerCase()!==expectedSelector.toLowerCase())throw new Error(`Semantic refusal returned an unexpected error selector: ${data??"missing"}`);}
    const tx=await treasury.recognizeFromReceipt(...args,{gasLimit:500000});
    const description="Persisted native authentication and correct source emitter; checkpoint event refused as an allocation payment fact";
    report.pendingTransaction={label:"mined-semantic-refusal",hash:tx.hash,chainId:String(TARGET_CHAIN_ID),expectedStatus:0,expectedSelector,description};await persist();
    let receipt:any;try {receipt=await tx.wait();} catch(error:any) {receipt=error.receipt;if(!receipt)throw error;}
    await finalizePending(report.pendingTransaction,receipt);
  }
  if(!report.invoiceBook) {
    const result=await deploy("PaidInvoiceBook",signer,[deployment.target.treasury,deployment.source.safe,sourceReport.orders.a.orderId,ZeroAddress,POLICY_HASH]);
    report.invoiceBook=result.record;await persist();
  }
  const book=new Contract(report.invoiceBook.address,(await artifact("PaidInvoiceBook")).abi,signer);
  if(!(await book.invoice(report.epochId,1)).recorded) await send("record-actually-paid-WORK-in-consumer",book.recordPaidWork(report.epochId,1));
  if(!report.freeWithdrawn && report.operations.some((op:any)=>op.label==="withdraw-returned-65")) {
    report.freeWithdrawn=true;await persist();
  }
  if(!report.freeWithdrawn) {
    const free=await treasury.freeBalance(report.config.refundBeneficiary);
    if(free<parseEther("65")) throw new Error("Expected at least 65 CTC returned free balance");
    await send("withdraw-returned-65",treasury.withdrawFreeFor(report.config.refundBeneficiary,parseEther("65")));
    report.freeWithdrawn=true;await persist();
  }
  account=await treasury.epochAccount(report.epochId);
  if(account.reserve!==0n||account.recognized!==parseEther("120")) throw new Error("Final target epoch accounting mismatch");
  const deposits=await treasury.totalCreditedDeposits(),liabilities=await treasury.liveLiabilities(),withdrawals=await treasury.cumulativeWithdrawals();
  if(deposits!==liabilities+withdrawals)throw new Error("Global treasury conservation mismatch");
  report.finalTarget={reserve:String(account.reserve),recognized:String(account.recognized),totalCreditedDeposits:String(deposits),liveLiabilities:String(liabilities),cumulativeWithdrawals:String(withdrawals),balance:String(await target.getBalance(deployment.target.treasury))};
  report.stage="main-journey-complete";report.completedAt=new Date().toISOString();delete report.wait;await persist();
  await writeFile(resolve(ROOT,"deployments/ui-testnet.json"),JSON.stringify({source:deployment.source,target:{...deployment.target,invoiceBook:report.invoiceBook.address},lastEpochId:report.epochId,proofServiceUrl:process.env.PROOF_BUILDER_URL??"https://prover.cc3-testnet.creditcoin.network",scope:report.scope},null,2)+"\n");
  console.log("Public main journey complete: earned/withdrawn 55 CTC; returned/withdrawn 65 CTC. Team-controlled actors disclosed.");
}
