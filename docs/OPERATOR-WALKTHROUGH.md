# Public operator walkthrough

This walkthrough lets a judge or new operator inspect the public deployment without a wallet, then understand the files used for recognition and payment. The public run is a team-controlled testnet demonstration. It is not an independent participant settlement, production deployment, audit result or prize guarantee.

Use the [public operator app](https://pvgirish.github.io/ProofKey-Work-Treasury/) and the [published repository](https://github.com/pvgirish/ProofKey-Work-Treasury). The current evidence stage can change as public transactions are added, so treat [`evidence/public-demo.json`](../evidence/public-demo.json) and the [release evidence ledger](RELEASE-GATES.md) as the current record rather than relying on screenshots or this walkthrough for live state.

## 1. Verify the public setup

A fresh browser automatically verifies the public setup and reads the built-in epoch from both chains without a wallet. Open **Networks** to inspect the pinned defaults and verification result. A saved workspace makes no automatic network request and is preserved; choose **Use public demo defaults** only if you want to replace it explicitly. The defaults are:

| Field | Public default |
|---|---|
| Source network | Ethereum Sepolia |
| Source chain ID | `11155111` |
| Native source chain key | `1` |
| Source RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| SourceCoordinator | `0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138` |
| Source Safe | `0x6Ed0f13C6f502F2a0790D2653B67791F3B5dBDE0` |
| Source confirmation fallback | `12` blocks |
| Target network | Creditcoin Testnet |
| Target chain ID | `102031` |
| Target RPC | `https://rpc.cc3-testnet.creditcoin.network` |
| WorkTreasury | `0x06c76dFF132e64453cc0eD04a4464648db4322DA` |
| PaidInvoiceBook | `0xb93d065d7995884ceb8dad26d09B3a1efD9787cf` |
| Proof service | `https://prover.cc3-testnet.creditcoin.network` |
| Built-in epoch | `0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7` |

The supplied **PaidInvoiceBook** is pinned to the main demonstration's buyer, order, asset and policy. Its completed claim 1 record can be inspected in **Payments**. For a different order, configure a separately deployed book with the intended expectations or leave the optional field empty.

To repeat verification, select **Verify without saving**. A successful check confirms both RPC chain IDs, contract code, and the target treasury's immutable source chain ID, source key and coordinator. Target values are read together at one target block. The app prefers an RPC's `finalized` block tag; if an RPC does not expose it, the result explicitly says that it used a confirmation-depth fallback and that finality is not asserted. Do not relabel that fallback as finalized.

This check is read only. It does not request an account, sign, or broadcast.

## 2. Load the built-in epoch without a wallet

Open **Budget**. In a fresh browser, the built-in epoch and both readback cards load automatically. The built-in epoch should already appear in **Epoch ID**. If the field is empty, paste the ID from the table and select **Load epoch**.

Read the two cards independently:

- **Ethereum source** shows the source policy phase, available capacity, unresolved capacity, allocation count and the exact block label used for the read.
- **Creditcoin funding** shows whether the exact epoch was funded, the remaining reserve and the amount already recognized. Its stored epoch configuration and source-domain immutables are checked at the same target block.
- **Next authorized action** is useful only when both reads succeed. A lagging or unavailable source read must not be inferred from the target card.

Select **Refresh both chains** after a public transaction or RPC delay. Source cutoffs in the app are Ethereum block heights, not dates or browser-clock times.

The **120-unit planning walkthrough** at the top of the page is explicitly an illustration. It is not evidence of a transaction. The actual public stage, transaction hashes and amounts are in [`evidence/public-demo.json`](../evidence/public-demo.json).

For an independent source-tree check, open **Evidence** and select **Run independent rebuild**. The app reads every public allocation and stored leaf at one stable source block, recomputes the root, and compares it with storage. The result labels the actual finality mode used. This checks the source tree; it does not by itself authenticate a target payment.

## 3. Keep the three settlement states separate

These facts occur on different contracts and can be separated by native-attestation or operator delays:

| State | What it proves | What it does not prove |
|---|---|---|
| `sourceFinal` | The source milestone reached a terminal outcome and the SourceCoordinator fixed the allocation amount, owner, destination and policy in an allocation/checkpoint. | It does not prove that Creditcoin authenticated or recognized the allocation, or that anyone was paid. |
| `targetRecognized` | WorkTreasury authenticated the relevant source fact and consumed the economic right. WORK/FEE becomes a target claim; RETURN becomes the refund beneficiary's free balance. | It does not prove that the claim or free balance left WorkTreasury. |
| `withdrawn` | A target withdrawal completed and records the actual paid destination. | It does not certify work quality, participant independence, income or creditworthiness. |

In **Payments**, enter the epoch ID and an allocation ID, then select **Read**. A recognized but unpaid claim has a positive amount and `Withdrawn: No`. A completed claim shows `Withdrawn: Yes` and the paid destination. A PaidInvoiceBook record, when one is configured, can be created only for completed WORK and is a payment record rather than a quality or independence assertion.

## 4. Inspect a claim JSON package

A UI claim file must have version `proofkey.work-treasury.claim-package.v1` and one of two routes:

- **checkpoint**: a target-cached checkpoint reference, the complete allocation and exactly seven ordered siblings; or
- **receipt**: the exact encoded source transaction, the receipt-local allocation-log ordinal, and either directly usable native proof material or an existing target authentication reference.

Open **Evidence** and use **Open file**, or paste the JSON into **Inspect claim package**. Select **Inspect package**. The app recomputes and checks the application structure and allocation leaf. The result intentionally says that this does not establish native authenticity or payment; Creditcoin decides native authenticity.

After a successful inspection:

1. Select **Save copy** if you want a normalized portable copy.
2. Select **Prepare exact recognition** to load the exact ABI call into the Creditcoin transaction panel.
3. Review the function, arguments, target address and chain before any wallet action.

Preparation does not send. A judge can stop here and remain read only. If the package uses a cached checkpoint, the cache must actually exist on the configured target. If it carries fresh material, the target's fixed verifier must accept it. A valid-looking JSON file alone satisfies neither condition.

The SDK format and validation rules are described in [`sdk/README.md`](../sdk/README.md) and implemented in [`sdk/claim-package.ts`](../sdk/claim-package.ts).

## 5. Fetch, export or bring a proof JSON

The browser's normal proof path is read only:

1. In **Evidence**, check the proof service URL and source chain key `1`.
2. Enter a completed Sepolia source transaction hash.
3. Select **Fetch and validate response**.
4. Confirm that the response matches the requested chain and transaction and reports encoded transaction bytes, transaction siblings and continuity roots.
5. Select **Export proof material** to download the directly usable `SingleProof` fields.

The browser proof-service run and its exported example are recorded in [`evidence/ui-proof-qa/report.md`](../evidence/ui-proof-qa/report.md) and [`evidence/ui-proof-qa/proofkey-native-proof-33642ef4.json`](../evidence/ui-proof-qa/proofkey-native-proof-33642ef4.json). That run made no target submission.

A raw proof JSON is not a claim package. The current browser has no raw-proof file picker. Do not paste a raw proof document into the claim-package box. To bring evidence back into the browser, either fetch the transaction in the browser and use **Export receipt claim from fetched proof**, or assemble a complete versioned receipt claim with the repository SDK/runner and import that claim JSON.

For an existing raw proof file, the published repository can independently rebuild and compare it:

```sh
git clone https://github.com/pvgirish/ProofKey-Work-Treasury.git
cd ProofKey-Work-Treasury
npm ci --ignore-scripts
npm run proof:refresh -- 0xSOURCE_TRANSACTION_HASH \
  --prior evidence/EXISTING-PROOF.json \
  --output refreshed-native-proof.json
```

The command is read only and writes the result under `evidence/`. It checks the source and target domains, source receipt, attestation frontier, encoded transaction and proof structure. The source RPC must support `eth_getBlockReceipts`. Its output disclosure remains important: generated material has not been accepted by the target verifier unless a separate target transaction authenticated it.

## 6. Replace the proof service without adding authority

The hosted proof service is a replaceable transport, not an authority over amounts or destinations. In **Networks**, replace **Proof service** with another compatible service and verify the response for the requested chain and transaction. A timeout or malformed response delays uncached evidence; it does not create a refund, prove a claim or justify a trusted proxy.

If no compatible browser service is available, use the raw CLI command above. Preserve the exact source receipt and transaction hash, wait until Creditcoin's native attestation frontier reaches the source block, then rebuild. A changed valid continuity path may reflect a newer frontier; changing the exact encoded source transaction is an error when a prior file is supplied.

## 7. Prepare a Safe transaction

Source Safe actions appear under **Work orders**. Read the current order and milestone first so approval or challenge uses the current delivery hash and state version. For a guided or advanced source action:

1. Choose or prepare the SourceCoordinator action.
2. Review the actor label, exact ABI arguments and calldata.
3. Select **Download Safe Transaction Builder JSON**.
4. Open the configured Safe in the Safe web app, open Transaction Builder, import the downloaded JSON, and recheck the Safe address, Sepolia chain ID `11155111`, destination, value and calldata.
5. Let the Safe's existing owner policy collect approvals and execute. Record the resulting transaction hash separately.

The downloadable file is the default Safe route. The operator app does not bundle the Safe Apps SDK and does not install a module or guard. **Send with injected wallet** is usable only when an injected Safe-compatible wallet is already present and its active account is the configured Safe. Worker, committee and permissionless source actions still require the actor shown by the app and contract.

## 8. Resume a wallet workspace safely

The browser stores public RPC URLs, addresses, the last epoch, exact epoch drafts and work-order drafts in local storage. It does not store private keys or seed phrases.

On return in the same browser profile:

1. Open **Networks** and verify the stored addresses and chain IDs again.
2. Load the epoch and refresh both chain reads.
3. Read the selected order/milestone or payment claim again before preparing a transaction.
4. Connect the wallet only for the final action, check the wallet chain and active account, then review what it will sign.

Restored device state is a convenience, not chain evidence. **Clear saved setup** removes the saved workspace. Old drafts retain their canonical base-unit amounts; the guided UI also displays their CTC conversion. Do not silently reinterpret or rewrite an old signed draft.

## 9. Evidence and independent-run checklist

Use these records in this order:

1. [`docs/RELEASE-GATES.md`](RELEASE-GATES.md) is the gate ledger. A pending public-observation cell is not a pass.
2. [`evidence/public-demo.json`](../evidence/public-demo.json) is the resumable public team run and labels its actors and current stage.
3. [`evidence/source-branches.json`](../evidence/source-branches.json) records the separate public branch run and may still be in progress.
4. [`evidence/ui-firstload-qa/report.md`](../evidence/ui-firstload-qa/report.md), [`evidence/ui-live-qa/report.md`](../evidence/ui-live-qa/report.md), [`evidence/ui-proof-qa/report.md`](../evidence/ui-proof-qa/report.md) and [`evidence/ui-public-qa/report.md`](../evidence/ui-public-qa/report.md) record bounded browser observations.
5. [`docs/INDEPENDENT-SETTLEMENT.md`](INDEPENDENT-SETTLEMENT.md) is the checklist and completion rule for an actual participant settlement.

The reusable buyer/control disclosure is the **Control and assistance record** in [`docs/INDEPENDENT-SETTLEMENT.md`](INDEPENDENT-SETTLEMENT.md#control-and-assistance-record). Create one record per settlement. It must disclose the participant's real relationship to the project, role, who controlled each key or Safe approval, who funded work and fees, exact assistance, the participant's own reason for Ethereum authority, terms reviewed, consent evidence, source and target hashes, repeat use and publication permission. Keep private keys, seed phrases, contact details and unapproved names out of it.

For a buyer or Safe owner specifically, record why that participant chose or accepted the Ethereum Safe authority and whether they personally controlled an approval. A team member operating a team-controlled Safe cannot be relabeled as an independent buyer. The full run sequence is in [Run an actual settlement in the app](INDEPENDENT-SETTLEMENT.md#run-an-actual-settlement-in-the-app), and the required evidence threshold is in its [Completion rule](INDEPENDENT-SETTLEMENT.md#completion-rule).

No independent participant settlement is recorded at the time of this walkthrough. Two consented independent settlements, the repeat-use observation and the buyer reason remain pending real participants. Tests, team fixtures, screenshots and the built-in public run cannot replace them.

## Known limits

- This is a public testnet operator app. The displayed public actors and Safe are team controlled.
- There is no reverse proof of Creditcoin funding on Ethereum. Binding worker consent depends on the app's separate exact finalized-target funding check.
- Proof unavailability can delay an uncached claim indefinitely. The target has no unilateral timeout refund for a source allocation it has not seen.
- The public UI imports complete claim packages, not standalone raw proof files.
- Source policy deadlines are block heights. Network congestion and RPC lag can affect when the app observes them.
- Recognition and withdrawal are separate target transactions. A recognized balance is not a completed payment.
- An unpaid claim owner can redirect once, but a successful payment to an accepting destination is final within this protocol.
- Public evidence is cumulative and may be incomplete. Check the release ledger before making a completion statement.
- The repository and demonstration do not promise a prize, audit outcome, production fitness or participant independence.

The contract trust boundaries and failure behavior are described in [`docs/POLICY-AND-SECURITY.md`](POLICY-AND-SECURITY.md).
