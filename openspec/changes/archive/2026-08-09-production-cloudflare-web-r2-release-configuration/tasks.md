# Tasks: Production Cloudflare/Web/R2 Release Configuration

## 0. Governance and Baseline

- [x] 0.1 Fetch and verify the exact `origin/main` SHA, branch, clean source repository and isolated worktree.
- [x] 0.2 Read AGENTS, decisions, AI governance, final GO evidence/checklist, Cloudflare/D1/R2/File/HTTP/Drive/backup/deployment specifications, contracts, architecture and runbooks.
- [x] 0.3 Keep all Cloudflare, GitHub, Feishu, Drive, MCP, Secret and production-data operations read-only or untouched; keep Ponytail off.

## 1. Migration

- [x] 1.1 Record `NO_SCHEMA_CHANGE`, preserve continuous `0001`–`0037`, and prohibit `0038`.
- [x] 1.2 Verify Migration continuity and guards locally without any remote ledger read or Migration.

## 2. Contracts

- [x] 2.1 Freeze the R2 binding-to-`ObjectStorageAdapter` contract without public bucket/key/URL authority.
- [x] 2.2 Freeze staging/production environment, binding, origin, custom-domain, cron, static-assets and managed-Secret-name contracts.
- [x] 2.3 Freeze all external/destructive switches disabled, including archive R2 delete.

## 3. Implementation

- [x] 3.1 Implement the R2 adapter/factory and production Worker binding composition.
- [x] 3.2 Add placeholder-only staging/production Wrangler templates and fail-closed runtime/preflight validation.
- [x] 3.3 Add Worker Static Assets, SPA fallback, security headers and same-origin API enforcement.
- [x] 3.4 Add local-only dry-run/static-build verification with secret-redacted output and no deploy path.

## 4. Tests

- [x] 4.1 Test anonymous R2 put/head/prefix/read/delete, invalid binding and metadata/checksum failures.
- [x] 4.2 Test existing upload intent, permissions, capacity, HEAD/final assertions, compensation/cleanup and private Audience reads through the adapter path.
- [x] 4.3 Test templates, placeholders, wrong environment, origins/CORS, headers, SPA fallback, static build and secret redaction.
- [x] 4.4 Run target/all OpenSpec strict, module tests, migration/security/type/build and appropriate full repository gates once after implementation.

## 5. Rollback and Runbook

- [x] 5.1 Document release backup point, production ledger read-only check, deploy order and Worker/Web compatibility rollback.
- [x] 5.2 Document pre/post-first-R2-delete differences, rehydration prerequisite and all kill switches.

## 6. Acceptance and Handoff

- [x] 6.1 Update final Production GO evidence and verifier from `ABSENT_BLOCKED` to local implementation present/external truth unverified.
- [x] 6.2 Keep every Gate 2 external checkbox and overall Production GO at `NO-GO`.
- [x] 6.3 Confirm unstaged, uncommitted, unpushed, unarchived, no PR and zero external-resource writes; report to total control.

## 7. Total-control Review Remediation

- [x] 7.1 Add provider-neutral ambiguous PUT semantics and route invalid/non-null R2 receipts through existing compensation and retryable deletion-pending handling.
- [x] 7.2 Require an absolute Git-external `--config` by both lexical containment and realpath, including both symlink directions, with fixed redacted CLI errors.
- [x] 7.3 Remove all Web JSX inline styles while retaining `style-src 'self'`, and make the zero-inline-style assertion persistent in the full Web gate.
- [x] 7.4 Re-run target tests, repository check, complete Chromium, strict OpenSpec, release/preflight/static verifiers and secret/dependency gates after remediation.
- [x] 7.5 Reconfirm dirty, unstaged, uncommitted, unpushed, unarchived handoff and Production `NO-GO`.
