# Seller Principal Rate Production Bootstrap Preflight

## ADDED Requirements

### Requirement: initialization reuses the controlled Staff policy workflow

Seller-principal default initialization MUST use the existing trusted Staff Web/API submit and Owner-confirm workflow with Idempotency-Key, request hash, expected version, permission, Personal DENY, Data Scope, Audit, Outbox and transaction assertions. It MUST NOT provide direct production SQL, a bypass actor or an automatic remote write path.

The Staff read boundary MUST allow a GLOBAL Owner to read the JPY→CNY default policy, pending row and next version without a Seller Organization. It MUST return nullable organization/override fields in that mode. Organization-specific reads and writes MUST still require an authorized ACTIVE Seller Organization, and Seller Ops MUST NOT gain global/default authority.

#### Scenario: production has no default policy row

- **WHEN** the restored snapshot contains no JPY→CNY currency-pair default policy
- **THEN** preflight reports a `SUBMIT_AND_OWNER_CONFIRM` plan with expected version/event/audit/outbox/idempotency deltas and performs no mutation

#### Scenario: organization master data is not ready

- **WHEN** no seller-organization override can yet be configured
- **THEN** a GLOBAL Owner can read and submit the default policy independently, while preflight and Staff UI neither create nor import organizations, Stores or overrides

#### Scenario: Seller Ops omits organization scope

- **WHEN** an assigned Seller Ops actor calls the default-only read or attempts a default write without an organization
- **THEN** the backend returns 403 and creates no policy, event, Audit, Outbox or idempotency fact

### Requirement: preflight is local, read-only and fail closed

Snapshot preflight MUST open only an explicitly supplied local SQLite file in read-only query-only mode, MUST require schema 43 and clean integrity/FK results, and MUST expose no apply, remote, deploy or mutation mode. Template inspection MUST prove staging and production keep enforcement explicitly disabled.

#### Scenario: preflight is repeated

- **WHEN** the same snapshot is inspected multiple times
- **THEN** the database bytes and facts remain unchanged and every output reports zero external calls, database writes, policy mutations, deployments and resource mutations

#### Scenario: schema or configuration authority is missing

- **WHEN** schema is not exactly the explicit expected version, the local file is invalid, or enforcement is absent/true
- **THEN** preflight returns a blocked result before any policy action is recommended

### Requirement: unset, explicit zero and correct default remain distinct

The classifier MUST distinguish no policy row, an explicit zero policy and the frozen JPY→CNY `+0.004` default. It MUST not assume version 1, and an explicit zero MUST remain a present value rather than an unset fallback.

#### Scenario: explicit zero exists

- **WHEN** the current default or an organization override stores `markup_rate_value=0`
- **THEN** preflight counts it as an existing policy fact and does not report it as the required `+0.004` default

#### Scenario: correct future policy is already confirmed

- **WHEN** a confirmed `+0.004` default exists with an effective time after `as_of`
- **THEN** preflight reports `WAIT_FOR_EFFECTIVE_BOUNDARY` with zero expected row mutations

### Requirement: policy facts conserve event, audit, outbox and idempotency rows

For every policy version, preflight MUST derive the exact required submitted and decision events and require exactly one matching Audit, Outbox and committed idempotency record per event. Missing, duplicate, orphan or mismatched facts MUST block activation.

#### Scenario: clean new default workflow

- **WHEN** no default or pending row exists
- **THEN** the plan predicts one new policy version and two submitted/confirmed event, Audit, Outbox and committed-idempotency facts

#### Scenario: an audit fact is missing

- **WHEN** a policy event has no exact matching immutable Audit fact
- **THEN** `fact_graph_anomalies` is nonzero and preflight returns `BLOCKED_MANUAL_REVIEW`

### Requirement: pending state and concurrency remain bounded

Preflight MUST classify a correct future pending row as an Owner-confirm action, MUST block stale/wrong/duplicate pending rows for manual review, and MUST rely on the existing database uniqueness and expected-version controls so concurrent submissions cannot create two pending winners.

#### Scenario: correct pending row already exists

- **WHEN** exactly one future pending default stores `400000/100000000`
- **THEN** preflight predicts zero new versions and one additional confirmed event/Audit/Outbox/committed-idempotency fact

#### Scenario: two writers race

- **WHEN** two authorized commands submit the same default target concurrently
- **THEN** exactly one pending version is created and the other command receives a stable conflict

### Requirement: enablement requires exact order-date authority

Enablement preflight MUST require the correct default to be currently effective and at least one explicit platform order business date to resolve to a confirmed exact-date JPY→CNY rate as of the supplied time. It MUST NOT use a nearby date or enable the switch.

#### Scenario: exact-date rate is missing

- **WHEN** one requested smoke order date has no confirmed exact-date JPY→CNY rate
- **THEN** enablement remains blocked and no formal order or financial fact is created

#### Scenario: local enablement evidence is complete

- **WHEN** schema/fact conservation pass, the `+0.004` default is effective, each requested exact date resolves and enforcement is still false
- **THEN** preflight reports `LOCAL_READY_PRODUCTION_BLOCKED`; a separate production authorization is still required to change configuration or run smoke

### Requirement: historical and financial boundaries remain unchanged

This Change MUST NOT recalculate historical orders, seller principal, Buyer refund, service fee, refund, settlement or existing snapshots. Rollback MUST keep immutable policy/event/snapshot facts and use switch disablement plus future corrective policy versions.

#### Scenario: activation is stopped after confirmation

- **WHEN** a default version has been confirmed but enforcement has not been approved
- **THEN** the switch remains false, the confirmed version remains immutable, history is unchanged and no destructive rollback runs
