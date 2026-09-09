import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatEther, isHexString } from "ethers";
import { ROOT } from "./runtime.ts";

const OUTPUT=resolve(ROOT,"docs/PUBLIC-EVIDENCE.md");
const RAW_BASE="https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence";
const EXPLORERS={
  source:"https://sepolia.etherscan.io/tx/",
  target:"https://creditcoin-testnet.blockscout.com/tx/",
} as const;

type EvidenceName=
  |"public-demo.json"
  |"public-branches.json"
  |"public-safe-rotation.json"
  |"source-demo.json"
  |"source-branches.json"
  |"native-recovery-verification-33642ef4.json"
  |"public-refusal-checks.json"
  |"release-readback.json";

type Operation={
  label?:string;
  chain?:string;
  transactionHash?:string;
  outerTransactionHash?:string;
  blockNumber?:number|string;
  gasUsed?:number|string;
  status?:number|string;
};

const names:EvidenceName[]=[
  "public-demo.json",
  "public-branches.json",
  "public-safe-rotation.json",
  "source-demo.json",
  "source-branches.json",
  "native-recovery-verification-33642ef4.json",
  "public-refusal-checks.json",
  "release-readback.json",
];

async function readOptional(name:EvidenceName):Promise<any|null>{
  try{return JSON.parse(await readFile(resolve(ROOT,"evidence",name),"utf8"));}
  catch(error:any){if(error.code!=="ENOENT")throw error;return null;}
}

function escapeCell(value:unknown):string{
  return String(value??"—").replaceAll("|","\\|").replaceAll("\n"," ");
}

function title(value:string):string{
  return value.split("-").filter(Boolean).map(word=>word[0]!.toUpperCase()+word.slice(1)).join(" ");
}

function evidenceLinks(name:EvidenceName):string{
  return `[repository file](../evidence/${name}) · [raw GitHub evidence](${RAW_BASE}/${name})`;
}

function chainFor(name:EvidenceName,operation:Operation):"source"|"target"|"unknown"{
  if(operation.chain==="source"||operation.chain==="target")return operation.chain;
  if(name==="source-demo.json"||name==="source-branches.json")return "source";
  if(name==="public-demo.json"||name==="public-branches.json")return "target";
  return "unknown";
}

function txLink(chain:"source"|"target"|"unknown",hash:unknown,name:EvidenceName):string{
  if(typeof hash!=="string"||!isHexString(hash,32))return "—";
  const url=chain==="unknown"?`${RAW_BASE}/${name}`:`${EXPLORERS[chain]}${hash}`;
  return `[${hash}](${url})`;
}

function gas(value:unknown):string{
  if(value===undefined||value===null)return "—";
  try{return BigInt(value as any).toLocaleString("en-US");}catch{return escapeCell(value);}
}

function operationState(operation:Operation):string{
  if(operation.status===undefined||operation.status===null)return "Mined";
  return Number(operation.status)===1?"Success":Number(operation.status)===0?"Failed":`Status ${operation.status}`;
}

function describeState(value:unknown):string{
  if(typeof value!=="string"||!value)return "Pending — no status recorded";
  const exact:Record<string,string>={
    "first-native-return-complete-awaiting-source-resume":"In progress — RETURN 50 is recognized on target; the remaining source and target steps are pending",
    "main-journey-complete":"Complete — the built-in main journey reports its final target state",
    "waiting-for-order-C-delivery-block":"In progress — A is approved, B is mutually settled, and C is waiting for its no-delivery deadline",
    "source-complete-awaiting-target-proofing":"Source complete — target status is reported separately",
    "source-complete-awaiting-final-target-recognition":"Source complete — target status is reported separately",
    "awaiting-final-native-attestation":"In progress — final source receipt is waiting for native attestation",
    "awaiting-branch-native-attestation":"In progress — source branch scenarios are complete and target proofing is waiting for native attestation",
    "public-branches-and-expiry-complete":"Complete — branch recognition, successor expiry, and recorded withdrawals report completion",
    "source-branches-complete-awaiting-target-proofing":"Source complete — target status is reported separately",
    "public-safe-rotation-complete":"Complete — the disposable Safe rotation journey reports completion",
    "disposable-safe-rotation-complete":"Complete — the disposable Safe rotation journey reports completion",
  };
  if(exact[value])return exact[value];
  const lower=value.toLowerCase();
  if(lower.includes("complete")&&!lower.includes("awaiting"))return `Complete — ${title(value)}`;
  if(lower.includes("await")||lower.includes("waiting")||lower.includes("pending"))return `In progress — ${title(value)}`;
  return title(value);
}

