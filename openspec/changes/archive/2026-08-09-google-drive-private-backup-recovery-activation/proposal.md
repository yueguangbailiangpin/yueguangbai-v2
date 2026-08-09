# Google Drive Private Backup and Recovery Activation

## Why

The production D1 has reached schema 39, but the current repository evidence does not prove that a release-bound encrypted backup can be stored in a private, owner-controlled Google Drive location and recovered from a real Drive download. A real anonymous Provider check and a production backup/restore rehearsal are required before historical-order AUDIT/PREVIEW work.

## What Changes

- Establish and verify a dedicated, non-public Google Drive folder hierarchy for encrypted D1 backups, anonymous cold-archive PoC artifacts, and recovery evidence.
- Verify the Google Drive connection boundary and record that it is not the Moonlight White production application's OAuth client or refresh token.
- Run an anonymous file upload/read-back PoC with byte, MIME, SHA-256, duplicate, interruption/resume, and revoke-boundary evidence.
- Read-only verify the production D1 release lineage and ledger, export it without writing plaintext data to the repository, create an authenticated release-bound encrypted backup, upload it to Drive, download it, and restore it into a new isolated database.
- Add a local no-shell Wrangler export wrapper that captures and redacts provider URLs before terminal output, refuses repository output paths, and requires an explicit local/remote mode.
- Add a local Google OAuth Desktop/PKCE acceptance tool that requests only `drive.file`, uses a loopback callback with offline access, writes only redacted receipts, and revokes the temporary grant before exit.
- Preserve R2 as the authority and keep Drive proxy-read and every R2 delete switch disabled.

## Non-Goals

- No Tencent Docs history access or import, Staff MCP/ChatGPT activation, Feishu change, R2 deletion, production deployment, remote Migration, or production configuration switch.
- No upload of real order attachments, backup keys, OAuth tokens, customer data, or plaintext D1 exports to Git, logs, Drive, or the final public report.
- No silent expansion beyond the minimum approved Google Drive scope.

## Migration and Contract Impact

No database Migration or application Contract change. The current production schema and D1 ledger are read-only inputs to an external recovery evidence package. Any future runtime Drive activation remains governed by the existing cold-archive Change and separate owner approval.

## External Authorization Boundary

The owner must personally complete any Google login, OAuth consent, Google Cloud client creation, MFA/recovery confirmation, or scope expansion. This Change may use an already connected Drive session for a read-only inventory, but it must not treat connector credentials as application OAuth credentials. Folder creation and test/backup uploads are separate external writes and must be recorded with private sharing verification.

## Acceptance

The Change is complete only when the real evidence package records the Drive account and private-sharing result without exposing identifiers, anonymous PoC results, production release/schema/ledger verification, encrypted backup upload/download hashes, isolated restore assertions, failure boundaries, and an explicit list of remaining owner actions. Production GO remains blocked for every missing external prerequisite.
