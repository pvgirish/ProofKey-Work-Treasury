# Deployment reproduction — existing Sepolia / Creditcoin deployments

**Date:** 2026-09-10. **Mode:** read-only. No key, no signature, no broadcast, no redeploy, **no verification submitted**.
**Revision:** HEAD `da0495d` + Participant Product overlay.
**Originals preserved:** `verification/source-compiler-input.json` is **unmodified** (SHA-256 `f3c1ae9167254dc88f0266bbe989bfc80e5a97d15344bac37c46bb2ad830dc11`).

---

## Result

| Contract | Chain | On-chain bytes | Verdict |
|---|---|---:|---|
| **SourceCoordinator** | Sepolia 11155111 | 21789 | **FULL RUNTIME BYTE-FOR-BYTE EQUALITY** |
| **SourceAccountingLib** | Sepolia 11155111 | 2646 | **EXACT** after documented linking + self-address immutable |
| WorkTypes | Sepolia / Creditcoin | 2881 | FULL byte-for-byte equality (both chains) |
| SourceSignatureLib | Sepolia | 2066 | FULL byte-for-byte equality |
| SourcePolicyV1Lib | Sepolia | 2507 | FULL byte-for-byte equality |
| AllocationTree | Sepolia / Creditcoin | 2832 | Exact outside `library_deploy_address`; slot resolved to each chain's own deployed address |
| **WorkTreasury** | Creditcoin 102031 | 20019 | Exact outside 4 declared immutables; **all 17 slots resolved** |

**The previously reported "21,789-byte match" is now resolved: it is full runtime byte-for-byte equality, not equal length only.** `SourceCoordinator` declares **no immutables at all** (`immutableReferences: {}`), so nothing was masked and metadata was not stripped.

### Hashes (SHA-256 over runtime bytes)

| Artifact | SHA-256 |
|---|---|
| SourceCoordinator on-chain runtime | `987ce5dbee0759374b11fab75013483bff95dd75661bd92ffe60f1aeb90b65c3` |
| SourceCoordinator reproduced from Foundry artifact | `987ce5dbee0759374b11fab75013483bff95dd75661bd92ffe60f1aeb90b65c3` |
| SourceCoordinator reproduced from retained standard JSON | `987ce5dbee0759374b11fab75013483bff95dd75661bd92ffe60f1aeb90b65c3` |
| SourceAccountingLib on-chain runtime | `1d77a36997cca40b6d7989c891f361087eea8405f2289470c5a8ef403320e09b` |
| SourceAccountingLib reproduced | `1d77a36997cca40b6d7989c891f361087eea8405f2289470c5a8ef403320e09b` |

Pinned blocks: Sepolia **11675052**, Creditcoin **5463592**. Block hashes and timestamps in `deployment-reproduction-2026-09-10.json`.

---

## Recovered build process

| Input | Value | Source |
|---|---|---|
| Compiler | `0.8.28+commit.7893614a` | `deployments/testnet.json`; confirmed against the local solc binary |
| Optimizer | enabled, 200 runs | `foundry.toml`, `deployments/testnet.json`, retained standard JSON |
| viaIR | `true` | all three |
| EVM version | `cancun` | all three |
| Metadata | `bytecodeHash: ipfs`, `appendCBOR: true`, `useLiteralContent: false` | retained standard JSON |
| Source paths | `src/*.sol` relative, content-embedded | retained standard JSON (43 sources) |
| Constructor arguments | **none for SourceCoordinator** | ABI has no constructor inputs |
| **Library linking** | **post-compilation placeholder patching** | `scripts/runtime.ts:55-72` |

### The linking finding — this corrects an earlier assessment

`settings.libraries` in the retained input is `{}`. An earlier review flagged this as a defect and recommended populating it. **That recommendation was wrong and has been withdrawn.**

`scripts/runtime.ts` links **after** compilation: `linkedBytecode()` walks `linkReferences` and overwrites each 20-byte placeholder with a deployed address (`scripts/runtime.ts:55-72`). Compilation itself therefore ran with **no** library settings, and `deploy()` patched the artifact afterwards (`scripts/runtime.ts:100`).

This is not an inference. It was tested: compiling the retained input **exactly as it stands** and applying only post-compilation linking reproduces the on-chain runtime hash **exactly**. Populating `settings.libraries` would change solc's metadata input and therefore the trailing metadata bytes, and would **break** the match.

> **`verification/source-compiler-input.json` is correct as-is and must not be edited.**
> Library addresses belong in the explorer's separate library-address fields, not in `settings.libraries`.

### Library references — confirmed against deployed code, not inferred from names

`SourceCoordinator` requires five links, each independently reproduced byte-for-byte at its recorded address:

