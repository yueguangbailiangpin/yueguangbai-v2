# Change: Security And Command Integrity Readiness

## Why

Several existing critical write routes do not yet use the repository command protocol consistently. Machine credential lifecycle, Prospect mutations, legacy assignment revocation and lead-source correction can currently commit without the full request-hash, guarded-write, Audit/Outbox, idempotency-completion and final-assertion boundary. Production readiness also permits an internally contradictory alert configuration, while selected browser-authenticated writes accept non-exact bodies or lack the strict same-origin guard.

## What Changes

- Harden acquisition machine credential create/revoke with canonical request hashing, command replay/conflict semantics, exact-one transaction assertions, immutable Audit evidence and atomic rate-bucket cleanup.
- Make machine credential plaintext secrets visible only in the first successful response. Persist only a non-secret replay result; a lost-response retry identifies the already-created credential and reports that the secret is no longer available, without creating another ACTIVE credential.
- Apply guarded OCC and the shared command protocol to Prospect update/signals, assignment revoke and lead-source correction; include required Audit/Outbox facts and fail unknown D1 errors closed.
- Add `operational_alerts` to production readiness and require a real enabled alert sink policy for production release configuration while preserving explicit isolated non-production behavior.
- Apply strict same-origin and exact accepted-body enforcement to customer password change and Staff order-instruction prepare/publish/cancel/scan/reconcile HTTP writes without changing the direct scheduled-service invocation path.

## Non-goals

- No production deployment, Migration, remote D1/R2/Drive write, Secret, DNS, Cloudflare Access, scheduler activation or real customer/order/fund operation.
- No schema change and no modification to migrations 0001-0065.
- No redesign of acquisition roles, machine scope, order-instruction state machines or alert delivery providers.
- No merge to `main` and no archival of this or any other active Change.

## Migration Decision

`NO_SCHEMA_CHANGE`. Existing `command_idempotency_records`, `transaction_assertions`, `audit_events`, Outbox tables and acquisition facts are sufficient for the required transaction boundaries.

## Rollback

Revert this Change's code, tests and documentation as one branch-level rollback. Existing facts and migrations remain untouched. A credential whose one-time secret was already returned remains governed by its existing ACTIVE/REVOKED lifecycle; rollback never attempts to recover or persist the plaintext secret.