function sourceReturnAmount(source:any):bigint|null{
  const value=source?.readback?.returned??source?.returned;
  if(value===undefined)return null;
  try{return BigInt(value);}catch{return null;}
}

function allocationReturnMap(source:any):Map<string,bigint>{
  const map=new Map<string,bigint>();
  for(const allocation of source?.readback?.allocations??source?.allocations??[]){
    if(Number(allocation.kind)===3)map.set(String(allocation.allocationId),BigInt(allocation.amount));
  }
  return map;
}

function mainReturnState(publicDemo:any,sourceDemo:any){
  const returns=allocationReturnMap(sourceDemo);
  const recognized=new Set<string>();
  if(publicDemo?.return50BeforeB)recognized.add("2");
  for(const operation of publicDemo?.operations??[]){
    const match=String(operation.label??"").match(/^cached-root-recognize-(\d+)$/);
    if(match&&returns.has(match[1]!))recognized.add(match[1]!);
  }
  let recognizedAmount=0n;
  for(const id of recognized)recognizedAmount+=returns.get(id)??0n;
  const sourceAmount=sourceReturnAmount(sourceDemo);
  const withdrawn=Boolean(publicDemo?.freeWithdrawn||(publicDemo?.operations??[]).some((operation:Operation)=>operation.label==="withdraw-returned-65"));
  return {
    source:sourceAmount===null?"Pending":`${formatEther(sourceAmount)} CTC in the latest source readback`,
    recognized:`${formatEther(recognizedAmount)} CTC confirmed as target free-balance credit`,
    withdrawn:withdrawn&&sourceAmount!==null?`${formatEther(sourceAmount)} CTC withdrawal recorded`:"No returned-funds withdrawal recorded",
  };
}

function branchReturnState(publicBranches:any,sourceBranches:any){
  const returns=allocationReturnMap(sourceBranches);
  let recognized=0n;
  for(const operation of publicBranches?.operations??[]){
    const match=String(operation.label??"").match(/^branch-root-recognize-(\d+)$/);
    if(match)recognized+=returns.get(match[1]!)??0n;
  }
  if((publicBranches?.operations??[]).some((operation:Operation)=>operation.label==="native-single-recognize-proven-expiry-return")){
    recognized+=BigInt(publicBranches?.successor?.config?.cap??0);
  }
  const sourceAmount=sourceReturnAmount(sourceBranches);
  const withdrawn=Boolean(publicBranches?.refundWithdrawn||(publicBranches?.operations??[]).some((operation:Operation)=>operation.label==="withdraw-branch-and-successor-return-11"));
  return {
    source:sourceAmount===null?"Pending":`${formatEther(sourceAmount)} CTC in the primary source epoch`,
    recognized:`${formatEther(recognized)} CTC confirmed as target free-balance credit${recognized>0n?"; some may have funded the successor epoch":""}`,
    withdrawn:withdrawn&&sourceAmount!==null?`${formatEther(sourceAmount)} CTC withdrawal recorded`:"No returned-funds withdrawal recorded",
  };
}

function rotationReturnState(rotation:any){
  if(!rotation)return {source:"Pending",recognized:"Pending",withdrawn:"Pending"};
  const returns=allocationReturnMap(rotation?.sourceReadback);
  const sourceAmount=[...returns.values()].reduce((sum,amount)=>sum+amount,0n);
  const recognized=(rotation.operations??[]).some((operation:Operation)=>operation.label==="recognize-disposable-safe-return-receipt")?sourceAmount:0n;
  const withdrawal=(rotation.operations??[]).find((operation:Operation)=>String(operation.label).includes("withdraw")&&String(operation.label).includes("return"));
  return {
    source:`${formatEther(sourceAmount)} CTC in the source readback`,
    recognized:`${formatEther(recognized)} CTC confirmed as target free-balance credit`,
    withdrawn:withdrawal?`Withdrawal recorded by ${withdrawal.label}`:"No returned-funds withdrawal recorded",
  };
}

