# Participant product release — 10 September 2026

The accepted participant iteration connects buyer-prepared unsigned offers, explicit worker consent, saved jobs and milestones, fresh follow-up work, selected verified payment records and optional pilot observations. It extends the existing treasury without changing the financial production contracts or frozen Review #41. Start with the [participant guide](PARTICIPANT-PRODUCT.md).

## What changed

- **Invite worker → My work:** the worker independently reviews the canonical offer, pinned deployment, historical funding observation and current eligibility before signing. The buyer imports the signed result into the existing Safe acceptance route. Imported terms, wallet changes and stale reads cannot silently substitute another authorization.
- **Continuing work:** saved order and milestone selection, next-actor guidance, supported delivery/revision preparation, explicit worker submission, durable original-action transaction hashes and receipt rechecks. Payment tracking locates the exact order/milestone WORK allocation in a fresh source prefix before opening the payment inspector.
- **Follow-up work:** the buyer templates a completely finalized prior job within an ACTIVE program, obtains a fresh unused nonce and editable deadlines, and creates a new consent packet. Available capacity, reservations, earned value, returned capacity and completed payments remain distinct.
- **Paid work:** fresh evidence reconstructs selected WORK/FEE withdrawals for an explicit source-worker, claim-owner or actual-recipient role. Exact imported selectors are retained, derived imported verdicts are ignored, redirects are preserved, duplicates cannot inflate totals and RETURN is excluded. A portable selection is not an identity, income or creditworthiness credential.
- **Pilot observations:** local optional notes connect assistance, fees and the buyer's repeat decision to the program. The guide describes qualification, control, consent and measurement; the software does not create participants or demand.

GPT-5.6 Sol at high reasoning handled the participant module, payment-history SDK, app and browser regression. GPT-6 Astra performed integration and bounded consent/payment-evidence review. This describes task allocation, not a fabricated percentage of code ownership or cost.

## Validation

Final validation **passed** in the [participant report](../evidence/participant-product-validation/report.json), with 146 implementation/build/fixture hashes unchanged before and after execution. Production financial sources match frozen baseline `da0495d6475aa8d0ed533f47f369a6e0085f9a83`. TypeScript and the browser build pass.

| Check | Result |
| --- | --- |
| Contract results | 47 passed |
| SDK tests | 59 passed |
| Participant helper tests | 6 passed |
| Evidence-checker tests | 21 passed |
| Consent browser checks | 12 passed |
| Existing workflow browser checks | 16 passed |
| Participant browser checks | 20 passed |

Review corrections include exact-packet acknowledgements, current wallet/source-chain checks immediately before a write, historical accepted-order verification after signature-policy rotation, atomic imports, selection-change invalidation, hash-first submission journals, original-action receipt recovery, scope-preserving paid totals and exact automatic payment selection. Unit and browser tests exercise these boundaries with disclosed synthetic chain/wallet failures. Deterministic test signatures are not independent participant signatures.

[Visual observations](../evidence/participant-product-validation/visual-observations.md) cover desktop and phone layouts. No real wallet transaction was sent during this iteration's automated or visual tests.

Reproduce with Node dependencies installed, the local app server running and a dedicated Chrome debug session:

```sh
CDP_PORT=9244 npm run participant:verify -- --browser
```

Omit the browser flag for the non-browser suites. The release includes `ui/dist`; `npm run ui:serve` serves it. The ZIP is a local source overlay plus the prebuilt app, with per-file hashes. For the Git-based frozen-source comparison, extract over the stated baseline checkout. Installed dependencies, credentials, Git internals and compiler caches are excluded. Earlier archives remain unchanged.

## Current operational limit

The [new public main120 readback](../evidence/participant-product-validation/public-main120.json) reports **accounting complete, provenance incomplete**. It reconciles 55 test CTC paid and 65 returned, but the configured public source RPC could not provide historical Safe state for all allocations. Fresh selected payment history correctly remains incomplete when the corresponding evidence is missing. The [readback notes](../evidence/participant-product-validation/public-readback-notes.md) distinguish this result from the older complete report used as a disclosed regression fixture.

An archive-capable source RPC for the same pinned chain is needed to reconstruct those missing historical observations. RPC availability, historical state and finality remain operational dependencies; no unavailable evidence has been replaced with a trusted assertion. Funding-before-consent remains an application and signed-terms check, not a reverse funding proof enforced on Ethereum. Source actions require source gas; an ERC-1271 worker needs execution through its actual account. Local browser records and journals are not backups; preserve them until reconciliation and use one execution tab.

This release is local and unpublished. The hosted app and public CI still describe the earlier published baseline. No new deployment, financial transaction, outreach, outside buyer, voluntary repeat or independent settlement is claimed. Those external observations cannot be completed by adding software. This iteration establishes no guaranteed competition placement.
