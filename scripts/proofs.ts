import { Contract, isHexString, type JsonRpcProvider, keccak256 } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { SOURCE_CHAIN_KEY, saveReport } from "./runtime.ts";
import {
  continuityFingerprint,
  refreshNativeProofBundle,
  type NativeContinuityProof,
} from "./refresh-native-proof.ts";

export type FetchNativeBundleOptions = {
  /** Skip the hosted proof service and rebuild from source RPC data. */
  refresh?: boolean;
  /** Optional prior bytes make raw recovery fail closed if transaction encoding changes. */
  priorEncodedTransactions?: Readonly<Record<string,string>>;
  priorContinuityProof?: NativeContinuityProof;
};

function proofBytes(value:unknown) {
  if(typeof value!=="string" || value==="0x" || !isHexString(value)) throw new Error("Proof response contains invalid encoded transaction bytes");
  return value;
}

function proofHash(value:unknown) {
  if(typeof value!=="string" || !isHexString(value,32)) throw new Error("Proof response contains an invalid transaction hash");
  return value.toLowerCase();
}

function serviceMerkle(value:any) {
  proofHash(value?.root);
  if(!Array.isArray(value?.siblings)) throw new Error("Proof response contains invalid Merkle siblings");
  for(const sibling of value.siblings) {
    proofHash(sibling?.hash);
    if(typeof sibling?.isLeft!=="boolean") throw new Error("Proof response contains an invalid Merkle direction");
  }
  return value;
}

function serviceContinuity(value:any):NativeContinuityProof {
  const proof={lowerEndpointDigest:value?.lowerEndpointDigest,roots:value?.roots};
  continuityFingerprint(proof);
  return proof;
}

