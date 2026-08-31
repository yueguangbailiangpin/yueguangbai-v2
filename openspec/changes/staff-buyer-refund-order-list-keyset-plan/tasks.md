# Tasks: staff-buyer-refund-order-list-keyset-plan

## OpenSpec and failure-first evidence

- [x] 1.1 Create this independent Change without modifying or archiving
  `staff-order-list-multimarket-index-preparation`.
- [x] 1.2 Add Schema 37 legal synthetic corpora at 1%/20%/80%, fixed-assignment hit/miss,
  first/subsequent pages, same-timestamp tie-breaks and Personal DENY coverage.
- [x] 1.3 Capture direct baseline EQP, including parent `USE TEMP B-TREE FOR ORDER BY`,
  market-index usage, assignment subquery, seek OR and responsibility subqueries.

## Minimal implementation decision

- [x] 2.1 Evaluate row-value seek, parameterized `UNION ALL`/two-branch keyset and other
  equivalent SQL forms without moving authorization out of SQL.
- [x] 2.2 Implement only a directly proven equivalent parent-sort removal; otherwise record
  an explicit NO-CHANGE result and leave production query code unchanged.

## Regression and boundaries

- [x] 3.1 Compare baseline and candidate result sets, order, no-duplicate/no-gap traversal,
  limit+1, cursor/filter echo and `confirmed_at/id` ties.
- [x] 3.2 Re-run fixed assignment, cross-market/organization, unassigned buyer, Personal
  DENY and concealed-404 tests, plus existing Staff list/detail regressions.
- [x] 3.3 Confirm no DTO/API/cursor/role/permission/registry/enablement/Buyer/Seller or
  migration changes; add no migration unless separately proven and authorized.

## Verification and handoff

- [x] 4.1 Run focused EQP/capacity, Staff order-list authorization, typecheck, test, build,
  check, db:verify, migration guards, API contract, Web source/static/CSS guards, current/
  all OpenSpec strict and `git diff --check`, with direct exit codes.
- [x] 4.2 Re-check final HEAD, clean worktree/ahead, and report LOCAL/STAGING/REMOTE CI/
  PRODUCTION separately with Production=`NO-GO`.
- [x] 4.3 Create one atomic local commit only if implementation or the evidence Change is
  complete; never push, deploy or archive this Change.

## LOCAL evidence summary

- Focused EQP/HTTP test: 11/11; Staff list/detail + multimarket regressions: 47/47.
- Capacity configuration: 23/23; full suite: 266 files / 1891 tests; typecheck, build and
  repository `check`: exit 0.
- Direct strict current/all OpenSpec, database/migration guards, API contract (241 endpoints),
  Web source/static, CSS guards and `git diff --check`: exit 0.
- Full-repository `format:check` remains an existing baseline failure across 3135 files; the
  new test and Change artifacts were formatted locally, while unrelated files were untouched.
