# Operator UI headless QA

Run: 2026-09-09T18:40:37.633Z

Chrome ran headlessly with an isolated temporary profile. No existing browser profile, injected wallet, or live RPC transaction was used.

## Checks

- PASS — Overview opens: Budget view is active
- PASS — No fake live state: Not read yet
- PASS — Funding action stays hidden before preparation: Fund exact source configuration is not disclosed before an exact epoch exists
- PASS — Missing wallet is explained: No browser wallet was found. Read-only RPC access remains available.
- PASS — Exact epoch builder: Exact epoch ID 0xc53f453688f58bd1be9d830c476cb5bbd5c2bd375ed4ff276ec9d09d918e446a
Cap 120.0 CTC · canonical 120000000000000000000 base units
No source initialization or target funding has occurred.
- PASS — Epoch ID is bytes32: 0xc53f453688f58bd1be9d830c476cb5bbd5c2bd375ed4ff276ec9d09d918e446a
- PASS — Epoch CTC becomes canonical base units: 120 CTC stored as 120000000000000000000 base units
- PASS — CTC precision over 18 decimals is rejected: Worker maximum must be a nonnegative CTC amount with up to 18 decimal places
- PASS — CTC uint256 overflow is rejected: Worker maximum exceeds the uint256 CTC limit
- PASS — Draft remains nonbinding: Nonbinding draft saved on this device.
Order 0x8ccb3f2b235ba380373ee39f1add2d28cf5fa784c2d15ded6ddb65ec2d99792a
Terms 0x5c3f25835621103671a624f7dd291a5fc217c626a9a1c1f6b0143e52107067df
Worker maximum 30.5 CTC · fee 0.0 CTC · timeout 0.0 CTC
Canonical signed values remain 30500000000000000000, 0, 0 base units.
No money or admission slot is reserved.
- PASS — Decimal CTC becomes canonical quote value: 30.5 CTC stored as 30500000000000000000 base units
- PASS — Funding check is the signing action: The enabled action is labelled Check funding & sign quote
- PASS — Safe acceptance stays hidden before worker consent: Prepare Safe acceptance remains hidden before a worker signature
- PASS — Malformed package rejected: Unsupported or malformed claim package
- PASS — Recognition remains disabled: Recognition is disabled after rejection
- PASS — Mobile overview fits the viewport: No horizontal page overflow
- PASS — Mobile overview keeps wallet control visible: Connect wallet is visible
- PASS — Mobile orders fits the viewport: No horizontal page overflow
- PASS — Mobile orders keeps wallet control visible: Connect wallet is visible
- PASS — Mobile settings fits the viewport: No horizontal page overflow
- PASS — Mobile settings keeps wallet control visible: Connect wallet is visible
- PASS — Mobile payments fits the viewport: No horizontal page overflow
- PASS — Mobile payments keeps wallet control visible: Connect wallet is visible
- PASS — No browser runtime errors: none

## Visual review

- Desktop (1440 × 1100): all five navigation destinations, page headers, form hierarchy, disabled controls and environment labels render without clipping.
- Mobile (390 × 844 at 2× density): Budget, Work orders, Networks and Payments use a readable single-column layout with no horizontal page overflow.
- The sticky mobile header keeps both Menu and Connect wallet legible. Mobile backdrop blur is disabled to avoid intermittent Chromium compositor text loss.

## Screenshots

- desktop-overview.png
- desktop-networks-epoch.png
- desktop-orders-draft.png
- desktop-payments.png
- mobile-overview.png
- mobile-orders.png
- mobile-settings.png
- mobile-payments.png

The QA workspace uses unreachable loopback RPC placeholders solely to exercise local form state. No verification, wallet signature, deployment, claim, or payment transaction was attempted.
