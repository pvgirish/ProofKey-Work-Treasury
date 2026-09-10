# G0 cap/funding evidence bundle — 2026-09-10

Durable, self-contained archive of the bounded G0 accounting investigation. Replaces the earlier `/tmp` harness, which was not reproducible.

**Full analysis:** `../../../PROOFKEY-G0-CAP-FUNDING-2026-09-10.md`
**Outcome:** VERIFIED NARROWER GUARANTEE. **No defect detected in the bounded G0 investigation.**

> This was a bounded gate investigation, not an audit. "No defect detected in the bounded G0 investigation" is the correct phrasing. It is not an audit finding, not a security sign-off, and not a statement about code paths outside the four questions below.

## Revision tested

`revision.txt` — HEAD `da0495d6475aa8d0ed533f47f369a6e0085f9a83`, branch `main`, plus the uncommitted Participant Product overlay.
`source-snapshot.sha256` — the 11 `src/*.sol` hashes these results were produced against. `reproduce.sh` refuses to run if they drift.

## Contents

| Path | What it is |
|---|---|
| `reproduce.sh` | Verifies hashes, rebuilds the harness in scratch, runs the suite |
| `harness/test/G0CapFunding.t.sol` | The 7 decisive-case tests |
| `harness/foundry.toml` | Byte-identical copy of the repository's config |
| `harness.sha256` | Hashes of the two harness files |
| `source-snapshot.sha256` | `src/*.sol` hashes at test time |
| `revision.txt` | HEAD, branch, working-tree entry count |
| `logs/g0-forge-test.log` | Captured run output |
| `logs/toolchain.log` | forge 1.8.1, node v24.20.0, solc 0.8.28 |

The harness never writes into the repository: `src/`, `lib/`, `node_modules/` are symlinked read-only into a scratch directory.

## Run it

```bash
bash evidence/g0-cap-funding-2026-09-10/reproduce.sh
```

Expected: `7 passed; 0 failed; 0 skipped`.

## The four questions and what was observed

| Test | Question | Observed |
|---|---|---|
| `test_G0A` | Source acceptance before target funding | Source reaches `earned = 10 ether` with treasury balance `0`; target then rejects the real allocation with `EpochNotFunded` |
| `test_G0B`, `test_G0B2` | Missing / insufficient funding | `cap−1 wei` → `InsufficientFreeBalance`; 13 ETH for a 10 ETH cap → reserve exactly 10, free 3 |
| `test_G0C`, `test_G0C2` | Mismatched cap/epoch/target binding | Foreign epoch → `EpochNotFunded`; foreign treasury → `InvalidConfiguration` |
| `test_G0D`, `test_G0E` | Reuse / overlap / backing | Replay → `EconomicRightAlreadyRecognized`; +1 wei over cap → `EpochCapExceeded`; claim paid from escrow with `balance ≥ liveLiabilities` throughout |

## Evidence category — read this before citing

These 7 results are **their own category**. Do not merge them with any other count.

| Category | Value | Nature |
|---|---|---|
| **G0 decisive cases** | **7 passed** | Newly executed 2026-09-10, this bundle |
| Current canonical suites | 47 Foundry / 59 SDK / 6 participant / 21 judge = 133 | Newly executed 2026-09-10, separate |
| Historical browser/UI results | see `../ui-*` | **Historical** unless re-run |
| 143 CTC in / 143 CTC out | `../judge-verification.json` | **Historical**, captured 2026-09-09T21:31:57Z |
| Mined native `0x0FD2` evidence | `../judge-verification.json`, `../native-bundle-*.json` | **Real mined transactions** |

**Critical distinction:** the 7 tests here **mock** the native verifier at `0x0FD2` via `vm.mockCall` (see `src/NativeReceiptAuth.sol:12-13`). They establish contract-level accounting behaviour only. They are **not** evidence about live precompile behaviour. The mined native evidence in `../judge-verification.json` is a separate, real category. Never present a mocked test as on-chain native execution.
