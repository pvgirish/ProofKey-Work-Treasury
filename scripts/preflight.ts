import { Wallet, formatEther, Contract } from "ethers";
import { chainInfo } from "@gluwa/usc-sdk";
import { loadEnvironment,testNetworks,required,SOURCE_CHAIN_KEY,SOURCE_CHAIN_ID,TARGET_CHAIN_ID,saveReport } from "./runtime.ts";

await loadEnvironment();
const {source,target}=await testNetworks();
const sourceAddress=new Wallet(required("SEPOLIA_PRIVATE_KEY")).address;
const targetAddress=new Wallet(required("CREDITCOIN_WALLET_PRIVATE_KEY")).address;
const info=new chainInfo.PrecompileChainInfoProvider(target as any);
const [sourceInfo,frontier,sourceBalance,targetBalance]=await Promise.all([
  info.getSupportedChainByKey(Number(SOURCE_CHAIN_KEY)), info.getLatestAttestedHeightAndHash(Number(SOURCE_CHAIN_KEY)),
  source.getBalance(sourceAddress),target.getBalance(targetAddress),
]);
if(!sourceInfo || sourceInfo.chainId!==Number(SOURCE_CHAIN_ID) || !frontier.exists) throw new Error("Native chain registration/frontier does not match Sepolia.");
let safe=null;
if(process.env.SAFE_ADDRESS) {
  const address=process.env.SAFE_ADDRESS;
  const contract=new Contract(address,["function VERSION() view returns(string)","function getOwners() view returns(address[])","function getThreshold() view returns(uint256)","function nonce() view returns(uint256)"],source);
  const [code,version,owners,threshold,nonce]=await Promise.all([source.getCode(address),contract.VERSION(),contract.getOwners(),contract.getThreshold(),contract.nonce()]);
  safe={address,hasCode:code!=="0x",version,owners:Array.from(owners),threshold,nonce,control:"Existing user-controlled Safe; not an independent buyer"};
}
const report={checkedAt:new Date().toISOString(),readOnly:true,sourceChainId:SOURCE_CHAIN_ID,targetChainId:TARGET_CHAIN_ID,sourceChainKey:SOURCE_CHAIN_KEY,encoding:sourceInfo.chainEncoding,frontierHeight:frontier.height,sourceDeployer:{address:sourceAddress,balance:formatEther(sourceBalance)},targetDeployer:{address:targetAddress,balance:formatEther(targetBalance)},safe};
await saveReport("preflight.json",report);
console.log(JSON.stringify(report,(_k,v)=>typeof v==="bigint"?v.toString():v,2));
source.destroy();target.destroy();
