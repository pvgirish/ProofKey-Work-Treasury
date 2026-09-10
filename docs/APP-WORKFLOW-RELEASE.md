# App workflow release — 10 September 2026

The three agreed browser workflows are implemented and verified locally: payment provenance, replacement settlement and fresh program closeout. Production financial source files match frozen baseline `da0495d6475aa8d0ed533f47f369a6e0085f9a83` byte for byte. This extends the earlier portable-authorization/SDK release; it does not modify V1 Review #41 or introduce a payment route.

Start with the [app workflow guide](APP-WORKFLOWS.md). Run the local server with `npm run ui:serve` after building, or serve the package's prebuilt `ui/dist` with that same command. The hosted app and public CI remain the earlier published baseline.

## What changed

- **Check payment** connects source policy outcome, historical Safe provenance, native authentication, recognition and actual withdrawal, with explorer links. Fresh native verification and reuse of authenticated evidence are distinguished. RETURN is a credit rather than an asserted epoch-specific withdrawal.
- **Continue verified payments** imports existing claim files, reconstructs a keyless plan from finalized reads and shows the fixed destination. Each explicit continuation considers at most one transaction. A synchronous execution lock prevents duplicate clicks; returned wallet hashes are journaled under their original plan before receipt waiting. Resume checks the actual target RPC chain and receipt/state, without automatically resending an unknown transaction.
- **Verify program** uses the same fresh collector as the CLI. It reconstructs the complete source prefix and root, conservation, target reserve, recognized value and completed WORK/FEE claims. Importing a report retains locators only. Contradictory or missing evidence cannot produce an overall complete result or a green individual-payment result.

Bulk implementation used GPT-5.6 Sol at high reasoning. Stronger review was restricted to evidence claims and the wallet/settlement boundary. Review findings were corrected before final validation.

## Final validation

The [hash-bound validation report](../evidence/app-workflow-validation/report.json) passed against 140 implementation, build and fixture files, with unchanged hashes before and after execution.

| Check | Result |
|---|---|
| Production financial source comparison | Matches frozen baseline |
| Type checking and browser build | Passed |
| Foundry contract results | 47 passed |
| SDK tests | 49 passed |
| Evidence-checker tests | 21 passed |
| Consent browser checks | 12 passed |
| App workflow browser checks | 16 passed |

Browser regression uses live public setup and keyless planning, a separately collected public report for rendering, and disclosed simulated wallet/RPC failures. It does not claim a new settlement. The [public readback summary](../evidence/app-workflow-validation/public-readback-summary.json) records fresh collector results for all four existing team-controlled epochs and a fresh reimport of the main report. Main120 reconciles as 55 paid and 65 returned credit; the branch, expiry and Safe-rotation examples also complete. Each report identifies its own finalized blocks. [Manual visual observations](../evidence/app-workflow-validation/visual-observations.md) cover the visible closeout action and ordinary/phone-width layouts.

Reproduce the final suite with a dedicated local Chrome debug session and the app server running:

```sh
CDP_PORT=9244 npm run product:verify -- --app-workflows --browser
```

## Delivery and limits

The App-Workflows ZIP is a local source overlay plus a prebuilt browser app. Extract it over a checkout at the frozen baseline for the Git-based source comparison. Its per-file manifest and adjacent SHA-256 identify the delivered bytes; credentials, installed dependencies, Git internals and compiler caches are excluded. Earlier review ZIPs remain unchanged.

No new financial transaction, outreach, deployment or publication was performed for this release. The buyer pilot and control/consent records are prepared, but no outside buyer, voluntary repeat use or independent settlement is claimed. The [pilot guide](TECHNICAL-WORK-PILOT.md) explains what those observations mean. They are product-validation targets rather than a new competition eligibility rule.

RPC access and finalized historical data are still required. A browser journal belongs to that browser profile and is not a backup; use one execution tab and preserve its data until submissions are reconciled. Safe runtime checks are historical block-end RPC observations. Program caps can include reused funds and must not be summed as unique deposits. This release establishes no guaranteed competition rank.
