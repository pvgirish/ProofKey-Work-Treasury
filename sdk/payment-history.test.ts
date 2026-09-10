import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, getAddress, keccak256 } from "ethers";
import { hashAllocation, rebuildAllocations, serializeAllocation } from "./allocation.ts";
import { PROGRAM_CLOSEOUT_VERSION, type CloseoutReceipt, type ProgramCloseoutV1, type TrustedCloseoutDeployment } from "./program-closeout.ts";
import type { CollectedProgramCloseoutV1 } from "./program-collector.ts";
import { PAYMENT_HISTORY_LOCATOR_VERSION, parsePaymentHistoryLocator, verifySelectedPaymentHistory, type PaymentHistoryLocatorV1 } from "./payment-history.ts";
import { AllocationKind, AllocationRole, EpochPhase, type Address, type AllocationV1, type Hex } from "./types.ts";

const address=(byte:string)=>getAddress(`0x${byte.repeat(40)}`) as Address;
const hash=(byte:string)=>`0x${byte.repeat(64)}` as Hex;
const epochId=hash("a"),orderId=hash("b"),treasury=address("1"),coordinator=address("2"),worker=address("3"),feeOwner=address("4"),feeDestination=address("5"),refund=address("6"),redirect=address("7");
const trusted:TrustedCloseoutDeployment={sourceChainId:"111",sourceCoordinator:coordinator,sourceRuntimeHash:hash("1"),targetChainId:"222",targetTreasury:treasury,targetRuntimeHash:hash("2"),sourceChainKey:"7"};
const abi=AbiCoder.defaultAbiCoder();
const target=new Interface([
  "function withdrawFor(bytes32,uint64)","function ownerWithdrawTo(bytes32,uint64,address)",
  "event AllocationRecognized(bytes32 indexed epochId,uint64 indexed allocationId,bytes32 indexed economicId,uint8 kind,uint256 amount,address claimOwner,address destination,bytes32 leafHash)",
  "event ClaimWithdrawn(bytes32 indexed epochId,uint64 indexed allocationId,uint8 kind,address indexed claimOwner,address destination,uint256 amount)",
]);
function economic(a:AllocationV1){return keccak256(abi.encode(["bytes32","uint64"],[a.epochId,a.allocationId])) as Hex;}
function allocation(index:number,kind:number,amount:bigint):AllocationV1{return{epochId,allocationId:BigInt(index+1),treeIndex:index,kind,orderId:kind===AllocationKind.RETURN?hash("0"):orderId,milestoneId:kind===AllocationKind.RETURN?0:index,role:kind===AllocationKind.WORK?AllocationRole.WORKER:kind===AllocationKind.FEE?AllocationRole.FEE:AllocationRole.EPOCH,asset:address("0"),amount,claimOwner:kind===AllocationKind.WORK?worker:kind===AllocationKind.FEE?feeOwner:refund,destination:kind===AllocationKind.WORK?worker:kind===AllocationKind.FEE?feeDestination:refund,policyHash:hash("9"),evidenceHash:hash(String(index+5))};}
function eventLog(event:"AllocationRecognized"|"ClaimWithdrawn",a:AllocationV1,destination=a.destination){const args=event==="AllocationRecognized"?[a.epochId,a.allocationId,economic(a),a.kind,a.amount,a.claimOwner,a.destination,hashAllocation(a)]:[a.epochId,a.allocationId,a.kind,a.claimOwner,destination,a.amount];const encoded=target.encodeEventLog(target.getEvent(event)!,args);return{address:treasury,topics:encoded.topics as Hex[],data:encoded.data as Hex};}
function recognitionReceipt(a:AllocationV1):CloseoutReceipt{return{transactionHash:hash(String(a.treeIndex+1)),blockNumber:"15",blockHash:hash("e"),status:1,to:treasury,from:address("8"),input:"0x1234",logs:[eventLog("AllocationRecognized",a)]};}
function withdrawalReceipt(a:AllocationV1,destination=a.destination,ownerRedirect=false):CloseoutReceipt{return{transactionHash:hash(String(a.treeIndex+7)),blockNumber:"16",blockHash:hash("e"),status:1,to:treasury,from:ownerRedirect?a.claimOwner:address("8"),input:target.encodeFunctionData(ownerRedirect?"ownerWithdrawTo":"withdrawFor",ownerRedirect?[a.epochId,a.allocationId,destination]:[a.epochId,a.allocationId]) as Hex,logs:[eventLog("ClaimWithdrawn",a,destination)]};}
function fixture():{report:CollectedProgramCloseoutV1;allocations:AllocationV1[]}{
  const allocations=[allocation(0,AllocationKind.WORK,70n),allocation(1,AllocationKind.FEE,10n),allocation(2,AllocationKind.RETURN,20n)],root=rebuildAllocations(allocations).root;
  const closeout:ProgramCloseoutV1={version:PROGRAM_CLOSEOUT_VERSION,source:{coordinator,runtimeHash:hash("1"),snapshot:{chainId:"111",blockNumber:"20",blockHash:hash("3"),finality:"rpc-finalized"}},target:{treasury,runtimeHash:hash("2"),snapshot:{chainId:"222",blockNumber:"20",blockHash:hash("4"),finality:"rpc-finalized"},sourceChainKey:"7",nativeAttestedSourceHeight:"20"},epochs:[{epochId,cap:"100",source:{available:"0",unresolved:"0",earned:"80",returned:"20",phase:EpochPhase.CLOSED,leafCount:3,root,allocations:allocations.map(serializeAllocation)},target:{reserve:"0",recognized:"100",funded:true,refundOwnerFreeBalance:"20",allocations:allocations.map(a=>({allocation:serializeAllocation(a),recognized:true,recognizedAllocation:serializeAllocation(a),recognitionReceipt:recognitionReceipt(a),authentication:{authenticationId:hash("f"),blockHeight:"10",transactionIndex:String(a.treeIndex),encodedTransactionHash:hash("d"),exists:true},...(a.kind===AllocationKind.RETURN?{}:{completedClaim:{allocation:serializeAllocation(a),withdrawn:true,paidDestination:a.destination},withdrawalReceipt:withdrawalReceipt(a)})}))}}]};
  const report={version:"proofkey.work-treasury.collected-closeout.v1",status:"complete",accountingStatus:"complete",label:"untrusted",limitations:[],errors:[],epoch:{} as any,allocations:allocations.map(a=>({allocationId:String(a.allocationId),kind:a.kind,amount:String(a.amount),status:a.kind===AllocationKind.RETURN?"returned-credit":"paid",legacyConsent:true,policyOutcome:{type:a.kind===AllocationKind.RETURN?"return":"milestone",label:a.kind===AllocationKind.RETURN?"draining-sweep-return":"approved",...(a.kind===AllocationKind.RETURN?{}:{outcomeCode:4,approval:true})},source:{transactionHash:hash("c"),errors:[]},nativeAuthentication:{transactionHash:hash("d"),classification:"cached",errors:[]},recognition:{transactionHash:recognitionReceipt(a).transactionHash,economicId:economic(a),amount:String(a.amount),successful:true,errors:[]},withdrawal:{...(a.kind===AllocationKind.RETURN?{}:{transactionHash:withdrawalReceipt(a).transactionHash,destination:a.destination,successful:true}),successful:a.kind!==AllocationKind.RETURN,errors:[]},errors:[]})),closeout,result:{status:"complete",errors:[],incomplete:[],totals:{cap:100n,earned:80n,returned:20n,paid:80n,outstanding:0n},consent:{boundOrders:0,legacyOrders:[orderId]},returnAccounting:"RETURN is recognized into the refund owner's fungible freeBalance; no free withdrawal is attributed to an epoch."},returnAccounting:"RETURN recognition is epoch-specific"} as unknown as CollectedProgramCloseoutV1;
  return{report,allocations};
}
function locator(role:"source-worker"|"claim-owner"|"paid-destination"="claim-owner",subject=worker,selection:PaymentHistoryLocatorV1["selections"][number]={epochId}):PaymentHistoryLocatorV1{return{version:PAYMENT_HISTORY_LOCATOR_VERSION,subject:{address:subject,role},domain:{...trusted},selections:[selection]};}

