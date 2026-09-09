# Binding-consent target finality UI QA

Run: 2026-09-09T21:28:45.722Z
URL: http://127.0.0.1:4173/

An isolated browser loaded the public read-only configuration. The negative case then replaced JsonRpcProvider.getBlock only inside that page so `finalized` returned null while ordinary block-number reads remained available. A recording EIP-1193 wallet stub would fail any wallet request; it recorded none. A source-capacity spy delegated to the real function if called and proved that the finality error happened first. The successful case restored ethers' original provider method and read the real public finalized target block.

The quote draft was an injected unsigned, zero-amount fixture used only to exercise the real Sign Quote button's gate ordering. The pending order was also an injected UI fixture used only to exercise the real Deliver button and calldata-preparation boundary. The live public epoch is complete with zero reserve; no source capacity, worker account, live pending order, funded worker consent, or live deliverability is claimed. No source-capacity or account result was mocked.

## Result

- PASS — Public demo loaded without a wallet: Epoch account, configuration and source-domain immutables read together at target finalized block 5459906.
- PASS — Unavailable finalized tag blocks quote before source-capacity or wallet access: Binding worker consent and delivery require a real finalized Creditcoin block with its hash. This RPC did not provide one; confirmation-depth fallback is available for inspection only. Source-capacity calls: 0.
- PASS — Failed quote remains unsigned and has no observation: {"version":"proofkey.work-treasury.draft.v1","authority":"none","orderId":"0x1111111111111111111111111111111111111111111111111111111111111111","terms":{"epochId":"0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7","worker":"0x2222222222222222222222222222222222222222","milestones":[{"work":"0","fee":"0"}]}}
- PASS — Unavailable finalized tag blocks delivery persistently: Delivery was not prepared. · Binding worker consent and delivery require a real finalized Creditcoin block with its hash. This RPC did not provide one; confirmation-depth fallback is available for inspection only.
- PASS — Failed delivery changes no prepared call: {"preparedSource":null,"signature":"acceptOffer(bytes32,bytes)","args":"[]"}
- PASS — Read-only inspection retains labeled fallback: {"blockTag":5459896,"label":"block 5459896 (12 confirmations behind head; finality not asserted)"}
- PASS — Default target inspection still works through the labeled fallback: {"main":"Exact epoch funded","detail":"Epoch account, configuration and source-domain immutables read together at target block 5459896 (12 confirmations behind head; finality not asserted)."}
- PASS — Finalized funding path returns block hash and basis: {"block":5459906,"blockHash":"0x87a3692f39dc0569cbde482ce495033e44f17fae917b08b136bce7a92041cacf","blockLabel":"finalized block 5459906","finalityBasis":"rpc-finalized-tag","reserve":"0"}
- PASS — Genuine finalized gate permits synthetic delivery-call preparation without wallet: {"signature":"deliver(bytes32,uint32,bytes32)","args":["0x3333333333333333333333333333333333333333333333333333333333333333",0,"0x9c2d40f5d223889a9cfb0d5594f0fa0a6a6c009733a53170501380d03e0928db"],"walletCalls":[]}
- PASS — QA made no signing, account or broadcast request: {"forbidden":[],"walletCalls":[]}
- PASS — No browser runtime or critical request errors: none

## Finalized observation

- Block: 5459906
- Hash: 0x87a3692f39dc0569cbde482ce495033e44f17fae917b08b136bce7a92041cacf
- Basis: rpc-finalized-tag
- Reserve at completed public epoch: 0 base units

The funding observation is unsigned metadata stored only after a quote is signed; it does not change EpochConfig, OrderTerms, termsHash, orderId or the ProofKeyQuoteV1 payload. Existing saved drafts are not re-signed or rewritten. The positive delivery assertion means only that a genuine finalized target gate allowed local calldata preparation for the injected UI fixture; it is not evidence of a currently deliverable public order.

## Screenshots

- quote-finality-required.png
- delivery-finality-required.png

No real wallet was present. The harness made no account request, signature request or transaction broadcast.
