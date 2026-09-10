# Public testnet UI live-readback QA

Run: 2026-09-10T13:04:47.066Z

Chrome used a fresh isolated profile. The run loaded the public deployment configuration and performed read-only RPC calls only.

## Result

- PASS — GitHub Pages asset paths are relative: All five built assets use ./ paths
- PASS — Public configuration loaded: Ethereum Sepolia ↔ Creditcoin Testnet
- PASS — Funded demo epoch loaded: 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7
- PASS — No injected wallet or profile: window.ethereum is absent in the isolated profile
- PASS — Safe export is the documented default: Transaction Builder JSON is offered without claiming bundled Safe Apps integration
- PASS — Setup verification checks pinned domain: Fresh browser: checking the built-in public demo.
Verified source chain 11155111 and target chain 102031. WorkTreasury's immutable source domain matches at target finalized block 5463644; source code was present at finalized block 11675043. Runtime hashes match Published ProofKey public testnet V1; write preparation is unlocked for this session.
No wallet account, signature or transaction was requested.
- PASS — Finalized target funding displayed: Exact epoch funded; Epoch account, configuration and source-domain immutables read together at target finalized block 5463645.; Reserve0.0 CTCRecognized120.0 CTCFundedYes
- PASS — Incomplete readback does not authorize an action: Collect remaining claims; The source is closed. Old earned allocations remain collectible on Creditcoin.
- PASS — Target account, config and immutables use one block: All five reads used 0x535e5d
- PASS — QA remained read-only: No signing, account request, or transaction broadcast RPC method was observed
- PASS — No browser runtime errors: none

## Observed readback

- Epoch: 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7
- Source: Closed — Read at source finalized block 11675043. Root 0x3281216…ae713d4. — Available0.0 CTCUnresolved0.0 CTCLeaves4
- Target: Exact epoch funded — Epoch account, configuration and source-domain immutables read together at target finalized block 5463645. — Reserve0.0 CTCRecognized120.0 CTCFundedYes
- Next action: Collect remaining claims — The source is closed. Old earned allocations remain collectible on Creditcoin.
- Same target block tag: 0x535e5d

## Evidence

- live-settings-verified.png
- live-funded-readback.png

No wallet provider was injected. The harness did not request accounts, sign data, prepare a broadcast through a wallet, or send a transaction.
