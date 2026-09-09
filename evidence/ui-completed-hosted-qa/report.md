# Completed public journey UI QA

Run: 2026-09-09T19:19:51.048Z

Chrome used a new isolated profile against the published app at `https://pvgirish.github.io/ProofKey-Work-Treasury/` and public read-only RPCs. No wallet provider was injected.

## Result

- PASS — Completed public configuration loaded: 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7
- PASS — PaidInvoiceBook default loaded: 0xb93d065d7995884ceb8dad26d09B3a1efD9787cf
- PASS — No injected wallet: window.ethereum is absent in the isolated profile
- PASS — Configured domains verify: Verified chain 11155111 and chain 102031; target immutables match at finalized block 5459390.
- PASS — One finalized target block has zero reserve and 120 recognized: block 5459391; reserve 0; recognized 120000000000000000000
- PASS — Worker A claim 1 is paid: 30000000000000000000; 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B
- PASS — Worker B claim 3 is paid: 25000000000000000000; 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B
- PASS — Completed WORK invoice is recorded: 30000000000000000000; 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B
- PASS — Completed target totals render in Budget: Exact epoch funded; Epoch account, configuration and source-domain immutables read together at target finalized block 5459391.; Reserve0.0 CTCRecognized120.0 CTCFundedYes
- PASS — Source lag cannot authorize a guessed action: Closed; Read at source finalized block 11669858. Root 0x3281216…ae713d4.; Collect remaining claims; The source is closed. Old earned allocations remain collectible on Creditcoin.
- PASS — Payment UI renders paid worker A: Claim 1 · Amount 30.0 CTC · Claim owner 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Fixed destination 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Withdrawn Yes · paid to 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Invoice recorded · 30.0 CTC
- PASS — Payment UI renders paid worker B: Claim 3 · Amount 25.0 CTC · Claim owner 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Fixed destination 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Withdrawn Yes · paid to 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Invoice not recorded
- PASS — Claim 1 file imports and validates: Application package is internally consistent. · Route checkpoint · Allocation 1 · tree index 0 · Amount 30.0 CTC · Leaf 0x487250c4f3016cdc10cae1e8f11cde2a3daedd3a23d248e2b3319f5ac2bef281 · Requires the cached checkpoint reference and these seven siblings. ·  · This check does not claim native authenticity or payment.
- PASS — Imported package prepares no broadcast: Prepare is available, but was not selected
- PASS — QA remained read only: No account request, signing, or broadcast RPC method was observed
- PASS — No browser runtime or critical request errors: none

## One-block target snapshot

- Finalized block: 5459391
- Block hash: 0x96467b6e046876c60d6f6cb76720e53afae262e73b50a3aa0ca984b4b3af2afb
- Epoch: 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7
- Reserve: 0
- Recognized: 120000000000000000000
- Claim 1: 30000000000000000000; withdrawn true; paid 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B
- Claim 3: 25000000000000000000; withdrawn true; paid 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B
- Invoice 1 recorded: true

All values in this snapshot were requested with the same explicit finalized target block tag. The payment cards were then exercised through the normal UI read path.

## UI readback

- Target: Exact epoch funded — Epoch account, configuration and source-domain immutables read together at target finalized block 5459391. — Reserve0.0 CTCRecognized120.0 CTCFundedYes
- Source: Closed — Read at source finalized block 11669858. Root 0x3281216…ae713d4.
- Next action: Collect remaining claims — The source is closed. Old earned allocations remain collectible on Creditcoin.
- Claim 1 payment: Claim 1 · Amount 30.0 CTC · Claim owner 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Fixed destination 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Withdrawn Yes · paid to 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Invoice recorded · 30.0 CTC
- Claim 3 payment: Claim 3 · Amount 25.0 CTC · Claim owner 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Fixed destination 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Withdrawn Yes · paid to 0x323ae3c8e87E7813480Fc2c37F1e4d45fbc7e54B · Invoice not recorded
- Imported claim: Application package is internally consistent. · Route checkpoint · Allocation 1 · tree index 0 · Amount 30.0 CTC · Leaf 0x487250c4f3016cdc10cae1e8f11cde2a3daedd3a23d248e2b3319f5ac2bef281 · Requires the cached checkpoint reference and these seven siblings. ·  · This check does not claim native authenticity or payment.

## Screenshots

- completed-budget.png
- completed-payment-claim-1.png
- imported-claim-1.png

The harness did not connect a wallet, request an account, sign, prepare a wallet broadcast, or submit a transaction. The public run remains team controlled and does not satisfy the independent-participant gates.
