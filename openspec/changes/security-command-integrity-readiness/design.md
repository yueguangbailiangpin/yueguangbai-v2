# Design: Security And Command Integrity Readiness

## Command transaction boundary

Critical acquisition writes reuse `acquireIdempotency`, the canonical JSON hash helpers, `createAuditEventStatement`, `prepareOutboxEvent`/`createOutboxStatements`, completion statements and `transaction_assertions`. The command claim is acquired before mutation. Mutation, domain evidence, Audit, required Outbox, idempotency completion and final assertions commit in one D1 batch. Any batch failure marks the claim FAILED outside the failed batch so the same request can safely retry.

Guarded updates are immediately followed by a `changes()=1` transaction assertion. Unknown D1 failures are rethrown to the existing sanitized 503 policy; only known state, version, idempotency and validation outcomes map to business 409/400 responses.

## Machine credential secret replay

The generated machine secret is hashed before storage and exists in memory only for the first successful response. The command completion response stores credential metadata and `secret_available=false`, never plaintext secret. A same-key/same-hash retry replays that non-secret result for the original credential, so a lost response cannot produce a second ACTIVE credential. Recovery is explicit operator revoke followed by a new logical create command with a new key. Audit, Outbox, logs and result references never contain the secret or secret hash.

Create batches the credential, immutable scopes, Audit, Outbox/completion where required, and final credential/scope/count assertions. Revoke batches the guarded ACTIVE-to-REVOKED update, exact-one assertion, rate-bucket cleanup, Audit, required Outbox, completion and final state/count assertions. Existing not-found and concealment behavior remains authoritative.

## Acquisition concurrency

Prospect update uses `expected_version` in the guarded mutation and never reads a winner's state as the loser's response. Prospect signals hash the complete normalized accepted body and replay the committed signal without inserting another fact. Assignment revoke uses the existing expected version and emits its immutable assignment event, Audit and Outbox in the command batch.

The machine Prospect routes require Bearer authentication and `Idempotency-Key`, then construct a CODEX command identity containing the authenticated machine id and immutable scope snapshot. Signal and analysis acquire the canonical command before resource-level scope lookup so committed replay is stable. An acquired command must still pass the scope-constrained lookup. Out-of-scope marketplace/channel/Prospect ids and random ids share the same public 404; only a missing global capability is rejected as 403 before any resource query.

Lead-source correction uses `expected_correction_sequence`, defined as the count returned by the candidate read model. Its batch inserts only when the current correction count and effective previous channel still match the submitted sequence, then asserts the inserted correction is the unique next sequence winner before Audit/Outbox/completion. No migration is required because the append-only correction count is the authoritative sequence.

## Production alert readiness

`/ready` exposes `checks.operational_alerts`. Production requires a real `bound` RPC service adapter. The canonical descriptor contains the actual service target, canonical named/default entrypoint, an exact props object, sink identity and sink deployment/version identifier. Only an omitted rendered service `entrypoint` canonicalizes to the default (`null` in the descriptor); its props and runtime mirrors must explicitly equal `default`. A named entrypoint must exactly match the supported JavaScript identifier subset `[A-Za-z_$][A-Za-z0-9_$]*` in the service, props and runtime mirror. Present invalid values, missing runtime mirrors, whitespace and dotted names fail closed rather than collapsing to default. Release preflight derives its fingerprint with stable canonical JSON plus SHA-256 from the rendered `services` entry, requires every runtime mirror to match, and rejects an operator-supplied arbitrary or stale hex value. Runtime reconstructs the same descriptor from the identifiers it can observe, derives the same fingerprint and requires a binding implementing both notification and verification RPC. A bare environment boolean is not evidence and the local console adapter is never accepted in staging or production.

The attestation trust source is the existing formal Staff session followed by an owner-only, strict-origin, exact-body, idempotent route. The client supplies only bounded expiry and a non-secret evidence reference; it cannot claim PASS. The API generates fresh cryptographic nonces and sequentially invokes `OPERATIONAL_ALERT_SINK.verifyOperationalAlertChallenge` for delivery, safe simulated failure handling and recovery. Each structured receipt must exactly match its challenge id/type/nonce, current release, binding fingerprint, identity and deployment version, report the type-specific observed outcome, and be current and non-duplicated. The failure challenge is explicitly `SAFE_NO_PRODUCTION_DISRUPTION`: the external sink must test its failure-handling path without disabling or corrupting production delivery. Any RPC failure, unknown/missing/stale receipt or one failed challenge returns 503 and writes no success Audit. Only summaries of validated receipts, never nonce or secret material, commit as an immutable D1 Audit event with Outbox, command completion and final assertions. `/ready` fails closed for missing, malformed, expired or descriptor/release-mismatched evidence.

Release preflight verifies the same descriptor and derived fingerprint but cannot manufacture or validate an online exercise. The repository defines the typed RPC contract and fail-closed caller plus local mock behavior; the production sink Worker remains an external operator-provisioned implementation and is not fabricated here. The runtime policy requires the binding, and the production health monitor consumes the attestation-backed `/ready` check. The production template deliberately retains operator inputs for target, identity, version and the derived fingerprint. No production sink or attestation is created by this change; provisioning, independent descriptor verification and the real exercise remain an incomplete deployment gate. Local may use the console adapter or disabled policy, while staging remains disabled.

## Strict browser write boundary

Browser-authenticated password and Staff order-instruction writes require an exact same-origin `Origin` and reject foreign/missing origins. Each route validates exactly the accepted semantic body keys, including explicit optional-key sets, before constructing its service input. Canonical request hashes therefore cover the complete accepted semantic body. Scheduled operations continue to invoke order-instruction services directly and do not depend on browser Origin headers.

## Verification and safety

Tests exercise the real Hono route registration, middleware and service/database behavior. Source-marker tests do not count as behavioral evidence. Verification remains local and isolated; production resources and migrations are not touched.
