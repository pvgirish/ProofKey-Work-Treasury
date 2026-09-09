import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, ZeroAddress, parseEther } from "ethers";
import { ROOT, loadEnvironment, required, testNetworks, signingWallet, artifact, saveReport, SOURCE_CHAIN_ID, SOURCE_CHAIN_KEY, TARGET_CHAIN_ID } from "./runtime.ts";
import { SOURCE_VERSION, SCHEMA_VERSION, POLICY_HASH, epochId } from "../sdk/identity.ts";
import { deserializeAllocation, rebuildAllocations, orderedProof } from "../sdk/allocation.ts";
import { runSourceBranches } from "./source-branches.ts";
import { fetchNativeBundle, singleProof, authenticatedPositions } from "./proofs.ts";

await loadEnvironment();
const {source,target}=await testNetworks();
try {await main();} finally {source.destroy();target.destroy();}
async function readOptional(path:string){try{return JSON.parse(await readFile(resolve(ROOT,path),"utf8"));}catch(e:any){if(e.code!=="ENOENT")throw e;return null;}}

async function main(){
  const deployment=await readOptional("deployments/testnet.json");
  if(!deployment?.target?.treasury)throw new Error("Deploy the pinned contracts first");
  const sponsor=signingWallet("CREDITCOIN_WALLET_PRIVATE_KEY",target), relayer=signingWallet("SEPOLIA_PRIVATE_KEY",source);
  const treasury=new Contract(deployment.target.treasury,(await artifact("WorkTreasury")).abi,sponsor);
  const coordinator=new Contract(deployment.source.coordinator,(await artifact("SourceCoordinator")).abi,relayer);
  let report=await readOptional("evidence/public-branches.json");
  const newConfig=async(cap:string,nonceOffset=0n,expiryOnly=false)=>{
    const height=BigInt(await source.getBlockNumber());
    return {sourceChainId:SOURCE_CHAIN_ID,sourceChainKey:SOURCE_CHAIN_KEY,sourceCoordinator:deployment.source.coordinator,sourceVersion:SOURCE_VERSION,targetChainId:TARGET_CHAIN_ID,targetTreasury:deployment.target.treasury,schemaVersion:SCHEMA_VERSION,sourceSafe:deployment.source.safe,sponsor:await sponsor.getAddress(),refundBeneficiary:await sponsor.getAddress(),asset:ZeroAddress,cap:parseEther(cap),policyHash:POLICY_HASH,initializationCutoff:height+(expiryOnly?4n:720n),admissionCutoff:height+7200n,maxMilestones:32,maxActiveReturns:16,maxDrainingReturns:33,treeDepth:7,nonce:BigInt(Date.now())+nonceOffset};
  };
  if(!report){const config=await newConfig("20");report={version:1,startedAt:new Date().toISOString(),scope:"All branch actors, committee and Safe are team controlled. Public native evidence; no independent user claimed.",config,epochId:epochId(config as any),stage:"funding-branch-epoch",operations:[]};await saveReport("public-branches.json",report);}
  if(report.config.targetTreasury.toLowerCase()!==deployment.target.treasury.toLowerCase())throw new Error("Branch report belongs to a different deployment");
  const persist=()=>saveReport("public-branches.json",report);
  const send=async(label:string,promise:Promise<any>,chain:"source"|"target"="target")=>{
    const tx=await promise;report.pending={label,chain,hash:tx.hash};await persist();
    const receipt=await tx.wait();if(!receipt||receipt.status!==1)throw new Error(`${label} failed`);
    const row={label,chain,transactionHash:tx.hash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed),status:1,logs:receipt.logs.map((log:any,ordinal:number)=>({ordinal,address:log.address,topics:Array.from(log.topics),data:log.data}))};
    report.operations.push(row);delete report.pending;await persist();console.log(`${label}: ${tx.hash}`);return row;
  };
  if(report.pending){
    const p=report.pending,rpc=p.chain==="source"?source:target,receipt=await rpc.getTransactionReceipt(p.hash);
    if(!receipt){console.log(`Waiting for recorded transaction ${p.hash}`);return;}
    if(receipt.status!==1)throw new Error(`Recorded ${p.label} transaction failed: ${p.hash}`);
    if(!report.operations.some((op:any)=>op.transactionHash===p.hash))report.operations.push({label:p.label,chain:p.chain,transactionHash:p.hash,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed),status:1,logs:receipt.logs.map((log:any,ordinal:number)=>({ordinal,address:log.address,topics:Array.from(log.topics),data:log.data})),recovered:true});
    delete report.pending;await persist();
  }
  if(!(await treasury.epochAccount(report.epochId)).funded)await send("fund-20-branch-epoch",treasury.fundEpoch(report.config,{value:report.config.cap}));
  if(!report.fundingFinalized){const block=await target.getBlock("finalized");if(!block||!(await treasury.epochAccount.staticCall(report.epochId,{blockTag:block.number})).funded){report.stage="awaiting-finalized-branch-funding";await persist();console.log(report.stage);return;}report.fundingFinalized={blockNumber:block.number,hash:block.hash};await persist();}
  let sourceReport=await readOptional("evidence/source-branches.json");
  if(sourceReport?.status!=="source-branches-complete-awaiting-target-proofing")sourceReport=await runSourceBranches({source,coordinator:deployment.source.coordinator,safe:deployment.source.safe,epochConfig:report.config,epochId:report.epochId,workerKey:required("NEW_OWNER_PRIVATE_KEY"),existing:sourceReport??undefined});
  const fixture=sourceReport.orders["committee-quorum"].receiptOnlyFixture;
  const final=sourceReport.operations.findLast((op:any)=>op.checkpointOrdinals.length>0);
  if(!fixture||!final)throw new Error("Missing exact receipt-only quorum fixture");
  if(!report.nativeBundles){
    const quorum=await fetchNativeBundle(source,target,[fixture.transactionHash]);
    if(!quorum.ready){report.stage="awaiting-branch-native-attestation";report.wait=quorum;await persist();console.log(JSON.stringify(quorum));return;}
    const last=await fetchNativeBundle(source,target,[final.transactionHash]);
    if(!last.ready){report.stage="awaiting-branch-native-attestation";report.wait=last;await persist();console.log(JSON.stringify(last));return;}
    report.nativeBundles={quorum,last};await persist();
  }
  const proofs=[report.nativeBundles.quorum.proofs[0],report.nativeBundles.last.proofs[0]];
  const pos=(p:any)=>({blockHeight:p.blockHeight,transactionIndex:p.transactionIndex});
  if(!report.segmentedAuthenticated){await send("native-segmented-authenticate-quorum-and-final",treasury.authenticateSegmented(proofs.map(singleProof)));report.positions=await authenticatedPositions(treasury,proofs);report.segmentedAuthenticated=true;await persist();}
  const work=fixture.work,fee=fixture.fee;
  for(const [kind,item] of [["WORK",work],["FEE",fee]] as const){
    const allocationId=BigInt(item.treeIndex)+1n;
    if(!await treasury.recognizedEconomicId(await treasury.economicId(report.epochId,allocationId))){
      if(await treasury.latestCheckpointId(report.epochId)!=="0x"+"00".repeat(32))throw new Error("Receipt-only fixture requires no imported application checkpoint");
      await send(`receipt-only-recognize-${kind}-without-root-or-siblings`,treasury.recognizeFromReceipt(pos(report.positions[0]),proofs[0].encodedTransaction,item.receiptLogOrdinal));
    }
  }
  report.receiptOnlyRecovery={nativeTransaction:fixture.transactionHash,workAllocationId:String(BigInt(work.treeIndex)+1n),feeAllocationId:String(BigInt(fee.treeIndex)+1n),applicationCheckpointRequired:false,applicationSiblingsSupplied:false,applicationGettersUsedForRecognition:false};await persist();
  if(!report.checkpointId){await send("import-cached-final-branch-checkpoint",treasury.importCheckpoint(pos(report.positions[1]),proofs[1].encodedTransaction,final.checkpointOrdinals.at(-1)));const id=await treasury.authenticationId(pos(report.positions[1]),report.positions[1].encodedTransactionHash);report.checkpointId=await treasury.selectedLogId(id,final.checkpointOrdinals.at(-1));await persist();}
  const allocations=sourceReport.readback.allocations.map(deserializeAllocation),rebuilt=rebuildAllocations(allocations),checkpoint=await treasury.checkpoint(report.checkpointId);
  if(rebuilt.root.toLowerCase()!==checkpoint.checkpoint.root.toLowerCase())throw new Error("Branch public-leaf rebuild mismatch");
  for(const allocation of allocations){if(!await treasury.recognizedEconomicId(await treasury.economicId(report.epochId,allocation.allocationId)))await send(`branch-root-recognize-${allocation.allocationId}`,treasury.recognizeFromCheckpoint(report.checkpointId,allocation,orderedProof(rebuilt.leaves,allocation.treeIndex)));if(allocation.kind!==3&&!(await treasury.claim(report.epochId,allocation.allocationId)).withdrawn)await send(`branch-withdraw-${allocation.allocationId}`,treasury.withdrawFor(report.epochId,allocation.allocationId));}
  if(!report.successor){const config=await newConfig("1",1n,true);report.successor={config,epochId:epochId(config as any)};await persist();}
  const next=report.successor;
  if(!(await treasury.epochAccount(next.epochId)).funded)await send("fund-successor-from-returned-free-balance",treasury.fundEpochFromFree(next.config));
  const current=BigInt(await source.getBlockNumber());
  if(current<BigInt(next.config.initializationCutoff)){report.stage="awaiting-source-expiry-block";await persist();console.log(report.stage);return;}
  let expiryOperation=report.operations.find((op:any)=>op.label==="materialize-uninitialized-source-expiry");
  if(!expiryOperation)expiryOperation=await send("materialize-uninitialized-source-expiry",coordinator.expireUninitializedEpoch(next.config),"source");
  if(!report.expiryBundle){const bundle=await fetchNativeBundle(source,target,[expiryOperation.transactionHash]);if(!bundle.ready){report.stage="awaiting-expiry-native-attestation";report.wait=bundle;await persist();console.log(JSON.stringify(bundle));return;}report.expiryBundle=bundle;await persist();}
  const expiryProof=report.expiryBundle.proofs[0];
  const ordinal=expiryOperation.logs.find((log:any)=>log.address.toLowerCase()===deployment.source.coordinator.toLowerCase()&&coordinator.interface.parseLog({topics:log.topics,data:log.data})?.name==="AllocationCreated")?.ordinal;
  if(ordinal===undefined)throw new Error("Expiry receipt has no canonical source allocation");
  if(!await treasury.recognizedEconomicId(await treasury.economicId(next.epochId,1)))await send("native-single-recognize-proven-expiry-return",treasury.authenticateAndRecognizeReceipt(singleProof(expiryProof),ordinal));
  if(!report.refundWithdrawn){const old=report.operations.find((op:any)=>op.label==="withdraw-branch-and-successor-return-11");if(!old)await send("withdraw-branch-and-successor-return-11",treasury.withdrawFreeFor(report.config.refundBeneficiary,parseEther("11")));report.refundWithdrawn=true;await persist();}
  for(const id of [report.epochId,next.epochId])if((await treasury.epochAccount(id)).reserve!==0n)throw new Error("Branch/successor reserves not fully recognized");
  report.stage="public-branches-and-expiry-complete";report.completedAt=new Date().toISOString();delete report.wait;await persist();
  console.log("Public policy branches, receipt-only WORK/FEE, segmented authentication, successor reuse and proven expiry refund complete.");
}
