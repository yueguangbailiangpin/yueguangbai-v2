# Staff MCP Production Transport and OAuth Specification

## Purpose

Define a disabled-by-default, fail-closed local implementation for exposing the existing Staff MCP limited read/draft tools through an HTTPS JSON-RPC protected resource without touching a real OpenAI, OAuth or Cloudflare resource.

## ADDED Requirements

### Requirement: Migration 0038 owns only production transport security state

The Change SHALL append continuous Migration `0038` and SHALL create only hashed OAuth subject bindings, token revocations, durable MCP replay, durable MCP rate state and MCP runtime controls. It SHALL reuse `staff_users` and immutable `audit_events` as authorities and SHALL NOT store a bearer token, Secret, prompt, Provider identifier or raw screenshot in replay, audit or logs. Ordinary replay JSON SHALL be text-only and no larger than 256 KiB.

#### Scenario: Migration is applied safely

- **WHEN** migrations `0001`-`0038` are applied once to a fresh local database
- **THEN** schema version becomes 38 and all MCP security constraints exist.

#### Scenario: Migration is skipped or repeated

- **WHEN** `0038` runs without schema 37 or is repeated
- **THEN** it aborts without partial DDL or version drift.

### Requirement: The HTTPS resource is strict and independently disabled

The Worker SHALL expose only `POST /mcp` for JSON-RPC and public RFC 9728 metadata at `/.well-known/oauth-protected-resource/mcp`. It SHALL reject non-HTTPS resource configuration, query parameters, batch payloads, malformed JSON, non-JSON content, oversized bodies, unsupported methods and malformed/missing bearer authorization. Disabled or incomplete MCP SHALL fail closed without making Web, `/health` or `/api/*` unavailable.

#### Scenario: An unauthenticated client discovers authorization

- **WHEN** a client requests the protected resource without a bearer token
- **THEN** it receives 401 and a sanitized Bearer challenge containing only the configured protected-resource metadata URL.

#### Scenario: MCP is disabled or invalid

- **WHEN** either switch, a required dependency or the D1 GLOBAL control is disabled/unavailable
- **THEN** MCP rejects without tool execution while ordinary Web/API health remains independent.

### Requirement: OAuth validation is audience-bound and fails closed

The resource server SHALL require exact authorization-server issuer metadata, authorization-code grant, PKCE S256, exact HTTPS authorization/token/JWKS/revocation endpoints, RS256 JWT signature, one signing key ID, exact issuer, configured audience and resource, valid expiry/issued-at/not-before and bounded token lifetime, unique required scope, subject, client ID, session ID and JTI. Unsupported headers/algorithms, ambiguous keys, unknown keys after one forced refresh, provider outage, revoked JTI or database failure SHALL reject.

#### Scenario: Anonymous valid token is verified

- **WHEN** a locally signed anonymous token and anonymous metadata/JWKS satisfy every claim and signature rule
- **THEN** the verifier continues to D1 binding and current Staff authorization without logging the token.

#### Scenario: A key rotates or provider fails

- **WHEN** `kid` is not in the first JWKS response
- **THEN** one forced refresh may select the new exact key; an absent/ambiguous key or refresh failure rejects.

### Requirement: One token maps to one current ACTIVE Staff

The keyed issuer/subject hashes SHALL select exactly one ACTIVE binding and one currently ACTIVE `staff_users` row. OAuth claims SHALL NOT grant roles, permissions, Team scope, Customer/Seller/Store access or File Audience. Current D1 authorization SHALL be recalculated on every catalog and tool call.

#### Scenario: Binding or Staff is not active

- **WHEN** the binding is missing/revoked/ambiguous or the Staff row is absent/inactive
- **THEN** the request is unauthenticated and no business data is returned.

#### Scenario: A token names business authority

- **WHEN** arbitrary role, permission, team or audience claims are present
- **THEN** they are ignored and cannot expand D1-derived authority.

### Requirement: Replay, rate, audit and kill switches are durable and composed

