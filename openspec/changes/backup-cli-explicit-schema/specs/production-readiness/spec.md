## MODIFIED Requirements

### Requirement: D1 backups are complete, hashed and restorable

The release process SHALL require an explicitly supplied positive integer expected schema for both backup creation and restore verification, SHALL produce an encrypted D1 backup with Schema inventory, row counts, critical financial aggregates, tool/version metadata and SHA-256 Manifest, SHALL authenticate a separate attestation bound to an explicitly supplied release commit, and SHALL prove restoration in an isolated database before Production GO. The backup and restore CLIs SHALL fail closed when expected schema is omitted or invalid and SHALL NOT infer it from a historical default or the repository migration tail.

#### Scenario: Backup and restore agree

- **WHEN** the candidate backup and isolated restore are invoked with the same explicitly approved expected schema and release commit
- **THEN** attestation, release commit, bundle, Manifest, schema, row, relationship and financial assertions agree and application smoke reads succeed.

#### Scenario: Expected schema is absent or invalid

- **WHEN** backup or restore omits `--expected-schema` or supplies a non-positive or non-integer value
- **THEN** the CLI fails before creating or restoring a backup and does not substitute schema 34 or any other default.

#### Scenario: Backup is incomplete or corrupt

- **WHEN** attestation authentication, release provenance, hash, explicit schema, row or financial assertions differ
- **THEN** the release is blocked and the backup is not marked usable.
