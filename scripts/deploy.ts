import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, ZeroAddress, keccak256 } from "ethers";
import { ROOT, loadEnvironment, required, testNetworks, signingWallet, deploy, artifact, compareRuntime, SOURCE_CHAIN_ID, SOURCE_CHAIN_KEY, TARGET_CHAIN_ID } from "./runtime.ts";

await loadEnvironment();
const {source,target}=await testNetworks();
const path=resolve(ROOT,"deployments/testnet.json");
let manifest:any;
try {manifest=JSON.parse(await readFile(path,"utf8"));} catch(error:any) {if(error.code!=="ENOENT") throw error;}
const safe=required("SAFE_ADDRESS");
if(await source.getCode(safe)==="0x") throw new Error("Source authority must be an existing Safe contract");
if(manifest && (manifest.source.safe.toLowerCase()!==safe.toLowerCase() || manifest.source.chainId!==String(SOURCE_CHAIN_ID) || manifest.target.chainId!==String(TARGET_CHAIN_ID))) throw new Error("Existing deployment manifest does not match this testnet configuration");
manifest??={version:1,createdAt:new Date().toISOString(),scope:"Public testnet; operator and Safe are team controlled",compiler:"0.8.28+commit.7893614a",optimizerRuns:200,viaIR:true,evmVersion:"cancun",source:{chainId:String(SOURCE_CHAIN_ID),chainKey:String(SOURCE_CHAIN_KEY),rpcUrl:"https://ethereum-sepolia-rpc.publicnode.com",safe,libraries:{}},target:{chainId:String(TARGET_CHAIN_ID),rpcUrl:"https://rpc.cc3-testnet.creditcoin.network",libraries:{}},records:[]};
await mkdir(resolve(ROOT,"deployments"),{recursive:true});
const save=()=>writeFile(path,JSON.stringify(manifest,null,2)+"\n");
for(const [chain,rpc,key,names] of [
  ["source",source,"SEPOLIA_PRIVATE_KEY",["WorkTypes","AllocationTree","SourceSignatureLib","SourcePolicyV1Lib","SourceAccountingLib","SourceCoordinator"]],
  ["target",target,"CREDITCOIN_WALLET_PRIVATE_KEY",["WorkTypes","AllocationTree","WorkTreasury"]],
] as const) {
  const signer=signingWallet(key,rpc);
  for(const name of names) {
    const existing=manifest.records.find((r:any)=>r.chain===chain&&r.name===name);
    if(existing) {
      const code=await rpc.getCode(existing.address);
      if(keccak256(code)!==existing.deployedCodeHash) throw new Error(`Existing ${name} code changed`);
      compareRuntime(await artifact(name),code,existing.libraries);
      console.log(`${chain} ${name}: verified existing ${existing.address}`);
      continue;
    }
    const args=name==="WorkTreasury"?[SOURCE_CHAIN_ID,SOURCE_CHAIN_KEY,manifest.source.coordinator]:[];
    const result=await deploy(name,signer,args,manifest[chain].libraries);
    manifest.records.push({chain,...result.record,constructorArguments:args.map(v=>typeof v==="bigint"?v.toString():v)});
    if(name==="SourceCoordinator") manifest.source.coordinator=result.record.address;
    else if(name==="WorkTreasury") manifest.target.treasury=result.record.address;
    else manifest[chain].libraries[name]=result.record.address;
    await save();
    console.log(`${chain} ${name}: ${result.record.address} (${result.record.runtimeBytes} bytes)`);
  }
}
const treasury=new Contract(manifest.target.treasury,(await artifact("WorkTreasury")).abi,target);
const [chainId,chainKey,emitter,verifier]=await Promise.all([treasury.SOURCE_CHAIN_ID(),treasury.SOURCE_CHAIN_KEY(),treasury.SOURCE_COORDINATOR(),treasury.VERIFIER()]);
if(chainId!==SOURCE_CHAIN_ID||chainKey!==SOURCE_CHAIN_KEY||emitter.toLowerCase()!==manifest.source.coordinator.toLowerCase()||verifier.toLowerCase()!=="0x0000000000000000000000000000000000000fd2") throw new Error("Deployed target immutable domain mismatch");
manifest.immutableReadback={sourceChainId:String(chainId),sourceChainKey:String(chainKey),sourceCoordinator:emitter,nativeVerifier:verifier,asset:ZeroAddress,checkedAt:new Date().toISOString()};
await save();
await writeFile(resolve(ROOT,"deployments/ui-testnet.json"),JSON.stringify({source:manifest.source,target:manifest.target,scope:manifest.scope},null,2)+"\n");
console.log("Pinned public-testnet deployment and runtime correspondence saved.");
source.destroy();target.destroy();
