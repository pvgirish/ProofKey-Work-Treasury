# Inspect and continue a work program in the app

The local app adds three workflows to the existing payment contracts: trace one payment, prepare replacement settlement, and reconstruct a complete program closeout. See [implementation progress](APP-WORKFLOW-PROGRESS.md) for current validation. The hosted app and its earlier CI evidence describe the published baseline until this build is separately published.

## Check one payment

Verify the public setup in **Networks**, then open **Payments → Check one payment from outcome to withdrawal**. Enter an epoch and allocation ID and select **Check payment**. No wallet is needed.

The app reconstructs the epoch and connects the selected allocation to its source policy outcome, historical Safe call when applicable, native authentication, Creditcoin recognition and actual withdrawal. Each available transaction links to its explorer. It distinguishes a fresh native invocation in the recognition transaction from reuse of an earlier authenticated record. Reusing that record still requires the original successful native verification.

A source approval does not certify work quality. A successful withdrawal establishes the recorded destination, not participant independence. Missing or contradictory evidence remains visible. RETURN allocations become the refund owner's free balance; the app does not call that credit an epoch-specific withdrawal or a worker-consent record.

## Continue settlement

In **Payments → Continue verified payments**, use **Import payment claims** to select one or more versioned claim files. Choose **Check payment claims** to reconstruct a plan from finalized chain reads. Raw JSON is available under the advanced controls. Inspect the amount, allocation and fixed destination before continuing.

Planning needs no wallet. **Continue settlement** is a separate explicit action and sends at most one transaction per click. A replacement operator can authenticate/recognize supported evidence and withdraw a WORK or FEE claim to its committed destination. The operator cannot change that destination. If the receiver rejects payment, the claim owner must separately authorize any permitted redirect.

Known transaction hashes are saved in this browser before receipt waiting. Continue with the same claim files and verified deployment to check that journal and current chain state. A pending or unavailable receipt never triggers an automatic resend. Keep this browser's saved data until submissions have been reconciled; local storage is not a backup or on-chain evidence. Use one execution tab for a program.

## Verify a program closeout

Open **Program → Check this program**, enter its epoch ID, and select **Verify program**. For new consent-bound orders, add their signed authorization files. The app independently locates the historical acceptance transactions. Older demonstration orders remain labeled as legacy evidence.

The result checks every source allocation, the rebuilt root, conserved budget, recognized amounts, reserve, completed WORK/FEE payments and outstanding claims at pinned finalized source/target blocks. Accounting and provenance must both pass for a complete result. It also checks the native events and the historical canonical Safe runtime when a source outcome uses the Safe.

Use **Export fresh report** to hand the result to another reviewer. **Import report locator** retains the epoch, pinned deployment and authorization inputs only. It discards the prior verdict and observations; **Verify program** must fetch fresh evidence again.

Totals cover one selected epoch. Adding multiple epoch caps can count reused funds twice. Global deposits and withdrawals require the separate global treasury audit. Historical Safe code checks are RPC observations at block end, not intra-block execution traces or proof of current owners.

## Existing public examples

| Program | Epoch | Completed accounting |
|---|---|---|
| Main work program | `0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7` | 120 cap; 55 WORK paid; 65 returned credit |
| Policy branches | `0xb69a02fe267b8cb855f1a6dab0c58e8fffa56788aa32e1ceffa56739a29c518f` | 20 cap; 9 WORK/FEE paid; 11 returned credit |
| Uninitialized expiry | `0x4bfe922276f1df1b448bc3a4b75fcf1c3c9d1a6a7433f32ee9cfc3039e757f8c` | 1 cap; 0 WORK/FEE paid; 1 returned credit |

These are existing team-controlled testnet examples. The [buyer pilot](TECHNICAL-WORK-PILOT.md) and [participant record](INDEPENDENT-SETTLEMENT.md) support an actual outside organization using the workflow. Software completion does not establish that adoption, and no outside buyer is claimed by these examples.
