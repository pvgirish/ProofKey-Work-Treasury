# App workflow visual observations

Observed in the Codex in-app browser at `http://127.0.0.1:4173/` during this implementation review.

- The visible **Verify program** button reconstructed the main program with 120 cap, 55 paid, 65 returned credit and zero outstanding, at source block 11673826 / target block 5462652. Export became available. This observation preceded final wording fixes; automated regression checks separately cover final consent/status wording.
- The new closeout and payment tools were inspected at the ordinary app viewport and at a temporary 390 × 844 phone-width viewport. Controls and text remained inside their cards; file import, advanced JSON disclosure and action buttons remained accessible. The temporary viewport was reset.
- The replacement plan separates import/check from wallet execution, and its continue button begins disabled. The phone layout stacks its action buttons.
- No wallet was connected and no signing or broadcast action was selected for these visual checks.

These are bounded manual layout observations, not a full accessibility audit or proof of customer adoption. The browser regression log and hashed validation report cover automated behavior separately.
