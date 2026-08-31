## 1. Baseline and fixture alignment

- [x] 1.1 Record the direct full-browser baseline with the nine named failures and the one environment-gated Buyer pilot skip.
- [x] 1.2 Set the affected screenshot viewport sizes before navigation and align current Seller/Staff labels and headings.
- [x] 1.3 Add the strict-schema nullable fields to the generic Seller and Stage 7 member fixtures.
- [x] 1.4 Scope the Stage 6.6 duplicate customer heading to `#staff-main-content` without weakening uniqueness.

## 2. Regression and visual evidence

- [x] 2.1 Run the focused browser harness and confirm the nine reproduced failures are resolved with direct exit 0.
- [x] 2.2 Run the full `npm run test:browser` gate and separately run the Buyer visual pilot with an explicit `/tmp/BUYER_VISUAL_REVIEW_SCREENSHOT` path.
- [x] 2.3 Run the dedicated 21-image Stage 7F visual evidence harness and manually inspect every generated PNG.

## 3. Release verification and handoff

- [x] 3.1 Run `npm run check`, `npm run release:check`, all required OpenSpec strict/current validations, web/static/CSS guards, and `git diff --check` with direct exits.
- [x] 3.2 Only after direct `npm run release:check` exit 0, close the dependent release-check-command-alignment and Staff JWT gate tasks supported by the full evidence.
- [x] 3.3 Create one independent local commit only; leave `release-browser-gate-alignment` unarchived and report LOCAL/REMOTE/PRODUCTION boundaries.
