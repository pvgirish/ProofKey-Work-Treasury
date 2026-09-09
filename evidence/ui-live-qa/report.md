# Public testnet UI live-readback QA

Run: 2026-09-09T18:42:10.267Z

Chrome used a fresh isolated profile. The run loaded the public deployment configuration and performed read-only RPC calls only.

## Result

- PASS — GitHub Pages asset paths are relative: All five built assets use ./ paths
- PASS — Public configuration loaded: Ethereum Sepolia ↔ Creditcoin Testnet
- PASS — Funded demo epoch loaded: 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7
- PASS — No injected wallet or profile: window.ethereum is absent in the isolated profile
- PASS — Safe export is the documented default: Transaction Builder JSON is offered without claiming bundled Safe Apps integration
- PASS — Setup verification checks pinned domain: Verified chain 11155111 and chain 102031; target immutables match at finalized block 5459240.
- PASS — Finalized target funding displayed: Exact epoch funded; Epoch account, configuration and source-domain immutables read together at target finalized block 5459240.; Reserve120.0 CTCRecognized0.0 CTCFundedYes
- PASS — Incomplete readback does not authorize an action: Wait for complete readback; Target funding is finalized, but the stable source state is unavailable or still lagging. Refresh before treating any source action as authorized.
- PASS — Target account, config and immutables use one block: All five reads used 0x534d28
- PASS — QA remained read-only: No signing, account request, or transaction broadcast RPC method was observed
- PASS — No browser runtime errors: none

## Observed readback

- Epoch: 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7
- Source: Source unavailable — execution reverted: UnknownEpoch() —
- Target: Exact epoch funded — Epoch account, configuration and source-domain immutables read together at target finalized block 5459240. — Reserve120.0 CTCRecognized0.0 CTCFundedYes
- Next action: Wait for complete readback — Target funding is finalized, but the stable source state is unavailable or still lagging. Refresh before treating any source action as authorized.
- Same target block tag: 0x534d28

## Evidence

- live-settings-verified.png
- live-funded-readback.png

No wallet provider was injected. The harness did not request accounts, sign data, prepare a broadcast through a wallet, or send a transaction.
