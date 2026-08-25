## ADDED Requirements

### Requirement: Cold archive production preparation is locally fail-closed

The repository SHALL provide a machine-executable Google Drive cold-archive preflight that reads only explicitly supplied, private, repository-external local evidence. It SHALL make zero network, Provider, D1, R2, deployment, Secret, or resource-mutating calls. Missing, malformed, in-repository, non-private, or contradictory evidence SHALL produce a blocking outcome without exposing evidence values.

#### Scenario: Configuration is absent

- **WHEN** an operator runs the preflight without an external rendered configuration and evidence files
- **THEN** it returns `LOCAL_NO_GO`, reports zero external calls and preserves every capability as unapproved.

#### Scenario: Evidence is unsafe

- **WHEN** an evidence path is inside the repository, is not owner-private, or contains a token, Drive identifier, owner identifier, session URL, object key, or customer content
- **THEN** the preflight returns `BLOCKED` before any external action.

### Requirement: Initial Drive activation is shadow-copy only

The preflight SHALL accept a rendered configuration only when the archive scheduler, archive capability and copy flags are enabled while proxy read and R2 deletion are disabled; it SHALL require the D1 controls to be `copy_enabled=1`, `proxy_read_enabled=0`, `r2_delete_enabled=0`. Proxy read and R2 delete SHALL remain independent later approvals.

#### Scenario: R2 delete is requested during initial activation

- **WHEN** either the rendered `DRIVE_ARCHIVE_R2_DELETE_ENABLED` flag or the D1 `r2_delete_enabled` control is enabled
- **THEN** the preflight returns `BLOCKED` and does not treat hash verification as deletion authorization.

### Requirement: Drive and recovery evidence is independently attestable

The preflight SHALL require a redacted receipt proving the exact `https://www.googleapis.com/auth/drive.file` scope, no token persistence, owner-only private permissions, and anonymous upload/read-back SHA-256 evidence. It SHALL also require a redacted encrypted D1 backup attestation with bounded schema/release metadata and SHA-256 values for encrypted bundle and manifest.

#### Scenario: OAuth scope or private permission proof differs

- **WHEN** the receipt returns a broader scope, reports token persistence, or does not prove owner-only folder/file permissions
- **THEN** the preflight returns `BLOCKED` and leaves copy, proxy and delete unapproved.

#### Scenario: Encrypted backup evidence is incomplete

- **WHEN** the backup attestation is missing either SHA-256 value or declares plaintext content
- **THEN** the preflight returns `BLOCKED` and reports the recovery evidence as invalid.
