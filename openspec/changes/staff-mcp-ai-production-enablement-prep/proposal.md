# Change Proposal: Staff MCP and AI Production Enablement Preparation

## Why

`origin/main` already contains the disabled-by-default `/mcp` transport, OAuth 2.1/PKCE/JWKS verifier, D1 security state, token-status Service Binding and D1-backed read/draft tools. Rebuilding those layers would duplicate accepted work.

Three production-enablement gaps remain:

- RFC 9728 metadata does not publish reviewed developer documentation and data-use/privacy policy URLs, and the Bearer challenge does not advertise the minimum `staff:mcp` scope recommended by the current MCP authorization specification.
- Production runtime advertises every currently constructible tool when no operator tool list is supplied, so a phased read-only then draft rollout is not fail closed.
- The zero-network preflight validates transport fields but does not pair the rendered configuration with a Git-external, machine-checkable record of custom-domain/public-policy URLs, exact client-registration mode and redirect URIs, and the explicitly approved tool catalog.

Existing tests already cover token-status timeout, redirect, non-JSON/oversized/malformed responses, durable replay, screenshot non-replayability and immutable-audit failure. This Change preserves and reports those tests rather than duplicating them.

## What Changes

- Require same-origin HTTPS developer-documentation and privacy/data-use policy URLs and publish them in protected-resource metadata.
- Add `scope="staff:mcp"` to unauthorized Bearer challenges.
- Require an explicit production enabled-tool allowlist. Missing, duplicate, unknown or currently unavailable tools fail closed; tools not listed are absent from discovery and direct calls remain disabled.
- Extend the zero-network preflight with custom-domain and public-URL checks plus a Git-external activation-evidence document covering client-registration mode, exact redirect URIs, PKCE S256 and the enabled-tool catalog.
- Add an example evidence template, a minimal owner/operator activation guide and refreshed local acceptance evidence.

## Out of Scope

- No real OpenAI/ChatGPT workspace, application, client registration, redirect registration, account, login, token, Provider request or Secret.
- No Cloudflare deploy, domain/DNS mutation, remote Migration, production D1/R2/Drive/Feishu/MCP write or production-data access.
- No new MCP business tool and no formal finance, order, permission, approval or external-write action.
- No File Audience/Read Intent provider or exception projection. `read_task_screenshot_v1` and `list_staff_exceptions_v1` remain unavailable in production.
- No historical order, product, seller-number or R2 historical-image import.

## Migration and Contract Impact

`NO_SCHEMA_CHANGE`. Migration `0038_staff_mcp_production_transport_oauth.sql` already owns hashed binding, revocation, replay, rate and runtime-control facts, and current schema 43 includes it unchanged. This Change adds configuration, public metadata, capability gating, preflight evidence and tests only.

The runtime contract becomes stricter: production construction requires reviewed public documentation/policy URLs and an explicit non-empty subset of currently available Staff read/draft tools.

## Rollback

Disable `STAFF_MCP_ENABLED` first or disable the D1 `GLOBAL/staff-mcp` control if environment configuration is unavailable. Preserve Migration 0038 and all audit/binding/control facts. A schema-compatible prior Worker may be restored only while MCP remains disabled. Removing the new metadata or tool gate is not an approved live rollback because it would widen discovery or capabilities.

## Acceptance

Local acceptance requires strict target and all-Change OpenSpec validation, Staff MCP production checks, preflight/evidence tests, metadata/challenge tests, explicit tool-gate tests, the already existing timeout/redirect/non-JSON/replay/audit-failure tests, typecheck, security/dependency gates and the full repository check. The conclusion remains `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO` until separately authorized real account, domain, registration, privacy, deployment and production drills are completed.
