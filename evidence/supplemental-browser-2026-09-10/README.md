# Supplemental browser evidence — 2026-09-10

Isolated read-only checks that close coverage left open by three stale QA harnesses, plus the corrected prover classification. **No wallet, no signing, no broadcast. No tracked evidence was overwritten** — this directory is new, and the probes write nothing into the repository.

Two earlier conclusions are **corrected** here. Both corrections are stated plainly rather than quietly replaced.

---

## 1. Epoch preparation after valid session verification — CLOSED

`probe-epoch-after-verify.mjs`. The app's own `#load-public-demo` verification was used to unlock the session; that step performs **real read-only chain reads** against the pinned public endpoints. Everything below is live, not mocked.

| Observation | Result |
|---|---|
| Locked before verification (`requireVerifiedWorkspace` throws) | `true` |
| Session unlocked ("write preparation is unlocked") | `true` |
| `verifiedWorkspaceFingerprint === workspaceFingerprint()` | `true` |
| Epoch prepared after verification | `true` — **"Exact epoch ID 0x81b7e203c341bd51d5d6132129ab4b83beb3d0c6ecba7cf51579868fc7f20943"** |
| Epoch ID is bytes32 | `true` |
| 120 CTC → canonical base units | `true` (`120000000000000000000 base units`) |
| Draft remains nonbinding | `true` ("No source initialization or target funding has occurred.") |
| 19 decimal places rejected | `true` — "Budget cap must be a nonnegative CTC amount with up to 18 decimal places" |
| uint256 overflow rejected | `true` — "Budget cap exceeds the uint256 CTC limit" |
| Negative rejected | `true` |
| Wallet calls made | **0** |

Observed `2026-09-10T13:47:44Z`.

This is exactly the assertion `ui-qa` timed out on. The harness could never reach it: it configures unreachable fake RPCs (`127.0.0.1:18545`), so the overlay's session-verification gate (`ui/app.ts:1129`, first call `requireVerifiedWorkspace()`) can never be satisfied there.

## 2. Finality guard — intact, verified statically plus runtime safety

The exact strings `ui-finality-qa` asserts are **present verbatim in the current code**, in two guards:

- `ui/app.ts:216` — "Binding worker consent and delivery require a real finalized Creditcoin block with its hash. This RPC did not provide one; confirmation-depth fallback is available for inspection only."
- `ui/app.ts:222` — the matching source-capacity guard for Ethereum.

The harness fails earlier, at a **consent-bound-packet prerequisite** added by the overlay, so it never reaches these guards. When it was blocked, its own instrumentation recorded **`Source-capacity calls: 0`** and no wallet access — the safety property the check exists to protect held.

**Not claimed:** the finality-unavailable *message* was not observed at runtime in this pass. Static presence plus the observed zero-call safety behaviour is the evidence; that is weaker than a live assertion and is labelled as such.

## 3. First-load storage label — cosmetic, not trust- or permission-affecting

`ui-firstload-qa` expects a stale-setup error to persist; the current UI shows "Checking without changing saved settings." (`ui/app.ts:1134`), the status passed to `verifySettingsWithStatus` when `#verify-settings` is clicked. The string is truthful: saved settings are not changed.

Permission to proceed is governed by `verifiedWorkspaceFingerprint`, **not** by any label:
- `requireVerifiedWorkspace()` throws unless the fingerprint matches (`ui/app.ts:245`) — observed `true` in §1.
- Verification failure always re-locks: `verifiedWorkspaceFingerprint = result.trusted ? … : null` (`ui/app.ts:457`) and `= null` on error (`:463`).
- `ui-consent-qa` (passing) independently asserts restored work stays locked without current-session verification.

**Conclusion: cosmetic.** No effect on trust state, verification status, or permission to proceed.

## 4. Prover — CORRECTED: the service works; the earlier 404 was my malformed request

**Previous claim (withdrawn):** "the public prover returns 404 for both the real transaction and a control hash — external-service failure."

That probe used `/api/v1/proof-by-tx/{txHash}`. The application's documented request is **`/api/v1/proof-by-tx/{chainKey}/{txHash}`** (`ui/app.ts:942`) — two path segments. The earlier 404 was caused by omitting `chainKey`, so it isolated nothing.

Re-probed with the correct shape:

| Request | Status | Evidence |
|---|---|---|
| `/api/v1/proof-by-tx/1/0x33642ef4…8efc5` | **200**, 14840 bytes | `prover-response-33642ef4.json` — `chainKey 1`, `headerNumber 11669711`, `txIndex 57`, matching `txHash` |
| Control, same shape, bogus tx | **404** | `prover-control-404.json` — structured `{"code":"TxHashNotFound","retriable":false}` |

The control's structured, specific error confirms correct routing rather than a broken path.

**Classification: incorrect probe request by this review. Not a service limitation, not an eligibility issue, not a product defect.**

## 5. Fresh interactive proof generation — WORKS today

`probe-proof.mjs`, observed `2026-09-10T13:49:53Z`, against the live prover.

| Observation | Result |
|---|---|
| Configured prover URL | `https://prover.cc3-testnet.creditcoin.network` |
| Configured chain key | `1` |
| Browser fetch + validation | **`result success`** |
| Reported | Block **11669711**, encoded transaction **3776 bytes**, **7** transaction siblings · **90** continuity roots |
| Export control enabled | `true` |
| In-memory export payload | `chainKey 1`, matching `transactionHash`, `blockHeight 11669711`, `siblings 7`, `roots 90` — all `SingleProof` fields present |

`ui-proof-qa`'s own first three checks also passed this session — "Browser fetched and validated proof", "Export control is enabled", "Proof response matches completed source transaction" — before failing at the download step.

### Why `ui-proof-qa` still fails: an unsatisfiable harness assertion

The download check is:

```js
downloaded = files.find(name => name === expectedName && !filesBefore.has(name));
```

`expectedName` is `proofkey-native-proof-33642ef4.json`, which **already exists as a committed baseline file** in `evidence/ui-proof-qa/`. It is therefore always in `filesBefore`, so the predicate can never be satisfied on a clean checkout. The harness presumes a cleaned output directory.

**Classification: harness defect / environment presumption.** Not the service, not the product.

**Not verified, and not claimed:** the browser's file **download to disk**, and the assertions after it. The complete interactive workflow is therefore **not** described as fully verified — fetch, validation and export-enablement are verified; download-to-disk is not.

---

## Standing limits

- The four QA harnesses encode pre-overlay UI copy and flow. They will keep failing until refreshed. **No application code was changed to make an obsolete harness pass**, and none should be.
- §1 and §5 are live read-only chain and service checks. §2 is static-code plus indirect runtime evidence. Nothing here is a mocked result presented as live.
- These supplemental checks are their own evidence category. Do **not** merge them into the 133 core suite results or the 7 G0 cases.

## Reproduce

```bash
npm run ui:build && npm run ui:serve
```
Then start headless Chrome with `--remote-debugging-port=9246` and run `node evidence/supplemental-browser-2026-09-10/probe-epoch-after-verify.mjs` (and `probe-proof.mjs`) with `CDP_PORT=9246 UI_URL=http://127.0.0.1:4173/`.
