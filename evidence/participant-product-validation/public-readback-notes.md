# Public readback during the participant iteration

The separately saved `public-main120.json` was collected again from the configured public source and target RPCs. It reports **accounting complete; provenance incomplete**. The selected epoch still reconciles cap 120, earned 55, returned 65, recognized 120, paid 55, reserve 0 and outstanding 0. Its own source and target snapshot fields identify the finalized blocks used.

Historical Safe calls for allocations 1–3 could not be reconstructed in this run. The collector recorded missing revert data while reading the Safe's historical `nonce()` state. A separate read through the app returned the public source provider's explicit historical-state-unavailable response while checking Safe code at the corresponding older blocks. These are missing historical observations; they are not successful provenance verification and are not new failed treasury transfers.

The Paid work app therefore left its fresh selected record incomplete and did not count these payments as individually verified in that run. It must not inherit an older report's green verdict. The earlier complete main120 report used by browser regression remains a **disclosed fixed fixture from its earlier snapshot**, not a fresh successful public readback of this release.

Recovery is to supply an archive-capable RPC for the same pinned source chain in Networks, reverify the deployment, then repeat collection. A bounded attempt to use `https://rpc.sepolia.org` returned HTTP 403, so no alternate provider is represented as verified or installed by this release. RPC completeness and availability remain operational dependencies.

No wallet request, new source/target transaction, independent settlement or external participant was used for this readback.
