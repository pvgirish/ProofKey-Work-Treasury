# Replacement settlement and program closeout

These tools extend the existing Work Treasury recognition and claim path. They do not add a payout route, timeout, refund clock, trusted signer, or relayer-selected destination.

The [app workflow guide](APP-WORKFLOWS.md) describes the browser controls for these same SDK paths.

## Replacement settlement

`sdk/settlement-runner.ts` accepts the existing `ClaimPackage` format from `sdk/claim-package.ts`. Planning checks both live chain IDs, exact finalized block hashes, source and target runtime bytecode against a separately trusted deployment manifest, treasury source immutables, the native profile, the funded epoch domain, asset and policy, and the current recognized/completed state.

The planner uses the actual WorkTreasury functions:

- a stored historical checkpoint may recognize a leaf even when it is not the latest checkpoint;
- fresh checkpoint or receipt material uses `authenticateAndRecognizeCheckpoint` or `authenticateAndRecognizeReceipt`;
- cached receipt evidence recomputes and reads the exact authentication before `recognizeFromReceipt`;
- WORK and FEE use permissionless `withdrawFor` to the allocation's fixed destination;
- RETURN stops after recognition because it enters the refund owner's fungible `freeBalance`.

Planning is always separate from execution. The execution path accepts only canonical, zero-value WorkTreasury recognition and fixed-destination withdrawal calls to the independently pinned treasury. The CLI writes the transaction hash to an atomic journal file before waiting for a receipt. SDK callers must provide crash-safe persistence through the required persistence callback. On restart it checks pending or completed receipt hashes and current target state rather than trusting the journal label. The stable journal identity binds the exact claims and deployment domain, so refreshed finalized snapshots do not discard an already submitted hash.

If the exact `withdrawFor` simulation returns WorkTreasury's `TransferFailed()`, the planner reports `needs-owner-redirection`. Only the claim owner can then use `ownerWithdrawTo`; the runner never chooses a replacement address. Other RPC and state errors fail planning instead of being mislabeled as receiver rejection.

Create a keyless plan for an existing package:

```sh
node scripts/settlement-runner.ts \
  --claim evidence/claim-1.json \
  --plan /tmp/proofkey-settlement-plan.json
```

Pass more `--claim` arguments for additional allocations. A packet is bounded to 32 claims and the resulting plan to 32 target actions. No transaction is sent without `--execute`. Execution also requires `CREDITCOIN_WALLET_PRIVATE_KEY`; `--max-actions` bounds submissions in one invocation. The runner rebuilds the plan from the claim files and live finalized reads immediately before sending, so an imported plan JSON is never treated as executable authority.

## Program closeout

`sdk/program-closeout.ts` checks a `ProgramCloseoutV1` observation against an independently trusted deployment pin. Browser and CLI both use `sdk/program-collector.ts` for fresh RPC collection; `scripts/program-closeout.ts` supplies the file and provider adapter. The collector reads every canonical source allocation at one finalized block, rebuilds the exact source root, scans the pinned treasury's recognition and withdrawal events, fetches their receipts and calldata, reads authentication/checkpoint records and `completedClaim`, and then runs the consistency verifier.

For every epoch, the verifier requires:

- the complete canonical source prefix and exact rebuilt root;
- `C = A + U + E + R`; a complete closeout also has CLOSED, `A = U = 0`, and `E + R = C`;
- WORK/FEE allocation sums equal E and RETURN sums equal R;
- one target evidence entry per source leaf with no duplicate or omitted identity;
- target `reserve = C - recognized`, and for a complete closeout `recognized = C` and reserve is zero;
- exact recognized allocation readback, a successful finalized `AllocationRecognized` receipt/event, and the associated native authentication or stored checkpoint identity;
- for WORK/FEE, successful finalized `withdrawFor` or direct-owner `ownerWithdrawTo` calldata, the exact `ClaimWithdrawn` event, and matching `completedClaim` paid destination.

An older stored checkpoint remains valid when its root reconstructs from the corresponding prefix of the append-only source allocations. The verifier does not impose a latest-checkpoint rule. Native frontier coverage is checked against each authentication position, so newer irrelevant finalized source blocks do not make an already settled epoch incomplete.

RETURN recognition is reported as a credit to the refund owner's fungible free balance. A later free-balance withdrawal cannot be attributed to one epoch and the closeout does not claim otherwise.

Optional `WorkAuthorizationPackageV1` evidence binds new orders to the portable commercial terms. It requires the exact historical agreed source order and a successful Safe execution whose inner call is the packet's canonical `acceptQuote` data. Historical ERC-1271 acceptance is anchored to that successful source action and is not re-evaluated against the Safe's current owners. Orders created before this packet format remain inspectable and are listed as `legacyOrders`; this means no portable commercial-consent evidence was supplied.

Run the keyless verifier for the existing public 120 CTC epoch:

```sh
node scripts/program-closeout.ts \
  --epoch 0x6d6a255499b76bd960e9c9bf7d649584d39dbe0192e4e2daa0fe3143c54227c7 \
  --output /tmp/proofkey-program-closeout.json
```

For a new order, repeat `--authorization path/to/signed-work-authorization.json`. The collector locates the finalized `OrderReserved(..., agreed=true)` event itself, fetches the source transaction and receipt, reconstructs the Safe `execTransaction` provenance and nonce, and reads the agreed source order. It does not trust an acceptance receipt or `agreed` boolean from the file.

An exported closeout can be handed to another reviewer as a locator. `--input` reads only its pinned domain, epoch ID, and authorization packets, rejects locator-domain changes, discards the exported observations and verdict, and reconstructs the full closeout from current public RPC reads:

```sh
node scripts/program-closeout.ts \
  --input /tmp/proofkey-program-closeout.json \
  --output /tmp/proofkey-program-closeout-readback.json
```

When collection succeeds, the consistency checker distinguishes `complete`, `incomplete`, and `invalid`; unpaid claims and structural contradictions remain explicit. Missing finalized tags or required RPC history, imported locator-domain changes, and live runtime mismatches stop the collector with an explicit error before it emits a verdict. Failed receipts, missing exact events, conservation failures and altered or duplicate leaves in collected observations cannot establish a complete closeout.

`verifyProgramCloseout` is a local consistency checker over supplied observations. A trusted verdict requires the RPC collector or another independent reader to reconstruct those observations and compare live bytecode with the trusted deployment manifest. The closeout proves treasury transfer to the recorded destination; it does not prove work quality, recipient independence, or what an accepting recipient contract does with funds afterward.
