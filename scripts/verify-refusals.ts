import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, getBytes, hexlify, isError, keccak256 } from "ethers";
import { ROOT, artifact, loadEnvironment, saveReport, testNetworks } from "./runtime.ts";
import { refreshNativeProofBundle } from "./refresh-native-proof.ts";

// Public eth_call controls, never a signer or transaction sender. Existing mined
// refusal evidence remains separate from these repeatable read-only observations.
await loadEnvironment();
const { source, target } = await testNetworks();
try {
  const read = async (path: string) => JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
  const deployment = await read("deployments/testnet.json");
  const journal = await read("evidence/source-demo.json");
  const approval = journal.operations.find((op: any) => op.label === "approve-A");
  if (!approval?.transactionHash) throw new Error("Missing recorded approval");
  const prior = (await read("evidence/native-bundle-33642ef4a9.json")).proofs[0];
  const regenerated = await refreshNativeProofBundle({
    source, target, transactionHashes: [approval.transactionHash],
    priorEncodedTransactions: { [approval.transactionHash.toLowerCase()]: prior.encodedTransaction },
    priorContinuityProof: prior.continuityProof,
    save: false,
  });
  const p = regenerated.proofs[0];
  const proof = { blockHeight: p.blockHeight, encodedTransaction: p.encodedTransaction,
    merkleProof: p.merkleProof, continuityProof: regenerated.continuityProof };
  const treasury = new Contract(deployment.target.treasury, (await artifact("WorkTreasury")).abi, target);
  const block = await target.getBlock("latest");
  if (!block?.hash) throw new Error("No target block");
  const tag = { blockTag: block.number };
  const verified = await treasury.authenticateTransaction.staticCall(proof, tag);
  const position = { blockHeight: verified[0].blockHeight, transactionIndex: verified[0].transactionIndex };
  if (!await treasury.isAuthenticated.staticCall(position, proof.encodedTransaction, tag)) {
    throw new Error("Expected the historical successful authentication to be persisted");
  }
  const observations: any[] = [{ name: "authentic-proof-and-repeat-authentication", outcome: "accepted",
    meaning: "A valid proof passes the current native verifier. Repeating authentication is intentionally idempotent.",
    authenticationId: verified[1] }];
  let priorProofOutcome: any;
  try {
    await treasury.authenticateTransaction.staticCall({ blockHeight: prior.blockHeight,
      encodedTransaction: prior.encodedTransaction, merkleProof: prior.merkleProof,
      continuityProof: prior.continuityProof }, tag);
    priorProofOutcome = { outcome: "accepted", note: "Replacement succeeded, but the older proof remained usable at this block." };
  } catch (error) {
    if (!isError(error, "CALL_EXCEPTION") || typeof error.data !== "string" || error.data === "0x") {
      throw new Error("Older-proof comparison was ambiguous; no recovery claim recorded");
    }
    priorProofOutcome = { outcome: "refused", selector: error.data.slice(0, 10), revertData: error.data };
  }
  async function refuses(name: string, action: () => Promise<unknown>, expectedName?: string) {
    try { await action(); }
    catch (error) {
      if (!isError(error, "CALL_EXCEPTION") || typeof error.data !== "string" || error.data === "0x") {
        throw new Error(`${name}: ambiguous transport or empty-revert result; not accepted as refusal evidence`);
      }
      const parsed = treasury.interface.parseError(error.data);
      if (expectedName && parsed?.name !== expectedName) throw new Error(`${name}: unexpected refusal ${parsed?.name}`);
      if (!expectedName && parsed?.name !== "ProofVerificationFailed"
        && !(parsed?.name === "Error" && parsed.args[0] === "Merkle proof validation failed")) {
        throw new Error(`${name}: a contract reverted, but this is not the expected native verification rejection`);
      }
      observations.push({ name, outcome: "refused", errorName: parsed?.name ?? "native revert",
        selector: error.data.slice(0, 10), revertData: error.data, expectedName: expectedName ?? "native verification rejection" });
      return;
    }
    throw new Error(`${name}: unexpectedly accepted`);
  }
  const changedBytes = getBytes(proof.encodedTransaction);
  changedBytes[changedBytes.length - 1] ^= 1;
  const changedProof = { ...proof, encodedTransaction: hexlify(changedBytes) };
  await refuses("tampered-source-bytes-before-recognition", () =>
    treasury.authenticateAndRecognizeReceipt.staticCall(changedProof, approval.allocationOrdinals[0], tag));
  await refuses("receipt-local-ordinal-out-of-range", () =>
    treasury.recognizeFromReceipt.staticCall(position, proof.encodedTransaction, 65535, tag), "LogOrdinalOutOfRange");
  await refuses("authenticated-checkpoint-is-not-an-allocation", () =>
    treasury.recognizeFromReceipt.staticCall(position, proof.encodedTransaction, approval.checkpointOrdinals[0], tag), "InvalidEncoding");
  await refuses("already-recognized-worker-allocation", () =>
    treasury.recognizeFromReceipt.staticCall(position, proof.encodedTransaction, approval.allocationOrdinals[0], tag), "EconomicRightAlreadyRecognized");
  const report = { version: 1, checkedAt: new Date().toISOString(), readOnly: true,
    scope: "Public Creditcoin eth_call observations at one explicit latest block; not mined transactions or claims of finalized state.",
    targetBlock: { number: block.number, hash: block.hash }, sourceTransaction: approval.transactionHash,
    sourceBlock: p.blockHeight, verifier: await treasury.VERIFIER.staticCall(tag), treasury: deployment.target.treasury,
    authenticEncodedHash: keccak256(proof.encodedTransaction), tamperedEncodedHash: keccak256(changedProof.encodedTransaction),
    proofReplacement: { priorFile: "evidence/native-bundle-33642ef4a9.json", comparison: regenerated.comparison,
      priorRootCount: prior.continuityProof.roots.length, replacementRootCount: proof.continuityProof.roots.length,
      priorProofOutcome, replacementProofOutcome: "accepted", acceptedReplacementProof: proof },
    observations, limitations: ["Local VM tests separately establish rollback of contract storage on dependency failure.",
      "The failed native call may bubble the runtime's error rather than the wrapper's ProofVerificationFailed selector.",
      "Wrong-emitter, failed-source and impossible-source allocation fixtures remain labeled local tests; no fabricated public events are introduced."] };
  await saveReport("public-refusal-checks.json", report);
  console.log(JSON.stringify(report, null, 2));
} finally { source.destroy(); target.destroy(); }
