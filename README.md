# ProofKey Work Treasury

Keep one finite work budget on Creditcoin while your organization approves work from its Ethereum Safe. Unused parts of a job reservation can fund a later job while earlier earned payments stay protected. **Attestcoin authenticates the Ethereum outcome before Creditcoin recognizes the payment entitlement.**

[Trace the Attestcoin payment path](docs/ATTESTCOIN-INTEGRATION.md): source policy outcome → native `0x0FD2` verification → one-time entitlement → withdrawal. The guide links mined single, batch and segmented transactions and explains why later cached collection remains proof-gated.

The local [app workflow upgrade](docs/APP-WORKFLOWS.md) brings payment provenance, replacement settlement and freshly reconstructed program closeouts into the browser. Its [completed acceptance checklist](docs/APP-WORKFLOW-PROGRESS.md) and [verified release notes](docs/APP-WORKFLOW-RELEASE.md) distinguish this work from the earlier hosted build.

The latest local [participant product](docs/PARTICIPANT-PRODUCT.md) connects buyer-prepared offers, worker review and signing, saved jobs and milestones, fresh follow-up work, and selected paid-work records. Its [release notes](docs/PARTICIPANT-PRODUCT-RELEASE.md) record validation and a historical-RPC limitation seen during one collection run. That limitation was transient: a [full closeout re-run on 10 September](evidence/closeout-refresh-2026-09-10/) completed with no errors and complete source provenance at finalized blocks on both chains. The hosted app remains the earlier published build.

In the public 120-CTC run, 50 CTC returned before the second job resolved; the final result paid workers 55 and refunded 65. The run is team controlled. Each source allocation can be recognized once through a saved checkpoint or its authenticated receipt.

This is the separate Work Treasury implementation. The earlier ProofKey Review Settlement and frozen Review #41 are not migrated or modified.

