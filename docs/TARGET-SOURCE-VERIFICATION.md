# Public testnet explorer source-code verification

This page covers reproducible Solidity compilation and explorer publication. It does not describe the runtime verification of source-chain events. For the exact `0x0FD2` call path, cached-proof safeguards and mined native receipts, see [Attestcoin payment verification](ATTESTCOIN-INTEGRATION.md). [Program closeout](REPLACEMENT-SETTLEMENT-AND-CLOSEOUT.md) is a separate read-only audit and cannot authorize payment.

The target contracts use the official Creditcoin Testnet Blockscout explorer:

- [WorkTypes](https://creditcoin-testnet.blockscout.com/address/0xCA704A845F34348363abEca935c80fe2f366Cde0)
- [AllocationTree](https://creditcoin-testnet.blockscout.com/address/0xfcD2F8240F9a727D532BEcc45c7f2d920843958f)
- [WorkTreasury](https://creditcoin-testnet.blockscout.com/address/0x06c76dFF132e64453cc0eD04a4464648db4322DA)

All three addresses report full verification with Solidity `v0.8.28+commit.7893614a`, Cancun EVM and 200 optimizer runs. WorkTreasury also reports the two exact target library links. The bounded API readback is saved in [`evidence/target-source-verification.json`](../evidence/target-source-verification.json).

[`scripts/verify-target-blockscout.ts`](../scripts/verify-target-blockscout.ts) reconstructs the original source and target contracts from the hash-pinned deployment compiler input. Before any network request it checks every dependency source hash, compiler setting, compilation target, constructor argument, linked library address and the deployment manifest's runtime-correspondence result. The public read then checks exact creation and runtime bytes. It invokes the pinned local `solc` directly and does not rebuild or modify `out/` or `cache/`.

The expected compiler settings are Solidity `v0.8.28+commit.7893614a`, optimizer enabled with 200 runs, via IR, Cancun EVM and IPFS metadata. The WorkTreasury constructor arguments are source chain ID `11155111`, source chain key `1` and SourceCoordinator `0xcF50a18ff9021f328Cc89fb37b9a2C872BB70138`. Its target links are WorkTypes `0xCA704A845F34348363abEca935c80fe2f366Cde0` and AllocationTree `0xfcD2F8240F9a727D532BEcc45c7f2d920843958f`.

Prepare and validate locally without contacting Blockscout:

```sh
node scripts/verify-target-blockscout.ts
```

Write the exact inputs for manual review or upload:

```sh
node scripts/verify-target-blockscout.ts \
  --write-dir /tmp/proofkey-work-treasury-blockscout
```

Read the current public verification state without publishing:

```sh
node scripts/verify-target-blockscout.ts --check
```

Submit any unverified target and wait for a bounded result:

```sh
node scripts/verify-target-blockscout.ts --submit
```

The submission uses Blockscout's Etherscan-compatible standard-JSON endpoint because it returns a receipt that can be checked. This per-instance route accepts submissions without a configured API key where the explorer permits them; public quotas can still reject requests. It sends only public source, compiler settings, public deployment addresses and public constructor arguments. It does not use a wallet, signing key or chain transaction. Fully verified contracts are skipped. [Blockscout documents the standard-JSON verification action](https://docs.blockscout.com/devs/verification/blockscout-smart-contract-verification-api).

## Ethereum Sepolia source contracts

The same tool now supports `--chain source`. The readback in [`evidence/source-explorer-verification.json`](../evidence/source-explorer-verification.json) checks every source address's creation bytecode against the reproduced, linked artifact plus constructor arguments, and its deployed runtime against the pinned deployment hash.

At the recorded 10 September 2026 readback, WorkTypes, AllocationTree, SourceSignatureLib and SourcePolicyV1Lib are fully verified. SourceAccountingLib and SourceCoordinator still await publication: the explorer returned HTTP 429 during submission. Their creation and runtime bytecode checks both pass. A local reproduction is not described as public source verification.

SourceCoordinator needs the original full compilation unit to reproduce its exact via-IR creation bytecode. [`verification/source-compiler-input.json`](../verification/source-compiler-input.json) preserves that Solidity standard JSON input, including public test and vendor sources from the original compilation. Its SHA-256 is `f3c1ae9167254dc88f0266bbe989bfc80e5a97d15344bac37c46bb2ad830dc11`, enforced by the tool. A dependency-only reconstruction can have identical metadata but different generated code. With the pinned full input supplied, the tool reconstructs the frozen deployment independently of mutable `out/` artifacts, still checks current dependency source hashes and compiler settings, then compares the resulting linked creation bytes directly with the explorer. The source runtime must also match the recorded deployment hash. No live correspondence check is bypassed.

Prepare the six source inputs for inspection or manual upload:

```sh
node scripts/verify-target-blockscout.ts --chain source \
  --compiler-input verification/source-compiler-input.json \
  --write-dir /tmp/proofkey-source-verification
```

Add `--check` for a fresh public readback or `--submit` to publish the still-unverified contracts. The tool defaults to this frozen compiler input for both source and target verification; the explicit input flag can identify a relocated copy with the same hash. Submission is resumable: each run checks full verification first. HTTP 429 retries are bounded; a quota failure remains pending and never becomes a passing result.

The authoritative deployment addresses, transaction hashes, linked libraries, constructor values and code-correspondence checks remain in [`deployments/testnet.json`](../deployments/testnet.json). Explorer verification improves discoverability; it does not replace those bytecode checks, the public evidence ledger or an audit.
