# Browser proof-service integration QA

Run: 2026-09-09T18:44:53.997Z

Source operation: approve-A
Transaction: 0x33642ef4a994dd63b5426a3835051f314cf422761d48000fcb1bcc4b4538efc5
Source block: 11669711

## Result

- PASS — Public proof service is configured: https://prover.cc3-testnet.creditcoin.network
- PASS — Native source chain key is configured: 1
- PASS — Browser fetched and validated proof: Response matches the request.
Block 11669711
Encoded transaction 3776 bytes
7 transaction siblings · 10 continuity roots

The prover's transaction index is metadata. The Creditcoin verifier derives the authoritative position.
- PASS — Export control is enabled: Export proof material is enabled after validation
- PASS — Proof response matches completed source transaction: Response matches the request.
Block 11669711
Encoded transaction 3776 bytes
7 transaction siblings · 10 continuity roots

The prover's transaction index is metadata. The Creditcoin verifier derives the authoritative position.
- PASS — Validated proof material downloaded: proofkey-native-proof-33642ef4.json
- PASS — Export has directly usable SingleProof fields: block 11669711; 7 siblings; 10 roots
- PASS — Proof service permits browser CORS: HTTP 200; Access-Control-Allow-Origin *
- PASS — No target transaction was submitted: No account, signing, or broadcast RPC method was observed
- PASS — No browser runtime errors: none

## Browser evidence

- Service response: HTTP 200; Access-Control-Allow-Origin *
- UI result: Response matches the request. · Block 11669711 · Encoded transaction 3776 bytes · 7 transaction siblings · 10 continuity roots ·  · The prover's transaction index is metadata. The Creditcoin verifier derives the authoritative position.
- Export: proofkey-native-proof-33642ef4.json
- Screenshot: browser-proof-response.png

The browser used a fresh isolated profile. It did not inject a wallet, request accounts, sign, or submit a target transaction.
