import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { collectProgramCloseout, parseProgramCloseoutLocator, stringifyCollectedProgramCloseout, type CollectorDeployment } from "../sdk/program-collector.ts";
import { parseWorkAuthorizationPackage } from "../sdk/work-authorization.ts";
import { ROOT } from "./runtime.ts";

function values(flag:string){const result:string[]=[];for(let index=2;index<process.argv.length;index++)if(process.argv[index]===flag&&process.argv[index+1])result.push(process.argv[++index]!);return result;}
function value(flag:string,fallback?:string){return values(flag)[0]??fallback;}
async function json(path:string){return JSON.parse(await readFile(resolve(ROOT,path),"utf8"));}
async function atomic(path:string,text:string){const temporary=`${path}.tmp`;await writeFile(temporary,`${text}\n`);await rename(temporary,path);}
function record(manifest:any,chain:"source"|"target",name:string){const row=manifest.records?.find((item:any)=>item.chain===chain&&item.name===name);if(!row?.address||!row?.deployedCodeHash||!Number.isSafeInteger(row.blockNumber)||row.matchesCompiledRuntimeOutsideImmutableSlots!==true)throw new Error(`manifest lacks trusted ${chain} ${name} deployment record`);return row;}

const manifest=await json(value("--manifest","deployments/testnet.json")!);
const sourceRecord=record(manifest,"source","SourceCoordinator"),targetRecord=record(manifest,"target","WorkTreasury");
const trusted:CollectorDeployment={sourceChainId:String(manifest.source.chainId),sourceChainKey:String(manifest.source.chainKey),sourceCoordinator:sourceRecord.address,sourceRuntimeHash:sourceRecord.deployedCodeHash,sourceDeploymentBlock:sourceRecord.blockNumber,targetChainId:String(manifest.target.chainId),targetTreasury:targetRecord.address,targetRuntimeHash:targetRecord.deployedCodeHash,targetDeploymentBlock:targetRecord.blockNumber};
const imported=value("--input")?parseProgramCloseoutLocator(await json(value("--input")!)):undefined;
if(imported&&(imported.source.chainId!==trusted.sourceChainId||imported.source.coordinator.toLowerCase()!==trusted.sourceCoordinator.toLowerCase()||imported.source.runtimeHash.toLowerCase()!==trusted.sourceRuntimeHash.toLowerCase()||imported.target.chainId!==trusted.targetChainId||imported.target.sourceChainKey!==trusted.sourceChainKey||imported.target.treasury.toLowerCase()!==trusted.targetTreasury.toLowerCase()||imported.target.runtimeHash.toLowerCase()!==trusted.targetRuntimeHash.toLowerCase()))throw new Error("imported closeout locator differs from trusted deployment");
let epochId=value("--epoch")??imported?.epochId;if(!epochId)epochId=(await json("evidence/source-demo.json")).epochId;
if(!/^0x[0-9a-f]{64}$/i.test(epochId))throw new Error("epoch locator must be bytes32");
const authorizationPackets=[...await Promise.all(values("--authorization").map(async path=>parseWorkAuthorizationPackage(await json(path)))),...(imported?.authorizationPackets??[])];
if(new Set(authorizationPackets.map(packet=>packet.orderId.toLowerCase())).size!==authorizationPackets.length)throw new Error("duplicate authorization packet locator");
const source=new JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL??manifest.source.rpcUrl),target=new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL??manifest.target.rpcUrl);
try{
  const [sourceChain,targetChain]=await Promise.all([source.send("eth_chainId",[]),target.send("eth_chainId",[])]);if(BigInt(sourceChain)!==BigInt(trusted.sourceChainId)||BigInt(targetChain)!==BigInt(trusted.targetChainId))throw new Error("RPC chain IDs differ from trusted deployment");
  const sourceAbi=(await json("out/SourceCoordinator.sol/SourceCoordinator.json")).abi,targetAbi=(await json("out/WorkTreasury.sol/WorkTreasury.json")).abi;
  const chainInfo=new Contract("0x0000000000000000000000000000000000000fd3",["function get_latest_attestation_height_and_hash(uint64) view returns((uint64 height,bytes32 hash,bool isAttestation,bool exists))"],target);
  const collected=await collectProgramCloseout({source,target,sourceAbi,targetAbi,deployment:trusted,epochId:epochId as `0x${string}`,authorizationPackets,getNativeFrontier:async(chainKey,targetBlock)=>{const row=await chainInfo.get_latest_attestation_height_and_hash.staticCall(chainKey,{blockTag:targetBlock});return{height:BigInt(row.height),hash:row.hash,exists:Boolean(row.exists)};}});
  const output=resolve(ROOT,value("--output","evidence/program-closeout.json")!);await atomic(output,stringifyCollectedProgramCloseout(collected));
  console.log(JSON.stringify({outputPath:output,epochId,status:collected.status,accountingStatus:collected.accountingStatus,label:collected.label,epoch:collected.epoch,errors:[...collected.result.errors,...collected.errors],incomplete:collected.result.incomplete,consent:collected.result.consent,returnAccounting:collected.returnAccounting},null,2));if(collected.status==="invalid")process.exitCode=1;
}finally{source.destroy();target.destroy();}
