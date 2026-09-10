# Offers, continuing work and payment records

This local iteration makes the existing treasury usable across successive buyer and worker sessions. It adds unsigned offer handoff, **My work**, follow-up preparation and selected payment history. It uses the existing financial contracts. See [release validation and limits](PARTICIPANT-PRODUCT-RELEASE.md).

Run `npm run ui:serve` and open the local address it prints. The release includes the built app; after editing source, run `npm run ui:build`. Use **Networks** to verify the pinned source and target deployments before working. The current public setup is Sepolia and Creditcoin testnet; displayed CTC amounts are testnet amounts.

## Buyer prepares; worker decides

In **Invite worker**, the buyer prepares work for the intended worker address, specifying scope, acceptance and revision rules, milestone amounts, fees, committee, claim owner, fixed payment destination and deadlines. Create and save the unsigned work file, then give that file to the worker. Exporting an offer neither reserves a private budget nor starts an order.

In a separate browser profile, the worker opens the file in **My work**. The app recomputes its commitments, checks the pinned deployment and funding observation, and checks current source eligibility. The worker reviews the complete terms and explicitly acknowledges the claim owner and payment destination before choosing **Review & sign offer**. Only the intended worker can sign. Changing terms or replacing the selected offer requires a fresh review; acknowledgements and old signatures do not carry into another offer.

The signed work file returns to the buyer through **Invite worker**. The existing Safe approval and source acceptance process follows. A filename, displayed label or imported green verdict does not authorize work. Funding-before-consent is an application and signed-terms check; Ethereum does not enforce a reverse proof of Creditcoin funding.

Work files contain commercial terms. Share them with the intended parties; they are not public links by default. Organization labels and addresses do not establish real-world identity or independence.

## Continue the same work

**My work** saves canonical work files in this browser. Select **Saved work on this device**, choose the milestone and press **Check live job**. Import a saved file on another device to reopen it. Local storage is convenience, not a backup, and the app rechecks live state before enabling an action.

The next-step panel names the responsible actor. A worker can prepare a supported delivery or revision, review the prepared action and separately send it from the worker wallet. The app commits a hash of the exact delivery text; it does not upload or guarantee access to a referenced file. Source actions require source-chain gas. A contract worker must execute through its actual account; an owner's personal wallet is not automatically that contract account.

Live action eligibility uses a hash-pinned latest source block and is checked again before submission. It is not labeled finalized payment evidence. Switching work, milestone, wallet or deployment invalidates the prepared action. Known source transaction hashes are journaled under the original action before waiting for receipts. An unknown or pending submission must be reconciled before retrying; use one execution tab and preserve this browser's data until reconciliation finishes.

An accepted order can remain inspectable after its Safe's signing policy changes. That historical acceptance does not make an old unaccepted offer newly valid. A canceled, expired or zero-WORK outcome does not become a worker payment.

After a payable source outcome, **Track payment** carries the exact order and milestone into the existing payment inspector. Source finality, native authentication, Creditcoin recognition and successful withdrawal are separate stages. When proof material or an operator is needed, use **Payments → Continue verified payments** with the appropriate claim files. There is no promise of an always-available relayer. See [payment inspection and settlement](APP-WORKFLOWS.md).

## Commission follow-up work

**Program** separates available purchasing capacity, unresolved reservations, earned allocations and returned capacity. Paid totals require a matching reconstructed closeout for the selected program; a source outcome alone is insufficient.

Choose **Create follow-up work**, then select a previous work file as a template. The app requires a terminal prior job and an ACTIVE source program within its admission window, checks available capacity, and prepares fresh nonce and deadlines. Review and edit the terms, create a new offer and obtain fresh worker consent. No old signature or terminal order is reused. A stale template read cannot overwrite a newer form.

Unearned reservation released into available capacity can support another job while the program remains open. A RETURN permanently retires capacity in the old epoch; native-verified target recognition credits the owner's free balance. A successor program needs its own existing funding/authorization process. Do not sum successive epoch caps as new deposits when funds were reused.

## Build a selected paid-work record

Open **Paid work**, choose a subject address and its exact role, select epochs and press **Rebuild from fresh receipts**. No wallet is required. The roles are distinct:

- **Source worker** needs the applicable signed work authorizations to establish the worker-to-payment relationship.
- **Claim owner** identifies the owner of the entitlement.
- **Paid destination** identifies the address that actually received a successful withdrawal, including an authorized redirection.

Only individually verified completed payments enter the totals. WORK and FEE remain separate; RETURN is excluded. Duplicate economic allocations cannot increase the total. Open or incomplete programs do not prevent a payment from appearing when that exact payment's source, native, recognition and withdrawal evidence is independently complete.

Open a record locator or earlier export to reconstruct it again. Imported totals and verdicts are discarded; exact imported order/allocation filters remain selected unless the selection is explicitly edited. An export records its scope and snapshots. It is selected history, not exhaustive history. Signed commercial terms are supplied separately when needed for the source-worker role; do not assume the portable locator publishes them.

Use the payment row's inspection action and receipt links to follow its evidence. Missing historical source state leaves verification incomplete. In that case choose an archive-capable source RPC in **Networks**, verify the deployment again and rebuild. Never substitute an older complete report and describe it as a fresh result. Technical error details remain available for diagnosis.

These are payment records, not proof of work quality, sustainable income, creditworthiness, participant identity or customer demand. Sharing a public name or testimonial needs separate permission.

## Observe a real evaluation

The optional observation form under **Program** exports local notes about the workflow, assistance, waiting, fees and the buyer's repeat decision. It sends no outreach and does not enroll a participant. Use the [pilot guide](TECHNICAL-WORK-PILOT.md) for consent and measurement. Count organizations, people, wallets and successful payments separately, and record negative feedback as well as success.
