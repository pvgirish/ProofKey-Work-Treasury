import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, Interface } from "ethers";
import { PROGRAM_CLOSEOUT_VERSION } from "./program-closeout.ts";
import { assertStableFinalizedSnapshots, classifyNativeAuthentication, collectedEvidenceStatus, parseProgramCloseoutLocator, stringifyCollectedProgramCloseout, validateAuthenticatedCheckpointReceipt, validateCollectedWithdrawal, validateNativeAuthenticationEvidence } from "./program-collector.ts";
import { AllocationKind, AllocationRole, type Address, type AllocationV1, type Hex } from "./types.ts";
import type { CloseoutReceipt } from "./program-closeout.ts";

const address=(byte:string)=>getAddress(`0x${byte.repeat(40)}`) as Address;
const hash=(byte:string)=>`0x${byte.repeat(64)}` as Hex;
function raw(){return{version:PROGRAM_CLOSEOUT_VERSION,source:{coordinator:address("1"),runtimeHash:hash("a"),snapshot:{chainId:"111",blockNumber:"10",blockHash:hash("1"),finality:"rpc-finalized"}},target:{treasury:address("2"),runtimeHash:hash("b"),snapshot:{chainId:"222",blockNumber:"20",blockHash:hash("2"),finality:"rpc-finalized"},sourceChainKey:"7",nativeAttestedSourceHeight:"10"},epochs:[{epochId:hash("e"),cap:"1",source:{},target:{}}]};}

test("locator parser accepts raw or collected exports and discards report verdict fields",()=>{
  const direct=parseProgramCloseoutLocator(raw());assert.equal(direct.epochId,hash("e"));
  const collected={version:"proofkey.work-treasury.collected-closeout.v1",status:"complete",accountingStatus:"complete",label:"untrusted",limitations:[],errors:[],epoch:{},allocations:[],closeout:raw(),result:{status:"complete"},returnAccounting:"x"};
  assert.deepEqual(parseProgramCloseoutLocator(collected),direct);
  (collected as any).verdict="accept";assert.throws(()=>parseProgramCloseoutLocator(collected),/unsupported field|verdict/);
});

test("locator parser preserves domain tampering for comparison with a trusted deployment",()=>{
  const changed=raw();changed.target.runtimeHash=hash("f");
  assert.equal(parseProgramCloseoutLocator(changed).target.runtimeHash,hash("f"));
});

test("native route classification depends only on recorded authentication and recognition transaction identities",()=>{
  assert.equal(classifyNativeAuthentication(hash("1"),hash("1")),"fresh-atomic");
  assert.equal(classifyNativeAuthentication(hash("1"),hash("2")),"cached");
  assert.equal(classifyNativeAuthentication(hash("1"),hash("2"),{recognitionFunction:"authenticateAndRecognizeReceipt",verified:true}),"fresh-atomic");
  assert.equal(classifyNativeAuthentication(hash("1"),hash("2"),{recognitionFunction:"authenticateAndRecognizeReceipt",verified:false}),"cached");
  assert.equal(classifyNativeAuthentication(hash("1"),hash("2"),{recognitionFunction:"recognizeFromReceipt",verified:true}),"cached");
});

test("collected export serialization is JSON safe",()=>{
  const text=stringifyCollectedProgramCloseout({value:1n} as any);assert.equal(JSON.parse(text).value,"1");
});

const log=(iface:Interface,name:string,args:readonly unknown[],emitter:Address)=>{const encoded=iface.encodeEventLog(iface.getEvent(name)!,args);return{address:emitter,topics:encoded.topics as Hex[],data:encoded.data as Hex};};
const receipt=(to:Address,input:Hex,logs:CloseoutReceipt["logs"],status=1):CloseoutReceipt=>({transactionHash:hash("9"),blockNumber:"10",blockHash:hash("8"),status,to,from:address("3"),input,logs});