test("selected history counts WORK, keeps FEE separate and excludes RETURN",()=>{
  const {report}=fixture(),history=verifySelectedPaymentHistory({locator:locator(),reports:[report],trusted});
  assert.equal(history.status,"verified");assert.equal(history.records.length,1);assert.equal(history.records[0]!.kind,"WORK");assert.equal(history.records[0]!.amount,"70");assert.deepEqual(history.totals.map(t=>[t.kind,t.amount]),[["WORK","70"]]);assert.match(history.limitations.join(" "),/RETURN is excluded/);
  const fees=verifySelectedPaymentHistory({locator:locator("claim-owner",feeOwner),reports:[report],trusted});assert.equal(fees.records[0]!.kind,"FEE");assert.deepEqual(fees.totals.map(t=>[t.kind,t.amount]),[["FEE","10"]]);
});

test("duplicate selections and duplicate evidence routes cannot inflate totals",()=>{
  const duplicate=locator();duplicate.selections.push({epochId});assert.throws(()=>parsePaymentHistoryLocator(duplicate),/duplicate epoch/);
  const {report}=fixture(),history=verifySelectedPaymentHistory({locator:locator(),reports:[report,structuredClone(report)],trusted});assert.equal(history.status,"invalid");assert.equal(history.records.length,0);assert.match(history.errors.join(" "),/duplicate evidence route/);
});

