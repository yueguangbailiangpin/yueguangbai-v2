# production-backup-recovery Specification

## Purpose

Prove that the current Moonwhite production candidate is recoverable as a complete business system, not merely that a Worker returns HTTP 200. Recovery evidence is release-bound, secret-separated, and covers the current D1 schema plus authoritative file storage.

## Requirements

### Requirement: Private backup evidence is secret-separated

The recovery process SHALL keep encryption/authentication keys separate from encrypted content and manifests, SHALL keep provider credentials out of Git/logs/evidence, and SHALL use only owner-controlled private storage with no link sharing.

#### Scenario: Secret or provider permission is unsafe
- **WHEN** a key file has unsafe permissions, a target artifact is link-shared, or credentials would be persisted in Git/logs
- **THEN** the process fails closed before accepting a backup.

### Requirement: Production D1 backup is release-bound and current-schema recoverable

The process SHALL verify the production release SHA and a continuous `0001`–`0064` migration chain, SHALL create an encrypted D1 backup and authenticated manifest bound to that release, and SHALL restore into a fresh isolated target without overwriting an existing database.

#### Scenario: Production D1 backup restores
- **WHEN** the candidate backup is restored into a new isolated database
- **THEN** `app_schema_state.schema_version=66`, full schema inventory, table row counts, `integrity_check`, `foreign_key_check`, key financial aggregates, and Staff/Buyer/Seller/order/file/scheduler/acquisition smoke reads match the backup evidence.

#### Scenario: Schema evidence is stale
- **WHEN** the newest successful recovery evidence has a schema version lower than the candidate schema
- **THEN** the candidate is not ready for production even if an older backup previously restored successfully.

### Requirement: R2 file authority is included in recovery evidence

The recovery process SHALL generate an R2 manifest reconciled with D1 file authority and SHALL perform bounded real read-back sampling against authoritative R2 objects without deleting or modifying them.

#### Scenario: R2 manifest and sample read-back pass
- **WHEN** D1 file authority reconciles with the R2 manifest and sampled objects match expected byte size, MIME, and SHA-256
- **THEN** the R2 portion may be marked recovered for that release.

#### Scenario: R2 mismatch exists
- **WHEN** any missing, orphan, duplicate, byte-size, MIME, SHA-256, or protected-reference mismatch is found
- **THEN** Production GO remains blocked and no R2 delete/proxy switch is enabled as a side effect.

### Requirement: Recovery proof is immutable and belongs to the running release

After a real isolated D1 restore and R2 sample read-back pass, the owner-controlled process SHALL append a `production_recovery_attestations` row containing release SHA, schema version, D1 manifest SHA-256, R2 manifest SHA-256, integrity/FK pass facts, R2 sample pass fact, verification time, and evidence note.

#### Scenario: Readiness checks recovery
- **WHEN** `/ready` evaluates the running Schema 66 release
- **THEN** recovery passes only when an attestation exists with `schema_version=66` and `release_sha=APP_RELEASE_SHA`; older schema or another release SHA is insufficient.

### Requirement: Operational readiness is stronger than liveness

`/health` MAY prove only that the Worker process responds. `/ready` SHALL fail unless database schema, required scheduled jobs, acquisition maintenance, object storage, Cloudflare Access configuration, running release identity, and current-release recovery evidence are all ready.

#### Scenario: Worker is alive but scheduler is stale
- **WHEN** `/health` returns 200 but a required scheduled job has never succeeded, is stale/failed, or has excessive backlog
- **THEN** `/ready` returns not-ready and Production GO is blocked.

#### Scenario: Recovery belongs to another release
- **WHEN** Schema 66 is current but the latest recovery attestation release SHA differs from `APP_RELEASE_SHA`
- **THEN** `/ready` returns not-ready.

### Requirement: Staff production authentication is Cloudflare Access

Production Staff login SHALL be gated by Cloudflare Access JWT verification and Moonwhite active Staff email/role/Marketplace authority. Legacy Feishu Staff Auth provider configuration SHALL NOT be required for the active login path.

#### Scenario: Access configuration is missing
- **WHEN** the production candidate lacks Access team domain, application audience, allowed origin, or still contains unresolved placeholder configuration
- **THEN** the release/readiness gate fails before production activation.

### Requirement: Scheduler and acquisition maintenance are release gates

The production candidate SHALL enable scheduled operations and acquisition maintenance, then prove successful runtime execution before final readiness.

#### Scenario: Scheduler switch is disabled
- **WHEN** `SCHEDULED_OPERATIONS_ENABLED` or `ACQUISITION_MAINTENANCE_ENABLED` is not true in the rendered production candidate
- **THEN** production release validation fails closed.

### Requirement: Local release validation does not silently probe production

Repository/static/migration/type/build/recovery-preparation checks SHALL remain local/offline. A real production `/ready` read SHALL be a separate explicit action.

#### Scenario: Local release check completes
- **WHEN** the local release command completes its repository gates
- **THEN** it reports external production readiness as unverified and performs zero production `/ready` calls.

#### Scenario: Owner explicitly probes production
- **WHEN** the explicit production readiness probe is invoked after deployment/activation approval
- **THEN** it performs a bounded HTTPS GET against the fixed `/ready` endpoint and requires all published readiness checks to be `ok`.

### Requirement: Provider PoC and OAuth tooling remain non-persistent and least-privilege

Drive/Provider acceptance tooling SHALL use generated anonymous fixtures, exact approved scope, PKCE where applicable, bounded responses, redacted receipts, and no persisted usable token.

#### Scenario: Scope silently expands
- **WHEN** a provider returns broader scope than approved
- **THEN** the acceptance flow fails without requesting or using broader authorization automatically.
