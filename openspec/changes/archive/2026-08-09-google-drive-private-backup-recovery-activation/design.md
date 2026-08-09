# Design: Google Drive Private Backup and Recovery Activation

## Evidence and Secret Separation

The repository baseline and production D1 ledger are read-only evidence. The production D1 export is created in a private temporary workspace, encrypted locally with a separately generated or owner-supplied 32-byte key, and removed from plaintext storage after the encrypted bundle is produced. The key remains outside Git, logs, Drive, and the report. The Drive package contains only the encrypted bundle, a non-sensitive attestation, and bounded evidence metadata that does not disclose customer rows or protected identifiers.

## Drive Boundary

The connected Google Drive identity is reported separately from the production application's Google OAuth. The minimum intended application scope is `drive.file`; no broader scope is requested implicitly. The owner-controlled folder is private, link sharing is prohibited, and the three child folders are separated into `encrypted-d1-backups`, `anonymous-cold-archive-poc`, and `recovery-evidence`. Folder and file IDs are retained only in local protected evidence.

## Anonymous PoC

Use a generated binary fixture with no order or customer content. Upload it, read it back, and compare exact byte length, MIME, and SHA-256. Exercise a same-content duplicate, a deliberately interrupted/resumed provider upload where the app-owned OAuth flow exposes it, an owner-only permission check, and an authorization-revocation boundary without touching any real resource. If `drive.file` cannot perform a required operation, record the exact limitation and stop before requesting a wider scope.

## Production Backup and Restore

1. Verify the immutable release SHA, production D1 schema 39, continuous ledger through 0039, and read-only query metadata.
2. Export the production D1 to a protected temporary file using the exact database identified by the ledger check.
3. Create the existing AES-256-GCM/HKDF encrypted backup and HMAC attestation bound to the release SHA and expected schema 39.
4. Upload only the encrypted bundle and attestation to the private backup folder; read back both files and compare metadata and SHA-256.
5. Download both files to a fresh protected temporary workspace.
6. Restore to a new, non-existing isolated SQLite target; never overwrite a target. Verify schema 39, full table row counts, integrity, foreign keys, financial aggregates, and Staff/Buyer/Seller/order/file/scheduler smoke reads.

Drive proxy-read, scheduler, R2 delete, deployment, Secret writes, and online Migration remain disabled. The recovery rehearsal proves recoverability only; it does not change production D1 or R2.

## Safe Export Wrapper

Future D1 exports SHALL run through `scripts/export-d1-redacted.mjs`. The wrapper starts the repository-local Wrangler binary without a shell, captures stdout/stderr instead of inheriting the terminal, replaces complete URLs and credential-like query values before emitting output, does not persist child output, requires exactly one explicit `--local` or `--remote` mode, rejects output inside the repository, requires a private existing parent directory, and changes a successful export to mode 0600. Its tests use synthetic signed URLs and anonymous argument values; they do not contact production.

## Failure and Rollback

Any missing owner OAuth step, scope failure, sharing ambiguity, checksum mismatch, incomplete export, target collision, or failed financial/integrity assertion blocks the corresponding acceptance item. The safe rollback is to stop the current phase and retain or locally remove only protected temporary artifacts as appropriate; never delete R2 or alter production facts. Drive test artifacts may be removed only after their IDs and sharing state are recorded in protected local evidence and the owner has approved cleanup.

A signed URL already emitted by an earlier unwrapped Wrangler invocation cannot be removed retroactively by this Change. Its expiry and provider-side access boundary must be recorded without repeating the URL; future exports use the wrapper.

## OAuth/PKCE Acceptance Tool

`scripts/google-drive-oauth-pkce.mjs` accepts only an installed Desktop client JSON from a repository-external private directory. It validates the Google authorization/token endpoints, uses a loopback `127.0.0.1` callback, PKCE S256, `access_type=offline`, `prompt=consent`, and exactly `https://www.googleapis.com/auth/drive.file`. On macOS it explicitly launches Google Chrome with `open -a "Google Chrome"` using `shell:false` and ignored stdio; the client JSON, code, access token, refresh token, authorization URL, callback URL, Drive IDs, and resumable session URL remain in memory only.

The acceptance creates only an app-owned anonymous folder and two 512 KiB generated fixtures with identical content. It forces two-part 256 KiB resumable uploads, requires a 308 response and exact offset for each, completes both final chunks, reads both files back, verifies distinct objects and owner-only permissions, and records only status, offset, byte count, MIME, and SHA-256 in a mode-0600 redacted receipt. It deletes only those app-created test objects before revocation, revokes the refresh token, verifies a subsequent refresh fails with `invalid_grant`, clears token variables, and writes no usable token to disk.

The owner downloads the Desktop client JSON directly into a pre-created 0700 directory; the tool rejects repository paths, Downloads paths, non-private parents, and non-private client files. No OAuth flow starts until the owner has completed the separate Cloud Console setup and the total-control process receives only a confirmation that the file is present.
