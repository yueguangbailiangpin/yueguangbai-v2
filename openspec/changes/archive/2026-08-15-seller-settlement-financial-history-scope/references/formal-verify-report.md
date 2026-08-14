# Formal Verify Report

Date: 2026-08-15 (Asia/Shanghai)

Implementation SHA: `4649a35084b150da5eea042a98d7740e738d1c3d`

## Completeness

- Tasks: 9/9 complete.
- Requirements: 4/4 matched to implementation and executed evidence.
- Scenarios: 7/7 matched to implementation and executed evidence.

## Correctness evidence

- Migrated-D1 Seller Portal HTTP tests prove that OWNER summary, payable list/detail and organization payment reads preserve disabled-Store historical settlement facts.
- The same HTTP suite proves that FINANCE remains limited to assigned active Stores, cannot read disabled-Store payables or organization payments, and does not regain general Store access through a stale assignment.
- Seller Web behavior tests prove that OWNER and FINANCE receive distinct scope copy and that changing the current Store selector does not add `store_id` to settlement requests.
- The settlement read model, formulas, contracts, migrations and write authorization are unchanged.

## Executed gates

- Focused Vitest: 3 files, 29/29 tests passed.
- `@ygb/api` typecheck passed.
- `@ygb/web` typecheck passed.
- Strict OpenSpec validation: 69/69 items passed.
- Fixed-range `git diff --check` passed.

## Boundary

This verification is repository-local. It does not claim staging, production, Cloudflare resource or real-data acceptance.

## Verdict

PASS. The implementation is complete and coherent for sync/archive and a final independent fixed-SHA review.
