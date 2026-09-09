# Authentication, refusal and rollback evidence

Refusals are evidence of particular boundaries, not a quota of failed transactions. Public simulations below are `eth_call` observations and spend no funds. The separately linked status-0 transaction was deliberately mined. Local tests replace the native VM boundary to check application behavior; they do not reproduce the native cryptography.

## Public observations

The [read-only control report](../evidence/public-refusal-checks.json) records a valid-proof control followed by four refusals at one explicit public target block. Reproduce it with `npm run proof:verify-refusals` using the documented RPC configuration. The script constructs no signing wallet, distinguishes contract rejection from transport errors, and refuses to label ambiguous failures as security evidence.

| Case | Observed behavior | Evidence class |
|---|---|---|
| Authentic source receipt, repeated authentication | Accepted; the existing authentication identity remains valid | Public native `eth_call` positive control; idempotency is intentional |
| Change one byte while keeping the original Merkle witness | Native runtime rejects the proof before recognition | Public native `eth_call`; the runtime's revert may bubble instead of `ProofVerificationFailed` |
| Select a receipt-local log outside its bounds | `LogOrdinalOutOfRange` | Public `eth_call` using real authenticated bytes |
| Present an authenticated checkpoint as an allocation | `InvalidEncoding` | Public `eth_call`; also a [mined status-0 refusal](https://creditcoin-testnet.blockscout.com/tx/0x0d077b52bb15edd32a8bbc3a2be0bd3420e7c657b43804b7128f8efb5785e079) |
| Recognize the already-paid worker allocation through its receipt | `EconomicRightAlreadyRecognized` | Public `eth_call`; original payment and both economic replay directions are recorded in [the main journal](../evidence/public-demo.json) |

The mined refusal used authentic native-backed bytes and failed at the application event boundary. It is not evidence of a cryptographically invalid proof. A reverted transaction does not retain logs emitted earlier in that reverted transaction; native success evidence belongs to the successful authentication transaction and persisted record.

## Observed proof replacement

The later read-only run also tested proof replacement at target block 5,459,734: the previously used 10-root continuity witness was rejected with `Continuity proof does not match attestation or checkpoint`; the raw SDK regenerated a 90-root witness for byte-identical source data, and native authentication accepted it. The report includes both outcomes and the complete accepted replacement. This observed recovery is distinct from the earlier [unchanged-witness regeneration](../evidence/native-recovery-verification-33642ef4.json), and neither implies unlimited future availability.

## Targeted local boundaries

The [target test suite](../test/WorkTreasuryTarget.t.sol) directly checks:

- Native single verification returning false: exact `ProofVerificationFailed`; a plausible matching allocation creates no authentication, economic right, claim or liability change.
- Native batch verification returning false: exact `ProofVerificationFailed`; no authentication is created.
- A later native call reverting inside segmented authentication: the revert bubbles and the earlier authentication is rolled back.
- A combined checkpoint/claim operation failing after authentication: the new authentication, checkpoint, latest-root pointer and financial effects are rolled back together.
- Correct receipt-local selection, wrong-emitter rejection, byte binding, both evidence routes, withdrawal ordering and rejecting recipients.

## Corrections to the proposed seven-case ledger

Repeated **authentication** is not repeated **payment**. The authentication cache deliberately accepts the same valid identity; the economic recognizer refuses the same `(epochId, allocationId)` twice. The source chain key is immutable and is supplied internally to native verification, not a freely selectable payment parameter.

Wrong-emitter and failed-source receipt fixtures are useful local cases. A conforming pinned source cannot author a legitimate allocation that exceeds its cap merely to create an impressive failed public transaction. Keep defensive cap checks and tests honest about the fixture needed to reach them. Do not deploy fake source facts or an alternative verifier to fill a public-refusal table.
