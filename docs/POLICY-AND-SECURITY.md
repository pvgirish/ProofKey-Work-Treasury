# Policy and security boundaries

## Economic state

Each source epoch conserves `cap = available + unresolved + earned + returned`. Accepting or reserving terms moves their full maximum from available to unresolved. Finalization consumes that reservation once, appends positive earned allocations, and restores the remainder to available. Only available capacity can become a RETURN. Target recognition counts all previously recognized allocations, including withdrawn ones; its reserve is `cap − recognized`.

The target conserves `credited deposits = free balances + epoch reserves + unpaid claims + cumulative withdrawals`. Forced surplus is observable and has no arbitrary owner. RETURN credits the fixed refund beneficiary's free balance. Funding a successor consumes only its sponsor's own free balance.

## WorkPolicyV1

All deadlines are **source block heights**, not timestamps or browser-clock times. Authorization windows are half open: consent, delivery, review and quorum are before their named cutoff; permissionless defaults begin at that cutoff.

| Trigger | Earned work | Earned fee | Remaining reservation |
|---|---:|---:|---|
| Pending decline / expiry / worker quote revocation | 0 | 0 | Restored |
| No delivery at delivery cutoff | 0 | 0 | Restored |
| Safe approves exact current delivery | Full work | 0 | Restored |
| Delivered, unchallenged monitoring default | Full work | 0 | Restored |
| Two distinct committee members agree before ruling cutoff | Exact signed work | Agreed fee | Restored |
| Challenged, committee timeout | Pre-agreed timeout work | 0 | Restored |
| Safe and worker mutually settle | Exact signed work | 0 | Restored |

The first valid terminal result wins. Approve/challenge bind the expected current delivery hash and state version, so queued Safe actions cannot approve a later revision. Mutual proposals bind current delivery, state and a revocable per-milestone nonce. Each committee member can revoke only their own old votes; valid votes must agree on one exact proposal and cannot pool across amounts or nonces. All full order terms, role addresses, cutoffs, fee settings, committee members, chain/contract domains and epoch policy are committed before consent.

## Source authority and deployment

The source coordinator uses immutable linked libraries for identities, signatures, policy validation and accounting. The compiled deployment links are recorded in the manifest. There is no upgrade function, administrator payment override, configurable verifier or arbitrary policy plug-in. Public library entry points cannot change coordinator storage without executing from that coordinator's linked call path.

EOA signatures require canonical length, v and low-s; the zero signer is rejected. Contract signatures use EIP-1271 static calls. Ordinary Safe calls follow the Safe's current owner policy. Existing Safe modules remain part of that Safe's authority; ProofKey does not install or bypass them. Local owner-change tests use actual Safe v1.4.1 artifacts.

## Evidence and recovery

The verifier is fixed to Creditcoin's `0x0000000000000000000000000000000000000FD2`. Native authentication persists an identity containing source key, block height, transaction position derived by the verifier, decoder profile, and the hash of the exact encoded bytes. Cache use still checks those bytes, successful receipt status, receipt-local ordinal, source emitter and canonical event encoding.

Checkpoint recognition verifies the full allocation against exactly seven ordered siblings. Receipt recognition decodes the exact canonical allocation event. Both call the same recognizer and permanently consume `(epochId, allocationId)`. Neither route accepts a caller-selected amount, owner, asset, policy or transaction position as an independent authority.

A cached checkpoint plus a witness works without new native proof access. A native allocation receipt works without application siblings or source getters. If neither usable evidence form survives, settlement can remain unavailable. Permissionless republishing uses current stored state only; it is not an administrator root repair mechanism.

## Withdrawals and consumer

WORK/FEE recognition creates a full fixed claim. Anyone can pay its agreed destination; only its claim owner can redirect it while unpaid. Either successful ordering completes it once. Rejecting destinations roll back all accounting and can be replaced by the owner. Accepting destinations that subsequently lock funds cannot be recovered by the protocol. Free-balance withdrawals follow equivalent owner/fixed-destination rules.

PaidInvoiceBook pins one treasury, buyer, order, asset and policy. It records only a completed WORK withdrawal and its actual destination. An earned allocation, recognized unpaid claim, FEE or RETURN is not a paid invoice.

## Verification limits

Contract tests execute real policy/storage/tree/decoder/signature code. The native precompile is stubbed only at the local VM boundary. These tests cannot establish the live verifier's behavior or availability. Public runs must name deployed bytecode, source and target transactions, authentic native inputs and outcomes. Independent-user evidence additionally requires consent and control disclosures. The earlier abstract state model does not prove Solidity, signature correctness, native decoding or product usability.
