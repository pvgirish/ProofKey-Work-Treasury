# Public evidence

Generated 2026-09-09T19:21:02.621Z from the checked-in public journals. This page reports the evidence currently present; missing or partial evidence remains pending.

## Control and release scope

All actors in the built-in public journeys are team controlled, including the Safe owners, workers, sponsor, relayers, committee members, and disposable rotation Safe. These runs demonstrate protocol behavior and public-chain execution. They do not count as independent-user adoption, two consenting independent settlements, or an independent buyer reference. Those release gates remain pending real participants.

## Networks

| Role | Network | Chain ID | Transaction explorer |
|---|---|---:|---|
| Source | Ethereum Sepolia | 11155111 | [Sepolia Etherscan](https://sepolia.etherscan.io/) |
| Target | Creditcoin testnet | 102031 | [Creditcoin testnet Blockscout](https://creditcoin-testnet.blockscout.com/) |

The Creditcoin testnet chain and explorer mapping is documented in the official [testnet environment](https://docs.creditcoin.org/environments/testnet) and [endpoint reference](https://docs.creditcoin.org/smart-contract-guides/creditcoin-endpoints). Transaction links below use these explorer bases. If an operation has no recorded chain, its hash links to the raw GitHub evidence instead.

## Journey status

| Journey | Current evidence status | Evidence |
|---|---|---|
| Main journey — source | Source complete — target status is reported separately | [repository file](../evidence/source-demo.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/source-demo.json) |
| Main journey — target | Complete — the built-in main journey reports its final target state | [repository file](../evidence/public-demo.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/public-demo.json) |
| Policy branches — source | Source complete — target status is reported separately | [repository file](../evidence/source-branches.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/source-branches.json) |
| Policy branches and successor — target | Complete — branch recognition, successor expiry, and recorded withdrawals report completion | [repository file](../evidence/public-branches.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/public-branches.json) |
| Disposable Safe owner rotation | Complete — the disposable Safe rotation journey reports completion | [repository file](../evidence/public-safe-rotation.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/public-safe-rotation.json) |
| Finalized release readback | Automated journeys report complete at finalized blocks | [repository file](../evidence/release-readback.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/release-readback.json) |

## Returned funds: recognition and withdrawal

A recognized RETURN moves value from an epoch reserve into the refund beneficiary’s target free balance. It is not an external payment until a separate free-balance withdrawal succeeds.

| Journey | Source RETURN evidence | Recognized target free-balance credit | Actually withdrawn |
|---|---|---|---|
| Main | 65.0 CTC in the latest source readback | 65.0 CTC confirmed as target free-balance credit | 65.0 CTC withdrawal recorded |
| Policy branches / successor | 11.0 CTC in the primary source epoch | 12.0 CTC confirmed as target free-balance credit; some may have funded the successor epoch | 11.0 CTC withdrawal recorded |
| Disposable Safe rotation | 1.0 CTC in the source readback | 1.0 CTC confirmed as target free-balance credit | Withdrawal recorded by withdraw-disposable-safe-return-1 |

## Chain transaction journal

### Main source journal

[repository file](../evidence/source-demo.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/source-demo.json)

| Chain | Operation | Transaction | Block | Gas used | Receipt |
|---|---|---|---:|---:|---|
| Ethereum Sepolia | initialize-epoch | [0x79edfd6ba13c07035e22b26b079f3f14c5b55b51b8c4c6c37b8ec4bd9343336f](https://sepolia.etherscan.io/tx/0x79edfd6ba13c07035e22b26b079f3f14c5b55b51b8c4c6c37b8ec4bd9343336f) | 11669702 | 466,803 | Mined |
| Ethereum Sepolia | create-offer-A | [0xbd7f7b78468d12e9660a821e295e7e76d33f4d8587561529ebf1520b5deced6c](https://sepolia.etherscan.io/tx/0xbd7f7b78468d12e9660a821e295e7e76d33f4d8587561529ebf1520b5deced6c) | 11669704 | 549,264 | Mined |
| Ethereum Sepolia | create-offer-B | [0xa08ae5616842b4c698fc014b766535f0621ed1f12106e9cb3008078b29183105](https://sepolia.etherscan.io/tx/0xa08ae5616842b4c698fc014b766535f0621ed1f12106e9cb3008078b29183105) | 11669705 | 532,176 | Mined |
| Ethereum Sepolia | accept-offer-A | [0x16a8fccd6c2a970b241af3c137fa1eb08959b26914f8baed02d2a327a86f59f3](https://sepolia.etherscan.io/tx/0x16a8fccd6c2a970b241af3c137fa1eb08959b26914f8baed02d2a327a86f59f3) | 11669707 | 60,152 | Mined |
| Ethereum Sepolia | accept-offer-B | [0x1444b0ff0188a2496c985d718532bf10fe7f07d6ef8330f3f6e63b3904996e62](https://sepolia.etherscan.io/tx/0x1444b0ff0188a2496c985d718532bf10fe7f07d6ef8330f3f6e63b3904996e62) | 11669708 | 60,178 | Mined |
| Ethereum Sepolia | deliver-A | [0x5ff2e3bd36c72872c9c263bbd2a9b816c272a2c5a3737f8374769682e51ffbe5](https://sepolia.etherscan.io/tx/0x5ff2e3bd36c72872c9c263bbd2a9b816c272a2c5a3737f8374769682e51ffbe5) | 11669710 | 62,000 | Mined |
| Ethereum Sepolia | approve-A | [0x33642ef4a994dd63b5426a3835051f314cf422761d48000fcb1bcc4b4538efc5](https://sepolia.etherscan.io/tx/0x33642ef4a994dd63b5426a3835051f314cf422761d48000fcb1bcc4b4538efc5) | 11669711 | 625,465 | Mined |
| Ethereum Sepolia | release-free-50 | [0xab9be5910aeba1e2cecab1613b35c6709a467cea51f0e1dd2172af0be942c1e3](https://sepolia.etherscan.io/tx/0xab9be5910aeba1e2cecab1613b35c6709a467cea51f0e1dd2172af0be942c1e3) | 11669713 | 333,624 | Mined |
| Ethereum Sepolia | deliver-B | [0x3fcde4661c5787dc88496a80e9f1c8559e11f9452090dab78a32e4eba7a8d444](https://sepolia.etherscan.io/tx/0x3fcde4661c5787dc88496a80e9f1c8559e11f9452090dab78a32e4eba7a8d444) | 11669803 | 61,988 | Mined |
| Ethereum Sepolia | mutually-settle-B-25 | [0x046b2a05edea39722100178c255c4a9356aa439f0744d118ff321b05075dede9](https://sepolia.etherscan.io/tx/0x046b2a05edea39722100178c255c4a9356aa439f0744d118ff321b05075dede9) | 11669804 | 501,690 | Mined |
| Ethereum Sepolia | create-offer-C | [0x5638f8dc17ef1fee5edd61b673f2b85902cf5b288ad33ca0a03fc4db1f1a6e95](https://sepolia.etherscan.io/tx/0x5638f8dc17ef1fee5edd61b673f2b85902cf5b288ad33ca0a03fc4db1f1a6e95) | 11669805 | 544,464 | Mined |
| Ethereum Sepolia | accept-offer-C | [0x9877d459c22a88f693123a7b8b946b4981adb746d5441ac8568aad698e984aec](https://sepolia.etherscan.io/tx/0x9877d459c22a88f693123a7b8b946b4981adb746d5441ac8568aad698e984aec) | 11669806 | 60,152 | Mined |
| Ethereum Sepolia | finalize-C-no-delivery | [0x49aa4996633ff6e59c6be9488dfeeafc28fcd35dd667d2d37f81a78514a84b93](https://sepolia.etherscan.io/tx/0x49aa4996633ff6e59c6be9488dfeeafc28fcd35dd667d2d37f81a78514a84b93) | 11669823 | 145,835 | Mined |
| Ethereum Sepolia | start-draining | [0x24dd3e723e6aef09d046a2c53916866109d38f57ab7ed8fb53ef4767a94ef661](https://sepolia.etherscan.io/tx/0x24dd3e723e6aef09d046a2c53916866109d38f57ab7ed8fb53ef4767a94ef661) | 11669824 | 82,770 | Mined |
| Ethereum Sepolia | sweep-final-15 | [0xdabbf0d3a81dda2f21956222fac3071520fa33999c146c93c6b1cf1e69dc6077](https://sepolia.etherscan.io/tx/0xdabbf0d3a81dda2f21956222fac3071520fa33999c146c93c6b1cf1e69dc6077) | 11669825 | 269,613 | Mined |
| Ethereum Sepolia | republish-checkpoint-1 | [0xa1308da7f1d7b362bdb08b51c7e547084bc518d24f4db9122ccb34a1cda029c8](https://sepolia.etherscan.io/tx/0xa1308da7f1d7b362bdb08b51c7e547084bc518d24f4db9122ccb34a1cda029c8) | 11669826 | 35,304 | Mined |
| Ethereum Sepolia | republish-checkpoint-2 | [0x0bc3d8a24eafd978946213f107c1ce78961da2f24cd24dcd85b05fe5b12249a2](https://sepolia.etherscan.io/tx/0x0bc3d8a24eafd978946213f107c1ce78961da2f24cd24dcd85b05fe5b12249a2) | 11669827 | 35,304 | Mined |

### Main target journal

[repository file](../evidence/public-demo.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/public-demo.json)

| Chain | Operation | Transaction | Block | Gas used | Receipt |
|---|---|---|---:|---:|---|
| Creditcoin testnet | fund-exact-120-epoch | [0x2d473ee9b60fbce59ccb95213bf2e135601e68ff74cdd322d0c44823b74bedc8](https://creditcoin-testnet.blockscout.com/tx/0x2d473ee9b60fbce59ccb95213bf2e135601e68ff74cdd322d0c44823b74bedc8) | 5459166 | 435,727 | Success |
| Creditcoin testnet | native-batch-authenticate-A-and-return50 | [0x803637ce8d1e691d826e64292366fa7e7de6f1d9f0676c82833c8d5a31562542](https://creditcoin-testnet.blockscout.com/tx/0x803637ce8d1e691d826e64292366fa7e7de6f1d9f0676c82833c8d5a31562542) | 5459242 | 435,498 | Success |
| Creditcoin testnet | receipt-recognize-return50-with-B-unresolved | [0x10a7d1c89661234ccd6f9291b21b0cff99abd359cc1d1a0b80a2c9dd53a36d03](https://creditcoin-testnet.blockscout.com/tx/0x10a7d1c89661234ccd6f9291b21b0cff99abd359cc1d1a0b80a2c9dd53a36d03) | 5459243 | 374,122 | Success |
| Creditcoin testnet | native-single-import-final-checkpoint | [0x688bbeb7a148c9eb7e5eed5c665cdc0d008f95bc14d49968e7e952b741e679ae](https://creditcoin-testnet.blockscout.com/tx/0x688bbeb7a148c9eb7e5eed5c665cdc0d008f95bc14d49968e7e952b741e679ae) | 5459336 | 395,958 | Success |
| Creditcoin testnet | cached-root-recognize-4 | [0x7cd579377a8de8a64e36c0f905b6f5760296512b9765b46b9dee1686fba9cda0](https://creditcoin-testnet.blockscout.com/tx/0x7cd579377a8de8a64e36c0f905b6f5760296512b9765b46b9dee1686fba9cda0) | 5459337 | 384,230 | Success |
| Creditcoin testnet | cached-root-recognize-1 | [0xe1403b1729049454dc9174050f20205f06c9d97cb471958f4bca58cccfaf9aae](https://creditcoin-testnet.blockscout.com/tx/0xe1403b1729049454dc9174050f20205f06c9d97cb471958f4bca58cccfaf9aae) | 5459338 | 526,327 | Success |
| Creditcoin testnet | withdraw-work-1 | [0x132f0ae39c2252f6b7ad13773ef191aedeafabee6d5e55e17b5b1491720a16f3](https://creditcoin-testnet.blockscout.com/tx/0x132f0ae39c2252f6b7ad13773ef191aedeafabee6d5e55e17b5b1491720a16f3) | 5459339 | 310,086 | Success |
| Creditcoin testnet | cached-root-recognize-3 | [0x723fd815d126fc47ae658eb4c08024e5a561a5c01296a5f108b8f1a0f3b669cc](https://creditcoin-testnet.blockscout.com/tx/0x723fd815d126fc47ae658eb4c08024e5a561a5c01296a5f108b8f1a0f3b669cc) | 5459340 | 521,561 | Success |
| Creditcoin testnet | withdraw-work-3 | [0xd7da3be6fea92054880b4914b3faa9b2603ac7b8c1b1119f62c701ff6193e2bd](https://creditcoin-testnet.blockscout.com/tx/0xd7da3be6fea92054880b4914b3faa9b2603ac7b8c1b1119f62c701ff6193e2bd) | 5459341 | 310,086 | Success |
| Creditcoin testnet | record-actually-paid-WORK-in-consumer | [0xb5a088f7d258d53a4518a2eaebabc062784face542d4f2deea784df69cb8d116](https://creditcoin-testnet.blockscout.com/tx/0xb5a088f7d258d53a4518a2eaebabc062784face542d4f2deea784df69cb8d116) | 5459344 | 388,752 | Success |
| Creditcoin testnet | withdraw-returned-65 | [0x93833d3295860b753cc28a8dd66a3aa732ee44506ed25e3792e74006dce6e393](https://creditcoin-testnet.blockscout.com/tx/0x93833d3295860b753cc28a8dd66a3aa732ee44506ed25e3792e74006dce6e393) | 5459345 | 301,966 | Success |

### Policy branch source journal

[repository file](../evidence/source-branches.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/source-branches.json)

| Chain | Operation | Transaction | Block | Gas used | Receipt |
|---|---|---|---:|---:|---|
| Ethereum Sepolia | initialize-branch-epoch | [0x55e14fbfa0c623f48e58750d36472969422eaea1fd84008d4a147b927485997f](https://sepolia.etherscan.io/tx/0x55e14fbfa0c623f48e58750d36472969422eaea1fd84008d4a147b927485997f) | 11669719 | 466,815 | Mined |
| Ethereum Sepolia | create-pending-decline | [0x81b92422eae707ebab551ed9790e447fbe5e68a347fc302114b5618044f434e1](https://sepolia.etherscan.io/tx/0x81b92422eae707ebab551ed9790e447fbe5e68a347fc302114b5618044f434e1) | 11669720 | 549,252 | Mined |
| Ethereum Sepolia | worker-declines-pending | [0x506e56eb78e698e8b09aa7424ca9a1f7b30c6f0beac9075c8b3e3e31fa7742a5](https://sepolia.etherscan.io/tx/0x506e56eb78e698e8b09aa7424ca9a1f7b30c6f0beac9075c8b3e3e31fa7742a5) | 11669721 | 75,049 | Mined |
| Ethereum Sepolia | create-pending-expiry | [0xa62c5c864681d759ec2e9ac80af4cf967c7b5fb8e01cd5e2a2f72acc81cdf19d](https://sepolia.etherscan.io/tx/0xa62c5c864681d759ec2e9ac80af4cf967c7b5fb8e01cd5e2a2f72acc81cdf19d) | 11669722 | 549,252 | Mined |
| Ethereum Sepolia | permissionless-pending-expiry | [0xcc640c7fe799cc99daf3c9191ff1995817c7313adb50b8b1be3a60e670f146f0](https://sepolia.etherscan.io/tx/0xcc640c7fe799cc99daf3c9191ff1995817c7313adb50b8b1be3a60e670f146f0) | 11669725 | 72,748 | Mined |
| Ethereum Sepolia | create-monitoring-default | [0x82fecd39d9a9a725b25866966c43fbeeb43faa804166e864da779d2d7c517f86](https://sepolia.etherscan.io/tx/0x82fecd39d9a9a725b25866966c43fbeeb43faa804166e864da779d2d7c517f86) | 11669726 | 549,264 | Mined |
| Ethereum Sepolia | accept-monitoring-default | [0xb234739a0ead7898945db13b3d90454b3c87f72a6e16415753e0197e075b3743](https://sepolia.etherscan.io/tx/0xb234739a0ead7898945db13b3d90454b3c87f72a6e16415753e0197e075b3743) | 11669727 | 60,152 | Mined |
| Ethereum Sepolia | deliver-monitoring-default | [0x8f103b867b5333fc7826b0a7c942d3a7e4dac265a2e73b24e270f3a4dcb11445](https://sepolia.etherscan.io/tx/0x8f103b867b5333fc7826b0a7c942d3a7e4dac265a2e73b24e270f3a4dcb11445) | 11669728 | 62,000 | Mined |
| Ethereum Sepolia | finalize-monitoring-default | [0xf9873918a2cc71369102dc8c41eed63e54c457c8157fa0e37d2b8d6f6989264e](https://sepolia.etherscan.io/tx/0xf9873918a2cc71369102dc8c41eed63e54c457c8157fa0e37d2b8d6f6989264e) | 11669740 | 579,565 | Mined |
| Ethereum Sepolia | create-committee-quorum | [0x1be2eaafd84c0f7ef0cdeeb0112fbddafbe0be3f1bfe20da7e2ea8724d647a47](https://sepolia.etherscan.io/tx/0x1be2eaafd84c0f7ef0cdeeb0112fbddafbe0be3f1bfe20da7e2ea8724d647a47) | 11669741 | 589,184 | Mined |
| Ethereum Sepolia | accept-committee-quorum | [0x12cc0e509eebd560a33ccc2bd6505e1240f7130f509601b591453ce9be3ecc93](https://sepolia.etherscan.io/tx/0x12cc0e509eebd560a33ccc2bd6505e1240f7130f509601b591453ce9be3ecc93) | 11669742 | 60,178 | Mined |
| Ethereum Sepolia | deliver-committee-quorum | [0x06ed60c15618227920611a79a83e63d6fd967989e1224c2f46ed8965f81038db](https://sepolia.etherscan.io/tx/0x06ed60c15618227920611a79a83e63d6fd967989e1224c2f46ed8965f81038db) | 11669743 | 62,000 | Mined |
| Ethereum Sepolia | challenge-committee-quorum | [0x74a31a3544de53f9e6bac75004b6afa7be5f35bdc2db8b29f404f7b8621a3182](https://sepolia.etherscan.io/tx/0x74a31a3544de53f9e6bac75004b6afa7be5f35bdc2db8b29f404f7b8621a3182) | 11669744 | 82,552 | Mined |
| Ethereum Sepolia | committee-vote-exact-one | [0xad6b1e36788f38380db5f1642eb0552b1c4083d5c8ffa87800e836f32be0d0ab](https://sepolia.etherscan.io/tx/0xad6b1e36788f38380db5f1642eb0552b1c4083d5c8ffa87800e836f32be0d0ab) | 11669745 | 82,180 | Mined |
| Ethereum Sepolia | committee-vote-distinct-proposal | [0x4fe30c4ab693c43a8e16b5330c7f403dc11095db4d46001d7a1be8232c32f2de](https://sepolia.etherscan.io/tx/0x4fe30c4ab693c43a8e16b5330c7f403dc11095db4d46001d7a1be8232c32f2de) | 11669746 | 84,370 | Mined |
| Ethereum Sepolia | committee-vote-exact-two-finalizes-work-fee | [0xc6c911a23ea07e2b6c92a322f0506da128ee8d52dae9595b3fd24a608a14bab9](https://sepolia.etherscan.io/tx/0xc6c911a23ea07e2b6c92a322f0506da128ee8d52dae9595b3fd24a608a14bab9) | 11669747 | 704,113 | Mined |
| Ethereum Sepolia | create-committee-timeout | [0x3184930109c1e6bee24bcaa8cc61fc2566068b2ee477f38e306d9c7469b75d1b](https://sepolia.etherscan.io/tx/0x3184930109c1e6bee24bcaa8cc61fc2566068b2ee477f38e306d9c7469b75d1b) | 11669748 | 589,208 | Mined |
| Ethereum Sepolia | accept-committee-timeout | [0x1faa80570d28d42603c8185a5137b0387a82751698420a0625add981422287a3](https://sepolia.etherscan.io/tx/0x1faa80570d28d42603c8185a5137b0387a82751698420a0625add981422287a3) | 11669749 | 60,178 | Mined |
| Ethereum Sepolia | deliver-committee-timeout | [0x3f8aa9344dc5bb17c8631f132e53ced0267dccdc5467ec5d6eee8bb9c30b2df6](https://sepolia.etherscan.io/tx/0x3f8aa9344dc5bb17c8631f132e53ced0267dccdc5467ec5d6eee8bb9c30b2df6) | 11669750 | 62,000 | Mined |
| Ethereum Sepolia | challenge-committee-timeout | [0xc98cef346aa5514056de5d0a4be47ba78f0b7d6314049a4fe3522c3c18dee157](https://sepolia.etherscan.io/tx/0xc98cef346aa5514056de5d0a4be47ba78f0b7d6314049a4fe3522c3c18dee157) | 11669751 | 82,564 | Mined |
| Ethereum Sepolia | finalize-committee-timeout | [0x6d96aa8315356a23528f9eefcfe57a787bc5fd3e20fda4ad71ccdfc7f611c023](https://sepolia.etherscan.io/tx/0x6d96aa8315356a23528f9eefcfe57a787bc5fd3e20fda4ad71ccdfc7f611c023) | 11669768 | 424,007 | Mined |
| Ethereum Sepolia | create-mutual-before-default | [0x65b14f3840595fa8392b343f831420c28a1ed046fedbd468209bdc6d787da9ae](https://sepolia.etherscan.io/tx/0x65b14f3840595fa8392b343f831420c28a1ed046fedbd468209bdc6d787da9ae) | 11669769 | 549,264 | Mined |
| Ethereum Sepolia | accept-mutual-before-default | [0xd6729169cab3f77b05758627a8fb5acf7c410f372205b141111b3a730e6d6d57](https://sepolia.etherscan.io/tx/0xd6729169cab3f77b05758627a8fb5acf7c410f372205b141111b3a730e6d6d57) | 11669770 | 60,152 | Mined |
| Ethereum Sepolia | deliver-mutual-before-default | [0x397976188ca9c023d246b84fed20ab5fea94aa0d0c4585e4e686380bf9c0e978](https://sepolia.etherscan.io/tx/0x397976188ca9c023d246b84fed20ab5fea94aa0d0c4585e4e686380bf9c0e978) | 11669771 | 62,000 | Mined |
| Ethereum Sepolia | mutual-wins-before-default | [0xec69771b3cd0bd707c8ea4e2f459833abf41ff175072ce68a7d327f24d89265c](https://sepolia.etherscan.io/tx/0xec69771b3cd0bd707c8ea4e2f459833abf41ff175072ce68a7d327f24d89265c) | 11669783 | 484,564 | Mined |
| Ethereum Sepolia | create-default-before-mutual | [0x44d5e4697dfcc299bb6827e9a2779fd88224e7db541e4de40e6e60705bd08c8c](https://sepolia.etherscan.io/tx/0x44d5e4697dfcc299bb6827e9a2779fd88224e7db541e4de40e6e60705bd08c8c) | 11669784 | 549,240 | Mined |
| Ethereum Sepolia | accept-default-before-mutual | [0xbae164b7a65472b53a4da075526e234ac3729606ac12e0b7d6fcccd689407e0c](https://sepolia.etherscan.io/tx/0xbae164b7a65472b53a4da075526e234ac3729606ac12e0b7d6fcccd689407e0c) | 11669785 | 60,178 | Mined |
| Ethereum Sepolia | deliver-default-before-mutual | [0x65f51e36d54e4b7ce44a0fe644484f4551610ea9b4918d801e6dee3daa6fd7b0](https://sepolia.etherscan.io/tx/0x65f51e36d54e4b7ce44a0fe644484f4551610ea9b4918d801e6dee3daa6fd7b0) | 11669786 | 62,000 | Mined |
| Ethereum Sepolia | default-wins-before-mutual | [0xa55d4c11cec44a3ad08fe843834d2c185b09280a96b4678aaf7004ed874e07c8](https://sepolia.etherscan.io/tx/0xa55d4c11cec44a3ad08fe843834d2c185b09280a96b4678aaf7004ed874e07c8) | 11669798 | 419,823 | Mined |
| Ethereum Sepolia | start-branch-draining | [0x116477cae88ae7eaeb494ab3e5daba322d3457365e9c6a9b0c6a0338e5f43420](https://sepolia.etherscan.io/tx/0x116477cae88ae7eaeb494ab3e5daba322d3457365e9c6a9b0c6a0338e5f43420) | 11669799 | 82,770 | Mined |
| Ethereum Sepolia | sweep-branch-remainder-11 | [0xf2ed8beb833fcd3fddab3308106e65bf4939ae13f5a670b259b5c2a1a1fa2e06](https://sepolia.etherscan.io/tx/0xf2ed8beb833fcd3fddab3308106e65bf4939ae13f5a670b259b5c2a1a1fa2e06) | 11669800 | 286,713 | Mined |

### Policy branch target journal

[repository file](../evidence/public-branches.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/public-branches.json)

| Chain | Operation | Transaction | Block | Gas used | Receipt |
|---|---|---|---:|---:|---|
| Creditcoin testnet | fund-20-branch-epoch | [0x4c1659b776801d14b6e24f03e0579bde0c217af2117039f3dfe18bc4c1de94c2](https://creditcoin-testnet.blockscout.com/tx/0x4c1659b776801d14b6e24f03e0579bde0c217af2117039f3dfe18bc4c1de94c2) | 5459202 | 401,527 | Success |
| Creditcoin testnet | native-segmented-authenticate-quorum-and-final | [0xd65928d72975f15e99d108674b64628ead2f821d626e35322cdd3eb9e9348530](https://creditcoin-testnet.blockscout.com/tx/0xd65928d72975f15e99d108674b64628ead2f821d626e35322cdd3eb9e9348530) | 5459301 | 428,008 | Success |
| Creditcoin testnet | receipt-only-recognize-WORK-without-root-or-siblings | [0x1bf2148dc8eb3bb6b592ed392f5c231ccc217f68530f6b40762c757e50c9af0d](https://creditcoin-testnet.blockscout.com/tx/0x1bf2148dc8eb3bb6b592ed392f5c231ccc217f68530f6b40762c757e50c9af0d) | 5459302 | 572,584 | Success |
| Creditcoin testnet | receipt-only-recognize-FEE-without-root-or-siblings | [0x02a0abe6d9f856c65d0f3b8a7bd0ed7b3156199b6a28e66210a7e3a3dc534e91](https://creditcoin-testnet.blockscout.com/tx/0x02a0abe6d9f856c65d0f3b8a7bd0ed7b3156199b6a28e66210a7e3a3dc534e91) | 5459303 | 538,422 | Success |
| Creditcoin testnet | import-cached-final-branch-checkpoint | [0xe0b70e72fb94af36848c805a24b3e22080951954a34bb30157a11495f1ed65ce](https://creditcoin-testnet.blockscout.com/tx/0xe0b70e72fb94af36848c805a24b3e22080951954a34bb30157a11495f1ed65ce) | 5459304 | 349,762 | Success |
| Creditcoin testnet | branch-root-recognize-1 | [0x68557dc539cb4a1fdd6e3ac0f1e46035ae608b925fd44dfae7ead4b5a9b08bb2](https://creditcoin-testnet.blockscout.com/tx/0x68557dc539cb4a1fdd6e3ac0f1e46035ae608b925fd44dfae7ead4b5a9b08bb2) | 5459305 | 509,215 | Success |
| Creditcoin testnet | branch-withdraw-1 | [0x36ae96a9b8f63123c07f4d91b3a29aada913c1ce595e2579a0d671b3effb09a4](https://creditcoin-testnet.blockscout.com/tx/0x36ae96a9b8f63123c07f4d91b3a29aada913c1ce595e2579a0d671b3effb09a4) | 5459306 | 310,086 | Success |
| Creditcoin testnet | branch-withdraw-2 | [0x2cb4e7ed0806b883437a829b5d37c74143e3f9f930f492bb7f7382617f26b328](https://creditcoin-testnet.blockscout.com/tx/0x2cb4e7ed0806b883437a829b5d37c74143e3f9f930f492bb7f7382617f26b328) | 5459307 | 310,086 | Success |
| Creditcoin testnet | branch-withdraw-3 | [0xa87092208059b6b78a3310bcb2182385e57917ce9f150979c8cf7ef99f84b0ea](https://creditcoin-testnet.blockscout.com/tx/0xa87092208059b6b78a3310bcb2182385e57917ce9f150979c8cf7ef99f84b0ea) | 5459308 | 310,086 | Success |
| Creditcoin testnet | branch-root-recognize-4 | [0x15e3997fa89e3a8ad3a7ac1aeaf95601816e31b78687d49a9f5286270ff13fe6](https://creditcoin-testnet.blockscout.com/tx/0x15e3997fa89e3a8ad3a7ac1aeaf95601816e31b78687d49a9f5286270ff13fe6) | 5459309 | 526,347 | Success |
| Creditcoin testnet | branch-withdraw-4 | [0x5df22dd5571cfa9811683d29f8eebc9eb20477ba8e72ed6a157aef9431501d12](https://creditcoin-testnet.blockscout.com/tx/0x5df22dd5571cfa9811683d29f8eebc9eb20477ba8e72ed6a157aef9431501d12) | 5459310 | 310,086 | Success |
| Creditcoin testnet | branch-root-recognize-5 | [0x550a3d82eb71e7b4050ea8d5aafa636ce73353f29934368b2a4fbb05dd0ed1da](https://creditcoin-testnet.blockscout.com/tx/0x550a3d82eb71e7b4050ea8d5aafa636ce73353f29934368b2a4fbb05dd0ed1da) | 5459311 | 526,337 | Success |
| Creditcoin testnet | branch-withdraw-5 | [0x2a0c1d39f6de5d6030fd7b0adab1882afe105f447cafc3d88c784c52c96dec47](https://creditcoin-testnet.blockscout.com/tx/0x2a0c1d39f6de5d6030fd7b0adab1882afe105f447cafc3d88c784c52c96dec47) | 5459312 | 310,086 | Success |
| Creditcoin testnet | branch-root-recognize-6 | [0x1e690e49bd34abad42ae39e7ab87b8107c0554c71ae124334a2adbf4e747670d](https://creditcoin-testnet.blockscout.com/tx/0x1e690e49bd34abad42ae39e7ab87b8107c0554c71ae124334a2adbf4e747670d) | 5459313 | 526,335 | Success |
| Creditcoin testnet | branch-withdraw-6 | [0x0f40a8447280b1a39d9a05ab9cd84af73a69394fe0fa27391dd93054b0700b30](https://creditcoin-testnet.blockscout.com/tx/0x0f40a8447280b1a39d9a05ab9cd84af73a69394fe0fa27391dd93054b0700b30) | 5459314 | 310,086 | Success |
| Creditcoin testnet | branch-root-recognize-7 | [0x47066825b89ae8e81d3624646c9198370d0dc3e2b4bd6e29d8893ae3ee211409](https://creditcoin-testnet.blockscout.com/tx/0x47066825b89ae8e81d3624646c9198370d0dc3e2b4bd6e29d8893ae3ee211409) | 5459315 | 384,230 | Success |
| Creditcoin testnet | fund-successor-from-returned-free-balance | [0x884f68aa4fa3f51d6b065f4dfdc4e79e8b49882ab1666f1d4b932f62fbf8aa1c](https://creditcoin-testnet.blockscout.com/tx/0x884f68aa4fa3f51d6b065f4dfdc4e79e8b49882ab1666f1d4b932f62fbf8aa1c) | 5459316 | 399,443 | Success |
| Ethereum Sepolia | materialize-uninitialized-source-expiry | [0xa9bf2698a8482bbc783424bffe57e4cb8bb11ad62bb033dc7481b817743a1b6f](https://sepolia.etherscan.io/tx/0xa9bf2698a8482bbc783424bffe57e4cb8bb11ad62bb033dc7481b817743a1b6f) | 11669862 | 782,832 | Success |
| Creditcoin testnet | native-single-recognize-proven-expiry-return | [0x94a01d978ce67739264978f700bd250fc836d4305660156669f33ac791c8193b](https://creditcoin-testnet.blockscout.com/tx/0x94a01d978ce67739264978f700bd250fc836d4305660156669f33ac791c8193b) | 5459363 | 397,292 | Success |
| Creditcoin testnet | withdraw-branch-and-successor-return-11 | [0x0e58b7497e063af7404294d1dea72822796c8b74f3be565557592ea3bf7047ac](https://creditcoin-testnet.blockscout.com/tx/0x0e58b7497e063af7404294d1dea72822796c8b74f3be565557592ea3bf7047ac) | 5459364 | 301,966 | Success |

### Disposable Safe rotation journal

[repository file](../evidence/public-safe-rotation.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/public-safe-rotation.json)

| Chain | Operation | Transaction | Block | Gas used | Receipt |
|---|---|---|---:|---:|---|
| Ethereum Sepolia | deploy-disposable-safe-factory | [0xd6ee557e8e10a3d6c31ad43508e56866768258df3cbc4518328ed28fc2daba74](https://sepolia.etherscan.io/tx/0xd6ee557e8e10a3d6c31ad43508e56866768258df3cbc4518328ed28fc2daba74) | 11669830 | 711,231 | Mined |
| Ethereum Sepolia | create-disposable-safe-proxy | [0x2e24e394e11b6aa2c8f09f75207f491cf0a3648f5756b1791c9bbb817370cb06](https://sepolia.etherscan.io/tx/0x2e24e394e11b6aa2c8f09f75207f491cf0a3648f5756b1791c9bbb817370cb06) | 11669831 | 283,476 | Mined |
| Creditcoin testnet | fund-disposable-safe-epoch-3 | [0x685c7f39c3900da22b4f27f9d51208fda4b594dd20d48847be10a2d5bc793137](https://creditcoin-testnet.blockscout.com/tx/0x685c7f39c3900da22b4f27f9d51208fda4b594dd20d48847be10a2d5bc793137) | 5459296 | 401,515 | Mined |
| Ethereum Sepolia | initialize-disposable-safe-epoch | [0x2433cd669fbf89484b67fc6e370b7633a82956f8277cee6a6cf3b3ab1d07a27c](https://sepolia.etherscan.io/tx/0x2433cd669fbf89484b67fc6e370b7633a82956f8277cee6a6cf3b3ab1d07a27c) | 11669864 | 483,903 | Mined |
| Ethereum Sepolia | create-rotation-offer-A | [0x2d3f8d1ffe08e1a445f496621891b7a83517c9d7836ea6025711d4b421c00175](https://sepolia.etherscan.io/tx/0x2d3f8d1ffe08e1a445f496621891b7a83517c9d7836ea6025711d4b421c00175) | 11669865 | 549,252 | Mined |
| Ethereum Sepolia | accept-rotation-A | [0xa5dd92e2baeb58147c0c3b0cee9380f510a4f28d25c0c0962f4b1515d985d3ab](https://sepolia.etherscan.io/tx/0xa5dd92e2baeb58147c0c3b0cee9380f510a4f28d25c0c0962f4b1515d985d3ab) | 11669866 | 60,178 | Mined |
| Ethereum Sepolia | deliver-rotation-A | [0x8f6fcfc9ede147dd0791b1825ee20d838d9ac69c248fded8491e87008c09c494](https://sepolia.etherscan.io/tx/0x8f6fcfc9ede147dd0791b1825ee20d838d9ac69c248fded8491e87008c09c494) | 11669867 | 62,000 | Mined |
| Ethereum Sepolia | approve-pre-rotation-A | [0x8b65e753cd8b6ae72a554b8d03c0604de1845d04a5e1ea97d60f384c67041f4f](https://sepolia.etherscan.io/tx/0x8b65e753cd8b6ae72a554b8d03c0604de1845d04a5e1ea97d60f384c67041f4f) | 11669868 | 620,665 | Mined |
| Ethereum Sepolia | create-rotation-offer-B | [0x35ccf2a4aaf3f074e0596ff1c5d8b1dc60cb71e903277a654a12c19058b51b78](https://sepolia.etherscan.io/tx/0x35ccf2a4aaf3f074e0596ff1c5d8b1dc60cb71e903277a654a12c19058b51b78) | 11669869 | 549,240 | Mined |
| Ethereum Sepolia | accept-rotation-B | [0x9f912eee8dcdcff9b87db7f118fa8ffa84d8a6012c4c25e6a33c08ecf0a7a5ec](https://sepolia.etherscan.io/tx/0x9f912eee8dcdcff9b87db7f118fa8ffa84d8a6012c4c25e6a33c08ecf0a7a5ec) | 11669870 | 60,166 | Mined |
| Ethereum Sepolia | deliver-rotation-B | [0x485e2a93c6c8758f9b3df2be60c1466e655f986eb60470cbc8d364b1f93b9b4c](https://sepolia.etherscan.io/tx/0x485e2a93c6c8758f9b3df2be60c1466e655f986eb60470cbc8d364b1f93b9b4c) | 11669871 | 62,000 | Mined |
| Ethereum Sepolia | rotate-disposable-safe-Z-to-W | [0xc0ce7699356b8826bdb4c05ddc6092bed256c6731e6b1157b5449e6817cd7b82](https://sepolia.etherscan.io/tx/0xc0ce7699356b8826bdb4c05ddc6092bed256c6731e6b1157b5449e6817cd7b82) | 11669872 | 87,738 | Mined |
| Ethereum Sepolia | approve-queued-B-with-current-X-W | [0x02859087db32f5299c625adb4fde73e3e20446a48aed9bd13d6bf3d15a093eeb](https://sepolia.etherscan.io/tx/0x02859087db32f5299c625adb4fde73e3e20446a48aed9bd13d6bf3d15a093eeb) | 11669873 | 463,832 | Mined |
| Ethereum Sepolia | start-disposable-safe-draining | [0x939d35841f1b2e1a9e719acb258d3378ec508887a8b89831a30afb39e0d1ce1c](https://sepolia.etherscan.io/tx/0x939d35841f1b2e1a9e719acb258d3378ec508887a8b89831a30afb39e0d1ce1c) | 11669874 | 82,770 | Mined |
| Ethereum Sepolia | return-disposable-safe-remainder-1 | [0x075af1965ccb46846ef3254b27453eb8d25ecd221c2c80fcb93396be69560675](https://sepolia.etherscan.io/tx/0x075af1965ccb46846ef3254b27453eb8d25ecd221c2c80fcb93396be69560675) | 11669875 | 289,634 | Mined |
| Creditcoin testnet | authenticate-disposable-safe-final-checkpoint | [0x9919d84a44839558c576e190da938b482acc8e0b22f0fae87c6ef259ec90c51c](https://creditcoin-testnet.blockscout.com/tx/0x9919d84a44839558c576e190da938b482acc8e0b22f0fae87c6ef259ec90c51c) | 5459368 | 396,330 | Mined |
| Creditcoin testnet | recognize-disposable-safe-return-receipt | [0xa464d9cea1653bf31ac4aebf1e5b78f15d42753bd70a344fa02b5498f88fbcd8](https://creditcoin-testnet.blockscout.com/tx/0xa464d9cea1653bf31ac4aebf1e5b78f15d42753bd70a344fa02b5498f88fbcd8) | 5459369 | 361,130 | Mined |
| Creditcoin testnet | recognize-rotation-work-1 | [0xcd3d2d4052a2175a0725fa3c69c39aaef18fcab6a6373630319afc66bac1e830](https://creditcoin-testnet.blockscout.com/tx/0xcd3d2d4052a2175a0725fa3c69c39aaef18fcab6a6373630319afc66bac1e830) | 5459370 | 526,327 | Mined |
| Creditcoin testnet | withdraw-rotation-work-1 | [0x3535c763a4c44ed515371901107f578dc730a9085a84782503496a1752e8e126](https://creditcoin-testnet.blockscout.com/tx/0x3535c763a4c44ed515371901107f578dc730a9085a84782503496a1752e8e126) | 5459371 | 310,086 | Mined |
| Creditcoin testnet | recognize-rotation-work-2 | [0xbd1638877ff5c0ed2cd399725225a22eee731cada7ee0252ea784d40ed422c61](https://creditcoin-testnet.blockscout.com/tx/0xbd1638877ff5c0ed2cd399725225a22eee731cada7ee0252ea784d40ed422c61) | 5459372 | 516,749 | Mined |
| Creditcoin testnet | withdraw-rotation-work-2 | [0x86252a5b42cf9059af0893a078a676228e282d28a3167624f9a8665fa115c9c9](https://creditcoin-testnet.blockscout.com/tx/0x86252a5b42cf9059af0893a078a676228e282d28a3167624f9a8665fa115c9c9) | 5459373 | 310,086 | Mined |
| Creditcoin testnet | withdraw-disposable-safe-return-1 | [0x135851ba38fc40c2ece92e74d2697750766ba4a4b6cd8ea27ccefe35adb2bcd0](https://creditcoin-testnet.blockscout.com/tx/0x135851ba38fc40c2ece92e74d2697750766ba4a4b6cd8ea27ccefe35adb2bcd0) | 5459374 | 301,966 | Mined |

## Pending recorded submissions

None recorded.

## Other mined failures

None recorded.

## Mined semantic refusal

The following failed transaction was intentionally mined to show that authenticated checkpoint bytes are refused when presented as an allocation payment fact.

| Transaction | Block | Gas used | Status | Expected selector | Description |
|---|---:|---:|---|---|---|
| [0x0d077b52bb15edd32a8bbc3a2be0bd3420e7c657b43804b7128f8efb5785e079](https://creditcoin-testnet.blockscout.com/tx/0x0d077b52bb15edd32a8bbc3a2be0bd3420e7c657b43804b7128f8efb5785e079) | 5459342 | 326,410 | Mined failure (0) | 0xad4d102a | Persisted native authentication and correct source emitter; checkpoint event refused as an allocation payment fact |

## Read-only refusal checks

These observations used `eth_call`; they are not mined failed transactions.

| Check | Source block | Expected error | Selector | Evidence note |
|---|---:|---|---|---|
| stale-ruling-signature-after-challenge | 11669744 | InvalidSignature | 0x8baa579f | eth_call contract refusal; not a mined failed transaction |
| duplicate-committee-vote | 11669745 | DuplicateVote | 0x0ebd16a4 | eth_call contract refusal; not a mined failed transaction |
| default-rejected-after-mutual | 11669783 | InvalidState | 0xbaf3f0f7 | eth_call contract refusal; not a mined failed transaction |
| mutual-rejected-after-default | 11669798 | InvalidState | 0xbaf3f0f7 | eth_call contract refusal; not a mined failed transaction |

## Native proof regeneration

[repository file](../evidence/native-recovery-verification-33642ef4.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/native-recovery-verification-33642ef4.json)

The raw SDK regenerated transaction [0x33642ef4a994dd63b5426a3835051f314cf422761d48000fcb1bcc4b4538efc5](https://sepolia.etherscan.io/tx/0x33642ef4a994dd63b5426a3835051f314cf422761d48000fcb1bcc4b4538efc5) at source position 11669711:57. Exact encoded bytes matched prior evidence: **yes**. The fixed native verifier read-only call returned **true**.

- Prior continuity fingerprint: `0x685d4c9cc743afbf3b174532c88b72671ff8c5e0ef3a866ddc9e627913d7bfc4`
- Regenerated continuity fingerprint: `0x685d4c9cc743afbf3b174532c88b72671ff8c5e0ef3a866ddc9e627913d7bfc4`
- Continuity changed: **false** (10 roots).

This demonstrates provider-independent regeneration for the recorded proof. Because the continuity fingerprint did not change, it does not by itself demonstrate recovery from an aged or changed continuity witness.

## Finalized conservation readback

[repository file](../evidence/release-readback.json) · [raw GitHub evidence](https://raw.githubusercontent.com/pvgirish/ProofKey-Work-Treasury/main/evidence/release-readback.json)

Finalized readback time: 2026-09-09T19:20:23.925Z. Automated journeys complete: **true**.

Credited deposits: 143.0 CTC; live liabilities: 0.0 CTC; completed withdrawals: 143.0 CTC; recorded balance: 0.0 CTC. Conservation: **true**; solvency: **true**.

## Evidence limits

The journals establish only the transactions, calls, state snapshots, and checks they record. A source-chain decision is distinct from target recognition, target free-balance recognition is distinct from withdrawal, and a read-only native verification is distinct from a mined authentication transaction. No competition ranking or release score is inferred here.
