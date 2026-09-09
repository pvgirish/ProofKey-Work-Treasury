import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AbiCoder, Contract, Interface, formatEther, id, keccak256 } from "ethers";
import { encoding } from "@gluwa/usc-sdk";
import { verifySafeCall } from "./judge-safe.ts";
import { verifySafeRuntime } from "./judge-safe-runtime.ts";
import { NATIVE_PROFILE } from "../sdk/identity.ts";
import { ALLOCATION_EVENT_TOPIC, CHECKPOINT_EVENT_TOPIC, decodeAllocationEvent, decodeCheckpointEvent, serializeAllocation } from "../sdk/allocation.ts";
import { ROOT, SOURCE_CHAIN_ID, SOURCE_CHAIN_KEY, TARGET_CHAIN_ID, testNetworks } from "./runtime.ts";

export const NATIVE = "0x0000000000000000000000000000000000000FD2";
const MERKLE = "(bytes32 root,(bytes32 hash,bool isLeft)[] siblings)";
const CONTINUITY = "(bytes32 lowerEndpointDigest,bytes32[] roots)";
const PROOF = `(uint64 blockHeight,bytes encodedTransaction,${MERKLE} merkleProof,${CONTINUITY} continuityProof)`;
export const JUDGE_ABI = [
  "event TransactionVerified(uint64 indexed chainKey,uint64 indexed height,uint64 transactionIndex)",
  "event CheckpointImported(bytes32 indexed checkpointId,bytes32 indexed epochId,bytes32 root,uint32 leafCount,uint256 earned,uint256 returned,uint8 phase,bytes32 authenticationId,uint32 receiptLogOrdinal)",
  "event NativeTransactionAuthenticated(bytes32 indexed authenticationId,uint64 indexed blockHeight,uint64 transactionIndex,bytes32 encodedTransactionHash,bytes32 nativeProfile)",
  `function authenticateBatch(uint64[] blockHeights,bytes[] encodedTransactions,${MERKLE}[] merkleProofs,${CONTINUITY} sharedContinuityProof)`,
  `function authenticateSegmented(${PROOF}[] proofs)`,
  `function authenticateCheckpoint(${PROOF} proof,uint32 receiptLogOrdinal)`,
  "function SOURCE_CHAIN_ID() view returns(uint256)",
  "function SOURCE_CHAIN_KEY() view returns(uint64)",
  "function SOURCE_COORDINATOR() view returns(address)",
  "function VERIFIER() view returns(address)",
  "function authentication(bytes32) view returns((uint64 blockHeight,uint64 transactionIndex,bytes32 encodedTransactionHash,bool exists))",
  "function totalCreditedDeposits() view returns(uint256)",
  "function totalFreeLiability() view returns(uint256)",
  "function totalReserveLiability() view returns(uint256)",
  "function totalClaimLiability() view returns(uint256)",
  "function cumulativeWithdrawals() view returns(uint256)",
  "function liveLiabilities() view returns(uint256)",
];
export const judgeInterface = new Interface(JUDGE_ABI);
const authTypeHash = id("ProofKeyNativeAuthenticationV1(uint64 sourceChainKey,uint64 blockHeight,uint64 transactionIndex,bytes32 nativeProfile,bytes32 encodedTransactionHash)");
const abi = AbiCoder.defaultAbiCoder();
const equal = (a:string,b:string) => a.toLowerCase() === b.toLowerCase();
function requireThat(condition:unknown,message:string):asserts condition { if (!condition) throw new Error(message); }
export type EvidenceLog = {address:string; topics:readonly string[]; data:string};
export type EvidenceReceipt = {status:number|null; to:string|null; logs:readonly EvidenceLog[]};

