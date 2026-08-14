# scheduled-operations Specification Delta

## MODIFIED Requirements

### Requirement: Scheduled operations have explicit kill switches and forward recovery

The system SHALL support global and per-job disable controls plus an explicit `OUTBOX_DELIVERY_ENABLED` delivery control, SHALL stop acquiring new leases when a relevant control is disabled, and SHALL recover erroneous effects only through the affected domain's replay, compensation or correction rules rather than direct data overwrite. `OUTBOX_DELIVERY_ENABLED` SHALL default to `false` in every checked-in environment template and SHALL not change transaction-time Outbox writes.

#### Scenario: Job is disabled

- **WHEN** an operator disables one registered job
- **THEN** new scheduled deliveries skip it while unrelated jobs continue.

#### Scenario: Outbox delivery is governed off

- **WHEN** `OUTBOX_DELIVERY_ENABLED=false` and a due Outbox event exists
- **THEN** scheduled and manual delivery skip before event claim or delivery, and do not write an Outbox failure attempt, dead letter, or delivery job-run fact.

#### Scenario: Delivery is intentionally deferred in readiness

- **WHEN** `OUTBOX_DELIVERY_ENABLED=false`
- **THEN** `/ready` retains the `outbox_delivery` check with status `not_required` while unrelated required checks retain their existing truth conditions.

#### Scenario: Valid effects already committed

- **WHEN** a job is rolled back after committing valid immutable facts
- **THEN** those facts remain and any correction follows the domain's auditable forward-recovery workflow.
