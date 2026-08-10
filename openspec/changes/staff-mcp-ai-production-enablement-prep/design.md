# Design: Staff MCP and AI Production Enablement Preparation

## Existing Capability Inventory

The baseline already provides:

- strict HTTPS `POST /mcp`, RFC 9728 resource discovery and isolated Web/API failure behavior;
- authorization-server metadata validation, PKCE S256, RS256 JWT/JWKS rotation, audience/resource/scope/lifetime checks and D1 ACTIVE Staff binding;
- HMAC-only token-status Service Binding with timeout, redirect, content-type, body-size and contract-drift rejection;
- D1 replay/rate/revocation/control state, bounded cleanup and immutable safe audit;
- D1-backed Application Services for eleven limited tools, with screenshot and exception tools fixed unavailable until their authoritative projections exist;
- formal actions restricted to controlled Staff Web paths.

This Change does not replace any of those components.

## Public Metadata and Domain Boundary

Production configuration adds:

- `STAFF_MCP_RESOURCE_DOCUMENTATION_URL`
- `STAFF_MCP_RESOURCE_POLICY_URL`

Both values must be exact HTTPS URLs without credentials, query or fragment, must share the MCP resource origin, must have non-root paths, must be distinct from `/mcp` and its well-known metadata path, and must not contain placeholders. They are published as RFC 9728 `resource_documentation` and `resource_policy_uri`.

The local preflight additionally requires `workers_dev=false`, `preview_urls=false`, exactly one custom-domain route and exact route-host alignment with `APP_ORIGIN`. It does not fetch DNS, TLS or page contents; those remain external evidence.

Unauthorized resource responses retain the sanitized `resource_metadata` link and add only the static minimum scope `staff:mcp`. No token, claim or Provider error is reflected.

## Explicit Tool Capability Gate

Production configuration adds `STAFF_MCP_ENABLED_TOOLS`, a comma-separated non-empty exact set of frozen `STAFF_MCP_TOOL_NAMES`.

Parsing is strict:

- whitespace is trimmed only around entries;
- empty, duplicate or unknown entries invalidate production runtime construction;
- `read_task_screenshot_v1` and `list_staff_exceptions_v1` invalidate construction until separate authoritative providers are implemented and approved;
- every known tool not explicitly enabled is passed to the existing adapter disabled set;
- `STAFF_MCP_DISABLED_TOOLS` may further reduce the catalog but can never re-enable a tool.

The checked-in staging/production templates remain disabled and contain a placeholder enabled-tool list. A real rendered file can begin with read-only tools and later add draft tools through a separately approved configuration change. No formal-write tool exists in the registry.

## Git-external Activation Evidence

The preflight accepts `--config <absolute Git-external file>` and `--evidence <absolute Git-external file>`. Repository-located files, symlink escapes, unreadable files and unknown arguments are rejected.

The evidence document is non-secret and versioned. It records:

- environment and exact MCP resource;
- exact documentation and privacy/data-use policy URLs;
- one client-registration mode: Client ID Metadata Document, pre-registration or Dynamic Client Registration;
- mode-specific public client ID/metadata URL or registration endpoint;
- one or more exact HTTPS redirect URIs and PKCE method `S256`;
- the exact enabled-tool set.

The evidence validator requires equality with the rendered runtime configuration. It prints only stable field names, modes and validation errors, not client IDs, redirect URIs or supplied values. Passing produces `LOCAL_CONFIG_AND_EVIDENCE_VALID_PRODUCTION_NO_GO`, never production GO.

The evidence file does not prove that OpenAI/ChatGPT, the authorization server, DNS, TLS, privacy pages or callbacks exist. Those remain operator checks and require separate authorization.

## Client Registration Guidance

Operators choose in this order after checking the selected authorization server and client:

1. use pre-registered client information when a trusted relationship already exists;
2. otherwise use a Client ID Metadata Document only when authorization-server metadata advertises support;
3. use Dynamic Client Registration only when the authorization server advertises a registration endpoint and the owner approves it.

Every redirect URI is copied from the selected real client, registered exactly and recorded only in the Git-external evidence file. Authorization code plus PKCE S256 and the exact `resource` value are mandatory. This repository does not implement or execute registration.

## Test and Evidence Strategy

New tests cover public metadata URLs, challenge scope, missing/invalid public metadata configuration, exact enabled-tool subsets, invalid/unavailable tool names, custom-domain mismatch and activation-evidence mode/redirect/catalog drift.

Existing named tests remain the authoritative failure evidence for:

- token-status timeout and active abort;
- redirect, non-JSON, oversized and malformed token-status responses;
- cross-instance replay, conflict and screenshot `REPLAY_NOT_AVAILABLE`;
- immutable audit insertion failure overriding a business result.

The targeted production check executes all of those tests. Documentation must report the actual command result and must not infer external acceptance.

## Security, Privacy and Audit

The new fields are public non-secret URLs and a tool-name catalog. No client Secret, bearer token, Provider identifier, prompt, customer text or file byte is added to configuration, evidence, metadata, log, replay or audit.

D1 remains the authority for Staff, role, Personal DENY, Team/Department, Customer/Seller/Store/Marketplace scope and business facts. Formal finance/order/permission/approval/external writes remain Web-only. Missing File Audience/Read Intent or exception projection remains `PROVIDER_UNAVAILABLE`/disabled rather than an empty authoritative result.

## Migration Decision

`NO_SCHEMA_CHANGE`. Existing schema and Migration 0038 already enforce every durable fact used by this Change.

## Rollback

1. Disable the environment MCP switch; if unavailable, disable D1 `GLOBAL/staff-mcp`.
2. Verify `/mcp` rejects and Web, `/health` and `/api/*` remain healthy.
3. Preserve schema, bindings, revocations, runtime controls and immutable audit; do not down-migrate or truncate.
4. Restore a schema-compatible prior Worker only with MCP disabled.
5. Re-enable only after custom-domain/TLS, metadata/policy pages, client registration, redirects, scope/audience, token-status, tool catalog, audit and rollback drills are revalidated.

## Rejected Alternatives

- Keep an implicit all-tools default: rejected because missing configuration would widen production capability.
- Put legal/privacy prose inside generated metadata: rejected because the reviewed policy must live at a stable owner-controlled public page.
- Store real client IDs, redirects or approvals in Git: rejected because they are environment-specific external evidence and may drift.
- Add a new D1 activation table: rejected because the existing runtime control and Git-external operational evidence already cover distinct responsibilities without creating a second authority.
