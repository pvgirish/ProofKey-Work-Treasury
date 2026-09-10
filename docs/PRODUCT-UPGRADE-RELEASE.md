# Work Treasury product upgrade — 10 September 2026

The approved product upgrade is implemented and verified locally. It makes a work agreement portable between worker and buyer, allows a replacement operator to finish settlement, and reconstructs a program's accounting and successful payments from finalized public chain reads. Production financial Solidity is byte-for-byte unchanged from `da0495d6475aa8d0ed533f47f369a6e0085f9a83`.

## What is ready

- **Work authorization:** canonical commercial terms and finalized funding/capacity observations bind into the existing `termsHash` and QuoteV1 domain. The SDK rejects changed commitments, wrong domains and invalid signatures. Historical observations and fresh eligibility are checked separately. Source acceptance still does not cryptographically verify Creditcoin funding; these checks are enforced by the guided client and the reviewable authorization packet.
- **Separate participant operation:** a worker exports a signed packet; a buyer imports and rechecks it in a different session before preparing the exact Safe transaction. Changed wallets, drafts, RPC settings or deployment domains invalidate prepared actions. Unknown deployments remain inspect-only until trusted configuration is supplied.
- **Replacement settlement:** the keyless runner creates a reviewable plan. Explicit execution permits only checked recognition and fixed-destination withdrawal, validates the exact selected source event and native profile, and atomically journals transaction hashes for resumption. It cannot choose a new payout destination. An actual fixed-destination transfer failure requires the claim owner's existing redirection path.
- **Program closeout:** the collector rebuilds source state and allocation roots, native authentication, target recognition and successful withdrawal evidence. An imported report is freshly recollected; its verdict is not trusted. Optional authorization packets are tied to actual agreed orders and Safe acceptance. RETURN is credited to the refund owner's fungible free balance; the report does not attribute a later free withdrawal to an individual epoch.
- **Deployment inspection:** the explorer tool reproduces deployed creation bytes using hash-pinned original compiler input. All six source and three target creation/runtime checks pass. Four source contracts and all three target contracts are fully verified publicly; two source publications remain pending after explorer HTTP 429.

Guides: [authorization](WORK-AUTHORIZATION.md), [operator walkthrough](OPERATOR-WALKTHROUGH.md), [replacement and closeout](REPLACEMENT-SETTLEMENT-AND-CLOSEOUT.md), [technical work pilot](TECHNICAL-WORK-PILOT.md), [explorer verification](TARGET-SOURCE-VERIFICATION.md).

## Verification and its limits

The [local validation report](../evidence/product-upgrade-validation/report.json) binds the exact implementation, test, build, deployment and fixture hashes. All input hashes remained unchanged during execution:

| Check | Observed result |
|---|---|
| Contract suite | 47 passed, zero failed or skipped; includes one new independent Solidity authorization commitment/domain/digest conformance test |
| SDK suite | 38 passed, zero failed or skipped |
| Evidence checker suite | 21 passed, zero failed or skipped |
| Type checking and wallet build | Passed |
| Separate worker/buyer browser checks | 12 passed; real deterministic EOA signature with synthetic active chain state and isolated sessions; no real wallet broadcast |
| Existing public payment/import UI checks | 16 passed against read-only public RPC; no wallet injected |
| Bounded independent security review | Identified deployment, selected-event, journal and closeout trust issues were corrected; final review found no remaining material issue within that scope |

The Solidity vector test verifies commitments and the quote digest, not cross-language signature execution. Signature rules have separate SDK and production-source tests. Local native adapter tests disclose their VM stub; new browser fixtures are not independent users or live new settlements.

Fresh read-only closeouts of existing team-controlled public epochs passed:

| Epoch | Cap / earned / RETURN / paid (test CTC) | Evidence |
|---|---|---|
| Main | 120 / 55 / 65 / 55 | [Closeout](../evidence/product-upgrade-closeouts/main120.json), [fresh imported-report recollection](../evidence/product-upgrade-closeouts/main120-fresh-reimport.json) |
| Branch | 20 / 9 / 11 / 9 | [Closeout](../evidence/product-upgrade-closeouts/branch20.json) |
| Expiry | 1 / 0 / 1 / 0 | [Closeout](../evidence/product-upgrade-closeouts/expiry1.json) |
| Safe rotation | 3 / 2 / 1 / 2 | [Closeout](../evidence/product-upgrade-closeouts/safe-rotation3.json) |

Each has zero outstanding earned payment. These caps include capacity reused between epochs and must not be added to infer unique deposits. Older orders are explicitly classified as legacy; no new commercial authorization or independent buyer is invented for them.

## Reproduce

Use Node.js 22.18 or later, the pinned npm lockfile, Foundry and Solidity 0.8.28. From the repository:

```sh
npm ci
npm run product:verify
npm run ui:serve
```

The full integration command includes contract, SDK, checker, type and wallet build checks. With the isolated browser QA endpoint prepared, `CDP_PORT=9244 npm run product:verify -- --browser` also executes the consent browser checks. Existing public UI readback is recorded separately in [its report](../evidence/product-upgrade-browser/public-readback/report.md).

The review ZIP is a source overlay for the baseline checkout, with a prebuilt `ui/dist` for local preview. Extract it over a checkout at the baseline commit before running the verification command, which compares production source against that Git revision. It excludes credentials, dependency installations, Git history and local compiler caches. Its archive hash and per-file manifest identify the delivered bytes.

## Outstanding external outcomes

This local upgrade is not yet the hosted app and has no matching new public CI run. `SourceAccountingLib` and `SourceCoordinator` explorer publication remain pending after HTTP 429, despite successful creation/runtime correspondence. New financial deployments and live pilot payments were not performed in this implementation run.

Two consented independently controlled settlements, voluntary repeat operation and an actual buyer reason remain unfulfilled. The technical-review → remediation → retest pilot is an actionable product workflow, not a claim of demand or revenue. Submission-card, video and deck completion are separate requirements. No ranking or prize is guaranteed.

Bulk implementation used GPT-5.6 Sol with high reasoning, with stronger models limited to focused security and integration review. The [progress ledger](PRODUCT-UPGRADE-PROGRESS.md) records implementation acceptance milestones separately from these external outcomes.