| Library | Address | Placeholders patched | Deployed code reproduced |
|---|---|---:|---|
| `WorkTypes` | `0xeA13543Ca73703cd65C6CFb98AE0b6d429BE85F8` | 6 | Full byte-for-byte |
| `AllocationTree` | `0xF56c7e00daB6f3FAd65E3A85Aa6c8FDE34e48f43` | 5 | Exact outside self-address |
| `SourceSignatureLib` | `0x481935Eb6D4e55B8664cd3B88CD1233D5BdCa1a1` | 6 | Full byte-for-byte |
| `SourcePolicyV1Lib` | `0xc9b230f18bD16955D302f9Bf3BDB522186Be46B3` | 2 | Full byte-for-byte |
| `SourceAccountingLib` | `0x3AC9B3eb94DBA253bCC4284a981fB45d35386612` | 6 | Exact after its own links + self-address |

`SourceAccountingLib` is itself linked: it references `AllocationTree` ×1 and `SourcePolicyV1Lib` ×1. Missing this nesting produced a spurious mismatch during this investigation; it is recorded here so the same trap is not re-entered.

### Immutables — every masked slot resolved, none masked arbitrarily

`immutable-resolution-2026-09-10.json`.

**Libraries.** solc emits a deployed library's own address as `immutableReferences.library_deploy_address` (32-byte word, left-padded 20-byte address). Each resolved to that library's own recorded address — which is why source `AllocationTree` differs from target `AllocationTree` at the same offset (`0xF56c…` vs `0xfcD2…`).

**WorkTreasury.** All four declared immutables were read independently through their public getters at the pinned block and matched the deployment manifest:

| Immutable id | Getter | Value read on-chain | Matches manifest |
|---|---|---|---|
| 41014 | `VERIFIER()` | `0x0000000000000000000000000000000000000fd2` | Yes |
| 41016 | `SOURCE_CHAIN_KEY()` | `1` | Yes |
| 41018 | `SOURCE_COORDINATOR()` | `0xcf50a18ff9021f328cc89fb37b9a2c872bb70138` | Yes |
| 46597 | `SOURCE_CHAIN_ID()` | `11155111` | Yes |

All 17 slots map to one of these four values. No slot was masked without a documented explanation.

---

## Artifacts

| File | Purpose |
|---|---|
| `source-compiler-input.json` | **ORIGINAL — unmodified** |
| `candidate-source-accounting-lib-input-2026-09-10.json` | Candidate for `SourceAccountingLib`: identical to the original except `outputSelection` also emits `SourceAccountingLib`. Justified because the original selects only `SourceCoordinator`, so it cannot serve that verification |
| `reproduce-deployment.mjs` | Rebuilds every runtime from local artifacts; compares at a pinned block |
| `resolve-immutables.mjs` | Resolves each masked slot to an independently-read value |
| `deployment-reproduction-2026-09-10.json` | Machine-readable comparison |
| `immutable-resolution-2026-09-10.json` | Machine-readable immutable resolution |

## Reproduce

```bash
cd /Users/girish/Documents/ProofKey/ProofKey-Work-Treasury && node verification/reproduce-deployment.mjs && node verification/resolve-immutables.mjs
```

Compile the retained input directly (solc 0.8.28 as fetched by Foundry):

```bash
"$HOME/Library/Application Support/svm/0.8.28/solc-0.8.28" --standard-json verification/source-compiler-input.json > /tmp/solc-out.json
```

---

## Proposed verification commands — NOT SUBMITTED

For the **existing** deployments only. Verification of a deployed contract; never grounds to redeploy.

**SourceCoordinator** — `0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138` (Sepolia):
- Method: Solidity **Standard-JSON-Input**
- Input file: `verification/source-compiler-input.json` — **unmodified**
- Compiler: `v0.8.28+commit.7893614a`
- Constructor arguments: **none**
- Library addresses: supply the five above in the explorer's library fields — **do not** add them to `settings.libraries`

**SourceAccountingLib** — `0x3AC9B3eb94DBA253bCC4284a981fB45d35386612` (Sepolia):
- Input file: `verification/candidate-source-accounting-lib-input-2026-09-10.json`
- Libraries: `AllocationTree`, `SourcePolicyV1Lib`

Optional, same pattern: `WorkTypes`, `SourceSignatureLib`, `SourcePolicyV1Lib`, `AllocationTree`, and `WorkTreasury` on Creditcoin.

**Authorization:** explorer submission is **not authorized**. These commands are prepared only.

## Unresolved

None. Every deployed runtime in `deployments/testnet.json` was reproduced, with every masked byte accounted for by a documented, independently-read value.

**Reproduction is not source verification.** No explorer has been asked to confirm anything, so no "source-verified" claim may be published yet.
