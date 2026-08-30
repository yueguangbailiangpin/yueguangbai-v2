# Demand Close HTTP and Staff UI Specification

## ADDED Requirements

### Requirement: Published demand close has a formal Staff route

The system MUST expose `POST /api/staff/demand-batches/:id/close`. The route
MUST require an active Staff session, a valid `Idempotency-Key`, a positive
`expected_version`, and a non-empty bounded `close_reason`; it MUST reject
unknown fields and malformed input using the existing API failure envelope.
The successful DTO MUST contain only `demand_batch_id`, `status='CLOSED'`,
`version`, `close_reason`, and `replayed`, under the `demand_close` key.

#### Scenario: Authorized Staff closes a published demand

- **WHEN** an active `owner` or `seller_ops` Staff actor with effective
  `DEMAND_PUBLISH` submits the current version and a valid reason for a
  `PUBLISHED` demand
- **THEN** the route returns 200 with `demand_close.status='CLOSED'`, the
  demand version increments exactly once, and the buyer public projection no
  longer exposes the demand.

#### Scenario: Missing reason is rejected before mutation

- **WHEN** the close body omits or supplies an empty/invalid `close_reason`
- **THEN** the route returns `400 VALIDATION_ERROR` and the demand, event,
  audit, work item, and committed idempotency state are unchanged.

### Requirement: Close authorization follows the authoritative Staff boundary

The close command MUST reread the active Staff record, exactly one canonical
Staff role, effective permissions including Personal DENY, the authoritative
Seller Organization/Store resource, and the `DEMAND_REVIEW` fixed work-item
assignment before writing. Only `owner` and `seller_ops` with effective
`DEMAND_PUBLISH` may close. `pre_sales`, `buyer_refund`, and any role that is
only client-asserted MUST fail closed. Non-owner organization, marketplace,
assignment, or stale work-item metadata mismatches MUST be concealed as 404
without business writes; the owner GLOBAL path MUST not weaken the resource
state or version checks.

#### Scenario: Personal DENY and role enumeration remain blocked

- **WHEN** a Staff session has a Personal DENY for `DEMAND_PUBLISH`, or the
  caller changes its displayed role to `pre_sales` or `buyer_refund`
- **THEN** the operation returns the existing forbidden/concealed failure and
  does not reveal whether the target demand is closable.

#### Scenario: Stale assignment metadata has no write authority

- **WHEN** a non-owner's demand review work item carries a seller organization
  different from the authoritative demand organization
- **THEN** the close operation returns concealed 404 and leaves the demand,
  event, audit, work item, and idempotency business result unchanged.

### Requirement: Close is a replay-safe state transition

The close operation MUST allow only `PUBLISHED -> CLOSED` and MUST guard the
update with the authoritative status and expected version. It MUST persist the
business update, `DEMAND_BATCH_CLOSED` event, audit event, any needed
`DEMAND_REVIEW` work-item completion, idempotency completion, and transaction
assertions consistently. The same actor/action/key/body MUST return the exact
first committed result with `replayed=true`; a different body under the same
key MUST return `IDEMPOTENCY_CONFLICT`, and concurrent or stale version races
MUST return the existing stable conflict without duplicate side effects.

#### Scenario: Identical replay is stable

- **WHEN** the same close path, key, expected version, and reason are submitted
  again after a committed close
- **THEN** the route returns the original closed result with `replayed=true`
  and creates no second event, audit, version increment, or work-item event.

#### Scenario: Non-published and stale versions fail safely

- **WHEN** the demand is not `PUBLISHED`, or another request has advanced its
  version before the close
- **THEN** the route returns the existing 409 state/version conflict and does
  not perform a partial close.

### Requirement: Staff scheduling detail exposes a real close entry

The existing Staff reservation-schedule DTO MUST expose only backend-derived
`status` and `can_close` fields for the demand close entry. The UI MUST show
the close form only when the demand is `PUBLISHED` and `can_close` is true;
it MUST NOT infer closability from a client role/permission list alone. The
form MUST use Chinese confirmation/reason text, require a non-empty reason,
disable duplicate in-flight submits, and show safe error code/request-id
feedback.

#### Scenario: Unauthorized or non-published demands have no close control

- **WHEN** a page is read by a non-eligible Staff role, a denied actor, an
  out-of-scope actor, or a demand whose status is not `PUBLISHED`
- **THEN** the schedule page contains no close form or close submit control.

#### Scenario: Ambiguous close retries the exact original request

- **WHEN** the first close request has an ambiguous network/contract result
  and the operator clicks retry without changing the reason
- **THEN** the UI retries the exact same path, body, and idempotency key; a
  changed reason releases the old retry and creates a new action identity.

#### Scenario: Successful close refreshes the Staff view

- **WHEN** the close request succeeds
- **THEN** the UI shows the closed result, refreshes the schedule and product
  detail projections, removes the close entry, and refreshes any affected
  Staff work-item view without a full visual redesign.

### Requirement: Close DTOs preserve concealment and privacy

The close response, schedule capability projection, and public failures MUST
not expose internal staff ids, role sets, assignment metadata, database
details, buyer private data, or unrelated demand fields. The strict runtime
schemas MUST reject unknown fields and sensitive leakage.

#### Scenario: Strict DTO rejects internal fields

- **WHEN** a close response or schedule demand projection contains an
  undeclared internal id, assignment, note, or storage field
- **THEN** the runtime contract test rejects the payload and the UI treats it
  as a malformed response rather than rendering the field.
