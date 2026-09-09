# Work Treasury implementation status

Implementation began on 9 September 2026 from the final architecture lock. This is a separate repository; frozen V1 code and Review #41 remain unchanged.

Model allocation: GPT-5.6 Sol at high reasoning handles the bounded source, target and application implementation tasks. GPT-6 Astra coordinates the shared commitments and reviews financial/security boundaries. This records the actual coding workflow, not a claim that a ChatGPT UI setting was changed.

| Area | Current status |
|---|---|
| Shared epoch/order/allocation codecs and incremental tree | Implemented; cross-language vectors and 128-leaf reconstruction pass |
| Source work policy and finite budget lifecycle | Implemented; all policy branches and reachable 113-leaf trace pass |
| Target native authentication, one recognition kernel and withdrawals | Implemented; local tests use an explicitly disclosed native VM stub |
| Wallet app, portable evidence and inspector | Implemented; SDK tests and desktop/mobile headless browser checks pass |
| Safe authority/owner change integration | Actual Safe v1.4.1 local integration passes; public owner rotation pending |
| Actual native testnet evidence and measured costs | Contracts deployed with verified runtime correspondence; 120-CTC target epoch funded; native lifecycle run in progress; local gas matrix published |
| Public CI and submission artifacts | CI workflow ready; public CI execution pending |
| Two consenting independent settlements and buyer reference | External participants needed; request sent to user |

Fixture tests, local demonstrations, mocked authentication and real native evidence remain distinct. See `docs/RELEASE-GATES.md`, `deployments/testnet.json`, `evidence/local-performance.json`, `evidence/ui-qa/report.md` and the progressing `evidence/public-demo.json` for scope and observations. Independent settlements remain an external release requirement.
