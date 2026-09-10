# Product upgrade progress — 10 September 2026

Approved strategy: portable work authorization, separate participant operation, replaceable settlement and verifiable program closeout. Baseline release: `da0495d6475aa8d0ed533f47f369a6e0085f9a83`.

Progress below counts ten implementation acceptance milestones. It is not an estimate of prize probability, customer adoption or production readiness. Existing public testnet fixtures remain team-controlled.

| Milestone | Status | Acceptance |
|---|---|---|
| 1. Baseline and scope | Complete | 46 contract tests, 15 SDK tests, 21 checker tests and type checking pass; financial contracts/codecs remain the baseline |
| 2. Canonical consent SDK | Complete | 22 SDK tests and type checking pass, including canonical packet, tamper/domain, strict EOA/ERC-1271, historical finalized observation and fresh eligibility cases |
| 3. Wallet and draft state | Complete | Nine targeted browser boundary checks passed, including restored-session locks, stale preparation and held wallet/draft actions; full regression remains milestone 8 |
| 4. Separate participant handoff | Complete | 12 browser checks pass, including real EOA signature/parser/calldata across isolated worker/buyer contexts. Active chain state is an explicitly synthetic fixture; no wallet transaction or independent adoption is claimed |
| 5. Replacement settlement | Complete | Trusted domain/runtime/profile, selected-event and canonical call checks; resumable atomic journals; 13 focused runner/closeout tests pass. Public claim-1 planning correctly returns already complete without sending |
| 6. Program closeout | Complete | All four public epochs reconstruct successfully, including WORK/FEE payments, expiry and Safe rotation. Imported closeout is freshly rebuilt; new authorization packets resolve historical Safe acceptance. RETURN remains owner-level free credit |
| 7. Deployment inspection tooling | Complete | All six source creation/runtime checks pass using hash-pinned frozen compiler input; targeted review passes. Four contracts are publicly fully verified; two explorer publications remain externally pending after HTTP 429. New buyer-domain deployment remains separately gated |
| 8. Integration verification | Complete | 47 contract results, 38 SDK tests, 21 checker tests, type checking and UI build pass on unchanged input hashes. Twelve separate-session browser checks and sixteen public-readback checks pass with fixture disclosures |
| 9. Product and operator documentation | Complete | Authorization, replacement operator, closeout, buyer pilot and release documents distinguish local implementation, public historical fixtures and pending outside adoption |
| 10. Reviewed release bundle | Complete | Targeted independent review findings resolved; final source/app overlay and SHA-256 manifest checked against the passing validation input hashes, with credentials and caches excluded |

Current implementation checklist: **10/10 (100%)**.

Model allocation: GPT-5.6 Sol with high reasoning performs the main coding work. An attempted additional GPT-5.6 Terra UI worker could not start because the app reported its agent limit, then a second Sol/high worker became available for the replacement runner and closeout in parallel with the app work. Stronger existing reviewers inspect bounded security and integration concerns. No claim is made that the main conversation's model was changed.

External outcomes are tracked separately: qualified buyer, publication consent, independently controlled participant settlements, voluntary repeat, and production payment value. Test CTC is not revenue. No new mainnet deployment is implied by completing this checklist.
