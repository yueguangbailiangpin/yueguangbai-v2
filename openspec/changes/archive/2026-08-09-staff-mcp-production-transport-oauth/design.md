# Design: Staff MCP Production Transport and OAuth

## Migration -> Contract -> Implementation -> Test -> Rollback -> Acceptance

### Migration

Migration `0038` is guarded by `schema_version=37` before DDL and advances exactly once to 38. It creates:

- `staff_mcp_subject_bindings`: keyed issuer/subject hashes map uniquely to one Staff ID, have ACTIVE/REVOKED state and are valid only while the referenced `staff_users` row is ACTIVE.
- `staff_mcp_token_revocations`: keyed issuer/JTI hashes deny a token until its expiry.
- `staff_mcp_replay_records`: keyed client/session/request hashes, canonical request hash, PROCESSING/COMPLETED/COMPLETED_NO_RESPONSE state, at most 256 KiB of text-only JSON result and expiry. Screenshot results never persist a response body.
- `staff_mcp_rate_limits`: keyed fixed-window counters with expiry.
- `staff_mcp_runtime_controls`: GLOBAL or TOOL controls, default GLOBAL disabled, versioned timestamps and optional operator reason.

The schema does not duplicate Staff role, permission, Team, Customer, Seller, Store, File Audience or audit truth.

### Contract

The protected resource is the exact configured HTTPS `/mcp` URL. Its RFC 9728 metadata is served at `/.well-known/oauth-protected-resource/mcp`; an unauthorized resource response advertises that metadata through `WWW-Authenticate` without reflecting a token.

The authorization-server metadata must have the exact configured HTTPS issuer, authorization/token/JWKS/revocation endpoints, authorization-code grant and PKCE `S256`. The resource server accepts only compact JWT access tokens signed with configured `RS256`; rejects embedded/remote key pointers and unsupported critical headers; selects one exact signing `kid`; and validates signature, issuer, audience, resource, expiry, issued-at, bounded lifetime, required scope, client ID, session ID, JTI and subject. Unknown `kid` causes one forced JWKS refresh; refresh/provider failure closes. Local JTI revocation and subject binding checks also close on database error.

One validated issuer/subject maps to exactly one ACTIVE binding and then to one currently ACTIVE Staff. The existing assignment authorization resolver recalculates current roles, permissions and Data Scope for every catalog/call. No OAuth claim grants business permission.

Every formal next step is an origin-relative `/staff/...` Web path. MCP never accepts a confirmation token and never invokes a formal business write.

### Implementation

The transport accepts only HTTPS `POST /mcp`, strict `application/json`, one JSON-RPC object and a bounded body. Batch requests, query parameters, malformed authorization, missing bearer token and disabled/incomplete runtime fail before tool execution. Metadata remains public only when its complete non-secret configuration is valid; it contains no client Secret or account data.

Runtime activation requires both environment switches, cleanup explicitly enabled, a complete production OAuth configuration, D1, a supported token-status Service Binding and a D1 GLOBAL control set to enabled. The production application service is constructed from D1 rather than injected as a JavaScript object. The screenshot tool remains disabled until a separately authorized File Audience/read-intent byte provider is configured; the exception list remains disabled until a real D1 exception projection exists, rather than returning an authoritative-looking empty page. Local mock coverage activates neither production tool. A missing or invalid MCP dependency affects only MCP endpoints; Web, `/health` and `/api/*` routing remain unchanged.

HMAC-SHA-256 with the managed `STAFF_MCP_BINDING_HASH_SECRET` derives identity/storage keys and the identifier fingerprints sent to the token-status Service Binding. The Secret and raw Provider identifiers are never logged or persisted. The binding adapter uses a fixed internal HTTPS URL, timeout, bounded JSON, exact content type and redirect rejection; any malformed or unavailable response fails closed.

Durable replay validates bounded stored JSON before returning it. Screenshot completion writes only status/request metadata and a duplicate returns `REPLAY_NOT_AVAILABLE`; image/base64/raw bytes are never serialized into D1. Ordinary replay accepts only text-only results no larger than 256 KiB. Rate limiting uses atomic D1 upserts.

When the explicit cleanup switch is enabled, every MCP request first runs a bounded D1 cleanup that deletes at most the configured limit from each expired replay, rate and revocation table. Cleanup failure closes the MCP request. Subject bindings, runtime controls and immutable audit are not cleanup targets. Checked-in templates keep cleanup disabled, so an operator must explicitly acknowledge the retention boundary before activation.

Checked-in staging/production templates keep both Staff MCP switches false and contain placeholders only. The separate local preflight reads templates or a Git-external rendered file, prints field/Secret names only, performs no fetch and has no deployment path.

### Test

Anonymous RSA keys, issuer URLs, fake JWTs and fixed clocks cover signature success, wrong issuer/audience/resource/scope, expiry/not-before/lifetime, duplicate claims, malformed JWT/JWK, unknown-key rotation and JWKS/metadata outage. HTTP tests cover discovery, challenge, methods, content type, body bounds, disabled and enabled paths.

Local D1 tests cover fresh/repeat/wrong-order Migration, one ACTIVE binding, revoked Staff/token, screenshot non-replayability, 256 KiB text replay, replay conflict/completion/expiry, bounded cleanup, rate windows, GLOBAL/TOOL controls and audit failure. Anonymous Service Binding tests cover timeout, body limit, content type, redirect, inactive/malformed responses and identifier-only request bodies. Existing Staff MCP tests continue covering Personal DENY, Team/Customer/Seller/Store/File Audience, 404 isolation and safe Web confirmation paths.

### Rollback

First set the environment or D1 GLOBAL control to disabled and verify `/mcp` rejects while Web and `/api/*` remain healthy. Preserve Migration 0038 facts; cleanup may remove only already-expired replay/rate/revocation rows and must never delete bindings, controls or immutable audit. Restore a schema-compatible prior Worker only with MCP disabled. If an OAuth/JWKS incident exists, revoke affected JTI/binding records and rotate keys/secrets through an owner-authorized external procedure not included here.

### Acceptance

Passing local gates proves implementation and anonymous interoperability boundaries only. Real authorization-server discovery, key rotation, token revocation propagation, ChatGPT/OpenAI registration, Cloudflare deployment, network behavior and production operator evidence remain unexecuted blockers. Production remains `NO_GO`.

## Rejected Alternatives

- Reuse Web Staff cookies or Feishu tokens: rejected because MCP needs a separate audience-bound OAuth resource-server boundary.
- Trust Staff role/permissions from JWT claims: rejected because D1 and current Staff authorization remain authoritative.
- Memory replay/rate in production: rejected because isolates do not provide durable cross-instance enforcement.
- Direct token introspection from the Worker: rejected because it would transmit bearer tokens and require a real Provider contract. A narrow internal Service Binding receives only keyed identifier fingerprints; real revocation propagation remains an explicit production blocker.
- Enable MCP in checked-in release templates: rejected because external resources and owner approvals do not exist.
