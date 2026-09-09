# Verify the native evidence in one command

From a checkout of this repository, use Node 24:

```sh
npm ci --ignore-scripts
npm run judge:verify
```

This command needs no private key, wallet, `.env`, hosted proof service or Solidity compiler. It uses public Sepolia and Creditcoin testnet RPCs. Optional `SOURCE_CHAIN_RPC_URL` and `CREDITCOIN_RPC_URL` environment variables select alternative RPCs; their reported chain IDs must still match the pinned testnets.

The command writes [evidence/judge-verification.json](../evidence/judge-verification.json). It exits unsuccessfully and records `not-verified` if a required observation is absent, inconsistent or unavailable. A provider failure is not a passed check or evidence that the protocol is insecure.

## What it checks

1. Both chains expose finalized blocks, and the deployed treasury's source chain, source key, coordinator and native verifier match this release. Coordinator and treasury runtime hashes match the pinned deployment records.
2. The recorded single, batch and segmented target transactions succeeded at their canonical target block positions and were addressed to the treasury.
3. Five `TransactionVerified` events came from exactly `0x0FD2`. Each source position is bound to one matching treasury authentication event, the encoding profile, recomputed authentication ID and exact proof bytes in target calldata.
4. The live source transaction and complete receipt independently re-encode to those exact bytes with the pinned SDK. The source block position and the persisted target authentication cache agree.
5. Canonical coordinator allocations/checkpoints are decoded from the same source receipt. A selected checkpoint log must match the target import, including its ordinal and every checkpoint field. For recorded direct Safe calls, the audit recomputes the complete Safe transaction hash and checks the exact coordinator CALL and unique matching success event. It also checks the historical block-end proxy, slot-zero singleton address and singleton runtime against the canonical Safe 1.4.1 artifacts. Their [package provenance](../vendor/safe/PROVENANCE.json) records the verified tarball integrity and artifact hashes. Safe's event `payment` is gas reimbursement, not the worker's payment.
6. At one finalized target block, credited deposits equal free balances plus reserves plus unpaid claims plus completed withdrawals. Actual contract balance covers liabilities.

The recorded public sample has three target transactions and five source transactions. The successful historical authentication covers every log in each encoded source receipt, including any reported Safe event. Only the selected coordinator allocation/checkpoint can authorize financial recognition in Work Treasury.

## What remains separate

This is a live RPC audit of **historical mined evidence**, not a new native-verifier execution or proof of chain consensus. RPCs supply canonical-block/finality observations; a stored block hash alone is not an offline state proof. Proxy/singleton code observations and exact-call checks have the scope stated in the report; they do not establish a real-world participant's identity or independent demand.

For allocation-tree reconstruction and completed claims, use **Evidence → Run independent rebuild** in the public app or `npm run release:readback` after compiling contracts. For real native refusal and changed-witness evidence, see the [refusal ledger](REFUSAL-LEDGER.md) and `npm run proof:verify-refusals`. Those are distinct checks, with distinct evidence classes.

The public actors remain team controlled. A passing command does not establish work quality, independent settlements, a security audit, buyer demand or a competition ranking.

## A 30-second explanation

“Keep one finite work budget on Creditcoin while your organization approves work from its Ethereum Safe. Reuse capacity released by cancelled or partially earned work while preserving payments already earned. In the team-controlled 120-CTC run, 50 CTC returned before the second job resolved; the final result paid workers 55 and refunded 65. Open the app without a wallet, or run the evidence check yourself.”

The walkthrough graphic is labeled as an illustration. Use the live Budget/Evidence/Payments readbacks and linked receipts for observed outcomes. Two independent settlements, repeat independent operation and a real buyer reason remain separate release requirements.
