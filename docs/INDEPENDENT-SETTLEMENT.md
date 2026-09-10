# Independent settlement evidence

## Current status

No independent participant settlement is recorded yet. Local tests and the public team-controlled demonstration do not satisfy this evidence gate. Mark a settlement complete only after the participant has reviewed the exact terms, controlled the stated signing key or Safe approval, and the resulting public transactions can be checked on both chains.

The target is two consented settlements with real participants, followed by one repeat use. Record actual assistance and any personal, employment, investment or project relationship. Do not describe a team-controlled account as independent.

## What the participant agrees to

Before signing, show the participant the complete epoch and order terms in the app. They should understand:

- the Ethereum Safe controls admission, approval, challenge and release decisions;
- the worker accepts the exact amount, fee, payout owner, payout destination, committee and block cutoffs;
- Creditcoin must already hold the exact epoch cap before the worker gives binding consent;
- the source result fixes the payable amount, and the target native verifier authenticates that result;
- proof availability can delay a claim, and the target has no timeout that refunds an unseen source allocation;
- an unpaid claim owner may redirect payment, while a successful payment to an accepting destination is final;
- transaction fees and any test funds supplied by the project are disclosed before the participant acts.

Consent may be demonstrated by the participant's own worker signature, Safe approval or committee signature for the exact on-chain payload. A name, testimonial or contact detail is optional and should be published only with separate permission.

## Control and assistance record

Create one record for each settlement and fill it from observed facts:

| Field | Required record |
|---|---|
| Participant label | Public alias or anonymous participant number |
| Relationship | Actual relationship to the project and team |
| Role | Buyer/Safe owner, worker, committee member or claim owner |
| Key control | Who controlled each signing key or Safe approval |
| Funding | Who supplied the work amount and each chain's transaction fees |
| Assistance | Exact setup, signing, wallet or transaction help provided |
| Reason for Ethereum authority | Participant's own reason, quoted or summarized with permission |
| Terms reviewed | Epoch ID, order ID, maximum work, fee, destinations and cutoffs |
| Consent evidence | Signature or Safe transaction hash and source chain ID |
| Source result | Final outcome, allocation IDs and source transaction hashes |
| Target result | Native authentication, recognition and withdrawal transaction hashes |
| Repeat use | Later order/epoch IDs and what the participant did without operator custody |
| Publication permission | Which facts, aliases or quotes may be made public |

Keep private keys, seed phrases, personal contact details and unapproved names out of the record.

## Run an actual settlement in the app

For the local participant and app-workflow upgrades, use the [app workflow guide](APP-WORKFLOWS.md); the hosted app may still be the earlier published build. In the upgraded browser, **Payments → Continue verified payments** prepares a fresh plan from imported claim files, and **Budget → Verify program** reconstructs and exports the final closeout.


1. Open the [public wallet app](https://pvgirish.github.io/ProofKey-Work-Treasury/), or build and serve it locally with `npm run build`, `npm run ui:build` and `npm run ui:serve`.
2. In **Networks**, compare the public defaults with `deployments/ui-testnet.json`, or enter the verified Sepolia SourceCoordinator, participant's Ethereum Safe and Creditcoin WorkTreasury addresses. Confirm source chain key `1`, Sepolia chain ID `11155111` and Creditcoin testnet chain ID `102031`, then select **Save and verify**.
3. In **Networks → Create a fresh budget epoch**, create a new exact configuration. Have the named sponsor use **Fund on Creditcoin** to fund its full cap. Wait for the app to confirm that exact epoch from a finalized target block.
4. Initialize the same configuration through the Ethereum Safe. The app prepares an ordinary Safe transaction; it does not install a module or bypass the Safe's current owner policy.
5. In **Work orders**, enter the complete work terms with the participant present. Review the worker, claim owner, destination, fee owner, committee, amounts and all three milestone cutoffs.
6. Let the worker accept the exact Safe offer or sign an exact quote only after the finalized funding check succeeds. Record who controlled the signature and what assistance was given.
7. Submit delivery from the worker account. Finalize through approval, mutual settlement, monitoring default, committee ruling, committee timeout or no delivery as the real facts require. Do not choose an outcome only to improve the demonstration.
8. In **Evidence**, fetch or import native proof material for the actual source transaction. Authenticate it on Creditcoin, then recognize the exact allocation through its receipt or a checkpoint package.
9. Withdraw the recognized claim to its agreed destination, or let the claim owner redirect it while unpaid. Record the successful target receipt and final destination.
10. Export the epoch, order, source receipt, native authentication, claim package and target receipts. Verify that public getters reproduce the allocation amount, owner, destination, policy and final accounting.
11. Repeat with a later order or epoch. Record which steps the participant completed without the project controlling their key or taking custody of their payment.

If a transaction is uncertain, stop and inspect its hash before retrying. If native proof service access is unavailable, preserve the source receipt and try a replacement provider later; do not claim target recognition until the fixed verifier has accepted the proof.

## Completion rule

The gate is complete only when two participant records contain verifiable source and target transactions, clear consent and control disclosures, and the repeat-use observation. Team fixtures may remain useful public evidence, but they stay labeled team controlled.