test("native authentication requires the exact treasury and 0xFD2 verifier events",()=>{
  const treasury=address("2"),precompile=getAddress("0x0000000000000000000000000000000000000fd2") as Address,authenticationId=hash("a"),encodedTransactionHash=hash("b"),nativeProfile=hash("c");
  const authIface=new Interface(["event NativeTransactionAuthenticated(bytes32 indexed authenticationId,uint64 indexed blockHeight,uint64 transactionIndex,bytes32 encodedTransactionHash,bytes32 nativeProfile)"]);
  const verifierIface=new Interface(["event TransactionVerified(uint64 indexed chainKey,uint64 indexed height,uint64 transactionIndex)"]);
  const good=receipt(treasury,"0x",[log(authIface,"NativeTransactionAuthenticated",[authenticationId,12n,4n,encodedTransactionHash,nativeProfile],treasury),log(verifierIface,"TransactionVerified",[7n,12n,4n],precompile)]);
  const expected={receipt:good,treasury,authenticationId,sourceChainKey:"7",blockHeight:"12",transactionIndex:"4",encodedTransactionHash,nativeProfile};
  assert.doesNotThrow(()=>validateNativeAuthenticationEvidence(expected));
  assert.throws(()=>validateNativeAuthenticationEvidence({...expected,receipt:{...good,logs:good.logs.slice(0,1)}}),/verifier event/);
  assert.throws(()=>validateNativeAuthenticationEvidence({...expected,receipt:{...good,logs:[good.logs[0]!,{...good.logs[1]!,address:address("4")} ]}}),/verifier event/);
});

test("withdrawal requires successful canonical calldata and the exact treasury event",()=>{
  const treasury=address("2"),destination=address("4"),owner=address("3"),iface=new Interface(["function withdrawFor(bytes32,uint64)","event ClaimWithdrawn(bytes32 indexed epochId,uint64 indexed allocationId,uint8 kind,address indexed claimOwner,address destination,uint256 amount)"]);
  const allocation:AllocationV1={epochId:hash("e"),allocationId:5n,treeIndex:0,kind:AllocationKind.WORK,orderId:hash("d"),milestoneId:1,role:AllocationRole.WORKER,asset:address("0"),amount:19n,claimOwner:owner,destination,policyHash:hash("1"),evidenceHash:hash("2")};
  const input=iface.encodeFunctionData("withdrawFor",[allocation.epochId,allocation.allocationId]) as Hex,event=log(iface,"ClaimWithdrawn",[allocation.epochId,allocation.allocationId,allocation.kind,owner,destination,allocation.amount],treasury),good=receipt(treasury,input,[event]);
  assert.doesNotThrow(()=>validateCollectedWithdrawal(good,treasury,allocation,destination));
  assert.throws(()=>validateCollectedWithdrawal({...good,status:0},treasury,allocation,destination),/unsuccessful/);
  assert.throws(()=>validateCollectedWithdrawal({...good,logs:[{...event,address:address("5")}]},treasury,allocation,destination),/ClaimWithdrawn/);
});

test("authenticated checkpoint is bound to the coordinator emitter and exact identity",()=>{
  const coordinator=address("1"),epochId=hash("e"),rootHash=hash("a"),iface=new Interface(["event CheckpointPublished(bytes32 indexed epochId,bytes32 root,uint32 leafCount,uint256 earned,uint256 returned,uint8 phase)"]),event=log(iface,"CheckpointPublished",[epochId,rootHash,3,10n,2n,3],coordinator),good=receipt(address("2"),"0x",[event]);
  assert.doesNotThrow(()=>validateAuthenticatedCheckpointReceipt(good,0,coordinator,{epochId,root:rootHash,leafCount:3}));
  assert.throws(()=>validateAuthenticatedCheckpointReceipt({...good,logs:[{...event,address:address("4")}]},0,coordinator,{epochId,root:rootHash,leafCount:3}),/pinned coordinator/);
});

test("snapshot changes and provenance errors cannot produce a complete collected verdict",()=>{
  const initial={source:{number:10,hash:hash("1")},target:{number:20,hash:hash("2")}};
  assert.doesNotThrow(()=>assertStableFinalizedSnapshots(initial,{source:initial.source,target:initial.target,sourceFinalized:10,targetFinalized:20}));
  assert.throws(()=>assertStableFinalizedSnapshots(initial,{source:{...initial.source,hash:hash("3")},target:initial.target,sourceFinalized:10,targetFinalized:20}),/snapshots changed/);
  const row:any={errors:["missing source proof"],source:{errors:[]},nativeAuthentication:{errors:[]},recognition:{errors:[]},withdrawal:{errors:[]}};
  assert.equal(collectedEvidenceStatus("complete",[row],[]),"incomplete");
});