export async function fetchNativeBundle(
  source:JsonRpcProvider,
  target:JsonRpcProvider,
  transactionHashes:string[],
  options:FetchNativeBundleOptions={},
) {
  if(transactionHashes.length===0||transactionHashes.length>32) throw new Error("Proof bundle requires 1–32 transactions");
  const normalized=transactionHashes.map(proofHash);
  if(new Set(normalized).size!==normalized.length) throw new Error("Proof bundle contains duplicate transactions");
  const receipts=await Promise.all(normalized.map(hash=>source.getTransactionReceipt(hash)));
  if(receipts.some(r=>!r||r.status!==1)) throw new Error("Expected successful source receipts");
  const height=Math.max(...receipts.map(r=>r!.blockNumber));
  const info=new chainInfo.PrecompileChainInfoProvider(target as any);
  const frontier=await info.getLatestAttestedHeightAndHash(Number(SOURCE_CHAIN_KEY));
  if(!frontier.exists||frontier.height<height) return {ready:false as const,requiredHeight:height,attestedHeight:frontier.height};
  let proofs:any[],continuityProof:NativeContinuityProof,proofOrigin:"hosted-service"|"raw-rpc-refresh";
  const refresh=options.refresh===true || process.env.PROOFKEY_REFRESH_NATIVE_PROOF==="1";
  if(!refresh) {
    try {
      const url=process.env.PROOF_BUILDER_URL??"https://prover.cc3-testnet.creditcoin.network";
      const builder=new proofProvider.service.ProofBuilder(Number(SOURCE_CHAIN_KEY),url,30000);
      if(normalized.length===1) {
        const response=await builder.getProof(normalized[0]);
        if(!response.success||!response.data) throw new Error(`Proof service unavailable: ${response.error??"empty response"}`);
        const p=response.data;
        continuityProof=serviceContinuity(p.continuityProof);
        if(p.chainKey!==Number(SOURCE_CHAIN_KEY)
          || proofHash(p.txHash)!==normalized[0]
          || p.headerNumber!==receipts[0]!.blockNumber
          || p.txIndex!==receipts[0]!.index) throw new Error("Proof response does not match requested transaction/domain/position");
        proofs=[{transactionHash:normalized[0],blockHeight:p.headerNumber,transactionIndex:p.txIndex,encodedTransaction:proofBytes(p.txBytes),merkleProof:serviceMerkle(p.merkleProof),continuityProof}];
      } else {
        const response=await builder.getBatchProof(normalized);
        if(!response.success||!response.data) throw new Error(`Batch proof service unavailable: ${response.error??"empty response"}`);
        if(response.data.chainKey!==Number(SOURCE_CHAIN_KEY)) throw new Error("Batch proof source key mismatch");
        continuityProof=serviceContinuity(response.data.continuityProof);
        const requested=new Set(normalized);
        const byHash=new Map<string,any>();
        for(const [blockHeight,entries] of response.data.merkleProofs) for(const [transactionIndex,entry] of entries) {
          const key=proofHash(entry.txHash);
          if(!requested.has(key)||byHash.has(key)) throw new Error("Unexpected or duplicate proof response for source transaction");
          byHash.set(key,{transactionHash:key,blockHeight,transactionIndex,encodedTransaction:proofBytes(entry.txBytes),merkleProof:serviceMerkle(entry.merkleProof),continuityProof});
        }
        proofs=normalized.map((hash,index)=>{
          const p=byHash.get(hash);
          if(!p||p.blockHeight!==receipts[index]!.blockNumber||p.transactionIndex!==receipts[index]!.index) {
            throw new Error("Missing or substituted batch transaction");
          }
          return p;
        });
      }
      proofOrigin="hosted-service";
    } catch {
      // The raw builder is a continuity-preserving recovery path for an unavailable
      // or structurally invalid service response. It still requires live source data.
      console.warn("Hosted proof response unavailable or malformed; rebuilding from source RPC data.");
      const rebuilt=await refreshNativeProofBundle({
        source,target,transactionHashes:normalized,
        priorEncodedTransactions:options.priorEncodedTransactions,
        priorContinuityProof:options.priorContinuityProof,
        save:false,
      });
      proofs=rebuilt.proofs;
      continuityProof=rebuilt.continuityProof;
      proofOrigin="raw-rpc-refresh";
    }
  } else {
    const rebuilt=await refreshNativeProofBundle({
      source,target,transactionHashes:normalized,
      priorEncodedTransactions:options.priorEncodedTransactions,
      priorContinuityProof:options.priorContinuityProof,
      save:false,
    });
    proofs=rebuilt.proofs;
    continuityProof=rebuilt.continuityProof;
    proofOrigin="raw-rpc-refresh";
  }
  // This is only a usable request bundle. Native authenticity is established by the target verifier call.
  const bundle={
    ready:true as const,
    fetchedAt:new Date().toISOString(),
    sourceChainKey:Number(SOURCE_CHAIN_KEY),
    attestedHeight:frontier.height,
    proofOrigin,
    continuityFingerprint:continuityFingerprint(continuityProof),
    proofs,
    continuityProof,
  };
  await saveReport(`native-bundle-${normalized[0].slice(2,12)}.json`,bundle);
  return bundle;
}

export function singleProof(proof:any) {
  return {blockHeight:proof.blockHeight,encodedTransaction:proof.encodedTransaction,merkleProof:proof.merkleProof,continuityProof:proof.continuityProof};
}

export async function authenticatedPositions(treasury:Contract,proofs:any[]) {
  const verifier=new Contract(await treasury.VERIFIER(),["function calculateTxIndex((bytes32 root,(bytes32 hash,bool isLeft)[] siblings) proof) pure returns(uint64)"],treasury.runner);
  return Promise.all(proofs.map(async proof=>{
    const position={blockHeight:proof.blockHeight,transactionIndex:await verifier.calculateTxIndex(proof.merkleProof)};
    if(!await treasury.isAuthenticated(position,proof.encodedTransaction)) throw new Error("Expected native authentication is not persisted on target");
    return {...position,encodedTransactionHash:keccak256(proof.encodedTransaction)};
  }));
}
