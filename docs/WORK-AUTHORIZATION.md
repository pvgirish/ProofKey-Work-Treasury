# Portable work authorization

Work Authorization V1 binds a worker's existing `QuoteV1` signature to the commercial terms and the funding/capacity observations they reviewed. It uses the deployed `termsHash` field; it changes no financial contract, allocation format or signature domain.

## Participant workflow

1. The sponsor prepares an exact epoch and reviews its funding transaction before explicitly sending it. The buyer's source Safe initializes the same epoch. The worker must observe finalized target funding and an active source epoch before creating binding consent.
2. On the worker's device, enter the scope, acceptance criteria, revision terms, delivery requirements and delivery commitment format, plus the recipients, maximum amounts and source block cutoffs. Creating the review packet reads both chains without asking for a wallet.
3. Review the whole packet. An explicit signature action checks its committed historical observations again, checks current funding and source eligibility, and asks the named worker to sign the unchanged quote domain. A draft or wallet change while the action is pending discards the returned signature.
4. Export the signed JSON. The buyer imports it on a separate device, recomputes every commitment, checks the exact configured domain, independently re-reads historical observations, checks the historical and current worker signature, and checks fresh source/target eligibility.
5. Prepare the source acceptance. The app creates exact `acceptQuote` calldata and a Safe Transaction Builder file. Preparing or downloading this file does not broadcast it. The actual source contract remains responsible for execution-time authorization and eligibility.

The build's trusted deployment registry identifies the published source and target runtime hashes. Importing a packet cannot add a trusted deployment. Unknown domains remain available for inspection; they do not unlock signing or transaction preparation. A buyer's Safe address may differ from the team fixture, but its chain and the epoch's source authority must match the configured domain. A mainnet Safe requires a separately matched source/target deployment before this workflow can use it.

Restored browser state is an input to inspect, not proof of a verified current session. Old draft formats remain exportable/inspectable. They must be recreated under the new version before the app signs them; existing on-chain agreements retain their original identities.

## What the signature binds

The packet version is `proofkey.work-treasury.work-authorization.v1`. The schema is [`schema/work-authorization-v1.json`](../schema/work-authorization-v1.json); the canonical implementation is [`sdk/work-authorization.ts`](../sdk/work-authorization.ts).

`termsHash` commits to five components:

| Component | Bound content |
|---|---|
| Commercial terms | Scope, acceptance criteria, revisions, delivery requirements and the format of a later delivery commitment |
| Epoch | Full existing epoch identity, including both chains/contracts, buyer Safe, sponsor, cap, policy and cutoffs |
| Order terms | Worker and payment recipients, committee, acceptance cutoff, nonce and all milestones, excluding the final `termsHash` to avoid a circular hash |
| Target funding observation | Target chain/treasury, finalized block number/hash, epoch cap, observed reserve and required maximum |
| Source capacity observation | Source chain/coordinator, finalized block number/hash, active phase, available capacity, cumulative reservations, remaining admissions and required maximum |

Text must already be NFC-normalized, nonempty and bounded in UTF-8 bytes. Numbers use canonical unsigned decimal strings. Unknown object fields, noncanonical values, altered order terms and mismatched domains are rejected. JSON property order is not the signature encoding: the SDK reconstructs typed ABI commitments and recomputes the existing order ID.

The packet's creation timestamp and post-signature validation-block locator are descriptive metadata, not signed terms. A verifier does not trust those fields as assertions of validity. It reads the identified chain state. The actual future delivery hash is also not invented in advance; the source delivery workflow records it later.

[`test/WorkAuthorizationConformance.t.sol`](../test/WorkAuthorizationConformance.t.sol) independently reconstructs the commitment in Solidity from the canonical JSON vector and compares the existing WorkTypes order identity and EIP-712 quote digest. This supplements the TypeScript tamper and signature tests.

## Boundaries

The funding observation is **not a reverse-chain proof enforced by Ethereum**. It establishes what was committed and independently checked before consent. Source state can change after review; the quote has a nonce and acceptance cutoff, and source execution can still reject it. Target reserve is an aggregate epoch reserve, not an individual worker reservation created by exporting a packet.

RPC finality and historical state are required for these checks. A provider's finalized tag is an RPC observation, not a consensus proof supplied by this packet. Confirmation-depth fallback may support labeled inspection but does not substitute for finalized consent checks.

EOA validation follows the deployed source's 65-byte, low-s signature rule. ERC-1271 validation is evaluated against the worker contract at an identified source block and rechecked before preparing new acceptance. A contract wallet can later change owners or modules. For an already accepted agreement, a closeout must establish successful historical source acceptance; it must not invalidate that agreement merely because the old signature no longer passes under today's wallet policy.

Signing proves authorization by the named account. It does not prove work quality, identity, independent key control, buyer demand or commercial payment value. Current public fixtures use test assets and team-controlled participants.
