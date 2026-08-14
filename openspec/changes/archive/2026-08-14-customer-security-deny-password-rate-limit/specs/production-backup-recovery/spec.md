# production-backup-recovery Delta

## MODIFIED Requirements

### Requirement: Production D1 backup is release-bound and current-schema recoverable

The process SHALL verify the production release SHA and a continuous `0001`–`0068` migration chain, SHALL create an encrypted D1 backup and authenticated manifest bound to that release, and SHALL restore into a fresh isolated target without overwriting an existing database.

#### Scenario: Production D1 backup restores

- **WHEN** the candidate backup is restored into a new isolated database
- **THEN** `app_schema_state.schema_version=68`, full schema inventory, table row counts, `integrity_check`, `foreign_key_check`, key financial aggregates, and Staff/Buyer/Seller/order/file/scheduler/acquisition smoke reads match the backup evidence.

#### Scenario: Schema evidence is stale

- **WHEN** the newest successful recovery evidence has a schema version lower than the candidate schema
- **THEN** the candidate is not ready for production even if an older backup previously restored successfully.

### Requirement: Recovery proof is immutable and belongs to the running release

After a real isolated D1 restore and R2 sample read-back pass, the owner-controlled process SHALL append a `production_recovery_attestations` row containing release SHA, schema version, D1 manifest SHA-256, R2 manifest SHA-256, integrity/FK pass facts, R2 sample pass fact, verification time, and evidence note.

#### Scenario: Readiness checks recovery

- **WHEN** `/ready` evaluates the running Schema 68 release
- **THEN** recovery passes only when an attestation exists with `schema_version=68` and `release_sha=APP_RELEASE_SHA`; older schema or another release SHA is insufficient.

### Requirement: Operational readiness is stronger than liveness

`/health` MAY prove only that the Worker process responds. `/ready` SHALL fail unless database schema, required scheduled jobs, acquisition maintenance, object storage, Cloudflare Access configuration, running release identity, and current-release recovery evidence are all ready.

#### Scenario: Worker is alive but scheduler is stale

- **WHEN** `/health` returns 200 but a required scheduled job has never succeeded, is stale/failed, or has excessive backlog
- **THEN** `/ready` returns not-ready and Production GO is blocked.

#### Scenario: Recovery belongs to another release

- **WHEN** Schema 68 is current but the latest recovery attestation release SHA differs from `APP_RELEASE_SHA`
- **THEN** `/ready` returns not-ready.
