# ProofKey Work Treasury

Keep work approvals in an Ethereum Safe. Pay completed work from a finite Creditcoin budget. Reuse released capacity, return unused funds, and collect a payment through either a saved checkpoint or an authenticated allocation receipt.

This is the separate Work Treasury implementation. The earlier ProofKey Review Settlement and frozen Review #41 are not migrated or modified.

## Run the wallet app

Requires Node 24 and Foundry. Solidity is pinned to 0.8.28; dependencies are pinned in `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run build
npm run ui:build
npm run ui:serve
```

Open the local URL printed by the server. In Setup, load the supplied testnet deployment or enter verified source and target addresses. Connect the wallet only when you want to sign or send an action. The browser stores workspace settings and drafts on this device; it never asks for private keys.

1. Build an exact epoch, fund its cap on Creditcoin, and initialize it through the source Safe.
2. Draft the work terms. The worker signs only after the app reads finalized funding for that exact epoch.
3. The Safe accepts the quote. The worker delivers; the Safe approves or challenges the current delivery.
4. Import a claim package or fetch native proof material. Recognize the allocation on Creditcoin.
5. Withdraw the recognized payment. Record the completed WORK payment in the separate invoice consumer.

The app prepares ordinary Safe transaction files. Import them in the Safe transaction builder for owner approval, or execute through a connected Safe wallet. It installs no Safe module or guard. Advanced contract actions expose all policy and recovery branches.

## Verify the implementation

```sh
npm run typecheck
npm run test:sdk
npm run test:contracts
bash scripts/forge.sh build --sizes --skip test
```

The committed CI workflow runs these checks and builds the wallet app. Tests cover actual source policy, real Safe v1.4.1 execution, ordered-tree reconstruction through 128 leaves, the reachable 113-leaf policy trace, both target evidence routes, withdrawal ordering, and consumer refusals. Tests stub the fixed native precompile at the VM boundary; they do not establish public native authentication. Public evidence is tracked separately in [the release ledger](docs/RELEASE-GATES.md).

## Public testnet run

Copy `.env.example` to `.env`, or set `PROOFKEY_ENV_FILE` to an existing local configuration. Never commit it. The runner requires the configured Sepolia relayer, Creditcoin sponsor, current Safe owner keys, and a distinct funded worker key. The source/target chain IDs are checked before any transaction: Ethereum Sepolia 11155111 and Creditcoin testnet 102031, with native source key 1.

```sh
npm run preflight
npm run deploy:testnet
npm run demo:public
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

There is no reverse proof of Creditcoin funding on Ethereum. The official app checks finalized target funding before binding consent and delivery. Bypassing that check can create an unfunded source agreement. Proof unavailability can delay uncached settlement indefinitely; the target has no unilateral timeout refund of unseen reserves. An unpaid claim owner can redirect its payout, but money successfully paid to an accepting destination cannot be recovered by this protocol.

The finite epoch supports at most 32 admitted milestones, 16 active returns, 33 draining returns and a depth-seven allocation tree. Refunds do not reset the milestone admission count. The source policy has explicit approval, monitoring default, no-delivery, committee quorum, committee timeout and mutual-settlement outcomes. See [the policy and security notes](docs/POLICY-AND-SECURITY.md).

Two consenting independent settlements and a buyer reference require real participants. A passing test or the built-in team demonstration cannot satisfy that release gate.

## Dependencies and licenses

Project code is MIT licensed. Vendored Forge Standard Library retains its MIT/Apache licenses. Safe v1.4.1 artifacts retain their license in `vendor/safe/LICENSE`. Creditcoin native decoder/verifier interfaces and OpenZeppelin dependencies retain their upstream licenses in their packages.
