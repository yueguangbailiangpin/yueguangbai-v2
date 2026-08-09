# Change Proposal: Staff MCP Production Transport and OAuth

## Why

The canonical Staff MCP implementation is intentionally local-only: it has no HTTPS resource route, protected-resource metadata, production OAuth verifier, durable replay/rate controls, D1 kill switch or production activation preflight. Those gaps must be closed locally before any owner may evaluate a real ChatGPT/OpenAI or OAuth-provider connection.

## What Changes

- Add a disabled-by-default HTTPS JSON-RPC resource at `/mcp` and RFC 9728 protected-resource metadata.
- Add a strict OAuth 2.1 resource-server verifier for anonymous JWT/JWKS fixtures: exact issuer, resource and audience; PKCE S256 authorization-server metadata; expiry/lifetime; scope; signature; key rotation; local revocation; and unique ACTIVE Staff binding.
- Add Migration `0038_staff_mcp_production_transport_oauth.sql` for hashed subject binding, token revocation, durable replay, durable fixed-window rate state and an independent D1 kill switch.
- Compose D1-backed OAuth, replay, rate, audit and kill-switch boundaries without weakening the existing Staff role/permission/Data Scope, Personal DENY, File Audience, 404 isolation or D1 authority.
- Add staging/production placeholder templates, a Secret-name-only zero-network preflight, rollback/runbook and truthful acceptance evidence.

## Out of Scope

- No real OpenAI/ChatGPT workspace, app, MCP registration, OAuth issuer, JWKS, token, account, Secret, provider request or provider login.
- No Cloudflare/D1/R2/Drive/Feishu/domain/DNS/deployment/remote Migration/production-data action.
- No formal business write tool. Existing reads and drafts remain bounded; a formal action returns only a controlled relative Staff Web path for fresh Web authorization and explicit confirmation.
- No automatic OAuth client registration, authorization server or token issuance implementation.

## Migration and Contract Impact

`SCHEMA_CHANGE_REQUIRED`. Migration `0038` follows the verified continuous `0001`-`0037` chain. Existing `staff_auth_rate_limits` is login-only, and generic `idempotency_records` lacks the MCP-specific hashed identity, revocation, bounded response, expiry and kill-switch invariants. Reusing either would weaken fail-closed ownership.

The migration stores no bearer token, Secret, prompt or raw screenshot log. OAuth issuer, subject, client, session and token identifiers are represented by keyed hashes. Existing immutable `audit_events` remains the only audit authority.

## Rollback

Disable `STAFF_MCP_ENABLED` or the D1 global control first; Web and `/api/*` remain available. Do not down-migrate committed rows. A schema-compatible prior Worker may run with MCP disabled. Key or issuer rotation is staged, verified anonymously, activated explicitly, and reversible while the prior key remains inside the bounded overlap window.

## Acceptance

Local acceptance requires strict OpenSpec validation, fresh/repeat/wrong-order Migration tests, anonymous metadata/HTTP/JWT/JWKS/rotation/revocation/expiry/scope/binding tests, durable replay/rate/kill-switch/audit tests, existing Staff MCP and authorization/File Audience isolation tests, zero-network preflight tests, typecheck/build, security/dependency gates and the full repository check. The conclusion is `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`; no mock or template is real OpenAI/ChatGPT/provider acceptance.
