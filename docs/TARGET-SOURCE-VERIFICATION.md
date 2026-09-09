# Creditcoin Testnet source verification

The target contracts use the official Creditcoin Testnet Blockscout explorer:

- [WorkTypes](https://creditcoin-testnet.blockscout.com/address/0xCA704A845F34348363abEca935c80fe2f366Cde0)
- [AllocationTree](https://creditcoin-testnet.blockscout.com/address/0xfcD2F8240F9a727D532BEcc45c7f2d920843958f)
- [WorkTreasury](https://creditcoin-testnet.blockscout.com/address/0x06c76dFF132e64453cc0eD04a4464648db4322DA)

All three addresses report full verification with Solidity `v0.8.28+commit.7893614a`, Cancun EVM and 200 optimizer runs. WorkTreasury also reports the two exact target library links. The bounded API readback is saved in [`evidence/target-source-verification.json`](../evidence/target-source-verification.json).

[`scripts/verify-target-blockscout.ts`](../scripts/verify-target-blockscout.ts) reconstructs each Solidity standard JSON input from the existing artifact metadata. Before any network request it checks every source hash, compiler setting, compilation target, creation bytecode, constructor argument, linked target library address and the deployment manifest's runtime-correspondence result. It invokes the pinned local `solc` directly and does not rebuild or modify `out/` or `cache/`.

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

The submission uses Blockscout's Etherscan-compatible standard-JSON endpoint because it returns a receipt that can be checked. It requires no API key and sends only public source, compiler settings, public deployment addresses and public constructor arguments. It does not use an RPC, wallet, signing key or chain transaction. Already verified contracts are skipped.

The authoritative deployment addresses, transaction hashes, linked libraries, constructor values and code-correspondence checks remain in [`deployments/testnet.json`](../deployments/testnet.json). Explorer verification improves discoverability; it does not replace those bytecode checks, the public evidence ledger or an audit.
