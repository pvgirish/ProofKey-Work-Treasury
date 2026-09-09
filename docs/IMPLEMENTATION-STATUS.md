# Work Treasury implementation status

Implementation began on 9 September 2026 from the final architecture lock. This is a separate repository; frozen V1 code and Review #41 remain unchanged.

Model allocation: GPT-5.6 Sol at high reasoning handles the bounded source, target and application implementation tasks. GPT-6 Astra coordinates the shared commitments and reviews financial/security boundaries. This records the actual coding workflow, not a claim that a ChatGPT UI setting was changed.

| Area | Current status |
|---|---|
| Shared epoch/order/allocation codecs and incremental tree | Implemented; cross-language vectors and 128-leaf reconstruction pass |
| Source work policy and finite budget lifecycle | Implemented; all policy branches and reachable 113-leaf trace pass locally; the public branch run is underway |
| Target native authentication, one recognition kernel and withdrawals | Implemented; local tests use an explicitly disclosed native VM stub |
| Wallet app, portable evidence and inspector | Implemented; 15 SDK tests and desktop/mobile browser checks pass. The [public app](https://pvgirish.github.io/ProofKey-Work-Treasury/) returns HTTP 200. Live readback, browser proof, and hosted-provider proof replacement are recorded |
| Safe authority/owner change integration | Actual Safe v1.4.1 local integration passes; disposable public Safe rotation pending |
| Actual native testnet evidence and measured costs | Contracts deployed with verified runtime correspondence; the 120-CTC target epoch is finalized. A native batch and an exact RETURN50 receipt recognition have been mined; the remaining lifecycle is pending. The local gas matrix is published |
| Public CI and submission artifacts | [Public CI run 34390602894](https://github.com/pvgirish/ProofKey-Work-Treasury/actions/runs/34390602894) passes; public app and evidence artifacts are present |
| Completed-WORK consumer | Implemented and tested locally; public paid-consumer observation pending |
| Two consenting independent settlements and buyer reference | External participants needed; request sent to user |

The current local contract suite passes 40 tests and the SDK suite passes 15 tests. The linked public CI run predates the marginal-event measurement and passed its then-current 39 contract tests plus all 15 SDK tests. In the public main journey, native batch transaction `0x803637ce8d1e691d826e64292366fa7e7de6f1d9f0676c82833c8d5a31562542` used 435,498 gas. RETURN50 receipt recognition transaction `0x10a7d1c89661234ccd6f9291b21b0cff99abd359cc1d1a0b80a2c9dd53a36d03` used 374,122 gas and was mined while order B still held 40 CTC unresolved. The source remainder, final native checkpoint and claims remain pending.

Fixture tests, local demonstrations, stubbed local authentication and actual native evidence remain distinct. See `docs/RELEASE-GATES.md`, `deployments/testnet.json`, `evidence/local-performance.json`, `evidence/ui-qa/report.md`, `evidence/ui-live-qa/report.md`, `evidence/ui-proof-qa/report.md`, `evidence/native-recovery-verification-33642ef4.json` and the progressing `evidence/public-demo.json` for scope and observations. The regenerated approve-A proof preserved the exact encoded transaction and ten-root continuity path, and the fixed Creditcoin native verifier returned true in a read-only call. Public source branches, the disposable Safe rotation, the paid consumer and independent settlements remain open release work.
