# Public-demo first-load and stale-settings UI QA

Run: 2026-09-09T20:54:37.349Z
URL: https://pvgirish.github.io/ProofKey-Work-Treasury/

Chrome used a new isolated profile. The run exercised the normal app UI with public read-only RPCs and no injected wallet. For the negative fresh-boot case, a CDP document-start setter changed the built-in source chain ID from 11155111 to 1 and added a test-only source label before demo-config.js completed; contract addresses, RPC URLs, target configuration and published files were not changed.

## Result

- PASS — Fresh browser verifies the public demo automatically: Fresh browser: built-in public demo loaded automatically. · Verified source chain 11155111 and target chain 102031. WorkTreasury's immutable source domain matches at target finalized block 5459769; source code was present at finalized block 11670323. · The Budget page now shows read-only state from both chains. · No wallet account, signature or transaction was requested.
- PASS — Fresh browser performs both read-only chain reads: Closed · Read at source finalized block 11670323. Root 0x3281216…ae713d4. · Available0.0 CTCUnresolved0.0 CTCLeaves4 / Exact epoch funded · Epoch account, configuration and source-domain immutables read together at target finalized block 5459769. · Reserve0.0 CTCRecognized120.0 CTCFundedYes
- PASS — Automatic fresh load does not persist settings: workspace localStorage remains absent
- PASS — Fresh storage label is truthful: Temporary public demo
- PASS — No injected wallet is needed: window.ethereum is absent
- PASS — Independent tree action rebuilds all public leaves: finalized block 11670323 · Leaves 4 / 128 · Rebuilt root 0x32812168c04e9a025daa3d66d4569aa81999031239719330074e7d651ae713d4 · Stored root  0x32812168c04e9a025daa3d66d4569aa81999031239719330074e7d651ae713d4 · ✓ Roots match · ✓ Every public allocation hashes to its stored leaf
- PASS — Saved setup is restored without automatic verification: Saved setup restored without making a network request. Verify it, or choose Use public demo defaults to replace it explicitly.
- PASS — Restored storage label is truthful: Saved on this device
- PASS — Saved setup is not silently replaced: {"source":{"chainId":"1","chainKey":"1","rpcUrl":"https://ethereum-sepolia-rpc.publicnode.com","safe":"0x6Ed0f13C6f502F2a0790D2653B67791F3B5dBDE0","libraries":{"WorkTypes":"0xeA13543Ca73703cd65C6CFb98AE0b6d429BE85F8","AllocationTree":"0xF56c7e00daB6f3FAd65E3A85Aa6c8FDE34e48f43","SourceSignatureLib":"0x481935Eb6D4e55B8664cd3B88CD1233D5BdCa1a1","SourcePolicyV1Lib":"0xc9b230f18bD16955D302f9Bf3BDB522186Be46B3","SourceAccountingLib":"0x3AC9B3eb94DBA253bCC4284a981fB45d35386612"},"coordinator":"0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138","label":"Stale reviewer setup","confirmations":12},"target":{"chainId":"102031","rpcUrl":"https://rpc.cc3-testnet.creditcoin.network","libraries":{"WorkTypes":"0xCA704A845F34348363abEca935c80fe2f366Cde0","AllocationTree":"0xfcD2F8240F9a727D532BEcc45c7f2d920843958f"},"treasury":"0x06c76dFF132e64453cc0eD04a4464648db4322DA","invoiceBook":"0xb93d065d7995884ceb8dad26d09B3a1efD9787cf","label":"Saved Creditcoin","confirmations":12},"lastEpochId":"0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7","proofServiceUrl":"https://prover.cc3-testnet.creditcoin.network","scope":"Public testnet; Safe, worker, sponsor and relayers are team controlled. No independent settlement is claimed."}
- PASS — Saved setup triggered no RPC calls on load: 0 calls
- PASS — Stale setup error remains visible: Checking without changing saved settings. · Verification failed: Stale reviewer setup RPC reports chain 11155111, not 1 · These settings were not treated as verified. Choose Use public demo defaults to recover without connecting a wallet.
- PASS — Failed verification does not change saved setup: stale value still present
- PASS — Explicit public-demo action recovers stale setup: Public demo defaults selected. · Verified source chain 11155111 and target chain 102031. WorkTreasury's immutable source domain matches at target finalized block 5459770; source code was present at finalized block 11670323. · The Budget page now shows read-only state from both chains. · No wallet account, signature or transaction was requested.
- PASS — Explicit public demo is labeled saved: Saved on this device
- PASS — Public defaults replace settings only after the click: {"source":{"label":"Ethereum Sepolia","confirmations":12,"chainId":"11155111","chainKey":"1","rpcUrl":"https://ethereum-sepolia-rpc.publicnode.com","safe":"0x6Ed0f13C6f502F2a0790D2653B67791F3B5dBDE0","libraries":{"WorkTypes":"0xeA13543Ca73703cd65C6CFb98AE0b6d429BE85F8","AllocationTree":"0xF56c7e00daB6f3FAd65E3A85Aa6c8FDE34e48f43","SourceSignatureLib":"0x481935Eb6D4e55B8664cd3B88CD1233D5BdCa1a1","SourcePolicyV1Lib":"0xc9b230f18bD16955D302f9Bf3BDB522186Be46B3","SourceAccountingLib":"0x3AC9B3eb94DBA253bCC4284a981fB45d35386612"},"coordinator":"0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138"},"target":{"label":"Creditcoin Testnet","confirmations":12,"chainId":"102031","rpcUrl":"https://rpc.cc3-testnet.creditcoin.network","libraries":{"WorkTypes":"0xCA704A845F34348363abEca935c80fe2f366Cde0","AllocationTree":"0xfcD2F8240F9a727D532BEcc45c7f2d920843958f"},"treasury":"0x06c76dFF132e64453cc0eD04a4464648db4322DA","invoiceBook":"0xb93d065d7995884ceb8dad26d09B3a1efD9787cf"},"lastEpochId":"0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7","proofServiceUrl":"https://prover.cc3-testnet.creditcoin.network","scope":"Public testnet; Safe, worker, sponsor and relayers are team controlled. No independent settlement is claimed."}
- PASS — Injected configuration changed only the fresh-boot source domain: {"label":"Injected fresh-boot test","confirmations":12,"chainId":"1","chainKey":"1","rpcUrl":"https://ethereum-sepolia-rpc.publicnode.com","safe":"0x6Ed0f13C6f502F2a0790D2653B67791F3B5dBDE0","libraries":{"WorkTypes":"0xeA13543Ca73703cd65C6CFb98AE0b6d429BE85F8","AllocationTree":"0xF56c7e00daB6f3FAd65E3A85Aa6c8FDE34e48f43","SourceSignatureLib":"0x481935Eb6D4e55B8664cd3B88CD1233D5BdCa1a1","SourcePolicyV1Lib":"0xc9b230f18bD16955D302f9Bf3BDB522186Be46B3","SourceAccountingLib":"0x3AC9B3eb94DBA253bCC4284a981fB45d35386612"},"coordinator":"0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138"}
- PASS — Actual fresh-boot failure stays visible on Budget: Public demo could not be verified. Injected fresh-boot test RPC reports chain 11155111, not 1 The app did not request a wallet or infer live state. Review network setup →
- PASS — Failed fresh boot shows no stale chain state: Not read yet / Not read yet / Connect the workspace
- PASS — Failed fresh boot does not save the injected default: workspace localStorage remains absent
- PASS — Actual UI retry clears the Budget failure: Public demo defaults selected. · Verified source chain 11155111 and target chain 102031. WorkTreasury's immutable source domain matches at target finalized block 5459770; source code was present at finalized block 11670323. · The Budget page now shows read-only state from both chains. · No wallet account, signature or transaction was requested.
- PASS — All automatic and recovery work remained read only: []
- PASS — No browser runtime or critical request errors: none

