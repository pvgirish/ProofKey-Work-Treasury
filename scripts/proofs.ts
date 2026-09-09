import { Contract, type JsonRpcProvider, keccak256 } from "ethers";
import { chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { SOURCE_CHAIN_KEY, saveReport } from "./runtime.ts";

export async function fetchNativeBundle(source:JsonRpcProvider,target:JsonRpcProvider,transactionHashes:string[]) {
  if(transactionHashes.length===0||transactionHashes.length>32) throw new Error("Proof bundle requires 1–32 transactions");
  const receipts=await Promise.all(transactionHashes.map(hash=>source.getTransactionReceipt(hash)));
  if(receipts.some(r=>!r||r.status!==1)) throw new Error("Expected successful source receipts");
  const height=Math.max(...receipts.map(r=>r!.blockNumber));
  const info=new chainInfo.PrecompileChainInfoProvider(target as any);
  const frontier=await info.getLatestAttestedHeightAndHash(Number(SOURCE_CHAIN_KEY));
  if(!frontier.exists||frontier.height<height) return {ready:false as const,requiredHeight:height,attestedHeight:frontier.height};
  const url=process.env.PROOF_BUILDER_URL??"https://prover.cc3-testnet.creditcoin.network";
  const builder=new proofProvider.service.ProofBuilder(Number(SOURCE_CHAIN_KEY),url,30000);
  let proofs:any[],continuityProof:any;
  if(transactionHashes.length===1) {
    const response=await builder.getProof(transactionHashes[0]);
    if(!response.success||!response.data) throw new Error(`Proof service unavailable: ${response.error??"empty response"}`);
    const p=response.data;
    if(p.chainKey!==Number(SOURCE_CHAIN_KEY)||p.txHash.toLowerCase()!==transactionHashes[0].toLowerCase()||p.headerNumber!==height) throw new Error("Proof response does not match requested transaction/domain/height");
    continuityProof=p.continuityProof;
    proofs=[{transactionHash:p.txHash,blockHeight:p.headerNumber,encodedTransaction:p.txBytes,merkleProof:p.merkleProof,continuityProof:p.continuityProof}];
  } else {
    const response=await builder.getBatchProof(transactionHashes);
    if(!response.success||!response.data) throw new Error(`Batch proof service unavailable: ${response.error??"empty response"}`);
    if(response.data.chainKey!==Number(SOURCE_CHAIN_KEY)) throw new Error("Batch proof source key mismatch");
    continuityProof=response.data.continuityProof;
    const byHash=new Map<string,any>();
    for(const [blockHeight,entries] of response.data.merkleProofs) for(const entry of entries.values()) {
      const key=entry.txHash.toLowerCase();
      if(byHash.has(key)) throw new Error("Duplicate proof response for source transaction");
      byHash.set(key,{transactionHash:entry.txHash,blockHeight,encodedTransaction:entry.txBytes,merkleProof:entry.merkleProof,continuityProof});
    }
    proofs=transactionHashes.map((hash,index)=>{
      const p=byHash.get(hash.toLowerCase());
      if(!p||p.blockHeight!==receipts[index]!.blockNumber) throw new Error("Missing or substituted batch transaction");
      return p;
    });
  }
  // This is only a usable request bundle. Native authenticity is established by the target verifier call.
  const bundle={ready:true as const,fetchedAt:new Date().toISOString(),sourceChainKey:Number(SOURCE_CHAIN_KEY),attestedHeight:frontier.height,proofs,continuityProof};
  await saveReport(`native-bundle-${transactionHashes[0].slice(2,12)}.json`,bundle);
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
