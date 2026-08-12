# Security Command Integrity Delta

## ADDED Requirements

### Requirement: Acquisition machine credential lifecycle is atomic and replay-safe

Machine credential create and revoke SHALL require an Idempotency-Key and canonical complete-request hash, SHALL commit mutation, immutable Audit, required Outbox, idempotency completion and final assertions in one D1 batch, and SHALL mark failed claims retryable after a failed batch. Revoke SHALL atomically remove all rate buckets and SHALL preserve existing scope concealment semantics.

#### Scenario: Create response is lost

- **WHEN** an authorized owner retries the same create key with the same normalized body after the credential committed
- **THEN** the system identifies the original credential, creates no second ACTIVE credential, returns no plaintext secret on replay, and reports that the one-time secret is unavailable.

#### Scenario: Create key is reused with a different body

- **WHEN** the same owner reuses a create key with a different accepted semantic body
- **THEN** the system returns `IDEMPOTENCY_CONFLICT` and creates no credential, scope, Audit or Outbox fact.

#### Scenario: Revoke is retried

- **WHEN** an authorized owner repeats the same revoke key and body after commit
- **THEN** the system replays the original revoked result, leaves zero rate buckets for the credential and appends no duplicate Audit or Outbox fact.

### Requirement: Acquisition writes use guarded shared commands

Prospect update and signal, assignment revoke and source correction SHALL use the shared command claim, canonical complete-body hash, guarded or unique mutation, exact-one assertion, Audit, required Outbox, completion and final assertion boundary. Unknown D1 errors SHALL remain dependency failures and SHALL NOT be translated into business conflicts.

Machine Prospect signal and analysis routes SHALL require Bearer authentication and `Idempotency-Key`, construct the CODEX command context from the authenticated machine, and enforce the same atomic command boundary. Resource-level machine or Staff marketplace/channel/scope denial SHALL be indistinguishable from a random id as 404. A missing global Staff capability SHALL remain a pre-query 403.

#### Scenario: Prospect update loses an OCC race

- **WHEN** another command wins the submitted Prospect expected version before the guarded batch commits
- **THEN** the losing batch rolls back and returns `VERSION_CONFLICT` without reading or reporting the winner's state as its own success.

#### Scenario: Prospect signal is replayed or conflicts

- **WHEN** the same signal key and normalized body is retried
- **THEN** the original signal is replayed with no duplicate fact; when the body differs, the system returns `IDEMPOTENCY_CONFLICT`.

#### Scenario: Machine Prospect analysis loses a controlled race

- **WHEN** two Bearer-authenticated machine commands read the same expected Prospect version and are released to commit concurrently
- **THEN** exactly one guarded batch commits and the loser returns `VERSION_CONFLICT` without returning the winner's state or leaving Audit, Outbox or committed-command ghosts.

#### Scenario: A scoped resource id is probed

- **WHEN** a machine or marketplace-scoped Staff principal submits either a real out-of-scope id or a random id
- **THEN** status, public error code and public message are the same 404 response.

#### Scenario: Source corrections race at one sequence

- **WHEN** two commands submit the same `expected_correction_sequence` for one Lead
- **THEN** exactly one correction commits and the other returns `VERSION_CONFLICT` without Audit, Outbox or committed-idempotency residue.
