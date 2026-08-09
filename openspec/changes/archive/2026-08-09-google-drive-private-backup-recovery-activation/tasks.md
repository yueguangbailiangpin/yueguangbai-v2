# Tasks: Google Drive Private Backup and Recovery Activation

## 0. Governance and Boundary

- [x] 0.1 Verify the independent Change exists, current main/origin baseline is unchanged, and no unrelated worktree changes are present.
- [x] 0.2 Record the connected Drive identity separately from the production application's OAuth credentials; do not copy connector credentials.
- [x] 0.3 Keep R2 authority, Drive proxy-read, Drive copy, and R2-delete switches closed.
- [x] 0.4 Add and test the no-shell Wrangler export wrapper with synthetic signed-URL redaction and repository-output guards.
- [x] 0.5 Prepare an empty repository-external 0700 OAuth handoff directory without creating or reading client credentials.

## 1. Drive Account and Private Folder

- [x] 1.1a Owner confirmed the intended Google account, and the real OAuth exchange returned only the minimum `drive.file` scope.
- [x] 1.1b Record that login/MFA/recovery configuration is not independently observable from the local tool or connector, keep it separate from the account and scope result, and retain it as an owner-side Production GO gate.
- [x] 1.2 Create the dedicated private folder hierarchy only after owner authorization and verify no link sharing or external permission exists.
- [x] 1.3 Record folder/file identifiers only in protected local evidence, never Git, logs, or public reports.

## 2. Anonymous Provider PoC

- [x] 2.1 Upload a generated anonymous fixture and verify upload/read-back byte count, MIME, and SHA-256.
- [x] 2.2 Real app-owned anonymous OAuth PoC passed duplicate, two resumable 308/offset/final boundaries, private-permission checks, and authorization revoke/refresh-failure boundaries; connector-only limitations remain separately recorded.
- [x] 2.3 Report that connector scope, resumable sessions, and revoke controls are not exposed; do not treat unavailable verification as a provider failure or expand scope silently.
- [x] 2.4 Implement and locally test the exact-scope Desktop/PKCE acceptance tool with redacted receipt rules and no token persistence.
- [x] 2.5 After owner setup, the real app-owned anonymous OAuth acceptance passed exact returned scope, two 308/offset/final hashes, read-back, duplicate, owner-only permissions, revoke, and refresh failure.

## 3. Production D1 Backup

- [x] 3.1 Read-only verify release SHA, production D1 identity, schema 39, continuous ledger through 0039, and zero writes.
- [x] 3.2 Export the current production D1 to protected temporary storage and generate the release-bound encrypted bundle and attestation.
- [x] 3.3 Upload the encrypted backup and attestation to the private Drive backup folder, then read back and verify size, MIME, and SHA-256.

## 4. Download and Isolated Recovery

- [x] 4.1 Download the Drive backup artifacts into a fresh protected temporary workspace and compare hashes.
- [x] 4.2 Restore into a newly created isolated database without overwriting any target.
- [x] 4.3 Verify schema 39, full row counts, financial aggregates, integrity, foreign keys, and Staff/Buyer/Seller/order/file/scheduler smoke reads.

## 5. Evidence and Handoff

- [x] 5.1 Produce a redacted evidence report with real results, failures, external writes, and remaining owner actions.
- [x] 5.2 Run final focused local/OpenSpec verification and confirm no secrets, tokens, IDs, plaintext export, customer data, or backup key entered Git or logs. Repository is clean of these; the historical unwrapped export emitted a temporary signed URL, while the new wrapper and real OAuth receipt pass redaction/no-persistence checks.
- [x] 5.3 Keep Production GO explicitly blocked for missing deployment, provider, network, privacy, owner-signature, and separate switch approvals.
