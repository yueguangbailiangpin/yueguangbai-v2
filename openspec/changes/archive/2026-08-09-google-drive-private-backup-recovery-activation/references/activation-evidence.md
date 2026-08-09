# Activation Evidence (Redacted)

Date: 2026-08-09 Asia/Shanghai

This file intentionally omits Google account identifiers, Drive folder/file IDs, OAuth tokens, backup keys, plaintext D1 exports, and customer/order content.

## Repository and production D1

- Repository baseline: `cfc01e2b…` on `main`, with no unrelated worktree changes before this Change.
- Production D1 was queried read-only. `app_schema_state.schema_version = 39`.
- `d1_migrations` was continuous through `0039_staff_access_binding_management.sql`.
- All read-only queries reported zero written rows and no database change.
- The production D1 export was held in a mode-0700 temporary workspace, then used only to create the encrypted bundle; no plaintext export was placed in this repository or Drive.

## Drive hierarchy and sharing

- Owner-confirmed Drive account: the connected account identified in the task conversation.
- Created one private recovery root with three child folders: encrypted D1 backups, anonymous cold-archive PoC, and recovery evidence.
- Root and child folders were read back with `shared=false` and an owner-only permission list; no domain or anyone permission was present.
- The encrypted D1 bundle and attestation were uploaded only to the encrypted-backup child folder.

## OAuth boundary

- The connected Drive identity is a Codex connector identity, not a production application OAuth client or refresh token.
- No production application OAuth client, refresh token, Secret, or Cloudflare configuration was created or changed.
- Owner confirmed the intended account and the real Desktop/PKCE exchange returned exactly `https://www.googleapis.com/auth/drive.file`; no broader scope was requested.
- Login/MFA/recovery configuration remains not independently observable from the local tool or connector and is recorded separately from the account and scope result.

## Anonymous PoC

- Generated fixture only; no order, customer, or real attachment content.
- Upload/read-back: PASS, 2048 bytes, `application/octet-stream`, exact SHA-256 match.
- Duplicate upload: PASS as a separate file; Drive did not provide application-level idempotent deduplication.
- Real app-owned OAuth upload/read-back: PASS, 524288 bytes, `application/octet-stream`, exact SHA-256 match; no business content was used.
- Real app-owned duplicate: PASS as a distinct second file with the same fixture hash, bytes, and MIME.
- Real app-owned resumable upload: PASS twice; each first chunk returned HTTP 308 with confirmed offset 262143, followed by HTTP 200 finalization and matching final SHA-256.
- Real app-owned private permissions: PASS for the test folder, primary file, and duplicate; each was read back owner-only with no public or domain permission.
- Real app-owned authorization revoke: PASS, revoke HTTP 200; refresh after revoke failed HTTP 400 with `invalid_grant`.
- Test folder and both app-created files were deleted before revoke; the receipt records cleanup true.

## Provider capability classification

- `drive.file` scope: PASS through the real Desktop/PKCE exchange; connector metadata alone remains UNVERIFIABLE and is not a reported provider failure.
- Resumable upload/session: UNVERIFIABLE from connector API; no resume controls were exposed; not a reported provider failure.
- OAuth revoke: PASS through the real Desktop/PKCE flow; connector-only revoke remains unavailable and is not a reported provider failure.

## Production backup, Drive round trip, and recovery

- Encrypted backup: AES-256-GCM/HKDF with authenticated attestation, release-bound to `cfc01e2b…`, expected schema 39.
- Drive upload metadata: PASS for encrypted bundle and attestation; sizes and MIME types matched local artifacts.
- Drive download: PASS; downloaded byte counts and SHA-256 matched the protected local source artifacts.
- Fresh isolated restore: PASS; schema, inventory, full row counts, financial aggregates, SQLite integrity, foreign-key violations, and Staff/Buyer/Seller/order/file/scheduler smoke reads matched.
- Restore target was new and was never used to overwrite a production or existing database.

## External writes and remaining gates

- Google Drive writes: recovery root, three child folders, two anonymous PoC files, encrypted bundle, and attestation. All remain owner-only.
- Cloudflare: production D1 read-only queries/export only; no D1 write, Migration, deployment, Secret, Worker, or R2 mutation.
- R2 deletion: zero. Drive proxy-read and all archive/delete switches remain disabled.
- Production application OAuth activation, production deployment, privacy/compliance approval, separate switch approvals, and final Production GO signature remain open. The anonymous OAuth scope, resumable, private-permission, and revoke boundaries are closed by the real one-time acceptance above.

## Security observation

The Wrangler remote export command printed a temporary signed download URL in its terminal progress output. The URL was not committed or copied into repository evidence, and it is not reproduced here. Future production exports must use a wrapper that suppresses provider URLs before they reach terminal logs.

The new `scripts/export-d1-redacted.mjs` wrapper captures child output, redacts complete URLs and credential-like values, refuses repository output paths, requires explicit mode, and writes only a mode-0600 export. Its synthetic redaction tests passed. Existing conversation/tool output cannot be deleted retroactively; the temporary URL was time-limited by the provider and is not repeated here.

## Local artifact cleanup

- The exact protected temporary paths were enumerated before cleanup.
- Production plaintext export, both SQLite restore copies, temporary key, local encrypted artifacts, Drive download copies, anonymous fixture/download, and wrapper local export were removed individually with non-recursive `unlink` calls.
- The two temporary subdirectories and the task root were removed with explicit `rmdir` calls.
- Post-cleanup checks confirmed that every enumerated path is absent. Drive-hosted encrypted backup, attestation, anonymous PoC files, and redacted evidence remain.

## OAuth local preparation

- The Desktop client JSON was moved from Downloads into the repository-external 0700 handoff directory and set to mode 0600; Downloads contains no matching client JSON.
- The real flow used localhost callback plus PKCE S256 and exact `drive.file`; client secret, authorization code, access token, refresh token, Drive IDs, session URL, and full OAuth URL were not written to Git, terminal output, or evidence.
- The redacted receipt is mode 0600, records `tokens_persisted=false`, and contains no sensitive identifier keys.
- The client grant was revoked after the one-time acceptance; no usable access or refresh token was retained.

## Final local verification

- OAuth/Wrapper syntax and focused tests: PASS, 9/9.
- Sensitive-information scan: PASS, 1533 project files; no secret, token, ID, plaintext export, customer data, or backup key findings.
- OpenSpec strict validation: PASS.
- Production-readiness tests: PASS, 5 files and 14 tests.
- Formal production-readiness verifier: PASS as a verifier; `production_go=NOT_APPROVED` remains intentional.
- `git diff --check`: PASS. Worktree contains only this Change and its four local wrapper/OAuth script/test files; no commit, archive, merge, push, deploy, or production configuration write was performed.