The baseline financial implementation and team-controlled public demonstrations are complete: all four testnet epochs closed with 143 CTC deposited, 143 CTC withdrawn and zero remaining liabilities. That published release passed 46 Foundry results (including one campaign checking four stateful invariants), 15 SDK tests and 21 evidence-checker tests; see [public CI](https://github.com/pvgirish/ProofKey-Work-Treasury/actions/workflows/ci.yml), the [finalized cross-chain audit](evidence/release-readback.json), and [release gates](docs/RELEASE-GATES.md). The current local revision adds the work-authorization conformance suite and the participant SDK and UI tests; run locally on 10 September it passed 47 Foundry, 59 SDK, 6 participant and 21 evidence-checker results with a clean typecheck. These local counts are not a published CI result. The [participant-workflow upgrade](docs/PRODUCT-UPGRADE-PROGRESS.md) adds portable consent, replacement settlement and program closeout to the local build, with the financial contracts unchanged. Its local validation is separate from the historical hosted release. Two consenting independent settlements, repeat independent use and a real buyer reason remain pending.

## Inspect the result in one minute

Open the [public app](https://pvgirish.github.io/ProofKey-Work-Treasury/) in a fresh browser: it automatically verifies the public configuration and reads the completed budget without a wallet. For an existing saved setup, **Networks → Use public demo defaults** explicitly restores the demo. Then select **Evidence → Run independent rebuild** to reconstruct the four source allocations at one stable block and compare their root with storage. **Payments → Read** for allocation 1 shows 30 CTC withdrawn and its recorded invoice.

The [conservation argument](docs/CONSERVATION-AND-REUSE.md) explains why an early refund preserves unseen earned work. The [refusal ledger](docs/REFUSAL-LEDGER.md) separates public native rejection, semantic rejection, economic replay and local rollback tests. Removing native authentication prevents a new source fact from unlocking payment; knowing a transaction hash or controlling its submitter is insufficient.

## Check the mined native evidence yourself

No key, wallet, `.env`, proof service or Solidity compiler is needed for this check:

```sh
npm ci --ignore-scripts
npm run judge:verify
```

The command re-reads three mined native paths, binds five events from `0x0FD2` to the treasury and exact source bytes, checks recorded Safe CALL provenance, and audits current global accounting. It reports failures explicitly. See the [verification scope and 30-second walkthrough](docs/JUDGE-VERIFY.md) and [captured report](evidence/judge-verification.json). This audits historical evidence; it does not broadcast or claim independent adoption.

## Buyer workflow to validate

The initial buyer hypothesis is a protocol team or ecosystem program commissioning **technical review, remediation and retest**. Its approvals already belong in an Ethereum Safe, and it must have a real reason to use a CTC work budget. One epoch covers successive scoped jobs and multiple consenting providers. Unearned capacity restored during finalization can fund another job; earned payments and returned credits remain separately accounted for.

The [pilot brief](docs/TECHNICAL-WORK-PILOT.md) compares this workflow with direct Safe payments and separate escrows. No buyer, revenue, security guarantee, credit score or work-quality oracle is claimed. CEIP is a possible audience, not a customer or endorsement. Current target payments use test CTC, and buyer validation remains required.

## Run the wallet app

[Open the public operator app](https://pvgirish.github.io/ProofKey-Work-Treasury/). Fresh sessions automatically verify and read the pinned public testnet demonstration. Saved setups are preserved until explicitly replaced, and verification errors remain visible. [Hosted browser checks](evidence/ui-firstload-hosted-qa/report.md) cover fresh loading, saved settings and failure recovery. Check that page before connecting a wallet; source finality can temporarily lag the latest demonstration transaction.

Requires Node 24 and Foundry. Solidity is pinned to 0.8.28; dependencies are pinned in `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run build
npm run ui:build
npm run ui:serve
```

Open the local URL printed by the server. In Networks, confirm the supplied testnet deployment or enter verified source and target addresses. Connect the wallet only when you want to sign or send an action. The browser stores workspace settings and drafts on this device; it never asks for private keys. Follow the [operator walkthrough](docs/OPERATOR-WALKTHROUGH.md) for the exact public setup and recovery steps.

1. Build an exact epoch, review and explicitly send its Creditcoin funding, and initialize it through the source Safe.
2. Review the commercial terms and finalized funding/capacity observations. The worker's quote binds the complete [portable authorization packet](docs/WORK-AUTHORIZATION.md).
3. Export the signed packet. A separate buyer browser imports and checks it, then prepares the exact Safe acceptance. The worker delivers; the Safe approves or challenges the current delivery.
4. Any replacement operator can validate a claim package and complete supported authentication, recognition and fixed-destination withdrawal through the [settlement runner](docs/REPLACEMENT-SETTLEMENT-AND-CLOSEOUT.md).
5. Export a program closeout. Another reviewer reconstructs its jobs, source outcomes, recognized amounts and successful WORK/FEE withdrawals from public reads. The separate invoice consumer remains a single-order demonstration.

The app prepares ordinary Safe transaction files. Import them in the Safe transaction builder for owner approval, or execute through a connected Safe wallet. It installs no Safe module or guard. Advanced contract actions expose all policy and recovery branches.

The downloadable Safe Transaction Builder JSON is the default Safe route. Direct browser execution requires an already injected Safe-compatible wallet whose active account is the configured Safe; the app does not bundle the Safe Apps SDK.

## Verify the implementation

```sh
npm run product:verify
```

This runs the local checks below, confirms that the financial source files match the frozen baseline, and records input hashes plus command results. It does not establish public CI or customer adoption. To include both app-workflow and consent browser checks, start the local app and a dedicated Chrome debug session, then use `CDP_PORT=9244 npm run product:verify -- --app-workflows --browser`. Browser wallet failures use disclosed fixtures; public readback is read only.

For the latest participant iteration, use `npm run participant:verify`; add `-- --browser` with the app and dedicated debug browser running to include all three browser suites. This also runs the participant offer/store/action tests.

```sh
npm run typecheck
npm run test:sdk
npm run test:contracts
npm run test:judge
bash scripts/forge.sh build --sizes --skip test
```

The committed CI workflow runs these checks and builds the wallet app. Tests cover actual source policy, real Safe v1.4.1 execution, ordered-tree reconstruction through 128 leaves, the reachable 113-leaf policy trace, both target evidence routes, withdrawal ordering, and consumer refusals. Tests stub the fixed native precompile at the VM boundary; they do not establish public native authentication. Public evidence is tracked separately in [the release ledger](docs/RELEASE-GATES.md).

The [frozen specification](docs/ARCHITECTURE-LOCK.md) defines the financial implementation gates. [Public transaction evidence](docs/PUBLIC-EVIDENCE.md) records the live journeys, and [explorer verification](docs/TARGET-SOURCE-VERIFICATION.md) records exact source/target reproduction and public publication status.

Create a keyless settlement plan or independently rebuild the public program's closeout:

```sh
npm run settlement:plan -- --claim evidence/claim-1.json --plan /tmp/proofkey-plan.json
npm run program:closeout -- --output /tmp/proofkey-closeout.json
npm run program:closeout -- --input /tmp/proofkey-closeout.json --output /tmp/proofkey-readback.json
```

These commands send no transactions. Existing completed claims correctly produce no new settlement actions. RETURN is recognized into the refund owner's fungible free balance; the closeout does not attribute an owner-level free withdrawal to one epoch.

## Public testnet run

Copy `.env.example` to `.env`, or set `PROOFKEY_ENV_FILE` to an existing local configuration. Never commit it. The runner requires the configured Sepolia relayer, Creditcoin sponsor, current Safe owner keys, and a distinct funded worker key. The source/target chain IDs are checked before any transaction: Ethereum Sepolia 11155111 and Creditcoin testnet 102031, with native source key 1.

```sh
npm run preflight
npm run deploy:testnet
npm run demo:public
npm run demo:branches
npm run demo:safe-rotation
```

The deployment manifest records immutable library links, transaction hashes, runtime byte counts, deployed code hashes and correspondence to compiled artifacts. A resumed deployment verifies existing code before continuing. Stop on any uncertain transaction error and inspect the recorded hash before retrying.

The demonstration persists progress under `evidence/`. Run it again when its stage reports waiting for finalized funding or native attestation. It deliberately stops source settlement B until RETURN 50 has been recognized on Creditcoin. Its final target phase collects from the cached root without requesting another proof. Public actors in this built-in run are team controlled and are labeled as such.

If saved native evidence has aged, rebuild it from the configured source RPC and the current Creditcoin attestation frontier. This command is read only: it does not submit a target transaction. The optional prior file makes recovery fail if the exact encoded source transaction bytes have changed; the output records the old and new continuity fingerprints without treating a changed continuity path as a failure by itself.

```sh
npm run proof:refresh -- 0xSOURCE_TRANSACTION_HASH \
  --prior evidence/native-bundle-EXISTING.json \
  --output refreshed-native-proof.json
```

The result is written under `evidence/` and contains no RPC URL or proof-service credential. It is proof material, not a claim that Creditcoin has accepted it. To make the public runners bypass an available hosted proof response for one recovery run, set `PROOFKEY_REFRESH_NATIVE_PROOF=1`; otherwise they use the raw SDK builder only when the hosted service is unavailable or returns malformed or substituted data. Raw generation requires a source RPC that supports `eth_getBlockReceipts`.

## Scope and trust

The Safe authorizes work on the source chain; the worker consents to the full terms and payout destinations. The source contract decides final amounts. Creditcoin authenticates the source fact through its fixed native verifier before the treasury recognizes that fact. Neither a proof service nor the transaction submitter chooses the payment amount.

There is no reverse proof of Creditcoin funding on Ethereum. The app checks finalized target funding before binding consent and delivery; the new quote also commits to the reviewed funding/capacity observations. These remain point-in-time observations rather than source-enforced funding guarantees. Bypassing the checks can create an unfunded source agreement. Proof unavailability can delay uncached settlement indefinitely; the target has no unilateral timeout refund of unseen reserves. An unpaid claim owner can redirect its payout, but money successfully paid to an accepting destination cannot be recovered by this protocol.

What the target does guarantee: every recognized allocation is backed one-for-one by native value the sponsor escrowed before any work was recognized. A funded epoch reserves exactly its immutable cap; recognition can never exceed that cap, no economic right is recognized twice, and no claim is paid twice. The Ethereum source independently conserves the same cap across available, unresolved, earned and returned capacity. Ethereum authorizes a budget; it does not prove the Creditcoin epoch is funded. See the [bounded accounting investigation](evidence/g0-cap-funding-2026-09-10/) for the reproducible checks behind this paragraph; no defect was detected within its scope, which is not an audit.

The finite epoch supports at most 32 admitted milestones, 16 active returns, 33 draining returns and a depth-seven allocation tree. Refunds do not reset the milestone admission count. The source policy has explicit approval, monitoring default, no-delivery, committee quorum, committee timeout and mutual-settlement outcomes. See [the policy and security notes](docs/POLICY-AND-SECURITY.md).

Two consenting independent settlements and a buyer reference require real participants. A passing test or the built-in team demonstration cannot satisfy that release gate. Those independent settlements remain pending.

## Dependencies and licenses

Project code is MIT licensed. Vendored Forge Standard Library retains its MIT/Apache licenses. Safe v1.4.1 artifacts retain their license in `vendor/safe/LICENSE`. Creditcoin native decoder/verifier interfaces and OpenZeppelin dependencies retain their upstream licenses in their packages.
