# Tasks: demand-close-http-staff-ui-completion

## 1. Change and failing evidence

- [x] 1.1 Confirm the current checkout and preserve all unrelated active
  Changes; keep this as the only new Change for Demand CLOSE wiring.
- [x] 1.2 Add a failing formal HTTP test proving the current route cannot
  close a published demand.
- [x] 1.3 Add a failing Staff UI test proving the current published demand
  detail has no close entry.
- [x] 1.4 Run both failing tests directly and record their exit codes/reasons.

## 2. Contracts and backend

- [x] 2.1 Add the strict close response DTO/runtime schema without sensitive
  fields and extend the schedule demand projection with `status` and
  backend-computed `can_close`.
- [x] 2.2 Harden `closeDemandBatch` with authoritative Staff re-resolution,
  DEMAND_REVIEW assignment/work-item boundary, Seller Organization/Store
  scope, and same-transaction work-item closure/assertions.
- [x] 2.3 Register the formal close route with exact body/query/header
  validation, standard success/failure envelopes, request id, and safe
  concealment.
- [x] 2.4 Add/extend command and HTTP tests for success, stable replay, key/body
  mismatch, concurrent/stale version, non-PUBLISHED, missing reason,
  unauthenticated, role enumeration, Personal DENY, scope/assignment mismatch,
  stale work-item organization metadata, cross-organization concealment, and
  DTO non-leakage.

## 3. Staff UI

- [x] 3.1 Add the close API client and strict response parsing.
- [x] 3.2 Add the published-and-authorized Chinese confirmation/reason form to
  the existing reservation schedule detail page.
- [x] 3.3 Use in-flight dedupe and exact ambiguous retry semantics; refresh the
  schedule/product/work-item views after success.
- [x] 3.4 Add UI tests for show/hide, role and status boundaries, submit,
  duplicate-click protection, exact retry, changed-input reset, error request
  id, and success refresh/status.

## 4. Current facts and validation

- [x] 4.1 Update only the direct current API inventory count/list after
  deriving the runtime route count; preserve historical 219/224/238/240
  meanings and no unrelated current-state prose.
- [x] 4.2 Run focused tests and all requested direct gates:
  `npm run typecheck`, `npm test`, `npm run build`, `npm run check`,
  `npm run db:verify`, `npm run verify:migration-guards`,
  `npm run verify:api-contract`, relevant source/static boundary checks,
  current/all OpenSpec strict validation, and `git diff --check`.
- [x] 4.3 Inspect the final diff and, only if all local gates are green, make
  one normal local atomic commit. Do not push, deploy, archive, or touch
  remote resources.
