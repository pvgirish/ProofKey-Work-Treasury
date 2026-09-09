import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Interface, isHexString, keccak256, type JsonRpcProvider } from "ethers";
import {
  ROOT,
  SOURCE_CHAIN_KEY,
  loadEnvironment,
  saveReport,
  testNetworks,
} from "./runtime.ts";
import {
  continuityFingerprint,
  refreshNativeProof,
  type NativeContinuityProof,
} from "./refresh-native-proof.ts";

const SOURCE_REPORT = resolve(ROOT,"evidence/source-demo.json");
const PRIOR_PROOF = resolve(ROOT,"evidence/ui-proof-qa/proofkey-native-proof-33642ef4.json");
const OUTPUT_NAME = "native-recovery-verification-33642ef4.json";
const NATIVE_VERIFIER = "0x0000000000000000000000000000000000000FD2";

const verifierInterface = new Interface([
  "function verify(uint64 chainKey,uint64 height,bytes encodedTransaction,(bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof,(bytes32 lowerEndpointDigest,bytes32[] roots) continuityProof) view returns(bool)",
  "function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings) merkleProof) view returns(uint64)",
]);

type RecordedOperation = {
  label?: string;
  transactionHash?: string;
  blockNumber?: number;
};

type PriorProof = {
  transactionHash?: string;
  blockHeight?: string | number;
  proverTransactionIndex?: string | number;
  encodedTransaction?: string;
  continuityProof?: NativeContinuityProof;
};

function transactionHash(value:unknown,label:string) {
  if(typeof value!=="string" || !isHexString(value,32)) throw new Error(`${label} is not a transaction hash`);
  return value.toLowerCase();
}

function safeNumber(value:unknown,label:string) {
  const number=Number(value);
  if(!Number.isSafeInteger(number) || number<0) throw new Error(`${label} is not a safe non-negative integer`);
  return number;
}

async function simulateNativeVerification(target:JsonRpcProvider,proof:{
  blockHeight:number;
  transactionIndex:number;
  encodedTransaction:string;
  merkleProof:unknown;
  continuityProof:NativeContinuityProof;
}) {
  // provider.call is an explicit eth_call. This script never constructs or sends a transaction.
  const verifyData=verifierInterface.encodeFunctionData(
    "verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))",
    [SOURCE_CHAIN_KEY,proof.blockHeight,proof.encodedTransaction,proof.merkleProof,proof.continuityProof],
  );
  const verifyResult=await target.call({to:NATIVE_VERIFIER,data:verifyData});
  const [verified]=verifierInterface.decodeFunctionResult(
    "verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))",
    verifyResult,
  );

  const indexData=verifierInterface.encodeFunctionData("calculateTxIndex",[proof.merkleProof]);
  const indexResult=await target.call({to:NATIVE_VERIFIER,data:indexData});
  const [calculatedIndex]=verifierInterface.decodeFunctionResult("calculateTxIndex",indexResult);
  const transactionIndex=Number(calculatedIndex);
  if(!verified) throw new Error("Native verifier returned false for the refreshed proof");
  if(transactionIndex!==proof.transactionIndex) throw new Error("Native verifier transaction index differs from the source receipt");
  return {callType:"eth_call",precompile:NATIVE_VERIFIER,returned:true,calculatedTransactionIndex:transactionIndex};
}

/** Runs the fixed approve-A recovery check without a signer or transaction submission. */
export async function runNativeRecoveryVerification(source:JsonRpcProvider,target:JsonRpcProvider) {
  const [sourceReport,prior] = await Promise.all([
    readFile(SOURCE_REPORT,"utf8").then(text=>JSON.parse(text)),
    readFile(PRIOR_PROOF,"utf8").then(text=>JSON.parse(text) as PriorProof),
  ]);
  const matches=(sourceReport.operations as RecordedOperation[] | undefined)?.filter(operation=>operation.label==="approve-A") ?? [];
  if(matches.length!==1) throw new Error("Source demo must contain exactly one approve-A operation");
  const operation=matches[0];
  const requestedHash=transactionHash(operation.transactionHash,"Recorded approve-A hash");
  if(transactionHash(prior.transactionHash,"Prior proof hash")!==requestedHash) throw new Error("Prior proof is not for recorded approve-A");
  const recordedHeight=safeNumber(operation.blockNumber,"Recorded approve-A height");
  if(safeNumber(prior.blockHeight,"Prior proof height")!==recordedHeight) throw new Error("Prior proof height differs from source report");
  const priorIndex=safeNumber(prior.proverTransactionIndex,"Prior proof transaction index");
  if(typeof prior.encodedTransaction!=="string" || !isHexString(prior.encodedTransaction) || prior.encodedTransaction==="0x") {
    throw new Error("Prior proof has no encoded transaction bytes");
  }
  if(!prior.continuityProof) throw new Error("Prior proof has no continuity proof");

  const refreshed=await refreshNativeProof({
    source,target,transactionHash:requestedHash,
    priorEncodedTransaction:prior.encodedTransaction,
    priorContinuityProof:prior.continuityProof,
    save:false,
  });
  if(refreshed.proof.blockHeight!==recordedHeight || refreshed.proof.transactionIndex!==priorIndex) {
    throw new Error("Refreshed proof position differs from recorded approve-A evidence");
  }

  const priorEncodedTransactionHash=keccak256(prior.encodedTransaction);
  const refreshedEncodedTransactionHash=keccak256(refreshed.proof.encodedTransaction);
  const exactEncodedBytesEqual=prior.encodedTransaction.toLowerCase()===refreshed.proof.encodedTransaction.toLowerCase();
  if(!exactEncodedBytesEqual || priorEncodedTransactionHash!==refreshedEncodedTransactionHash) {
    throw new Error("Refreshed approve-A encoding differs from prior evidence");
  }
  const priorContinuityFingerprint=continuityFingerprint(prior.continuityProof);
  const refreshedContinuityFingerprint=continuityFingerprint(refreshed.continuityProof);
  const nativeSimulation=await simulateNativeVerification(target,refreshed.proof);

  const report={
    schema:"proofkey.native-recovery-verification.v1",
    checkedAt:new Date().toISOString(),
    readOnly:true,
    transaction:{
      label:"approve-A",
      transactionHash:requestedHash,
      blockHeight:refreshed.proof.blockHeight,
      transactionIndex:refreshed.proof.transactionIndex,
    },
    generator:refreshed.generator,
    targetAttestedHeight:refreshed.targetAttestedHeight,
    targetAttestedHash:refreshed.targetAttestedHash,
    encodedTransaction:{
      priorHash:priorEncodedTransactionHash,
      refreshedHash:refreshedEncodedTransactionHash,
      exactBytesEqual:exactEncodedBytesEqual,
    },
    continuity:{
      priorFingerprint:priorContinuityFingerprint,
      refreshedFingerprint:refreshedContinuityFingerprint,
      changed:priorContinuityFingerprint!==refreshedContinuityFingerprint,
      priorRootCount:prior.continuityProof.roots.length,
      refreshedRootCount:refreshed.continuityProof.roots.length,
    },
    nativeSimulation,
    conclusion:"Freshly regenerated approve-A evidence was accepted by the fixed Creditcoin native verifier in a read-only call.",
  };
  await saveReport(OUTPUT_NAME,report);
  return report;
}

async function main() {
  await loadEnvironment();
  const {source,target}=await testNetworks();
  try {
    const report=await runNativeRecoveryVerification(source,target);
    console.log(JSON.stringify(report,null,2));
  } finally {
    source.destroy(); target.destroy();
  }
}

if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)) {
  main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
}
