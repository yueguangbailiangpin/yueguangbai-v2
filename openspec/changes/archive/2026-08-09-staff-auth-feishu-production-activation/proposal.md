# Change Proposal: Staff Auth Feishu Production Activation

## Why

The production Feishu application, managed secrets, callback URL and initial D1 Staff identity now exist with explicit owner authorization, but the Cloudflare runtime still hard-rejects every release where `STAFF_AUTH_ENABLED=true`. Enabling the variable therefore makes the whole Worker fail closed instead of activating the already implemented Staff login flow.

## What Changes

- Keep checked-in staging and production templates disabled by default.
- Permit `STAFF_AUTH_ENABLED=true` only when the release runtime has the exact official Feishu endpoints, same-origin callback, fixed scope/return path and complete managed-secret bindings.
- Preserve Staff Auth provider bindings only for an enabled and validated release; strip them while disabled and always strip the test provider adapter in staging/production.
- Add a zero-network, Git-external activation preflight that validates configuration by managed-secret name without reading or printing values.
- Add runtime, failure-closed, preflight and existing Staff Auth regression evidence.

## Out of Scope

- No Migration, schema, role, permission, Personal DENY, Staff Scope, session contract or business-fact change.
- No automatic Staff provisioning and no authority derived from Feishu roles or headers.
- No Feishu workbench sync/callback, Drive, Staff MCP, Scheduler or acquisition-maintenance activation.
- No Secret value in Git, logs, test fixtures or preflight output.

## Migration and Contract Impact

`NO_SCHEMA_CHANGE`. The activation uses the existing Staff Auth API, D1 identity/session model and `0036` Staff Auth schema. D1 remains the sole Staff/role/permission authority.

## Rollback

Set `STAFF_AUTH_ENABLED=false` and redeploy the same reviewed SHA. Disabled releases strip all Staff Auth provider authority while leaving D1 users, identities, roles, audit records and business facts intact. If real login acceptance fails, rollback occurs before enabling any other external capability.

## Acceptance

Local acceptance requires strict OpenSpec, API/contracts typecheck, Staff Auth/runtime/preflight tests, Wave 13 verifier, migration guards and the full repository gate. Production acceptance additionally requires an owner-authorized real known-Staff Feishu login and session/role verification; failure returns the switch to false.