test("wrong trusted domain is invalid and contributes no total",()=>{
  const {report}=fixture(),changed=locator();changed.domain.targetRuntimeHash=hash("f");const history=verifySelectedPaymentHistory({locator:changed,reports:[report],trusted});assert.equal(history.status,"invalid");assert.deepEqual(history.totals,[]);assert.match(history.errors.join(" "),/trusted deployment/);
});

test("pending and failed withdrawals never count as paid",()=>{
  const pending=fixture();const item=pending.report.closeout.epochs[0]!.target.allocations[0]!;item.completedClaim!.withdrawn=false;delete item.withdrawalReceipt;pending.report.allocations[0]!.status="recognized-unpaid";pending.report.allocations[0]!.withdrawal.successful=false;
  const pendingHistory=verifySelectedPaymentHistory({locator:locator(),reports:[pending.report],trusted});assert.equal(pendingHistory.status,"partial");assert.equal(pendingHistory.records.length,0);
  const failed=fixture();failed.report.closeout.epochs[0]!.target.allocations[0]!.withdrawalReceipt!.status=0;const failedHistory=verifySelectedPaymentHistory({locator:locator(),reports:[failed.report],trusted});assert.equal(failedHistory.status,"invalid");assert.equal(failedHistory.records.length,0);
});

test("stale green row summaries cannot replace recognition or native-frontier evidence",()=>{
  const missing=fixture();delete missing.report.closeout.epochs[0]!.target.allocations[0]!.recognitionReceipt;const missingHistory=verifySelectedPaymentHistory({locator:locator(),reports:[missing.report],trusted});assert.equal(missingHistory.status,"partial");assert.equal(missingHistory.records.length,0);assert.match(missingHistory.unresolvedSelections.join(" "),/recognition receipt/);
  const stale=fixture();stale.report.closeout.target.nativeAttestedSourceHeight="9";const staleHistory=verifySelectedPaymentHistory({locator:locator(),reports:[stale.report],trusted});assert.equal(staleHistory.status,"partial");assert.equal(staleHistory.records.length,0);assert.match(staleHistory.unresolvedSelections.join(" "),/frontier/);
});

test("owner redirect preserves committed and actual destinations and role matching",()=>{
  const value=fixture(),item=value.report.closeout.epochs[0]!.target.allocations[0]!,row=value.report.allocations[0]!;item.completedClaim!.paidDestination=redirect;item.withdrawalReceipt=withdrawalReceipt(value.allocations[0]!,redirect,true);row.withdrawal={transactionHash:item.withdrawalReceipt.transactionHash,destination:redirect,successful:true,errors:[]};
  const recipient=verifySelectedPaymentHistory({locator:locator("paid-destination",redirect),reports:[value.report],trusted});assert.equal(recipient.status,"verified");assert.equal(recipient.records[0]!.withdrawalRoute,"owner-redirect");assert.equal(recipient.records[0]!.committedDestination,worker);assert.equal(recipient.records[0]!.paidDestination,redirect);
  const wrongRecipient=verifySelectedPaymentHistory({locator:locator("paid-destination",worker),reports:[value.report],trusted});assert.equal(wrongRecipient.status,"partial");assert.equal(wrongRecipient.records.length,0);
});

test("source-worker is not inferred from claim ownership",()=>{
  const {report}=fixture(),history=verifySelectedPaymentHistory({locator:locator("source-worker",worker),reports:[report],trusted});assert.equal(history.status,"partial");assert.equal(history.records.length,0);assert.match(history.unresolvedSelections.join(" "),/source-worker/);
});

test("reimport discards stale verdicts, totals and records",()=>{
  const {report}=fixture(),history=verifySelectedPaymentHistory({locator:locator(),reports:[report],trusted});const imported:any=structuredClone(history);imported.status="verified";imported.totals=[{amount:"999999"}];imported.records=[{amount:"999999"}];assert.deepEqual(parsePaymentHistoryLocator(imported),locator());
});

test("contradictory program accounting cannot yield a green selected record",()=>{
  const {report}=fixture();report.closeout.epochs[0]!.source.available="1";const history=verifySelectedPaymentHistory({locator:locator(),reports:[report],trusted});assert.equal(history.status,"invalid");assert.equal(history.records.length,0);assert.match(history.errors.join(" "),/contradictory program report/);
});

test("an incomplete program can still prove one individually complete selected payment",()=>{
  const value=fixture(),fee=value.report.closeout.epochs[0]!.target.allocations[1]!;fee.completedClaim!.withdrawn=false;delete fee.withdrawalReceipt;value.report.allocations[1]!.status="recognized-unpaid";value.report.allocations[1]!.withdrawal.successful=false;
  const history=verifySelectedPaymentHistory({locator:locator(),reports:[value.report],trusted});assert.equal(history.status,"verified");assert.equal(history.snapshots[0]!.programAccountingStatus,"incomplete");assert.equal(history.records[0]!.amount,"70");
});
