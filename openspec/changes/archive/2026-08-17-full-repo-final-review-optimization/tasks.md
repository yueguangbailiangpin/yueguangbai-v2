# Tasks: Full Repository Final Review and Optimization

## 0. Baseline, governance and scope freeze

- [x] 0.1 Read-only verify remote identity, local main, historical-order integration branch, origin tracking ref and the four protected untracked main-worktree paths.
- [x] 0.2 Create `audit/full-repo-final-review-optimization` and its isolated worktree from exact commit `384873ac3c5c6f83d73e6dd8e1788992081b78e7`.
- [x] 0.3 Read `AGENTS.md`, OpenSpec/governance, decision/product/architecture/contract authorities and current historical-order, seller-principal, chat-screenshot and Rakuten/TikTok Changes.
- [x] 0.4 Freeze proposal, design, requirements, repair boundary, external NO-GO and verification matrix in this independent Change.

## 1. Security, authentication and authorization audit

- [x] 1.1 Trace Customer/Staff authentication and revocation from route to session resolver; test account/session/version/inactive and anti-enumeration boundaries.
- [x] 1.2 Trace unique Staff role, default/additional/leader grants, Personal DENY, system hard-deny and Staff Data Scope across sensitive services.
- [x] 1.3 Trace Seller Organization/Store membership and cross-organization/cross-store isolation across product/order/evidence/finance paths.
- [x] 1.4 Trace file purpose, ownership, explicit audience, short read-intent creation/consumption, single-use/expiry and dynamic revocation; prove no storage identifier leak.
- [x] 1.5 Implement and test only evidence-proven fail-closed security corrections; list any unresolved rule as owner authorization required.

## 2. Migration 0001–0043 audit

- [x] 2.1 Inspect all SQL for continuity, transaction assertions, FK/integrity, immutability, unique/idempotency and unsafe destructive behavior.
- [x] 2.2 Run fresh and sequential local application; verify semantic table/trigger/index/registry inventory and schema 43.
- [x] 2.3 Run repeat, wrong-order and injected no-partial-DDL failure cases and compare complete pre/post inventory.
- [x] 2.4 Verify 0041/0042 behavior and 0043 forward-recovery/rollback boundaries; do not execute remote Migration or down-migrate immutable facts.
- [x] 2.5 Repair only deterministically incorrect local Migration/verifier/test behavior and rerun the full chain.
- [x] 2.6 Freeze migrations 0001–0042 to the exact baseline bytes and add a 42-file SHA-256 plus aggregate-hash immutability gate; keep 0043+ append only.

## 3. Historical-order data conservation audit

- [x] 3.1 Run focused negative tests for source SHA/header drift, refund cutoff, platform shapes, duplicate keys, seller ambiguity and image policy.
- [x] 3.2 Run `npm run test:historical-order-migration` and the full dry-run against the frozen workbook.
- [x] 3.3 Reconcile manifest SHA, 16,304 rows, candidate/quarantine, recognized/unique/duplicate/exact duplicate, marketplace/product/refund and H/K image totals.
- [x] 3.4 Prove every external/database/R2/image-byte/Migration/deployment counter is zero and keep production import `NOT_EXECUTED`.
- [x] 3.5 Fix only deterministic generator/test conservation defects; defer historical financial authority or real import to separate owner approval.

## 4. Cross-platform and seller-principal finance audit

- [x] 4.1 Verify Amazon/Coupang compatibility and Rakuten/TikTok platform-neutral registry, identifier, formal-order, evidence and chat-file chains.
- [x] 4.2 Verify exact organization/store scope, provider-unavailable state, nullable legacy/finance projection and Chinese display.
- [x] 4.3 Verify 0041 exact order-date rate, default/organization priority, explicit zero, future-effective versioning, BigInt/HALF_UP and immutable snapshot in both confirmation paths.
- [x] 4.4 Prove missing authority creates no financial facts and later policies do not recalculate history.
- [x] 4.5 Implement and test only deterministic compatibility or finance corrections within the frozen rules.

## 5. Contract, API, UI, pagination and performance audit

- [x] 5.1 Compare shared Contract, route registry, service DTO, runtime schema and UI for discriminator/null/error/timezone/Chinese-copy consistency.
- [x] 5.2 Test mixed legacy/platform cursor traversal, limit boundaries, equal timestamps and authorization conservation.
- [x] 5.3 Test Customer/Staff query-root isolation, session invalidation and Seller screenshot lazy loading with no list-time byte/read-intent fetch.
- [x] 5.4 Measure current build/runtime evidence; optimize only reproducible regressions without weakening dynamic authorization or raising thresholds.
- [x] 5.5 Implement focused consistency/performance fixes and regression tests where authority is unambiguous.

## 6. Maintainability and static-verifier audit

- [x] 6.1 Inventory dependencies, duplicate implementations, single-use wrappers, unreachable exports/routes, stale flags and dead code with reference analysis.
- [x] 6.2 Audit static verifiers for semantic checks and negative failure proof rather than count/tail text only.
- [x] 6.3 After full tests and OpenSpec consistency pass, run Ponytail whole-repository read-only review and classify each suggestion as accept/reject/later.
- [x] 6.4 No Ponytail suggestion was adopted; active re-exports/lazy boundaries were retained and no post-review source mutation was needed.

## 7. Required gates and handoff

- [x] 7.1 Run all affected focused tests and record actual files/tests/pass/fail/skip totals.
- [x] 7.2 Run historical-order full verification and record manifest/conservation/zero-write evidence.
- [x] 7.3 Run `npm run db:verify`, `npm run verify:migration-guards` and `npm run verify:openspec:strict`.
- [x] 7.4 Run complete `npm run check`, `git diff --check` and final branch/worktree/ref/status verification.
- [x] 7.5 Produce the required governance report with actual diff, rollback, permissions, performance and external resource counters.
- [x] 7.6 Stop uncommitted and unpushed at `待总控复核`; do not create PR, merge, deploy or execute production Migration.

## 8. Total-control historical-Migration correction

- [x] 8.1 Restore 0003–0008 and 0010 exactly from baseline and prove all 0001–0042 files have zero diff.
- [x] 8.2 Make the verifier truthfully distinguish intrinsic SQL failures from seven predecessor mismatches rolled back by its explicit outer transaction.
- [x] 8.3 Remove every delivery claim that historical Migration SQL was edited; document the immutable checksum and forward-only 0043 boundary.
- [x] 8.4 Rerun focused tests, historical negative/full dry-run, database/Migration/OpenSpec gates, complete `npm run check`, and final diff validation.
