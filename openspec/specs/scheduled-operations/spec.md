# scheduled-operations Specification

## Purpose

Provide a single, bounded and auditable Worker background-operation loop for
small-scale operations without exposing business payloads or relying on an
external scheduler as the source of truth.

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

Signal ingestion SHALL accept only opaque 64-character lowercase hexadecimal observation IDs, fixed signal/summary enums, fixed job names, breach/healthy state, UTC-millisecond timestamps and non-negative integer counts. Category and severity SHALL be derived from the following server-owned policies:

| Signal | Opening threshold | Cooldown | Severity |
| --- | --- | --- | --- |
| Worker 5xx | 3 failures in 5 minutes | 30 minutes | Critical |
| Job stale | no success for 6 hours | 60 minutes | Warning |
| Stuck lease | 5 minutes past lease expiry | 60 minutes | Critical |
| Sustained backlog | 3 breached evaluations in 30 minutes | 60 minutes | Warning |
| File failure | 3 failures in 30 minutes | 60 minutes | Warning |
| Login anomaly | 5 failures in 10 minutes | 30 minutes | Critical |
| Primary alert sink failure | 1 failure in 5 minutes | 30 minutes | Critical |
| Future Feishu adapter failure | 3 failures in 15 minutes | 60 minutes | Warning |

Every signal SHALL resolve after two consecutive healthy evaluations. Duplicate observation IDs SHALL NOT advance thresholds or resend notifications; a resolved problem MAY open a new incident when it breaches again. Alert delivery failure SHALL NOT fail the originating request or job and SHALL create only the fixed primary-sink-failure signal without recursively invoking the failed sink.

Staff authentication rejection, replay, rate-limit and invalid-session facts SHALL enter the login-anomaly policy through an opaque hash of the existing security-event id. Successful authentication SHALL NOT emit an anomaly. The operational signal SHALL NOT contain a login identifier, network address, token, password, User-Agent, Provider subject or raw error. Provider delivery failure SHALL use the fixed future-Feishu-adapter signal instead of a dynamic error label.

The primary alert adapter SHALL default to disabled and SHALL support only an explicit local adapter or injected local mock in this Change. Unknown modes and an adapter supplied while disabled SHALL fail configuration validation. No mode in this Change SHALL accept external credentials or perform an external network call.

#### Scenario: Job becomes stale

- **WHEN** a required job has no success within its approved threshold
- **THEN** an alert is emitted through a channel that does not depend solely on the failing integration.

#### Scenario: Staff reads job health

- **WHEN** an authorized Staff requests operations health
- **THEN** the API returns safe job and alert aggregate facts with UTC-millisecond truth and the `Asia/Shanghai` display convention, without Secrets or row payloads.

#### Scenario: Authentication attempt is rejected

- **WHEN** the existing Staff authentication boundary persists a rejected, blocked or invalid-session security event
- **THEN** one idempotent login-anomaly observation is evaluated using only the security-event id hash, fixed enums, timestamp and count.

#### Scenario: Authentication succeeds normally

- **WHEN** a Staff login completes successfully without a rejection security event
- **THEN** no login-anomaly observation is created.

#### Scenario: Repeated evaluator delivery

- **WHEN** the same evaluator observation is delivered more than once
- **THEN** one durable evaluation advances the alert state and subsequent deliveries neither increment its counters nor send another notification.

#### Scenario: Signal recovers and later recurs

- **WHEN** an open or acknowledged signal has two consecutive healthy evaluations and later reaches its threshold again
- **THEN** the original incident is resolved and the later breach opens a new incident version subject to the fixed notification cooldown.

#### Scenario: Primary alerting is locally disabled

- **WHEN** no alert mode is configured or the mode is explicitly disabled
- **THEN** alert state continues to persist without notification delivery or external access.

### Requirement: Alert acknowledgement is a controlled Staff command

The system SHALL allow only an ACTIVE Staff actor with effective `SCHEDULED_OPERATIONS_RUN` to acknowledge the exact current OPEN incident. The command SHALL require an Idempotency-Key and request hash, SHALL conditionally update the incident version, and SHALL write only fixed signal, job, incident, status, actor, request and idempotency audit facts.

#### Scenario: Operator acknowledges an open incident twice

- **WHEN** the same authorized Staff repeats the same acknowledgement with the same Idempotency-Key and request body
- **THEN** the alert changes to ACKNOWLEDGED once and the committed safe result is replayed.

#### Scenario: Acknowledgement target is stale or resolved

- **WHEN** the referenced incident version is not the current OPEN incident
- **THEN** no alert state is changed and the command returns a safe not-found or state-conflict result.

### Requirement: Scheduled operations have explicit kill switches and forward recovery

The system SHALL support global and per-job disable controls, SHALL stop acquiring new leases when disabled, and SHALL recover erroneous effects only through the affected domain's replay, compensation or correction rules rather than direct data overwrite.

#### Scenario: Job is disabled

- **WHEN** an operator disables one registered job
- **THEN** new scheduled deliveries skip it while unrelated jobs continue.

#### Scenario: Valid effects already committed

- **WHEN** a job is rolled back after committing valid immutable facts
- **THEN** those facts remain and any correction follows the domain's auditable forward-recovery workflow.

### Requirement: Manual commands and dead-letter replay are controlled recovery paths

The system SHALL require an ACTIVE Staff actor with `SCHEDULED_OPERATIONS_RUN` for manual job execution and Outbox dead-letter replay, SHALL enforce the same global, per-job and hard-disable controls as scheduled execution, and SHALL make each command idempotent by Staff, key and request hash. Replay SHALL reference one fixed dead-letter id and matching event id without accepting or returning an event payload.

#### Scenario: Operator double-clicks a recovery command

- **WHEN** two identical manual commands use the same Staff identity and Idempotency-Key
- **THEN** only one command performs an effective side effect and the committed safe result is replayed.

#### Scenario: A dead-letter event is approved for retry

- **WHEN** an authorized operator references an existing quarantined Outbox dead-letter and its exact unsent event id
- **THEN** one versioned replay lease resets that event to a bounded retry state and records only low-cardinality command, actor, reason and result facts.

#### Scenario: A recovery target is concealed or disabled

- **WHEN** the dead letter is missing, already handled, mismatched or already sent, or the applicable kill switch is disabled
- **THEN** no event is requeued or delivered and the API returns the safe not-found, in-progress or disabled contract as applicable.
