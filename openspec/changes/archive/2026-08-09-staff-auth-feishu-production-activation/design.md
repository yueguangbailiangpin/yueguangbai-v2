# Design: Staff Auth Feishu Production Activation

## Migration

No schema change. Existing `staff_users`, `feishu_staff_identities`, `staff_roles`, `staff_login_states`, `staff_auth_rate_limits`, `staff_sessions`, security events and audit facts remain authoritative.

## Runtime Boundary

The generic release template continues to require `STAFF_AUTH_ENABLED=false`. A separately reviewed external activation configuration may set it to `true`. The Cloudflare runtime accepts that value only when all Staff Auth fields form one exact production shape: provider FEISHU, current official authorization/token/identity endpoints, `contact:user.base:readonly`, one exact HTTPS application origin, same-origin callback, `/staff` return path, safe non-placeholder app/tenant identifiers, and present managed app/hash secrets.

When disabled, all Staff Auth provider configuration and test-adapter authority are removed before Hono receives bindings. When enabled and valid, the real provider bindings are retained but the in-process test adapter is still removed, so staging/production cannot replace Feishu with synthetic identity authority.

The Web redirect boundary independently allowlists the current official Feishu authorization origin, `https://accounts.feishu.cn`. It rejects every other HTTPS origin even after a structurally valid API response, so updating the official provider host does not weaken the arbitrary-redirect defense.

The release perimeter keeps its default cross-site API deny and admits one OAuth protocol exception: an origin-less `GET` top-level document navigation to the exact Feishu callback path. CORS/fetch requests, writes, sibling API routes, foreign `Origin` headers and non-document modes remain denied. The admitted navigation still has no authority until the application consumes the exact single-use state, exchanges the code with Feishu and resolves one pre-existing ACTIVE D1 identity.

Authentication-traffic cleanup deletes bounded expired rows from the login-state and rate-limit tables as two ordered statements. The tables are independent and the cleanup is not a business transaction; if either statement fails, login still fails before rate-limit, state, Provider or session creation. This preserves the original failure-closed contract while avoiding a remote D1 batch incompatibility observed during production activation.

## Preflight

The Staff Auth activation preflight accepts only an absolute rendered config outside Git. It validates the enabled Staff Auth shape, requires the two managed secret names to be declared without reading their values, and requires Scheduler, acquisition maintenance, Drive, Feishu workbench and Staff MCP switches to remain false. Output contains fixed error names only and performs no network, provider, deployment or mutation operation.

## Identity and Permission Boundary

Feishu proves only the provider subject. Callback handling must match `(tenant_key, open_id)` to one pre-existing ACTIVE D1 identity and ACTIVE Staff. It never creates Staff, assigns roles or imports Feishu permissions. Every protected request continues to resolve current D1 role, permission, Scope and Personal DENY.

## Test and Production Acceptance

Anonymous runtime tests prove complete enabled configuration succeeds and every provider/origin/scope/secret-boundary drift returns 503 without leaking values. Existing Staff Auth tests cover single-use state, provider callback, session issuance, authorization recalculation, logout, replay and failure paths. The first real production login is a separate acceptance step; if it fails, the kill switch is restored to false immediately.
