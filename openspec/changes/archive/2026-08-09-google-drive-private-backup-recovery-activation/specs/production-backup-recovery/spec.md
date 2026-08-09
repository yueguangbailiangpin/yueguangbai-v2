# Production Backup and Recovery Requirements

## ADDED Requirements

### Requirement: Private Drive backup evidence is secret-separated

The recovery process SHALL use a private owner-controlled Drive hierarchy with no link sharing, SHALL keep the backup key separate from encrypted content, SHALL keep the production application's OAuth credentials separate from any Codex connector credentials, and SHALL use the minimum approved Drive scope without silent expansion.

#### Scenario: Drive identity is only a connector identity

- **WHEN** the connected Drive profile is inspected before activation
- **THEN** the evidence labels it as a connector identity and does not treat it as a production application refresh token or OAuth grant.

#### Scenario: Folder is not private

- **WHEN** a target folder or uploaded artifact has link sharing or an unexpected external permission
- **THEN** the process stops before backup upload and Production GO remains blocked.

### Requirement: Anonymous Provider behavior is proven before production backup upload

The process SHALL use only generated anonymous content for the initial Provider PoC and SHALL verify byte count, MIME, SHA-256, duplicate, interruption/resume, and revoke-boundary behavior before any production backup upload.

#### Scenario: Anonymous read-back matches

- **WHEN** the fixture is uploaded and read back
- **THEN** bytes, MIME, and SHA-256 match exactly and no real business content is involved.

#### Scenario: Minimum scope is insufficient

- **WHEN** a required PoC operation fails under the approved minimum scope
- **THEN** the exact failure is reported and no broader scope is requested or used automatically.

### Requirement: Production D1 backup is release-bound and recoverable

The process SHALL read-only verify the production release SHA, schema 39, and continuous migration ledger through 0039, SHALL create an encrypted backup and authenticated attestation bound to that release, SHALL verify Drive upload/download hashes, and SHALL restore into a fresh isolated target without overwriting a database.

#### Scenario: Production backup restores

- **WHEN** the downloaded backup is restored into a new isolated database
- **THEN** schema 39, full table row counts, integrity, foreign keys, financial aggregates, and Staff/Buyer/Seller/order/file/scheduler smoke reads match the backup evidence.

#### Scenario: Backup or recovery assertion fails

- **WHEN** export completeness, attestation, hash, schema, row, financial, integrity, foreign-key, or smoke assertions fail
- **THEN** the backup is not accepted, production facts are unchanged, and Production GO remains blocked.

### Requirement: R2 remains authoritative during recovery activation

The process SHALL keep Drive proxy-read, scheduler activation, and every R2 delete switch disabled during the PoC, backup, upload, download, and restore rehearsal, and SHALL perform no R2 deletion.

#### Scenario: Recovery rehearsal completes

- **WHEN** Drive upload/download and isolated restore pass
- **THEN** the result proves recoverability only; it does not enable proxy reads, delete R2 content, or modify production configuration.

### Requirement: Remote export output does not disclose provider credentials

The release process SHALL use a no-shell local export wrapper that requires an explicit local or remote mode, refuses repository output paths, captures Wrangler output, redacts complete URLs and credential-like values before terminal emission, does not persist child output, and writes a successful export with private file permissions.

#### Scenario: Wrangler prints a signed export URL

- **WHEN** the wrapped export subprocess emits a provider signed URL or credential-like query value
- **THEN** terminal output contains only a redaction marker and no complete URL, token, or signature.

#### Scenario: Export output targets the repository

- **WHEN** an operator supplies an output path inside the repository or a non-private parent directory
- **THEN** the wrapper fails before invoking Wrangler.

### Requirement: OAuth acceptance is exact-scope, PKCE-bound, and non-persistent

The OAuth acceptance tool SHALL accept only a repository-external private Desktop client JSON, request exactly `https://www.googleapis.com/auth/drive.file` with loopback PKCE and offline access, create and read only app-owned anonymous test objects, verify duplicate objects and owner-only permissions, record redacted scope/resumable/revoke receipts without IDs or URLs, revoke the refresh token, verify refresh failure after revocation, and persist no usable token.

#### Scenario: Scope is wider than drive.file

- **WHEN** the token response returns any scope other than the exact requested `drive.file` scope
- **THEN** the acceptance fails closed and does not continue with Drive objects or broader authorization.

#### Scenario: Resumable upload, duplicate, private permission, and revoke pass

- **WHEN** the app-created fixture receives a 308 offset response, a final upload response, exact read-back hash, successful revocation, and `invalid_grant` on refresh
- **THEN** the redacted receipt records those statuses without any token, session URL, file ID, or folder ID.

#### Scenario: Token persistence is attempted

- **WHEN** the flow would write client credentials, authorization code, access token, or refresh token to Git, logs, evidence, or a non-private file
- **THEN** the flow fails closed; after revocation no usable token remains persisted.
