# Design: Google Drive 冷归档生产启用预检

## Trust boundary

Preflight consumes only repository-external, local files: a rendered release configuration, a redacted OAuth/private-folder receipt, a redacted encrypted-backup attestation, and a D1-control snapshot produced by an approved operator. It does not read managed Secret values, resolve environment variables, call a Provider, or make a D1/R2 request. Paths must be absolute, outside the repository, regular files, and owner-private.

The receipt formats intentionally contain only booleans, opaque hash strings, sizes, version markers and statuses. Drive IDs, owner identifiers, OAuth codes/tokens, session URLs, object keys and customer data are rejected. A valid local structure is evidence preparation only, never a Production GO decision.

## Activation phases

The preflight accepts exactly the initial shadow-copy configuration:

1. Scheduler, archive capability and copy flag are enabled.
2. Drive proxy read and R2 delete environment flags remain false.
3. D1 `copy_enabled` is 1 while `proxy_read_enabled` and `r2_delete_enabled` are 0.

This preserves R2 as the only runtime read source. A later proxy-read approval and a later R2-delete approval require independent changes or approved operator evidence and are intentionally rejected here.

## Evidence checks

- OAuth receipt: exact `drive.file` request/return, no token persistence, owner-only private folder/file checks, anonymous hash read-back, duplicate/resume proof, cleanup and revoke boundary.
- Backup attestation: encrypted bundle and manifest SHA-256 are present and valid hexadecimal hashes, schema/release metadata are bounded, and the encrypted bundle and manifest hash values agree with the optional local manifest evidence.
- D1 controls: only the one allowed shadow-copy bit pattern is accepted.
- Rendered config: expected environment and enablement flags are exact; client/owner/folder identifiers are syntactically safe and non-placeholder; client secret and refresh token must be declared managed secrets and cannot appear in `vars`.

## Failure and rollback

Any error returns a safe code without echoing file paths or values, makes zero external calls, and keeps the outcome `BLOCKED`. `LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO` still requires the business owner to confirm the live account/MFA/recovery, private hierarchy, actual provider behavior, secret injection, deployment, proxy-read approval, R2-delete approval and final production signature. To roll back initial preparation, leave all archive flags false; no state has been changed by preflight.

## Migration decision

No Migration. Existing `drive_archive_controls` stores independent copy, proxy-read and R2-delete gates; existing immutable Drive manifests and rehydration cover archive/recovery facts. This Change adds only local validation and runbook evidence.
