# Tasks: Rakuten and TikTok Japan Marketplace Foundation

## Migration

- [x] 1.1 Reconfirm branch/worktree/ref and allocate only `0042` after `0041`; record no production migration.
- [x] 1.2 Add `RAKUTEN_JP`/`TIKTOK_JP` JP/JPY registry rows with Chinese labels, active modeling state and unavailable adapters.
- [x] 1.3 Add platform-neutral product/order identity tables, scoped uniqueness, organization/store guards, immutable events and transaction assertions.
- [x] 1.4 Verify fresh, sequential upgrade, repeat rejection, wrong-order rollback, integrity and foreign-key checks.

## Contracts and Domain

- [x] 2.1 Extend marketplace/currency runtime contracts and Chinese display labels without changing Amazon behavior.
- [x] 2.2 Add platform-neutral identifier validator and explicit Rakuten/TikTok profiles, including optional historical TikTok profile.
- [x] 2.3 Add cross-platform collision and Amazon compatibility tests; expose stable importer validator results.

## API, Permissions and UI

- [x] 3.1 Extend registry resolver and store/product/order DTO boundaries with canonical marketplace and platform identifiers.
- [x] 3.2 Keep Seller Organization + Store scope, Personal DENY, permission revocation and concealed 404/403 behavior; add tests for mismatches.
- [x] 3.3 Preserve internal communication evidence, short read intents, Seller lazy loading and forbidden storage identifiers.
- [x] 3.4 Add Chinese marketplace labels/status display and no provider action when adapter is unavailable.

## Tests and Verifiers

- [x] 4.1 Add migration verifier and update schema-tail/version guard assertions to 0042.
- [x] 4.2 Run targeted contract/domain/API/UI tests plus Amazon regression and full repository test suite.
- [x] 4.3 Run OpenSpec strict, migration guards, typecheck/build and relevant local D1 checks; report real PASS/FAIL/SKIP.

## Rollback and Handoff

- [x] 5.1 Document local reversible rollback evidence and post-new-fact forward-recovery boundary.
- [x] 5.2 Confirm no real Excel/image/Cloudflare/R2/provider/Feishu/Drive/Tencent Docs access, no deploy, no commit/push/PR/merge; stop at total-control review.

## Acceptance Remediation

- [x] 6.1 Add immutable non-Amazon evidence/formal-order carriers and exact order/product/evidence scope guards in 0042.
- [x] 6.2 Add discriminated nullable Amazon legacy projection across Seller contract, API read model and UI runtime/rendering.
- [x] 6.3 Add shared buyer-supported marketplace allowlist and controlled zero-write invitation rejection.
- [x] 6.4 Reject profile/platform mismatch and pre-trim control characters in identifier validation.
- [x] 6.5 Remove the unused provider feature-flag declaration and rely only on consumed registry adapter status.
- [x] 6.6 Freeze the legacy registry parent with mutation-deny triggers and negative tests.
- [x] 6.7 Rerun migration guards, focused tests, OpenSpec strict, diff check and complete repository gate.

## Acceptance Remediation 2

- [x] 7.1 Add the immutable platform formal-order communication evidence/file association and exact file/link/grant/seller/store guards to 0042.
- [x] 7.2 Extend Staff attach and Seller screenshot resolution/read authorization across legacy and platform orders without changing Purpose, route or Amazon behavior.
- [x] 7.3 Dynamically project platform screenshot availability and preserve the existing Seller lazy-loading UI without storage identifiers or permanent URLs.
- [x] 7.4 Prove platform attach/read success and concealed cross-org/store, Personal DENY, revoked member/store/link/grant/file and no-screenshot outcomes.
- [x] 7.5 Prove mixed legacy/platform keyset pagination has no missing or duplicate rows, including equal timestamps.
- [x] 7.6 Re-run 0042 fresh/sequential/repeat/wrong-order/no-partial-DDL/FK/integrity/inventory, focused tests, full `npm run check`, OpenSpec strict and diff check.