Production transport SHALL use D1-backed replay, fixed-window rate and GLOBAL/TOOL controls. Request keys and OAuth identifiers SHALL be keyed hashes. A repeated replayable request with the same canonical hash returns only a validated completed text result; a different hash conflicts; processing leases and records expire. Screenshot completion SHALL persist no response body and the same request SHALL return an explicit `REPLAY_NOT_AVAILABLE` without re-reading or returning image bytes. Rate limits apply globally and per tool. Every terminal tool outcome SHALL use immutable audit, and audit failure SHALL override success.

#### Scenario: A request repeats across adapters

- **WHEN** another adapter instance receives the same session/request ID and canonical arguments
- **THEN** D1 returns the original validated completed result without re-executing the application service.

#### Scenario: A screenshot request repeats

- **WHEN** a completed `read_task_screenshot_v1` request is repeated with the same request ID and arguments
- **THEN** D1 contains no image/base64 response and the request returns `REPLAY_NOT_AVAILABLE` without re-executing the file read.

#### Scenario: A control or audit dependency fails

- **WHEN** GLOBAL/TOOL control is disabled/unavailable or audit insertion fails
- **THEN** the tool fails closed and exposes no business result.

### Requirement: Expired security state has bounded cleanup

Production activation SHALL require an explicit cleanup switch. Each cleanup pass SHALL delete no more than a configured bound from each expired replay, rate and token-revocation table and SHALL fail closed on database error. It SHALL NOT delete subject bindings, runtime controls or immutable audit.

#### Scenario: Expired rows are cleaned

- **WHEN** cleanup is enabled and an MCP request arrives with expired and current rows present
- **THEN** only bounded expired replay/rate/revocation rows are deleted and current rows plus bindings, controls and audit remain.

#### Scenario: Cleanup is disabled or unavailable

- **WHEN** cleanup is not explicitly enabled or its D1 operation fails
- **THEN** production MCP does not activate or rejects the request while Web remains available.

### Requirement: Production composition uses supported Cloudflare bindings

The production Worker SHALL construct its application service from D1 and its token-status provider from a configured Cloudflare Service Binding. It SHALL NOT require JavaScript service objects in Wrangler vars. The token-status adapter SHALL send only keyed identifier fingerprints, use a fixed internal HTTPS target, enforce a timeout and bounded exact JSON response, reject redirects and fail closed on unavailable, malformed or inactive results.

#### Scenario: Supported bindings are present

- **WHEN** D1, the token-status Service Binding, managed hash Secret and complete non-secret configuration are present
- **THEN** the production runtime is constructible without mock or JavaScript object injection.

#### Scenario: Token-status binding is unsafe or unavailable

- **WHEN** the binding times out, redirects, returns an oversized/non-JSON/malformed body or reports inactive
- **THEN** token verification rejects without logging or persisting Provider identifiers.

### Requirement: Existing limited read/draft authority remains unchanged

The transport SHALL expose no new formal write tool. Existing Personal DENY, Team/Customer/Seller/Store scopes, File Audience and 404 isolation remain authoritative. A formal action SHALL return only a controlled origin-relative `/staff/...` path, where the employee must freshly authorize and explicitly confirm in Web.

#### Scenario: A formal action is requested

- **WHEN** an MCP draft or fact suggests an actual business mutation
- **THEN** no mutation occurs and the only next step is a controlled relative Staff Web path.

### Requirement: Templates, preflight and evidence are local and truthful

Checked-in staging and production templates SHALL keep MCP disabled and contain placeholders only. Preflight SHALL be zero-network, accept only local template or Git-external rendered configuration, print field/Secret names rather than values, reject placeholders/missing/unsafe/enabled-with-incomplete configuration and have no deploy mode. Acceptance SHALL say `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO` and SHALL not describe anonymous mocks/templates as real OpenAI/ChatGPT/provider verification.

#### Scenario: Checked-in template is inspected

- **WHEN** preflight reads a repository template
- **THEN** it reports blocked operator fields and Secret names, performs no fetch and emits no supplied values.

#### Scenario: Local gates pass

- **WHEN** all specified local tests and gates pass
- **THEN** only local implementation readiness is proven; real registration, issuer, JWKS, token, deployment, networking and production behavior remain unverified blockers.