## Fresh readback

- Source: Closed · Read at source finalized block 11670323. Root 0x3281216…ae713d4. · Available0.0 CTCUnresolved0.0 CTCLeaves4
- Target: Exact epoch funded · Epoch account, configuration and source-domain immutables read together at target finalized block 5459769. · Reserve0.0 CTCRecognized120.0 CTCFundedYes
- Setup status: Fresh browser: built-in public demo loaded automatically. · Verified source chain 11155111 and target chain 102031. WorkTreasury's immutable source domain matches at target finalized block 5459769; source code was present at finalized block 11670323. · The Budget page now shows read-only state from both chains. · No wallet account, signature or transaction was requested.
- Independent tree: finalized block 11670323 · Leaves 4 / 128 · Rebuilt root 0x32812168c04e9a025daa3d66d4569aa81999031239719330074e7d651ae713d4 · Stored root  0x32812168c04e9a025daa3d66d4569aa81999031239719330074e7d651ae713d4 · ✓ Roots match · ✓ Every public allocation hashes to its stored leaf

## Stale and recovery behavior

- Restored: Saved setup restored without making a network request. Verify it, or choose Use public demo defaults to replace it explicitly.
- Visible error: Checking without changing saved settings. · Verification failed: Stale reviewer setup RPC reports chain 11155111, not 1 · These settings were not treated as verified. Choose Use public demo defaults to recover without connecting a wallet.
- Recovery: Public demo defaults selected. · Verified source chain 11155111 and target chain 102031. WorkTreasury's immutable source domain matches at target finalized block 5459770; source code was present at finalized block 11670323. · The Budget page now shows read-only state from both chains. · No wallet account, signature or transaction was requested.
- Forced fresh-load failure: Public demo could not be verified. Injected fresh-boot test RPC reports chain 11155111, not 1 The app did not request a wallet or infer live state. Review network setup →

## Screenshots

- fresh-public-demo.png
- independent-tree-rebuild.png
- stale-settings-error.png
- public-demo-recovered.png
- fresh-default-failure.png
- fresh-default-retry.png

No account request, signing method or transaction broadcast was observed. The public demo remains team controlled; this QA does not claim independent settlement.
