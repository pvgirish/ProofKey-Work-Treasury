# Release check — 2026-09-10

Local pre-publication check on HEAD `da0495d` + Participant Product overlay, after the README corrections.
Contracts were built into an **isolated output location** (`FOUNDRY_OUT=/tmp/proofkey-release-out`, `FOUNDRY_CACHE_PATH=/tmp/proofkey-release-cache`) so the canonical `out/` used by the verification scripts was not disturbed.

## Automated suites — all newly executed 2026-09-10

| Suite | Command | Result | Log |
|---|---|---|---|
| Foundry contracts | `forge test --summary` | **47 passed, 0 failed** | `forge-test.log` |
| SDK | `npm run test:sdk` | **59 passed, 0 failed** | `test-sdk.log` |
| Participant / UI unit | `npm run test:participant` | **6 passed, 0 failed** | `test-participant.log` |
| Evidence checkers | `npm run test:judge` | **21 passed, 0 failed** | `test-judge.log` |
| Types | `npm run typecheck` | clean | `typecheck.log` |
| UI bundle | `npm run ui:build` | 3 compiled interfaces | `ui-build.log` |

Total **133 passing, 0 failing**. Foundry breakdown: AdversarialIntegration 4 · AllocationTree 5 · EndToEnd 2 · IdentityConformance 1 · Performance 4 · SourceAccountingInvariant 1 · SourceCapacityReuseFuzz 2 · SourceCoordinator 14 · WorkAuthorizationConformance 1 · WorkTreasuryTarget 13.

**Separate categories — do not merge into the 133:**
- **G0 decisive cases: 7 passed** — `../g0-cap-funding-2026-09-10/`. These **mock** the `0x0FD2` verifier.
- **143 CTC in / 143 CTC out** — `../judge-verification.json`, **historical, captured 2026-09-09**.
- **Mined native `0x0FD2` evidence** — real mined transactions, distinct from any test result.

## Browser suites — freshly executed, mixed result

Run against a locally built UI (`http://127.0.0.1:4173/`) driven over CDP by headless Chrome 153.0.8010.36 on port 9244. **This is a genuine current pass, not a retained historical status** — for the six suites that passed.

| Suite | Result |
|---|---|
| `ui-participant-qa` | **PASS (current)** |
| `ui-workflows-qa` | **PASS (current)** |
| `ui-consent-qa` | **PASS (current)** |
| `ui-completed-qa` | **PASS (current)** |
| `ui-live-qa` | **PASS (current)** |
| `ui-public-qa` | **PASS (current)** |
| `ui-qa` | **NOT ESTABLISHED here** — timed out waiting for `#epoch-result` to contain "Exact epoch ID" |
| `ui-finality-qa` | **NOT ESTABLISHED here** — timed out waiting for `#target-main` to read "Exact epoch funded" |
| `ui-firstload-qa` | **NOT ESTABLISHED here** — assertion "Stale setup error remains visible" |
| `ui-proof-qa` | **NOT ESTABLISHED here** — failed at the download-to-disk assertion |

**These four are not claimed as passing and are not claimed as regressions.** Their historical status in `../ui-*` directories is retained unchanged and is **not** upgraded by this run. No fresh browser pass has been invented for them.

> ### ⚠ Correction — 2026-09-10, later the same day
>
> An earlier draft of this file attributed the `ui-proof-qa` failure to *"a proof-builder service that is not configured in this environment."* **That diagnosis was wrong and is retracted.**
>
> The prover requires no configuration — its URL is public and built into the app. The failing probe behind that claim omitted the `chainKey` path segment. Against the documented path `/api/v1/proof-by-tx/{chainKey}/{txHash}` (`ui/app.ts:942`) the service returns **HTTP 200** with valid proof material, and a control transaction returns a structured `TxHashNotFound`.
>
> Live re-checks the same day also established the behaviour `ui-qa` could not reach, and showed the browser proof workflow fetching and validating successfully.
>
> **Root causes are recorded in `../supplemental-browser-2026-09-10/`.** All four failures are harness drift against the stricter Participant Product overlay, or an unsatisfiable harness assertion — **not** product defects and **not** a service outage.
>
> Limitations that remain genuinely unverified: the finality-unavailable **response message** was not observed at runtime, and the browser **file download to disk** was not verified. Neither is claimed as passing.

## Unchanged implementation

Contract sources and build configuration are byte-identical to the opening snapshot:

| File | SHA-256 |
|---|---|
| `foundry.toml` | `6c859119a9551236dbf3dc6b36579b725e2f4f4dd13f423a80a3f589b84ae326` |
| `package.json` | `82d296d6ae38e86b2b7f9809836506f160ce62c69407261e61b1edcd7f02fdb7` |
| `tsconfig.json` | `916d743634976e9bd0d3d6cad652a74f4f49c2e749425b446e2c9385c9bad800` |
| `deployments/testnet.json` | `b402336cdb3aa943e880ec238e02e640c393f759f3d917925ad28ea5b72290cd` |

All eleven `src/*.sol` hashes match `g0-cap-funding-2026-09-10/source-snapshot.sha256`.

## Reproduce

```bash
export PATH="$HOME/.foundry/bin:$PATH" FOUNDRY_OUT=/tmp/proofkey-release-out FOUNDRY_CACHE_PATH=/tmp/proofkey-release-cache && cd /Users/girish/Documents/ProofKey/ProofKey-Work-Treasury && forge test --summary && npm run test:sdk && npm run test:participant && npm run test:judge && npm run typecheck
```

Browser suites additionally need `npm run ui:build`, `npm run ui:serve`, and a headless Chrome started with `--remote-debugging-port=9244`, then `CDP_PORT=9244 UI_URL=http://127.0.0.1:4173/ node scripts/ui-participant-qa.mjs`.