function operationsSection(name:EvidenceName,document:any,fallback:string):string{
  const operations:Array<Operation>=Array.isArray(document?.operations)?document.operations:[];
  const lines=[`### ${fallback}`,"",evidenceLinks(name),""];
  if(!document){lines.push("Pending — evidence file is not present.","");return lines.join("\n");}
  if(operations.length===0){lines.push("No chain operations are recorded yet.","");return lines.join("\n");}
  lines.push("| Chain | Operation | Transaction | Block | Gas used | Receipt |","|---|---|---|---:|---:|---|");
  for(const operation of operations){
    const chain=chainFor(name,operation);
    const hash=operation.transactionHash??operation.outerTransactionHash;
    lines.push(`| ${chain==="unknown"?"Unspecified":chain==="source"?"Ethereum Sepolia":"Creditcoin testnet"} | ${escapeCell(operation.label)} | ${txLink(chain,hash,name)} | ${escapeCell(operation.blockNumber)} | ${gas(operation.gasUsed)} | ${operationState(operation)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(){
  const loaded=await Promise.all(names.map(async name=>[name,await readOptional(name)] as const));
  const evidence=Object.fromEntries(loaded) as Record<EvidenceName,any|null>;
  const mainPublic=evidence["public-demo.json"],mainSource=evidence["source-demo.json"];
  const branchesPublic=evidence["public-branches.json"],branchesSource=evidence["source-branches.json"];
  const rotation=evidence["public-safe-rotation.json"];
  const recovery=evidence["native-recovery-verification-33642ef4.json"];
  const refusalChecks=evidence["public-refusal-checks.json"];
  const readback=evidence["release-readback.json"];
  const rows=[
    ["Main journey — source",mainSource?describeState(mainSource.status):"Pending — source evidence file is missing",evidenceLinks("source-demo.json")],
    ["Main journey — target",mainPublic?describeState(mainPublic.stage):"Pending — target evidence file is missing",evidenceLinks("public-demo.json")],
    ["Policy branches — source",branchesSource?describeState(branchesSource.status):"Pending — source evidence file is missing",evidenceLinks("source-branches.json")],
    ["Policy branches and successor — target",branchesPublic?describeState(branchesPublic.stage):"Pending — target evidence file is missing",evidenceLinks("public-branches.json")],
    ["Disposable Safe owner rotation",rotation?describeState(rotation.stage??rotation.status):"Pending — rotation evidence file is missing",evidenceLinks("public-safe-rotation.json")],
    ["Finalized release readback",readback?(readback.automatedJourneysComplete?"Automated journeys report complete at finalized blocks":"Readback exists; one or more automated journeys or liabilities remain incomplete"):"Pending — finalized release readback has not been generated",evidenceLinks("release-readback.json")],
  ];
  const mainReturn=mainReturnState(mainPublic,mainSource);
  const branchReturn=branchReturnState(branchesPublic,branchesSource);
  const rotationReturn=rotationReturnState(rotation);
  const refusal=mainPublic?.minedSemanticRefusal;
  const sourceRefusals:Array<any>=[...(mainSource?.refusals??[]),...(branchesSource?.refusals??[])];
  const journalDocuments:Array<[EvidenceName,any,"source"|"target"]>=[
    ["source-demo.json",mainSource,"source"],
    ["public-demo.json",mainPublic,"target"],
    ["source-branches.json",branchesSource,"source"],
    ["public-branches.json",branchesPublic,"target"],
    ["public-safe-rotation.json",rotation,"source"],
  ];
  const unexpectedFailures=journalDocuments.flatMap(([name,document,fallback])=>(document?.failedTransactions??[]).map((item:any)=>({name,item,chain:item.chain??fallback})));
  const pendingSubmissions=journalDocuments.flatMap(([name,document,fallback])=>{
    const item=document?.pendingTransaction??document?.pendingSourceTransaction??document?.pending;
    return item?[{name,item,chain:item.chain??fallback}]:[];
  });
  const text:string[]=[
    "# Public evidence",
    "",
    `Generated ${new Date().toISOString()} from the checked-in public journals. This page reports the evidence currently present; missing or partial evidence remains pending.`,
    "",
    "## Control and release scope",
    "",
    "All actors in the built-in public journeys are team controlled, including the Safe owners, workers, sponsor, relayers, committee members, and disposable rotation Safe. These runs demonstrate protocol behavior and public-chain execution. They do not count as independent-user adoption, two consenting independent settlements, or an independent buyer reference. Those release gates remain pending real participants.",
    "",
    "## Networks",
    "",
    "| Role | Network | Chain ID | Transaction explorer |",
    "|---|---|---:|---|",
    "| Source | Ethereum Sepolia | 11155111 | [Sepolia Etherscan](https://sepolia.etherscan.io/) |",
    "| Target | Creditcoin testnet | 102031 | [Creditcoin testnet Blockscout](https://creditcoin-testnet.blockscout.com/) |",
    "",
    "The Creditcoin testnet chain and explorer mapping is documented in the official [testnet environment](https://docs.creditcoin.org/environments/testnet) and [endpoint reference](https://docs.creditcoin.org/smart-contract-guides/creditcoin-endpoints). Transaction links below use these explorer bases. If an operation has no recorded chain, its hash links to the raw GitHub evidence instead.",
    "",
    "## Journey status",
    "",
    "| Journey | Current evidence status | Evidence |",
    "|---|---|---|",
    ...rows.map(row=>`| ${row[0]} | ${row[1]} | ${row[2]} |`),
    "",
    "## Returned funds: recognition and withdrawal",
    "",
    "A recognized RETURN moves value from an epoch reserve into the refund beneficiary’s target free balance. It is not an external payment until a separate free-balance withdrawal succeeds.",
    "",
    "| Journey | Source RETURN evidence | Recognized target free-balance credit | Actually withdrawn |",
    "|---|---|---|---|",
    `| Main | ${mainReturn.source} | ${mainReturn.recognized} | ${mainReturn.withdrawn} |`,
    `| Policy branches / successor | ${branchReturn.source} | ${branchReturn.recognized} | ${branchReturn.withdrawn} |`,
    `| Disposable Safe rotation | ${rotationReturn.source} | ${rotationReturn.recognized} | ${rotationReturn.withdrawn} |`,
    "",
    "## Chain transaction journal",
    "",
    operationsSection("source-demo.json",mainSource,"Main source journal"),
    operationsSection("public-demo.json",mainPublic,"Main target journal"),
    operationsSection("source-branches.json",branchesSource,"Policy branch source journal"),
    operationsSection("public-branches.json",branchesPublic,"Policy branch target journal"),
    operationsSection("public-safe-rotation.json",rotation,"Disposable Safe rotation journal"),
    "## Pending recorded submissions",
    "",
  ];
  if(pendingSubmissions.length){
    text.push("These hashes have a persisted submission marker but are not represented as completed operation receipts.","","| Chain | Operation | Transaction | Evidence |","|---|---|---|---|",...pendingSubmissions.map(({name,item,chain})=>`| ${chain==="source"?"Ethereum Sepolia":"Creditcoin testnet"} | ${escapeCell(item.label)} | ${txLink(chain,item.hash??item.transactionHash,name)} | ${evidenceLinks(name)} |`),"");
  }else{text.push("None recorded.","");}
  text.push(
    "## Other mined failures",
    "",
  );
  if(unexpectedFailures.length){
    text.push("These journal entries are separate from the intentional semantic refusal below.","","| Chain | Operation | Transaction | Block | Gas used | Evidence |","|---|---|---|---:|---:|---|",...unexpectedFailures.map(({name,item,chain})=>`| ${chain==="source"?"Ethereum Sepolia":"Creditcoin testnet"} | ${escapeCell(item.label)} | ${txLink(chain,item.hash??item.transactionHash,name)} | ${escapeCell(item.blockNumber)} | ${gas(item.gasUsed)} | ${evidenceLinks(name)} |`),"");
  }else{text.push("None recorded.","");}
  text.push(
    "## Mined semantic refusal",
    "",
  );
  if(refusal){
    const hash=refusal.transactionHash;
    text.push("The following failed transaction was intentionally mined to show that authenticated checkpoint bytes are refused when presented as an allocation payment fact.","", "| Transaction | Block | Gas used | Status | Expected selector | Description |","|---|---:|---:|---|---|---|",`| ${txLink("target",hash,"public-demo.json")} | ${escapeCell(refusal.blockNumber)} | ${gas(refusal.gasUsed)} | Mined failure (${escapeCell(refusal.status)}) | ${escapeCell(refusal.expectedSelector)} | ${escapeCell(refusal.description)} |`,"");
  }else{text.push("Pending — no mined semantic-refusal receipt is recorded in the main target journal.","");}
  text.push("## Read-only refusal checks","","These observations used `eth_call`; they are not mined failed transactions.","");
  if(sourceRefusals.length){
    text.push("| Check | Source block | Expected error | Selector | Evidence note |","|---|---:|---|---|---|",...sourceRefusals.map(item=>`| ${escapeCell(item.label)} | ${escapeCell(item.atBlock)} | ${escapeCell(item.error)} | ${escapeCell(item.selector)} | ${escapeCell(item.observation)} |`),"");
  }else{text.push("No read-only refusal observations are recorded.","");}
  text.push("## Native proof regeneration","",evidenceLinks("native-recovery-verification-33642ef4.json"),"");
  if(recovery){
    text.push(`The raw SDK regenerated transaction ${txLink("source",recovery.transaction?.transactionHash,"native-recovery-verification-33642ef4.json")} at source position ${escapeCell(recovery.transaction?.blockHeight)}:${escapeCell(recovery.transaction?.transactionIndex)}. Exact encoded bytes matched prior evidence: **${recovery.encodedTransaction?.exactBytesEqual===true?"yes":"no"}**. The fixed native verifier read-only call returned **${recovery.nativeSimulation?.returned===true?"true":"false"}**.`,"",`- Prior continuity fingerprint: \`${escapeCell(recovery.continuity?.priorFingerprint)}\``,`- Regenerated continuity fingerprint: \`${escapeCell(recovery.continuity?.refreshedFingerprint)}\``,`- Continuity changed: **${escapeCell(recovery.continuity?.changed)}** (${escapeCell(recovery.continuity?.refreshedRootCount)} roots).`,"","This demonstrates provider-independent regeneration for the recorded proof. Because the continuity fingerprint did not change, it does not by itself demonstrate recovery from an aged or changed continuity witness.","");
  }else{text.push("Pending — the native proof regeneration report is missing.","");}
  text.push("## Public refusal controls and replacement of an older proof","",evidenceLinks("public-refusal-checks.json"),"");
  if(refusalChecks){
    const replacement=refusalChecks.proofReplacement;
    text.push(`These are read-only calls at explicit target block ${escapeCell(refusalChecks.targetBlock?.number)}, not mined transactions.`,"","| Control | Outcome | Error |","|---|---|---|");
    for(const observation of refusalChecks.observations??[])text.push(`| ${escapeCell(observation.name)} | ${escapeCell(observation.outcome)} | ${escapeCell(observation.errorName??"—")} |`);
    text.push("");
    if(replacement)text.push(`The older proof was **${escapeCell(replacement.priorProofOutcome?.outcome)}** and the replacement was **${escapeCell(replacement.replacementProofOutcome)}** at the same target block. Continuity changed: **${escapeCell(replacement.comparison?.continuity?.changed)}**; roots: ${escapeCell(replacement.priorRootCount)} → ${escapeCell(replacement.replacementRootCount)}. The report records exact source-byte comparison, both continuity fingerprints, the older proof's result and the accepted replacement proof. This is a recorded read-only recovery observation; it does not promise perpetual proof availability.`,"");
  }else{text.push("Pending — no public read-only refusal/replacement report is present.","");}
  text.push("## Finalized conservation readback","",evidenceLinks("release-readback.json"),"");
  if(readback){
    text.push(`Finalized readback time: ${escapeCell(readback.checkedAt)}. Automated journeys complete: **${escapeCell(readback.automatedJourneysComplete)}**.`,"");
    if(readback.global)text.push(`Credited deposits: ${escapeCell(readback.global.creditedDepositsCTC)} CTC; live liabilities: ${escapeCell(readback.global.liveLiabilitiesCTC)} CTC; completed withdrawals: ${escapeCell(readback.global.completedWithdrawalsCTC)} CTC; recorded balance: ${escapeCell(readback.global.actualBalanceCTC)} CTC. Conservation: **${escapeCell(readback.global.conserved)}**; solvency: **${escapeCell(readback.global.solvent)}**.`,"");
  }else{text.push("Pending — no finalized cross-chain release readback is available yet.","");}
  text.push("## Evidence limits","","The journals establish only the transactions, calls, state snapshots, and checks they record. A source-chain decision is distinct from target recognition, target free-balance recognition is distinct from withdrawal, and a read-only native verification is distinct from a mined authentication transaction. No competition ranking or release score is inferred here.","");
  await writeFile(OUTPUT,text.join("\n").trimEnd()+"\n");
  console.log(`Wrote ${OUTPUT}`);
}

main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