/** Validate the live receipt; checked-in journals supply locators, never a passing result. */
export function checkNativeReceipt(receipt:EvidenceReceipt, treasury:string, expectedCount:number) {
  requireThat(receipt.status === 1, "Target receipt did not succeed");
  requireThat(receipt.to && equal(receipt.to,treasury), "Target transaction is not addressed to the pinned treasury");
  const nativeTopic = judgeInterface.getEvent("TransactionVerified")!.topicHash;
  const authTopic = judgeInterface.getEvent("NativeTransactionAuthenticated")!.topicHash;
  const native = receipt.logs.filter(log => equal(log.address,NATIVE) && equal(log.topics[0]??"",nativeTopic)).map(log => judgeInterface.parseLog(log)!);
  const auth = receipt.logs.filter(log => equal(log.address,treasury) && equal(log.topics[0]??"",authTopic)).map(log => judgeInterface.parseLog(log)!);
  requireThat(native.length === expectedCount && auth.length === expectedCount, "Missing or unexpected native/treasury authentication logs");
  const seen = new Set<string>();
  return native.map(event => {
    const {chainKey,height,transactionIndex} = event.args;
    requireThat(chainKey === SOURCE_CHAIN_KEY, "Native source chain key does not match Sepolia");
    requireThat(height<=BigInt(Number.MAX_SAFE_INTEGER) && transactionIndex<=BigInt(Number.MAX_SAFE_INTEGER), "Source position exceeds safe integer range");
    const key = `${height}:${transactionIndex}`;
    requireThat(!seen.has(key), "Duplicate source position in native evidence"); seen.add(key);
    const matches = auth.filter(candidate => candidate.args.blockHeight === height && candidate.args.transactionIndex === transactionIndex);
    requireThat(matches.length === 1, "Native source position is not bound to one treasury authentication");
    const record = matches[0].args;
    requireThat(equal(record.nativeProfile,NATIVE_PROFILE), "Wrong native encoding profile");
    const authenticationId = keccak256(abi.encode(["bytes32","uint64","uint64","uint64","bytes32","bytes32"], [authTypeHash,chainKey,height,transactionIndex,NATIVE_PROFILE,record.encodedTransactionHash]));
    requireThat(equal(authenticationId,record.authenticationId), "Authentication identity does not bind position and bytes");
    return {blockHeight:Number(height),transactionIndex:Number(transactionIndex),authenticationId,encodedTransactionHash:String(record.encodedTransactionHash)};
  });
}

export function checkCalldata(data:string, expectedMethod:string, entries:ReturnType<typeof checkNativeReceipt>) {
  const decoded = judgeInterface.parseTransaction({data});
  requireThat(decoded?.name === expectedMethod, "Target calldata is not the recorded native path");
  const inputs = expectedMethod === "authenticateBatch"
    ? [...decoded.args.blockHeights].map((height:bigint,index:number)=>({height,bytes:decoded.args.encodedTransactions[index]}))
    : expectedMethod === "authenticateSegmented"
      ? [...decoded.args.proofs].map(proof=>({height:proof.blockHeight,bytes:proof.encodedTransaction}))
      : [{height:decoded.args.proof.blockHeight,bytes:decoded.args.proof.encodedTransaction}];
  requireThat(inputs.length === entries.length, "Calldata proof count differs from native observations");
  return entries.map(entry=>{
    const matches=inputs.filter(input=>BigInt(entry.blockHeight)===input.height && equal(keccak256(input.bytes),entry.encodedTransactionHash));
    requireThat(matches.length===1,"Authenticated bytes are not bound to one calldata proof");
    return {...entry,encodedTransaction:String(matches[0].bytes),selectedCheckpointOrdinal:expectedMethod === "authenticateCheckpoint"?Number(decoded.args.receiptLogOrdinal):null};
  });
}

