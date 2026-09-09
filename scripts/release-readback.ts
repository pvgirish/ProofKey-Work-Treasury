import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, formatEther } from "ethers";
import { ROOT, artifact, loadEnvironment, saveReport, testNetworks } from "./runtime.ts";
import { deserializeAllocation, hashAllocation, rebuildAllocations } from "../sdk/allocation.ts";
import type { AllocationV1, SerializedAllocationV1 } from "../sdk/types.ts";

function allocationFromResult(value:any):AllocationV1 {
  const serialized:SerializedAllocationV1={
    epochId:String(value.epochId) as `0x${string}`,
    allocationId:String(value.allocationId),
    treeIndex:Number(value.treeIndex),
    kind:Number(value.kind),
    orderId:String(value.orderId) as `0x${string}`,
    milestoneId:Number(value.milestoneId),
    role:Number(value.role),
    asset:String(value.asset) as `0x${string}`,
    amount:String(value.amount),
    claimOwner:String(value.claimOwner) as `0x${string}`,
    destination:String(value.destination) as `0x${string}`,
    policyHash:String(value.policyHash) as `0x${string}`,
    evidenceHash:String(value.evidenceHash) as `0x${string}`,
  };
  return deserializeAllocation(serialized);
}

// Read-only finality and conservation audit. No signing wallet is constructed.
await loadEnvironment();
const {source,target}=await testNetworks();
try {
  const read=async(path:string)=>JSON.parse(await readFile(resolve(ROOT,path),"utf8"));
  const deployment=await read("deployments/testnet.json");
  const sourceContract=new Contract(deployment.source.coordinator,(await artifact("SourceCoordinator")).abi,source);
  const treasury=new Contract(deployment.target.treasury,(await artifact("WorkTreasury")).abi,target);
  const [sourceBlock,targetBlock]=await Promise.all([source.getBlock("finalized"),target.getBlock("finalized")]);
  if(!sourceBlock?.hash||!targetBlock?.hash)throw new Error("Both RPCs must expose finalized blocks");
  const sourceTag={blockTag:sourceBlock.number},targetTag={blockTag:targetBlock.number};
  const report:any={version:1,checkedAt:new Date().toISOString(),scope:"Public testnet, read-only finalized state. All built-in demo actors are team controlled; independent-user and buyer gates remain pending.",sourceBlock:{number:sourceBlock.number,hash:sourceBlock.hash},targetBlock:{number:targetBlock.number,hash:targetBlock.hash},epochs:[]};
  const observedEpochIds=new Set<string>();
  const manifests=["public-demo.json","public-branches.json","public-safe-rotation.json"];
  for(const filename of manifests){
    let journal:any;
    try {journal=await read(`evidence/${filename}`);}catch(error:any){if(error.code!=="ENOENT")throw error;report.epochs.push({journal:filename,status:"not-run"});continue;}
    const ids=[journal.epochId,...(journal.successor?[journal.successor.epochId]:[])];
    for(const id of ids){
      if(typeof id!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(id))throw new Error(`${filename} contains an invalid epoch ID`);
      if(observedEpochIds.has(id.toLowerCase()))throw new Error(`Duplicate public epoch ${id}`);
      observedEpochIds.add(id.toLowerCase());
      const [account,state,config,targetConfig]=await Promise.all([treasury.epochAccount.staticCall(id,targetTag),sourceContract.epochState.staticCall(id,sourceTag),sourceContract.epochConfig.staticCall(id,sourceTag),treasury.epochConfig.staticCall(id,targetTag)]);
      if(!account.funded)throw new Error(`Epoch ${id} is not finalized-funded`);
      const [sourceConfigId,targetConfigId]=await Promise.all([
        sourceContract.computeEpochId.staticCall(config.toObject(),sourceTag),
        sourceContract.computeEpochId.staticCall(targetConfig.toObject(),sourceTag),
      ]);
      if(sourceConfigId.toLowerCase()!==id.toLowerCase()||targetConfigId.toLowerCase()!==id.toLowerCase())throw new Error(`Source/target epoch configuration identity failed for ${id}`);
      const total=state.available+state.unresolved+state.earned+state.returned;
      if(total!==config.cap)throw new Error(`Source conservation failed for ${id}`);
      if(account.reserve+account.recognized!==config.cap)throw new Error(`Target conservation failed for ${id}`);
      const allocations:AllocationV1[]=[];
      for(let index=0;index<Number(state.leafCount);index++){
        const allocation=await sourceContract.allocationAt.staticCall(id,index,sourceTag);
        allocations.push(allocationFromResult(allocation));
      }
      const rebuilt=rebuildAllocations(allocations);
      if(rebuilt.root.toLowerCase()!==state.root.toLowerCase())throw new Error(`Finalized public-leaf reconstruction failed for ${id}`);
      const allocatedEarned=allocations.filter(allocation=>allocation.kind!==3).reduce((sum,allocation)=>sum+allocation.amount,0n);
      const allocatedReturned=allocations.filter(allocation=>allocation.kind===3).reduce((sum,allocation)=>sum+allocation.amount,0n);
      if(allocatedEarned!==state.earned||allocatedReturned!==state.returned)throw new Error(`Allocation totals disagree with source epoch state for ${id}`);
      const claims=[];
      for(const allocation of allocations){
        const economicId=await treasury.economicId.staticCall(id,allocation.allocationId,targetTag);
        const recognized=await treasury.recognizedEconomicId.staticCall(economicId,targetTag);
        const claim=allocation.kind===3?null:await treasury.claim.staticCall(id,allocation.allocationId,targetTag);
        if(recognized){
          const targetAllocation=allocation.kind===3
            ?allocationFromResult(await treasury.recognizedAllocation.staticCall(id,allocation.allocationId,targetTag))
            :allocationFromResult(claim.allocation);
          if(hashAllocation(targetAllocation)!==hashAllocation(allocation))throw new Error(`Recognized target allocation differs from source allocation ${allocation.allocationId}`);
        }
        claims.push({allocationId:String(allocation.allocationId),kind:allocation.kind,amountCTC:formatEther(allocation.amount),recognized,recognitionMatchesSource:recognized,withdrawn:claim?claim.withdrawn:null});
      }
      report.epochs.push({journal:filename,epochId:id,capCTC:formatEther(config.cap),source:{availableCTC:formatEther(state.available),unresolvedCTC:formatEther(state.unresolved),earnedCTC:formatEther(state.earned),returnedCTC:formatEther(state.returned),phase:Number(state.phase),leafCount:Number(state.leafCount),root:state.root,independentRebuildMatches:true},target:{reserveCTC:formatEther(account.reserve),recognizedCTC:formatEther(account.recognized)},claims,complete:Number(state.phase)===3&&account.reserve===0n&&claims.every(claim=>claim.recognized&&(claim.withdrawn??true))});
    }
  }
  const [deposits,freeLiability,reserveLiability,claimLiability,liabilities,withdrawals,balance]=await Promise.all([treasury.totalCreditedDeposits.staticCall(targetTag),treasury.totalFreeLiability.staticCall(targetTag),treasury.totalReserveLiability.staticCall(targetTag),treasury.totalClaimLiability.staticCall(targetTag),treasury.liveLiabilities.staticCall(targetTag),treasury.cumulativeWithdrawals.staticCall(targetTag),target.getBalance(deployment.target.treasury,targetBlock.number)]);
  if(liabilities!==freeLiability+reserveLiability+claimLiability||deposits!==liabilities+withdrawals||balance<liabilities)throw new Error("Global target conservation or solvency failed");
  report.global={creditedDepositsCTC:formatEther(deposits),freeLiabilityCTC:formatEther(freeLiability),reserveLiabilityCTC:formatEther(reserveLiability),claimLiabilityCTC:formatEther(claimLiability),liveLiabilitiesCTC:formatEther(liabilities),completedWithdrawalsCTC:formatEther(withdrawals),actualBalanceCTC:formatEther(balance),conserved:true,solvent:true};
  report.automatedJourneysComplete=report.epochs.length===4&&report.epochs.every((epoch:any)=>epoch.complete)&&liabilities===0n;
  report.independentSettlements="pending real participants";
  await saveReport("release-readback.json",report);
  console.log(JSON.stringify(report,null,2));
}finally{source.destroy();target.destroy();}
