import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {AbiCoder,Interface} from "ethers";
import {checkNativeReceipt,checkCalldata,checkCheckpointImport,judgeInterface,NATIVE,type EvidenceReceipt} from "./judge-verify.ts";
const read=async(path:string)=>JSON.parse(await readFile(resolve(import.meta.dirname,"..",path),"utf8"));
const journal=await read("evidence/public-demo.json");
const treasury=journal.config.targetTreasury;
const operation=journal.operations.find((item:any)=>item.label==="native-batch-authenticate-A-and-return50");
const fixture=():EvidenceReceipt=>({status:1,to:treasury,logs:structuredClone(operation.logs)});

test("judge checker binds both real batch native events to their exact treasury authentications",()=>{
  const entries=checkNativeReceipt(fixture(),treasury,2);
  assert.equal(entries.length,2);assert.equal(entries[0].blockHeight,11669711);assert.equal(entries[0].transactionIndex,57);
  assert.equal(entries[0].encodedTransactionHash,"0x93a1c3c431e290a1120ec71fc4d0e9edce7d0f770f2578b3c9c500a000837afe");
});
test("judge checker rejects reverted and wrongly addressed receipts even with copied genuine logs",()=>{
  assert.throws(()=>checkNativeReceipt({...fixture(),status:0},treasury,2),/did not succeed/);
  assert.throws(()=>checkNativeReceipt({...fixture(),to:NATIVE},treasury,2),/not addressed/);
});
test("judge checker rejects look-alike native or treasury events from a different emitter",()=>{
  for(const index of [0,2]){const r=fixture();r.logs[index].address="0x0000000000000000000000000000000000001234";assert.throws(()=>checkNativeReceipt(r,treasury,2),/Missing or unexpected/);}
});
test("judge checker rejects source-domain and source-position substitution",()=>{
  const wrongDomain=fixture();wrongDomain.logs[0].topics=[wrongDomain.logs[0].topics[0],`0x${"0".repeat(63)}3`,wrongDomain.logs[0].topics[2]];
  assert.throws(()=>checkNativeReceipt(wrongDomain,treasury,2),/chain key/);
  const wrongPosition=fixture();wrongPosition.logs[0].data=`0x${"0".repeat(63)}1`;
  assert.throws(()=>checkNativeReceipt(wrongPosition,treasury,2),/not bound/);
});
test("judge checker rejects a substituted encoded hash even when source position is unchanged",()=>{
  const r=fixture();const log=r.logs[2];const parsed=judgeInterface.parseLog(log)!;
  const encoded=judgeInterface.encodeEventLog(judgeInterface.getEvent("NativeTransactionAuthenticated")!,[parsed.args.authenticationId,parsed.args.blockHeight,parsed.args.transactionIndex,`0x${"ab".repeat(32)}`,parsed.args.nativeProfile]);
  log.topics=encoded.topics;log.data=encoded.data;
  assert.throws(()=>checkNativeReceipt(r,treasury,2),/identity does not bind/);
});
test("judge checker rejects calldata from a different native path or substituted proof bytes",()=>{
  const entries=checkNativeReceipt(fixture(),treasury,2);const zero=`0x${"00".repeat(32)}`;
  const batch=judgeInterface.encodeFunctionData("authenticateBatch",[[11669711,11669713],["0x12","0x34"],[[zero,[]],[zero,[]]],[zero,[zero]]]);
  assert.throws(()=>checkCalldata(batch,"authenticateSegmented",entries),/not the recorded/);
  assert.throws(()=>checkCalldata(batch,"authenticateBatch",entries),/not bound/);
});
test("judge ABI functions and treasury event match the compiled immutable implementation",async()=>{
  const compiled=new Interface((await read("out/WorkTreasury.sol/WorkTreasury.json")).abi);
  for(const fragment of judgeInterface.fragments){
    if(fragment.type==="function")assert.ok(compiled.getFunction(fragment.format("sighash")),fragment.format("sighash"));
  }
  const native=judgeInterface.getEvent("TransactionVerified")!;
  assert.equal(native.topicHash,"0x8a8df984523447f746ce8bccdb04c87025c708eb62a2d070bdffb8945c8f391e");
  assert.deepEqual(native.inputs.map(input=>input.indexed===true),[true,true,false]);
  assert.equal(compiled.getEvent("NativeTransactionAuthenticated")!.format("full"),judgeInterface.getEvent("NativeTransactionAuthenticated")!.format("full"));
});

test("judge checkpoint audit binds the selected source log and rejects a substituted target root",()=>{
  const bytes=journal.finalNativeBundle.proofs[0].encodedTransaction;
  const chunks=AbiCoder.defaultAbiCoder().decode(["uint8","bytes[]"],bytes)[1];
  const decoded=AbiCoder.defaultAbiCoder().decode(["uint8","uint64","tuple(address,bytes32[],bytes)[]","bytes"],chunks[2]);
  const logs=decoded[2].map((row:any)=>({address:String(row[0]),topics:[...row[1]] as string[],data:String(row[2])}));
  const op=journal.operations.find((item:any)=>item.label==="native-single-import-final-checkpoint");
  const imported=op.logs.find((log:any)=>log.topics[0]===judgeInterface.getEvent("CheckpointImported")!.topicHash);
  const parsed=judgeInterface.parseLog(imported)!.args;
  const result=checkCheckpointImport(logs,op.logs,journal.config.sourceCoordinator,treasury,Number(parsed.receiptLogOrdinal),parsed.authenticationId);
  assert.equal(result.checkpoint.root,parsed.root);
  assert.throws(()=>checkCheckpointImport(logs,op.logs,journal.config.sourceCoordinator,treasury,0,parsed.authenticationId),/Selected checkpoint ordinal/);
  const changed=structuredClone(op.logs);const index=changed.findIndex((log:any)=>log.topics[0]===imported.topics[0]);
  const encoded=judgeInterface.encodeEventLog(judgeInterface.getEvent("CheckpointImported")!,[parsed.checkpointId,parsed.epochId,`0x${"ab".repeat(32)}`,parsed.leafCount,parsed.earned,parsed.returned,parsed.phase,parsed.authenticationId,parsed.receiptLogOrdinal]);
  changed[index]={...changed[index],...encoded};
  assert.throws(()=>checkCheckpointImport(logs,changed,journal.config.sourceCoordinator,treasury,Number(parsed.receiptLogOrdinal),parsed.authenticationId),/does not match/);
});
test("judge checker never aliases a uint64 position into an unsafe JavaScript number",()=>{
  const r=fixture();const encoded=judgeInterface.encodeEventLog(judgeInterface.getEvent("TransactionVerified")!,[1n,BigInt(Number.MAX_SAFE_INTEGER)+1n,0n]);
  r.logs[0].topics=encoded.topics;r.logs[0].data=encoded.data;
  assert.throws(()=>checkNativeReceipt(r,treasury,2),/safe integer range/);
});
