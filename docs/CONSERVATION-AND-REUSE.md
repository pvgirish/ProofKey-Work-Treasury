# Conserved work budgets and reusable capacity

An organization reserves one Creditcoin budget while its Ethereum Safe commissions multiple work orders. A cancelled or partially earned reservation can free capacity for a later order before older workers collect payment. Old earned rights remain payable. This is the capability the accounting protects; a new order does not require a new target reservation within that epoch.

## State and assumptions

For one epoch, let `C` be its immutable cap, `A` its available source capacity, `U` its unresolved source commitments, `E` its cumulative WORK/FEE allocations, `R` its cumulative RETURN allocations, and `P` the cumulative amount recognized on Creditcoin, including allocations already withdrawn. Let `T` be its target reserve.

The cross-chain relation assumes an exact funded epoch with matching chain/contract/configuration identity, correct deployed source and target code, canonical authenticated source history, collision-resistant commitments and correct native verification. Choose a finalized source prefix containing every allocation already recognized at the target; an earlier lagging RPC snapshot cannot establish this relation. Work approval remains the authority of the agreed Safe, worker and policy, not a cryptographic assertion of real-world quality.

## Safety relation

The source transition rules maintain:

```text
C = A + U + E + R
A, U, E, R >= 0
```

Each target recognition consumes one exact source allocation once, through either evidence route. Therefore:

```text
0 <= P <= E + R
T = C - P = A + U + (E + R - P)
T >= A + U
```

The remaining target reserve covers both currently available source capacity and unresolved obligations, plus earned or returned allocations not yet recognized. Recognizing a RETURN cannot erase an unseen worker allocation: the RETURN had already left `A` at the source, and it decrements only its own target share. Withdrawal does not reset `P` or permit recognition again.

This is an invariant argument from the transition rules under the stated assumptions. The tests and public traces exercise those rules; neither is a machine-checked proof of the compiler, native verifier or complete deployed system. The finalized 143-CTC readback is one observed execution, not the theorem itself.

## Two distinct kinds of reuse

| Action | Source movement | Target movement | Reuse allowed |
|---|---|---|---|
| Admit a work reservation of `m` | `A -= m; U += m` | None | Reserves available capacity for this order |
| Finalize reservation `m` with earned amount `x` | `U -= m; E += x; A += m-x` | None until proof recognition | The unearned `m-x` can fund later work in this epoch while admission remains open |
| Recognize WORK/FEE amount `x` | None | `T -= x; P += x`; create unpaid claim | That earned allocation cannot be reused |
| Publish RETURN amount `r` | `A -= r; R += r` | None until proof recognition | That capacity is permanently retired from this epoch |
| Recognize RETURN amount `r` | None | `T -= r; P += r`; credit refund beneficiary's free balance | Owner may withdraw it or reserve it in a new epoch |
| Fund a successor from returned free balance | No mutation of the old epoch | Consume sponsor's free balance; create a new exact reserve | Fresh epoch ID and limits; old obligations remain isolated |

The cumulative admission limit does not reset when capacity is released. SourcePolicyV1 still limits each epoch to 32 admitted milestones, with protected allocation/return slots. Reuse is a financial property, not unlimited admission.

## Global target accounting

Across all epochs, let `D` be credited deposits, `F` total free balances, `Q` unpaid WORK/FEE claims and `W` completed withdrawals:

```text
D = F + sum(T) + Q + W
live liabilities = F + sum(T) + Q
actual contract balance >= live liabilities
```

Moving a refund into a successor changes liability categories without creating a deposit. A successful withdrawal reduces the relevant liability and increases `W`; a failed transfer reverts both changes. Forced transfers may create uncredited surplus, so balance equality is not universally required.

## What this does not guarantee

Ethereum does not verify Creditcoin funding. An operator bypassing the app can create an unfunded source agreement. The app's finalized-funding check protects its normal consent/delivery flow, but it is not an Ethereum contract precondition. Fixing that different property requires a supported reverse-authentication design, not a new conservation slogan.

Proof availability can indefinitely delay uncached recognition. There is no target timeout that returns reserves while unseen source allocations may exist. A valid historical work decision does not prove current non-revocation of an unrelated attestation, the truth of delivered work, or an independent customer relationship.

## Executable and public evidence

- [Source transition and capacity tests](../test/SourceCoordinator.t.sol): terminal paths, limits, protected returns and the actual 113-leaf policy trace.
- [Stateful accounting and reuse tests](../test/SourceAccountingInvariant.t.sol): four invariant assertions against an independent accounting model in 128 runs of 64 randomized handler calls, plus two 256-case fuzz properties for same-epoch reuse and irreversible RETURN. Guarded calls may be no-ops; the call count is not a count of distinct financial transitions.
- [Source accounting](../src/SourceAccountingLib.sol): consume unresolved capacity once, append earned allocations, restore the unearned remainder and check source conservation.
- [Target recognizer and withdrawals](../src/WorkTreasury.sol): one economic identifier for both evidence routes, reserve/cap enforcement and liability-preserving withdrawals.
- [End-to-end tests](../test/EndToEnd.t.sol): RETURN before delayed WORK collection and successor isolation.
- [Finalized public readback](../evidence/release-readback.json): four closed epochs, reconstructed roots, settled claims and 143 testnet CTC deposited and withdrawn.

The core counterfactual is precise: without native authentication or a matching previously authenticated record, an arbitrary submitter cannot introduce the source allocation or checkpoint that unlocks recognition. A separate trusted signer could replace that boundary only by changing the security model.