/** Bind the selected source log and target import, rather than any checkpoint in the receipt. */
export function checkCheckpointImport(sourceLogs:readonly EvidenceLog[], targetLogs:readonly EvidenceLog[], coordinator:string, treasury:string, ordinal:number, authenticationId:string) {
  const selected=sourceLogs[ordinal];
  requireThat(selected && equal(selected.address,coordinator) && equal(selected.topics[0]??"",CHECKPOINT_EVENT_TOPIC),"Selected checkpoint ordinal is not the pinned coordinator checkpoint");
  const checkpoint=decodeCheckpointEvent(selected.topics,selected.data);
  const topic=judgeInterface.getEvent("CheckpointImported")!.topicHash;
  const imports=targetLogs.filter(log=>equal(log.address,treasury)&&equal(log.topics[0]??"",topic)).map(log=>judgeInterface.parseLog(log)!.args);
  requireThat(imports.length===1,"Expected exactly one target checkpoint import");
  const imported=imports[0];
  requireThat(equal(imported.authenticationId,authenticationId)&&Number(imported.receiptLogOrdinal)===ordinal&&equal(imported.epochId,checkpoint.epochId)&&equal(imported.root,checkpoint.root)&&Number(imported.leafCount)===checkpoint.leafCount&&imported.earned===checkpoint.earned&&imported.returned===checkpoint.returned&&Number(imported.phase)===checkpoint.phase,"Target import does not match the exact selected source checkpoint");
  return {checkpointId:String(imported.checkpointId),sourceLogOrdinal:ordinal,authenticationId,checkpoint};
}

