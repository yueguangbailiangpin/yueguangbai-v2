# Tasks: Seller Principal Rate Production Bootstrap Preflight

## 1. Baseline and inventory

- [x] Verify remote `origin/main`, repository identity, main-worktree protected paths and create the isolated branch/worktree.
- [x] Read AGENTS, OpenSpec/governance and current decision/product/contract authorities.
- [x] Audit Migrations 0040–0043, policy service/API/UI, both formal-order confirmation paths and deployment templates.
- [x] Freeze Migration decision as NONE and choose the existing Staff workflow over direct bootstrap SQL.

## 2. Read-only preflight

- [x] Add GLOBAL Owner default-only Staff read/submit UI support without weakening organization reads or Seller Ops scope.
- [x] Add template inspection proving enforcement remains false in staging/production.
- [x] Add local restored-SQLite inspection with explicit schema/as-of/phase/date inputs and read-only query-only access.
- [x] Classify absent, explicit-zero, correct pending, future confirmed, effective and conflicting default-policy states.
- [x] Verify policy/event/Audit/Outbox/Idempotency conservation without outputting operational identifiers.
- [x] Emit expected row deltas, rollback boundary and zero-write counters.

## 3. Runbook and tests

- [x] Add an operator runbook for bootstrap, Owner confirmation, exact-date rate check, separate switch authorization, smoke and rollback.
- [x] Add anonymous tests for repeat/no-write, row-plan states, anomaly blocking, exact-date fail closed and local-ready output.
- [x] Re-run existing service/HTTP/UI/formal-order/Migration tests for concurrency, permissions, snapshots and historical immutability.
- [x] Register the exact Staff pricing workspace in the cross-module static source allowlist without weakening the verifier.

## 4. Verification and handoff

- [x] Run focused tests, typecheck, DB/Migration guards, strict OpenSpec and complete repository gate; record truthful PASS/FAIL/SKIP.
- [x] Verify final diff, worktree scope and the four protected main-worktree paths.
- [x] Commit only the bounded local Change; do not push, PR, merge, deploy, migrate, access real accounts or write external resources.
- [x] Stop at `待总控复核` with explicit owner authorization steps and external-write count.
