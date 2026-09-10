# Attestcoin payment verification

An Ethereum work outcome becomes a Creditcoin payment entitlement only after native Attestcoin authentication. The submitter supplies evidence and pays transaction fees; it cannot author the amount, substitute the source emitter or choose a new payment destination.

This document describes runtime proof verification. [Explorer source verification](TARGET-SOURCE-VERIFICATION.md) describes publishing Solidity and reproducing deployed bytecode. [Program closeout](REPLACEMENT-SETTLEMENT-AND-CLOSEOUT.md) is a separate read-only audit of outcomes already recorded by the contracts.

## From work outcome to payment

1. The configured Ethereum `SourceCoordinator` applies the agreed work policy. An authorized approval or another valid policy terminal finalizes an allocation; the contract emits canonical `AllocationCreated` and `CheckpointPublished` events. A worker's unsigned claim of completion is insufficient. Work quality remains the agreed parties' policy responsibility.
2. Any operator can obtain the exact encoded source transaction/receipt, Merkle inclusion witness and continuity witness. The proof service is replaceable and has no payment authority.
3. On Creditcoin, `NativeReceiptAuth._authenticateSingle` calls `VERIFIER.verifyAndEmit(...)` synchronously. `_authenticateBatch` calls the batch overload; `_authenticateSegmented` runs bounded individual proofs with their respective continuity witnesses. The verifier comes from the installed official `NativeQueryVerifierLib` and is fixed at `0x0000000000000000000000000000000000000FD2`. There is no deployer-provided verifier override. A false result reverts with `ProofVerificationFailed`; a reverting native call also rolls back the transaction.
4. The treasury records an authentication bound to source chain key, source block, proof-derived transaction index, native encoding profile and the hash of the exact authenticated bytes. Log selection checks the successful source receipt, exact receipt-local ordinal and pinned coordinator emitter. An authenticated checkpoint is not interchangeable with an allocation event.
5. Either a canonical allocation in that receipt or an ordered Merkle witness under an authenticated stored checkpoint reaches the same private `_recognize` function. Epoch funding, asset, policy, economic identity, allocation kind, beneficiary fields and the cap are checked. The same allocation cannot be recognized twice through different evidence routes.
6. WORK and FEE create pull-payment claims. A later `withdrawFor` pays the fixed destination; only the claim owner can redirect through `ownerWithdrawTo`. RETURN creates credit in the refund beneficiary's free balance. Recipient transfer failure does not erase the entitlement.

The combined `authenticateAndRecognizeReceipt` and `authenticateAndRecognizeCheckpoint` functions authenticate and recognize atomically. Separate authentication and cached collection are also supported. Withdrawal is deliberately separate: a recipient failure must not make already authenticated evidence disappear or force the recipient to regenerate an aging proof.

## Why cached collection is still Attestcoin-gated

Cached collection requires an authentication or checkpoint previously created through successful native verification. It rechecks the exact bytes or committed leaf. It does not trust an operator assertion or a closeout JSON file.

Removing native verification blocks **new source facts** from creating payment entitlements. Previously authenticated rights remain collectible without another precompile invocation. This preserves earned payments when a proof provider is unavailable or the attestation frontier changes; it is not an alternate trust path.

`calculateTxIndex` binds source positions and supports checkpoint ordering. This is useful protocol integration, not a claim that ProofKey implements transaction-order adjudication. Shared batch continuity, segmented proofs and witness regeneration serve distinct evidence-availability and operation needs; call counts alone do not establish competitive depth.

## Public evidence a reviewer can inspect

The existing team-controlled testnet deployment has mined all three authentication paths:

| Path | Public Creditcoin transaction | What to inspect |
|---|---|---|
| Batch | [Batch authentication](https://creditcoin-testnet.blockscout.com/tx/0x803637ce8d1e691d826e64292366fa7e7de6f1d9f0676c82833c8d5a31562542) | Native verification events and their matching treasury authentications |
| Single | [Checkpoint authentication](https://creditcoin-testnet.blockscout.com/tx/0x688bbeb7a148c9eb7e5eed5c665cdc0d008f95bc14d49968e7e952b741e679ae) | Successful native verification followed by the exact checkpoint import |
| Segmented | [Segmented authentication](https://creditcoin-testnet.blockscout.com/tx/0xd65928d72975f15e99d108674b64628ead2f821d626e35322cdd3eb9e9348530) | Individual native authentications within the bounded segmented call |

`npm run judge:verify` re-reads these mined transactions, checks five events emitted by `0x0FD2`, binds source bytes and treasury cache records, and reads accounting. The [captured report](../evidence/judge-verification.json) and [audit scope](JUDGE-VERIFY.md) distinguish RPC observations from new consensus proofs or new settlement execution.

The [refusal ledger](REFUSAL-LEDGER.md) separates the mined semantic refusal from read-only malformed-proof rejection and old-witness refusal → regenerated-witness acceptance. Local contract tests stub the fixed native address at the VM boundary; those tests are not the public native evidence above.

## What program closeout does

`scripts/program-closeout.ts` independently collects finalized source state, canonical allocations, the rebuilt root, recorded native authentication, target recognition, and successful WORK/FEE withdrawals. Importing a previous report supplies locators, not a trusted verdict. The collector makes no payment and invokes no new settlement transaction. Its SDK verifier is a consistency checker over observations; the collector supplies fresh RPC observations and validates trusted deployment pins.

There is no requirement to postpone payment until the epoch closes or to re-prove every earned claim during closeout. Source outcomes may settle throughout the epoch, and source RETURN may be recognized while earlier WORK remains collectible. Adding a mandatory proof at withdrawal would create a new availability dependency without authenticating a new fact.

## Trust boundaries

- Attestcoin authenticates source-chain evidence under the network's security assumptions. It does not establish real-world work quality, satellite uptime, legal ownership or the independence of a source signer.
- The source work policy and its configured authorities decide legitimate outcomes. A finalization event is not equivalent to a worker publishing arbitrary completion text.
- Guided funding-before-consent checks are based on finalized RPC observations bound into the authorization packet. Ethereum source acceptance does not perform a reverse cryptographic proof of Creditcoin funding.
- No Attestcoin Outbox/Inbox reverse-execution flow is claimed. The import path of an official library containing `write-ability` does not establish use of writability.
- The public examples remain team controlled. Separate participants, buyer demand and production economic value require separate evidence.

The [official competition rules](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail) require meaningful functional Attestcoin integration and name utilization depth as one core scoring criterion. They publish no numeric weighting or requirement to use all protocol capabilities. This mapping supports evaluation; it makes no placement promise.
