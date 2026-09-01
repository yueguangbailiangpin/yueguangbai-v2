# Tasks: staff-buyer-refund-order-list-keyset-plan

## NO-CHANGE decision and failure-first evidence

- [x] 1.1 Keep this independent Change unarchived and leave
  `staff-order-list-multimarket-index-preparation` untouched.
- [x] 1.2 Build legal Schema 37 source-chain corpora with many irrelevant-market rows,
  exact 1%/20%/80% Marketplace scope shares, fixed-assignment hit/miss and same-timestamp
  `confirmed_at/id` ordering.
- [x] 1.3 Capture direct default and test-only forced-hint EQP, explicitly separating the
  parent `USE TEMP B-TREE FOR ORDER BY` from nested responsibility sorts.
- [x] 1.4 Run deterministic pre-authorization candidate probes for first, deep and tail
  pages; do not use wall-clock timing as performance evidence.

## Safe production boundary

- [x] 2.1 Reject the global-index `INDEXED BY` candidate because its key interval includes
  out-of-scope market rows before Marketplace/fixed-assignment authorization.
- [x] 2.2 Remove the `buyer_refund` multi-Marketplace hint from `routes.ts`, remove its
  `marketplaceCodes` metadata transport from `data-scope.ts`, and restore planner autonomy.
- [x] 2.3 Preserve fixed assignment, Marketplace/Seller Organization scope, Personal DENY,
  concealed 404, `confirmed_at/id` keyset, `limit+1`, cursor/filter echo, DTO and wire shape.

## OpenSpec and regression boundaries

- [x] 3.1 Rewrite proposal/design/spec/tasks as an explicit `NO-CHANGE` record, including
  rejected alternatives and the unresolved parent/nested TEMP-BTREE boundaries.
- [x] 3.2 Re-run result order, tie-breaker, no-gap/no-duplicate traversal, assignment miss,
  Personal DENY and concealed-404 regressions.
- [x] 3.3 Confirm no DTO/API/cursor/role/permission/registry/enablement/Buyer/Seller,
  migration 0031/0037 or D1 schema changes.

## Verification and handoff

- [x] 4.1 Run focused cost/HTTP, Staff list/detail/multimarket, capacity, typecheck, test,
  build, check, database/migration, API contract, Web/CSS and OpenSpec strict gates; record
  direct command exits. The focused Change run is 14/14, the three Staff files are 50/50,
  order-list capacity is 26/26, and the full suite is 266 files/1894 tests. The full-repo
  format baseline remains a separate exit-1 report; the changed test and Change artifacts
  pass targeted formatting.
- [x] 4.2 Re-check final HEAD, clean worktree/ahead, and report LOCAL/STAGING/REMOTE CI/
  PRODUCTION separately with `PRODUCTION_STATUS=NO-GO` after the atomic local commit.
- [x] 4.3 Create one atomic local forward commit only after the final gates pass; never push,
  deploy or archive this Change.

## LOCAL evidence summary

- Current Change focused cost/HTTP run: 14/14 tests passed with direct deterministic metrics for
  first/deep/tail pages at 1%/20%/80% scope; no historical `47/47` statistic is reused.
- Staff list/detail plus multimarket: 50/50; order-list capacity: 26/26; full suite: 266
  files/1894 tests; typecheck, build and repository `check` exited 0.
- Database, migration, API contract, Web source/static-build, CSS, security/DTO/finance,
  and OpenSpec strict guards exited 0. Full-repository `format:check` and Change-targeted
  formatting are reported separately: the former is the existing 3134-file baseline exit 1,
  while the latter exited 0.
- All evidence is LOCAL. STAGING, REMOTE CI and PRODUCTION were not run; Production is NO-GO.
