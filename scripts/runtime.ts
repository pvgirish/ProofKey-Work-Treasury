import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ContractFactory, Contract, FetchRequest, JsonRpcProvider, Wallet, NonceManager, keccak256, type Signer } from "ethers";

export const ROOT = resolve(import.meta.dirname, "..");
export const SOURCE_CHAIN_ID = 11155111n;
export const TARGET_CHAIN_ID = 102031n;
export const SOURCE_CHAIN_KEY = 1n;

/** Reads only the requested local environment file. Never logs contents or private keys. */
export async function loadEnvironment(): Promise<void> {
  const path=process.env.PROOFKEY_ENV_FILE ?? resolve(ROOT,".env");
  let text: string;
  try { text=await readFile(path,"utf8"); } catch { return; }
  for(const line of text.split(/\r?\n/)) {
    const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]!==undefined) continue;
    let value=match[2];
    if ((value.startsWith('"')&&value.endsWith('"')) || (value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    process.env[match[1]]=value;
  }
}

export function required(name:string):string {
  const value=process.env[name]; if(!value) throw new Error(`Missing ${name}`); return value;
}

export function provider(url:string,chainId:bigint):JsonRpcProvider {
  const req=new FetchRequest(url); req.timeout=15000;
  return new JsonRpcProvider(req,chainId,{staticNetwork:true,batchMaxCount:1});
}

export async function testNetworks() {
  const source=provider(process.env.SOURCE_CHAIN_RPC_URL??"https://ethereum-sepolia-rpc.publicnode.com",SOURCE_CHAIN_ID);
  const target=provider(process.env.CREDITCOIN_RPC_URL??"https://rpc.cc3-testnet.creditcoin.network",TARGET_CHAIN_ID);
  const ids=await Promise.all([source.send("eth_chainId",[]),target.send("eth_chainId",[])]);
  if(BigInt(ids[0])!==SOURCE_CHAIN_ID || BigInt(ids[1])!==TARGET_CHAIN_ID) throw new Error("Wrong network; this release runner only permits Sepolia and Creditcoin testnet.");
  if(process.env.SOURCE_CHAIN_KEY && BigInt(process.env.SOURCE_CHAIN_KEY)!==SOURCE_CHAIN_KEY) throw new Error("Wrong native source chain key.");
  return {source,target};
}

export function signingWallet(keyName:string,rpc:JsonRpcProvider):NonceManager {
  return new NonceManager(new Wallet(required(keyName),rpc));
}

export async function artifact(name:string):Promise<any> {
  return JSON.parse(await readFile(resolve(ROOT,`out/${name}.sol/${name}.json`),"utf8"));
}

export function linkedBytecode(a:any,links:Record<string,string>,runtime=false):string {
  const section = runtime ? a.deployedBytecode : a.bytecode;
  let code:string=section.object.replace(/^0x/,"");
  for(const [file,items] of Object.entries(section.linkReferences??{}) as [string,any][]) {
    for(const [name,locations] of Object.entries(items) as [string,any][]) {
      const address=links[`${file}:${name}`]??links[name];
      if(!address) throw new Error(`Missing immutable library link ${file}:${name}`);
      const raw=address.replace(/^0x/,""); if(!/^[0-9a-fA-F]{40}$/.test(raw)) throw new Error("Invalid library address");
      for(const location of locations) {
        if(location.length!==20) throw new Error("Unexpected library link width");
        code=code.slice(0,location.start*2)+raw+code.slice((location.start+20)*2);
      }
    }
  }
  if(!/^[0-9a-fA-F]+$/.test(code)) throw new Error("Unresolved bytecode link");
  return `0x${code}`;
}

/** Checks every deployed byte except compiler-declared immutable slots; callers separately read all public immutables. */
export function compareRuntime(a:any,code:string,links:Record<string,string>) {
  const template=linkedBytecode(a,links,true).toLowerCase();
  if(template.length!==code.length) throw new Error("Deployed runtime length differs from compiled artifact");
  let actual=code.toLowerCase(), expected=template;
  const slots:Record<string,string[]>={};
  for(const [id,locations] of Object.entries(a.deployedBytecode.immutableReferences??{}) as [string,any][]) {
    slots[id]=[];
    for(const loc of locations) {
      const start=2+loc.start*2, end=start+loc.length*2;
      slots[id].push(code.slice(start,end));
      const mask="0".repeat(loc.length*2);
      actual=actual.slice(0,start)+mask+actual.slice(end);
      expected=expected.slice(0,start)+mask+expected.slice(end);
    }
    if(new Set(slots[id].map(v=>v.toLowerCase())).size!==1) throw new Error("Repeated immutable slots disagree");
  }
  if(actual!==expected) throw new Error("Deployed runtime differs from linked compiled artifact");
  return {matchesCompiledRuntimeOutsideImmutableSlots:true,immutableValues:slots};
}

export async function deploy(name:string,signer:Signer,args:unknown[]=[],links:Record<string,string>={}) {
  const a=await artifact(name);
  const factory=new ContractFactory(a.abi,linkedBytecode(a,links),signer);
  const request=await factory.getDeployTransaction(...args);
  const gas=await signer.estimateGas(request);
  const contract=await factory.deploy(...args,{gasLimit:gas*12n/10n});
  const tx=contract.deploymentTransaction(); if(!tx) throw new Error("Missing deployment transaction");
  const receipt=await tx.wait(); if(!receipt||receipt.status!==1) throw new Error(`${name} deployment failed`);
  const address=await contract.getAddress();
  const code=await signer.provider!.getCode(address);
  const runtimeSize=(code.length-2)/2;
  if(runtimeSize===0 || runtimeSize>24576) throw new Error(`${name} invalid deployed runtime size`);
  const correspondence=compareRuntime(a,code,links);
  return {contract:new Contract(address,a.abi,signer),record:{name,address,transactionHash:tx.hash,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),runtimeBytes:runtimeSize,deployedCodeHash:keccak256(code),libraries:{...links},...correspondence}};
}

export async function saveReport(name:string,data:unknown) {
  await mkdir(resolve(ROOT,"evidence"),{recursive:true});
  await writeFile(resolve(ROOT,"evidence",name),JSON.stringify(data,(_k,v)=>typeof v==="bigint"?v.toString():v,2)+"\n");
}

export async function mined(transaction:Promise<any>) {
  const tx=await transaction; const receipt=await tx.wait();
  if(!receipt||receipt.status!==1) throw new Error(`Transaction failed: ${tx.hash}`);
  return receipt;
}
