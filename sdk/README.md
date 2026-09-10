# Work Treasury SDK and operator UI

The TypeScript SDK mirrors the frozen Work Treasury V1 application codecs. It does not replace native Creditcoin authentication.

- `identity.ts` derives the exact `EpochConfig`, milestone and order commitments from `WorkTypes.sol`, and builds the source quote EIP-712 digest.
- `allocation.ts` enforces the frozen allocation shape, decodes the full canonical events, hashes leaves and reconstructs the ordered depth-7 tree independently.
- `inspector.ts` reads every full allocation at one RPC-finalized source block. Confirmation-depth fallback is opt-in and is reported as such.
- `claim-package.ts` validates and serializes portable checkpoint and canonical-receipt packages. Fresh proof material uses the exact `SingleProof` tuple accepted by `WorkTreasury`; cached routes retain the exact target reference and transaction bytes needed by the contract.
- `prover-client.ts` bounds and validates proof-service responses, then converts them to a directly usable `SingleProof`.
- `wallet.ts` verifies RPC networks, loads compiled artifacts and prepares ordinary wallet or Safe transaction data.
- `work-authorization.ts` canonically binds commercial terms, finalized funding/capacity observations and the existing worker quote. Parsing, historical checks and current eligibility are separate operations; see [portable consent](../docs/WORK-AUTHORIZATION.md).
- `receipt-evidence.ts` selects the exact successful receipt-local source event from the pinned native ABI-v1 format. Structural decoding does not establish native authenticity.
- `settlement-runner.ts` prepares bounded, permissionless recognition and fixed-destination withdrawal actions using a separately trusted deployment. Execution validates calls and persists resumable transaction evidence.
- `program-closeout.ts` checks financial and payment consistency across jobs and labels missing commercial consent on legacy orders. The CLI reconstructs observations from public RPCs; the pure checker alone cannot authenticate caller-supplied chain observations.

Run `npm run test:sdk` for the schema, event, proof-package, identity, authorization, settlement and closeout checks. Run `npm run ui:build` after compiling contracts; the build copies compiled ABIs plus the shared consent SDK and the published runtime registry into the browser bundle. Any compiler-output hash is labeled `compiledTemplateCodeHash` and is not a deployed-code claim. Deployment manifests remain the authority for deployed addresses and bytecode correspondence.

The operator UI stores public network configuration, the last epoch and local drafts in browser storage. It never stores wallet keys. It labels the 120-unit journey as an illustration unless a real local or testnet deployment manifest supplies live configuration. Start the local server with `npm run ui:serve` after building.
