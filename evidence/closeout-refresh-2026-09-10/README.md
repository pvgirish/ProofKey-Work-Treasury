# main120 closeout refresh — 2026-09-10

Newly collected full program closeout for the canonical lifecycle. **Nothing was overwritten or relabeled.**

## Result

| Field | Value |
|---|---|
| Output | `public-main120-refresh.json` |
| Epoch | `0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7` |
| `status` | **complete** |
| `accountingStatus` | **complete** |
| `errors` | `[]` |
| Label | Complete program closeout |
| Attempts needed | 1 of 3 |

Snapshots (both `rpc-finalized`):

| Chain | Block | Block hash |
|---|---:|---|
| Sepolia 11155111 | 11675013 | `0xc1803121391cbae5f9daf77bd0622d97ef31a8cd504d69da80f71adfc142e62e` |
| Creditcoin 102031 | 5463616 | `0x72cc9bb46005b5c09c46219525adbbc1db4322cc80305da334ab6d636384d4c5` |

Contracts: SourceCoordinator `0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138` · WorkTreasury `0x06c76dFF132e64453cc0eD04a4464648db4322DA`.

Accounting: cap 120 CTC = 0 available + 0 unresolved + **55 earned** + **65 returned**; recognized 120, reserve 0, paid 55, outstanding 0, `conservation: true`, `prefixComplete: true`.

Allocation provenance — all four resolved, zero source errors:

| Allocation | Kind | Status | Execution | Policy outcome |
|---:|---|---|---|---|
| 1 | WORK | paid | `safe-call` | milestone |
| 2 | RETURN | returned-credit | `safe-call` | return |
| 3 | WORK | paid | `safe-call` | milestone |
| 4 | RETURN | returned-credit | `direct` | return |

This is allocation-for-allocation identical to the historical complete snapshot.

## Why this run was made

A later collection run on 2026-09-10 15:37 produced `status: incomplete` with three source-provenance errors. This refresh, run against the same public endpoints in `deployments/testnet.json`, completed on the first attempt with no errors — confirming that failure was a **transient RPC condition**, not a capability gap or a chain fact.

The full closeout was re-run in its entirety. A successful Safe `nonce()` probe alone would **not** have been sufficient to call the closeout complete, and was not treated as such.

## Canonical selection

| Role | File | Date |
|---|---|---|
| **Canonical, newly collected** | `evidence/closeout-refresh-2026-09-10/public-main120-refresh.json` | **2026-09-10, this run** |
| Historical complete, corroborating | `evidence/app-workflow-validation/public-main120.json` | 2026-09-10 14:18 |
| Historical provenance-incomplete, preserved | `evidence/participant-product-validation/public-main120.json` | 2026-09-10 15:37 |

All three are retained unmodified. The provenance-incomplete snapshot is kept deliberately: it is the record of the transient failure and must not be deleted or relabeled.

## Separate evidence, not part of this lifecycle

- **143 CTC in / 143 CTC out** — `../judge-verification.json`, captured **2026-09-09T21:31:57Z**. A four-epoch treasury-wide **value** reconciliation, not a count of checks and not this epoch. Never re-present it as newly executed.
- **Mined native `0x0FD2` evidence** — `../judge-verification.json`, `../native-bundle-*.json`. Five events across three mined paths. Real mined transactions; supplemental to this lifecycle, not merged into it.
- **G0 decisive cases** — `../g0-cap-funding-2026-09-10/`. Seven tests that **mock** the native verifier. Contract-level accounting only; not evidence of live precompile behaviour.

Do not combine different epochs or deployments into a single end-to-end example.

## Reproduce

```bash
cd /Users/girish/Documents/ProofKey/ProofKey-Work-Treasury && node scripts/program-closeout.ts --epoch 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7 --output evidence/closeout-refresh-2026-09-10/public-main120-refresh.json
```

Read-only: public endpoints from `deployments/testnet.json`, no key, no `.env`, no broadcast. Block-pinned results will differ by snapshot height.
