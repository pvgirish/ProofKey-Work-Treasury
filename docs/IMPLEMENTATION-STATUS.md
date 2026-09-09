# Work Treasury implementation status

Implementation began on 9 September 2026 from the final architecture lock. This is a separate repository; frozen V1 code and Review #41 remain unchanged.

Model allocation: GPT-5.6 Sol at high reasoning handles the bounded source, target and application implementation tasks. GPT-6 Astra coordinates the shared commitments and reviews financial/security boundaries. This records the actual coding workflow, not a claim that a ChatGPT UI setting was changed.

| Area | Current status |
|---|---|
| Shared epoch/order/allocation codecs and incremental tree | Implemented; cross-language vectors, the reachable 113-leaf production-policy trace and the 128-leaf production-tree harness pass locally |
| Source work policy and finite budget lifecycle | Implemented; every terminal and required refusal passes locally, and the smaller public main and branch traces are complete on Sepolia |
| Target native authentication, one recognition kernel and withdrawals | Implemented; local tests disclose their native VM stub. Actual single, batch and segmented native paths have each mined successfully on Creditcoin testnet |
| Wallet app, portable evidence and inspector | Implemented; 15 SDK tests and desktop/mobile browser checks pass. The [public app](https://pvgirish.github.io/ProofKey-Work-Treasury/) returns HTTP 200. Live readback, browser proof, and hosted-provider proof replacement are recorded |
| Safe authority/owner change integration | Actual Safe v1.4.1 local integration passes. A new disposable public Safe rejected the removed-owner signature set with GS026 and accepted the same queued approval under its current owners; the existing Safe remained unchanged. Target attestation for this fixture is pending |
| Actual native testnet evidence and measured costs | Deployed runtime correspondence passes, and all three target-side contracts/libraries are fully verified on Blockscout. The complete 120-CTC journey, branch receipt-only WORK/FEE collection and measured native calls are recorded; successor-expiry and rotation target attestations remain pending |
| Public CI and submission artifacts | [Public CI run 34392863030](https://github.com/pvgirish/ProofKey-Work-Treasury/actions/runs/34392863030) passes 40 contract tests and 15 SDK tests; the public app and generated public-evidence document are present. A follow-up CI run for a small demo refund-withdraw reporting fix remains pending; production contracts are unchanged |
| Completed-WORK consumer | Implemented and tested locally; the main public journey deployed PaidInvoiceBook and recorded an actually withdrawn WORK payment |
| Two consenting independent settlements and buyer reference | External participants needed; request sent to user |

The public main journey is complete: workers received 55 CTC, the refund beneficiary withdrew 65 CTC, and the epoch reserve is zero. RETURN50 was recognized while order B still held 40 CTC unresolved. The final checkpoint then supported delayed cached-root worker collection. Both cross-route replay directions refused duplicate value, and a deliberately mined status-0 transaction demonstrated that an authenticated checkpoint event cannot be used as an allocation payment fact.

The source branch fixture is complete with E=9 CTC and R=11 CTC; its noninitial WORK/FEE receipt-only allocations were recognized and 9 CTC was paid. Its returned balance funded a fresh successor epoch, whose uninitialized source expiry is mined and awaiting target attestation. The disposable Safe rotation source fixture is also complete and awaiting target attestation. These team-controlled fixtures remain distinct from the still-pending two independent settlements and buyer reference. Current links and transaction receipts are collected in `docs/PUBLIC-EVIDENCE.md`; local measurements and proof-recovery evidence remain in `evidence/local-performance.json` and `evidence/native-recovery-verification-33642ef4.json`.
