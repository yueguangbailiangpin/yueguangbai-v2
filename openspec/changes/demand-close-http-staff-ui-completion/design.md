# Design: demand-close-http-staff-ui-completion

## 1. Formal HTTP contract

Register one route in the existing Staff catalog/workflow route group:

`POST /api/staff/demand-batches/:id/close`

The handler will require an active `staffAuthorization` context, reject
unknown JSON fields, require a positive integer `expected_version`, require a
non-empty bounded `close_reason`, and require a valid `Idempotency-Key`.
The response is the standard `apiSuccess` envelope containing:

```json
{
  "demand_close": {
    "demand_batch_id": "...",
    "status": "CLOSED",
    "version": 3,
    "close_reason": "...",
    "replayed": false
  }
}
```

Existing `withStaffWorkflowErrors` mapping remains the public error boundary:
unauthenticated is 401, permission failure is 403, concealed resource or
assignment failure is 404, validation/state/version/idempotency conflicts are
their current 400/409 codes, and no internal staff or database details are
returned.

## 2. Authoritative close command

The command keeps its current initial permission guard and request hash, then
uses the following order inside the claimed idempotency attempt:

1. Reread the demand row and require the authoritative Seller Organization,
   Store, Product, status, and version.
2. Require the `DEMAND_REVIEW` work item for the demand, allowing the normal
   `COMPLETED` item left by publication. Re-resolve the active Staff record,
   exactly one canonical role, effective permissions, and Personal DENY from
   D1. For an open item, the same transaction closes it; an already completed
   item produces no duplicate completion event.
3. Reapply the hard gate (`owner` or `seller_ops` plus
   `DEMAND_PUBLISH`) and the authoritative Seller Organization scope. A
   non-owner with stale work-item organization metadata receives concealed
   404; an owner retains GLOBAL behavior. Store and marketplace scope comes
   from the authoritative resource and assignment resolution, never from the
   client or stale work-item metadata.
4. Require exactly `PUBLISHED` and the supplied current version, then prepare
   the `CLOSED` update, `DEMAND_BATCH_CLOSED` event, audit, idempotency
   completion, work-item completion if needed, and transaction assertions.

The update remains guarded by both `status='PUBLISHED'` and the source version.
The guarded `UPDATE` MUST be followed immediately in the same D1 batch by an
`INSERT INTO transaction_assertions ... SELECT CASE WHEN changes()=1 THEN 1
ELSE 0 END` statement. A zero-row update therefore aborts the batch before the
event, audit, idempotency completion, or work-item statements run; the
transaction assertion error is normalized to the stable 409
`VERSION_CONFLICT`, and the claimed idempotency attempt is marked `FAILED`
after rollback. The close invariant must not use `close_reason` or a later
read as a substitute for the changed-row assertion.

An identical committed key/body returns the stored first response with
`replayed=true`; a changed body under the key, in-progress claim, concurrent
version race, stale expected version, missing reason, or non-published source
keeps its stable current failure behavior without duplicate business side
effects.

## 2.1 Demo contract parity

The review Demo's direct state resolver mirrors the formal close boundary only
for the Demo fixture: it requires the same two body fields, rejects unknown
fields and missing/invalid `Idempotency-Key`, normalizes and validates the
reason, checks the expected version, and stores the first successful response
under the key. The same normalized key/body replays the stored response with
`replayed=true`; a changed body returns `IDEMPOTENCY_CONFLICT` without changing
the Demo state. Demo authorization is an effective-permission projection for
the fixture, not a client-only role check: only `owner`/`seller_ops` with
effective `DEMAND_PUBLISH` may close, and the test fixture can exercise a
missing permission or Personal DENY. The Demo response contains no permission,
role, assignment, or other internal authorization fields.

## 3. Read-model capability projection

The existing reservation schedule page remains the Staff entry point. Its
demand projection will add only authoritative, bounded fields:

- `status`: the current demand status;
- `can_close`: true only when the backend can resolve the current active
  Staff actor, effective `DEMAND_PUBLISH`, the owner/seller-ops hard gate,
  Seller Organization scope, and the demand's open-or-completed
  `DEMAND_REVIEW` assignment boundary, and the demand is `PUBLISHED`.

The read path must fail closed for the capability hint without widening page
visibility. The close POST remains the final authority and repeats all checks.
No internal staff id, role set, assignment metadata, or buyer private data is
added to the DTO.

## 4. Staff UI behavior

`ReservationScheduleDetail` will render a compact “关闭需求” card only when
`page.demand.status === 'PUBLISHED' && page.demand.can_close`. It will ask for
Chinese confirmation, require a trimmed close reason, show the current
version, and disable controls while submitting. The form is placed alongside
the existing schedule controls and does not change the three-portal visual
system.

The form uses `StaffMutationAuthority` with the exact path/body/key retained
for an ambiguous network or contract result. It never silently creates a new
key for an unchanged request, and changing the reason releases the retained
request. On success it invalidates the reservation schedule, product detail,
product list, and Staff work-item roots so the closed status and any completed
work item are reflected. Error rendering uses the existing safe request-id
and error-code pattern.

## 5. Verification and boundary

Tests will exercise the command and route with the existing SQLite test
database and mocked Staff page. The current endpoint inventory will be
updated only after the runtime `app.routes` and
`npm run verify:api-contract` derive the new total. No schema or migration
files change. Focused tests run before the implementation to record the
current missing route and missing UI entry, plus the same-version/same-reason
different-key race and Demo contract gaps, then focused and full gates run
with direct exit-code capture. The existing Change is updated with the
acceptance evidence; it is not archived as part of this work.