// No .env is loaded, no key is read, and no signer or transaction submission is constructed.
export async function runJudgeVerification() {
  const {source,target}=await testNetworks();
  try {
    const read=async(path:string)=>JSON.parse(await readFile(resolve(ROOT,path),"utf8"));
    const deployment=await read("deployments/testnet.json");
    const treasuryAddress=deployment.target.treasury, coordinator=deployment.source.coordinator;
    const treasury=new Contract(treasuryAddress,JUDGE_ABI,target);
    const [sourceFinal,targetFinal]=await Promise.all([source.getBlock("finalized"),target.getBlock("finalized")]);
    requireThat(sourceFinal?.hash && targetFinal?.hash,"Both RPCs must supply finalized blocks; a timeout or fallback is not a pass");
    const tag={blockTag:targetFinal.number};
    const [chainId,key,emitter,verifier]=await Promise.all([treasury.SOURCE_CHAIN_ID(tag),treasury.SOURCE_CHAIN_KEY(tag),treasury.SOURCE_COORDINATOR(tag),treasury.VERIFIER(tag)]);
    requireThat(chainId===SOURCE_CHAIN_ID && key===SOURCE_CHAIN_KEY && equal(emitter,coordinator) && equal(verifier,NATIVE),"Deployed treasury domain does not match this release");
    for(const [chain,name,address,rpc,block] of [["source","SourceCoordinator",coordinator,source,sourceFinal.number],["target","WorkTreasury",treasuryAddress,target,targetFinal.number]] as const){
      const record=deployment.records.find((item:any)=>item.chain===chain && item.name===name && equal(item.address,address));
      requireThat(record,"Missing pinned deployment runtime record");
      requireThat(equal(keccak256(await rpc.getCode(address,block)),record.deployedCodeHash),`${name} runtime differs from the pinned deployment`);
    }
    const cases=[
      {file:"evidence/public-demo.json",label:"native-batch-authenticate-A-and-return50",method:"authenticateBatch",count:2},
      {file:"evidence/public-demo.json",label:"native-single-import-final-checkpoint",method:"authenticateCheckpoint",count:1},
      {file:"evidence/public-branches.json",label:"native-segmented-authenticate-quorum-and-final",method:"authenticateSegmented",count:2},
    ];
    const sourceJournals=await Promise.all([read("evidence/source-demo.json"),read("evidence/source-branches.json")]);
    const sourceLocators=sourceJournals.flatMap(journal=>journal.operations.map((operation:any)=>({...operation,safeAddress:journal.safe})));
    const observations=[];
    for(const item of cases){
      const journal=await read(item.file);
      const op=journal.operations.find((entry:any)=>entry.label===item.label);
      requireThat(op?.transactionHash,"Missing recorded target transaction locator");
      const [receipt,transaction]=await Promise.all([target.getTransactionReceipt(op.transactionHash),target.getTransaction(op.transactionHash)]);
      requireThat(receipt && transaction && equal(receipt.hash,op.transactionHash) && equal(transaction.hash,op.transactionHash),"Missing or substituted target transaction");
      requireThat(receipt.blockNumber<=targetFinal.number && equal(receipt.blockHash,transaction.blockHash??"") && receipt.index===transaction.index,"Target transaction/receipt position mismatch or not finalized");
      const block=await target.getBlock(receipt.blockNumber);
      requireThat(block?.hash && equal(block.hash,receipt.blockHash) && equal(block.transactions[receipt.index]??"",receipt.hash),"Target receipt is not at its canonical block position");
      const entries=checkCalldata(transaction.data,item.method,checkNativeReceipt(receipt,treasuryAddress,item.count));
      const sources=[];
      for(const entry of entries){
        requireThat(entry.blockHeight<=sourceFinal.number,"Native source height is not finalized in the source read");
        const sourceBlock=await source.getBlock(entry.blockHeight);
        const hash=sourceBlock?.transactions[entry.transactionIndex];
        requireThat(sourceBlock?.hash && hash,"Source position is absent from the canonical block");
        const [raw,sourceReceipt,cache]=await Promise.all([encoding.getTransactionWithRaw(source as any,hash),source.getTransactionReceipt(hash),treasury.authentication(entry.authenticationId,tag)]);
        requireThat(raw && sourceReceipt?.status===1,"Source transaction is missing or failed");
        requireThat(equal(raw.formatted.hash,hash) && raw.formatted.index===entry.transactionIndex && raw.formatted.blockNumber===entry.blockHeight && equal(raw.formatted.blockHash??"",sourceBlock.hash) && sourceReceipt.index===entry.transactionIndex && equal(sourceReceipt.blockHash,sourceBlock.hash),"Source transaction/receipt/block disagree");
        const encoded=encoding.abiEncode(raw,sourceReceipt as any,encoding.EncodingVersion.V1).abi;
        requireThat(equal(encoded,entry.encodedTransaction),"Live source transaction and entire receipt differ from the native-authenticated calldata bytes");
        requireThat(cache.exists && Number(cache.blockHeight)===entry.blockHeight && Number(cache.transactionIndex)===entry.transactionIndex && equal(cache.encodedTransactionHash,entry.encodedTransactionHash),"Persisted authentication cache differs from the mined evidence");
        const locator=sourceLocators.find((candidate:any)=>equal(candidate.transactionHash,hash));
        requireThat(locator,"Source transaction does not match the recorded public journey");
        const allocations=sourceReceipt.logs.filter(log=>equal(log.address,coordinator)&&equal(log.topics[0]??"",ALLOCATION_EVENT_TOPIC)).map(log=>({ordinal:sourceReceipt.logs.indexOf(log),allocation:serializeAllocation(decodeAllocationEvent(log.topics,log.data))}));
        const checkpoints=sourceReceipt.logs.filter(log=>equal(log.address,coordinator)&&equal(log.topics[0]??"",CHECKPOINT_EVENT_TOPIC)).map(log=>({ordinal:sourceReceipt.logs.indexOf(log),checkpoint:decodeCheckpointEvent(log.topics,log.data)}));
        requireThat(allocations.length+checkpoints.length>0,"Source receipt contains no canonical allocation/checkpoint");
        const checkpointImport=entry.selectedCheckpointOrdinal===null?null:checkCheckpointImport(sourceReceipt.logs,receipt.logs,coordinator,treasuryAddress,entry.selectedCheckpointOrdinal,entry.authenticationId);
        let safeExecution=null;
        if(locator.safe){
          requireThat(equal(locator.safeAddress,deployment.source.safe),"Source journal Safe is not the pinned release Safe");
          const call=verifySafeCall({transaction:raw.formatted,receipt:sourceReceipt,safe:locator.safeAddress,coordinator,chainId:SOURCE_CHAIN_ID,nonce:locator.safe.nonce,expectedSafeTxHash:locator.safe.safeTransactionHash});
          const runtimeSnapshot=await verifySafeRuntime(source,locator.safeAddress,entry.blockHeight);
          requireThat(equal(runtimeSnapshot.blockHash,sourceBlock.hash) && runtimeSnapshot.chainId===String(SOURCE_CHAIN_ID),"Safe runtime snapshot differs from the authenticated source position");
          safeExecution={...call,runtimeSnapshot};
        }
        sources.push({...entry,encodedTransaction:undefined,sourceTransactionHash:hash,sourceBlockHash:sourceBlock.hash,sourceLabel:locator.label,sourceBytesMatch:true,cacheMatches:true,allocations,checkpoints,checkpointImport,safeExecution});
      }
      observations.push({method:item.method,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status:receipt.status,nativeEventCount:entries.length,sources});
    }
    const [deposits,free,reserve,claims,withdrawn,liabilities,balance]=await Promise.all([treasury.totalCreditedDeposits(tag),treasury.totalFreeLiability(tag),treasury.totalReserveLiability(tag),treasury.totalClaimLiability(tag),treasury.cumulativeWithdrawals(tag),treasury.liveLiabilities(tag),target.getBalance(treasuryAddress,targetFinal.number)]);
    requireThat(deposits===free+reserve+claims+withdrawn && liabilities===free+reserve+claims && balance>=liabilities,"Global target conservation or solvency failed");
    for(const [rpc,pinned] of [[source,sourceFinal],[target,targetFinal]] as const){
      const reread=await rpc.getBlock(pinned.number);requireThat(reread?.hash && equal(reread.hash,pinned.hash??"" ),"Pinned block changed during verification");
    }
    return {version:1,status:"pass",checkedAt:new Date().toISOString(),readOnly:true,scope:"Live RPC audit of recorded native receipts, exact source bytes, persisted authentication and global target accounting. All public demo actors are team controlled. This is not fresh native execution, a light-client state proof, work-quality verification or independent adoption.",source:{chainId:String(SOURCE_CHAIN_ID),finalizedBlock:sourceFinal.number,blockHash:sourceFinal.hash,coordinator},target:{chainId:String(TARGET_CHAIN_ID),finalizedBlock:targetFinal.number,blockHash:targetFinal.hash,treasury:treasuryAddress,nativeVerifier:NATIVE},observations,accounting:{depositsCTC:formatEther(deposits),withdrawnCTC:formatEther(withdrawn),liabilitiesCTC:formatEther(liabilities),balanceCTC:formatEther(balance),conserved:true,solvent:true},limitations:["RPCs supply the canonical/finality observations. This command does not independently verify chain consensus.","The whole authenticated source receipt includes the reported Safe CALL and canonical allocations. Exact Safe calldata/hash/event checks do not authorize a second payout route or prove participant independence.","Safe gasReimbursement is transaction-cost reimbursement, not the worker payment.","The recorded native paths are a bounded sample, not all historical calls. Use the separate tree/readback and refusal tools for their stated checks."]};
  } finally {source.destroy();target.destroy();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const output=resolve(ROOT,"evidence/judge-verification.json");
  try {
    const report=await runJudgeVerification();await mkdir(resolve(ROOT,"evidence"),{recursive:true});await writeFile(output,JSON.stringify(report,(_key,value)=>typeof value==="bigint"?value.toString():value,2)+"\n");
    console.log(`PASS: 3 mined native paths, 5 native events, exact source bytes and authentication cache match.\nAccounting: ${report.accounting.depositsCTC} CTC deposited, ${report.accounting.withdrawnCTC} withdrawn, ${report.accounting.liabilitiesCTC} liabilities.\nReport: evidence/judge-verification.json\nRead-only historical receipt audit; independent use remains pending.`);
  }catch(error:any){
    const message=error.shortMessage??error.message??"Verification unavailable";
    await mkdir(resolve(ROOT,"evidence"),{recursive:true});await writeFile(output,JSON.stringify({version:1,status:"not-verified",checkedAt:new Date().toISOString(),readOnly:true,error:message},null,2)+"\n");
    console.error(`NOT VERIFIED: ${message}`);process.exitCode=1;
  }
}
