# Formal Verify Report

Verified at the M5 head before archive. Ponytail remained off.

| Requirement group | Implementation evidence | Verification evidence | Result |
| --- | --- | --- | --- |
| Independent ACTIVE Staff session | Existing Staff route guard and D1 authorization are unchanged; the Web consumes only the Staff identity client | Full Staff auth/session, inactive/version and route-guard suites in `npm run check` | PASS |
| Permission, Personal DENY, hard deny, scope and concealed 404 | Existing domain authorization remains the only authority; the workbench never sends actor/role/scope fields | Assignment, finance, file, order-evidence and refund authorization suites; concealed-detail MSW test | PASS |
| Stable scoped queue | Filter-bound opaque `(created_at,id)` cursor, exact query parsing, limit+1 projection | Pagination unit tests cover stable traversal, tampering and filter mismatch | PASS |
| Strict DTO boundary | Strict Zod schemas cover queue, details, mutations, integer strings and safe file references | Runtime-schema tests reject unknown secret fields and floating/invalid money | PASS |
| Order/review controlled decisions | Existing versioned/idempotent endpoints only; submitter action bug fixed | Browser verifies exact request body/key and visible version-conflict request ID; existing replay/hash/state suites pass | PASS |
| Invitation/recovery | Existing issue/read/revoke/reset endpoints, one-time link kept only in component memory and explicitly hideable | Existing customer-security suite plus full browser pass | PASS |
| Buyer refund | Existing payment/reversal commands, verified proof upload/read, CNY strings and Beijing time | Existing ledger rollback/replay/scope/file suites and Web regressions pass | PASS |
| Seller settlement | Existing payment/allocation/reversal commands; Staff-only additive safe proof; principal/service fee separate | Seller ledger/authorization/proof suites plus Staff MSW separation test pass | PASS |
| Protected files | Generic purpose/audience Staff reader; no object key, arbitrary URL or permanent token projection | File architecture, dynamic audience and R2 boundary suites pass | PASS |
| Partial failure and accessibility | Independent queries/errors/retries/request IDs; desktop three-pane and narrow source order | 141/141 Playwright tests, including 320/390px, keyboard, 200% and reduced motion | PASS |
| Migration and rollback | No schema gap; no Migration created; deployment rollback never reverses facts | Fresh schema 30, sequential 0001→0030, integrity/foreign keys/migration guards all pass | PASS |
| Compatibility and dependency baseline | Additive contracts/routes; Buyer/Seller behavior unchanged | `npm run check`: 156 files/1058 tests; React Router 7.18.2 baseline remains exactly two documented high advisories | PASS WITH DOCUMENTED EXCEPTION |

## Independent review remediation

- Staff writes now use a shared mutation authority bound to stable serialization of exact `action + path + body`.
- Only explicit retry after an ambiguous network/contract outcome reuses the frozen key and cloned body.
- Deterministic 4xx/conflicts release authority; editing a body or choosing another action/path starts a new logical operation and key.
- Unit tests cover ambiguous replay, deterministic failure, changed bodies and separation across payment/reversal/allocation. The 141-test Playwright suite covers the real order-confirmation retry and changed-body journey.

## Visual review

The two representative final-state screenshots below remain in the current tree. See `openspec/changes/archive/VISUAL_EVIDENCE_RETENTION.md` for the repository-wide archived-binary policy.

- `staff-workbench-desktop-1600x1000.png`: queue, authoritative detail, customer/internal/sensitive separation and customer-security tools are legible with no clipping.
- `staff-workbench-narrow-390x844.png`: source order is queue → detail → tools, controls remain reachable, and no horizontal page overflow is present.

## Truthful capability boundary

The baseline Staff order-evidence and Buyer-refund contracts remain JP-shaped. M5 preserves those authoritative fields and does not fabricate USD/KRW order operations. Marketplace-independent Seller settlement stays CNY; Amazon US context is shown only when returned by an existing generic fact. Korea remains disabled/unavailable.
