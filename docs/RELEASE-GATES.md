# Release evidence ledger

This ledger separates implemented behavior, local verification and public observations. A pending row is not a passed release gate. The built-in public run uses team-controlled actors.

| Gate | Implemented / local evidence | Public observation |
|---|---|---|
| Frozen allocation/checkpoint ABI, epoch/order domains | `schema/`, SDK conformance and `IdentityConformance.t.sol` | Pending deployment run |
| Conserved source policy and all terminal outcomes | `SourceCoordinator.t.sol`, `AdversarialIntegration.t.sol` | Pending branch runner |
| Capacity, actual 113-leaf policy, actual 128-leaf tree | `SourceCoordinator.t.sol`, `AllocationTree.t.sol` | Public getters implemented; measured run pending |
| Atomic publication and independent rebuild | Real source event roundtrip, full bottom-up test reconstruction | Public same-block rebuild pending |
| Republish and immutable source authority | Source tests and Safe integration tests | Public republish/owner-change observation pending |
| Native necessity, single/batch/segmented paths | `WorkTreasuryTarget.t.sol`; local native boundary stub disclosed | Pending actual native proofs |
| Persisted cache, wrong event/emitter/domain rejection | Target and adversarial tests | Pending cached public claims and mined refusal |
| Receipt/checkpoint economic equivalence and replay | Both directions in `EndToEnd.t.sol` | Pending native run |
| Refund before unseen WORK; payout ordering and recovery | Target tests and locked 120-unit E2E | Pending public 120-unit journey |
| Receipt-only and cached-root collection | Target and E2E tests | Pending both public recovery demonstrations |
| Measured costs and transaction bounds | Performance measurements in progress | Native costs pending |
| Wallet app, portable evidence, proof replacement | Guided app and SDK implemented; browser review in progress | Public hosting pending |
| Completed-WORK consumer | Target tests reject nonpayments and wrong expectations | Pending public completed payment |
| Public CI | `.github/workflows/ci.yml` ready | Pending public run |
| Two consenting independent settlements, repeat use, buyer reason | Participant request sent to project owner | **Pending real participants; cannot be replaced by team fixtures** |

The runtime sizes before deployment are SourceCoordinator 21,789 bytes and WorkTreasury 20,019 bytes, below the 24,576-byte EIP-170 limit. Compiler settings are Solidity 0.8.28, Cancun, optimizer 200, via IR. The deployment runner independently compares deployed bytes to the linked compiled runtime outside declared immutable slots, then checks the public target immutables.
