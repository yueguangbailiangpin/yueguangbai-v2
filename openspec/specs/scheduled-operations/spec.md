# scheduled-operations Specification

## Purpose
TBD - created by archiving change scheduled-operations-observability. Update Purpose after archive.
## Requirements
### Requirement: One bounded Scheduled Handler drives registered background jobs

The system SHALL expose one Worker Scheduled Handler that invokes only fixed registered jobs, SHALL apply per-job enablement, batch and time budgets, and SHALL continue incomplete work from a persisted cursor without creating a second business-rule implementation.

#### Scenario: Due batch completes

- **WHEN** the Scheduler fires and a registered job has due rows within its budget
- **THEN** it processes a bounded batch through the existing Application Service and records a successful run summary.

#### Scenario: Time budget is reached

- **WHEN** due work remains after the job budget is exhausted
- **THEN** the job persists a safe continuation cursor and the next scheduled run resumes without skipping or duplicating formal effects.

### Requirement: Job leases and business idempotency resist duplicate execution

The system SHALL acquire versioned expiring D1 leases before scanning a job, SHALL permit only one active lease per job, and SHALL retain each business command's existing idempotency, version and unique guards as the final duplicate-effect protection.

#### Scenario: Concurrent scheduled deliveries

- **WHEN** two Scheduled Handler invocations race for the same job
- **THEN** only one acquires the lease and the other records or returns a non-error skipped result.

#### Scenario: Worker crashes with a lease

- **WHEN** a run terminates before releasing its lease
- **THEN** no other runner takes it before expiry and a later runner safely recovers it after expiry.

### Requirement: Required lifecycle jobs progress automatically

The system SHALL schedule reservation/instruction expiry, integration Outbox delivery, file compensation/orphan cleanup and authentication ephemeral cleanup, and SHALL provide registered extension points for approved Drive archive and Feishu jobs.

#### Scenario: Expired business hold

- **WHEN** a reservation or instruction passes its authoritative deadline
- **THEN** the corresponding existing expiry command runs automatically with audit and capacity restoration semantics.

#### Scenario: Cleanup candidate is not eligible

- **WHEN** a row is newer than retention, actively leased, linked, or otherwise protected
- **THEN** the cleanup job leaves it unchanged.

### Requirement: Operations are observable without leaking business data

The system SHALL expose privacy-safe job health including last start/success/failure, backlog, counts and failure categories, SHALL alert on stale success, stuck lease, sustained backlog and repeated dependency failure, and SHALL NOT include raw customer, file, token or financial payloads.

#### Scenario: Job becomes stale

- **WHEN** a required job has no success within its approved threshold
- **THEN** an alert is emitted through a channel that does not depend solely on the failing integration.

#### Scenario: Staff reads job health

- **WHEN** an authorized Staff requests operations health
- **THEN** the API returns safe aggregate facts and request IDs without Secrets or row payloads.

### Requirement: Scheduled operations have explicit kill switches and forward recovery

The system SHALL support global and per-job disable controls, SHALL stop acquiring new leases when disabled, and SHALL recover erroneous effects only through the affected domain's replay, compensation or correction rules rather than direct data overwrite.

#### Scenario: Job is disabled

- **WHEN** an operator disables one registered job
- **THEN** new scheduled deliveries skip it while unrelated jobs continue.

#### Scenario: Valid effects already committed

- **WHEN** a job is rolled back after committing valid immutable facts
- **THEN** those facts remain and any correction follows the domain's auditable forward-recovery workflow.

