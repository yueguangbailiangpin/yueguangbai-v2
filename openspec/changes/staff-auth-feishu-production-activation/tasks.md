# Tasks: Staff Auth Feishu Production Activation

## 0. Governance

- [x] 0.1 Create an isolated Feature worktree from current main and record explicit owner authorization for the production activation sequence.
- [x] 0.2 Declare `NO_SCHEMA_CHANGE` and keep all unrelated external capability switches disabled.

## 1. Runtime and Preflight

- [x] 1.1 Replace the unconditional production Staff Auth hard lock with complete fail-closed Feishu configuration validation.
- [x] 1.2 Preserve provider bindings only when enabled and valid; always remove the test provider adapter in staging/production.
- [x] 1.3 Add a zero-network external-config activation preflight requiring managed-secret names without values.

## 2. Tests

- [x] 2.1 Test complete enabled runtime composition and sanitized 503 failure for every configuration-boundary drift.
- [x] 2.2 Test template-default disablement, origin/provider/scope/kill-switch drift and secret redaction.
- [x] 2.3 Run Staff Auth, runtime, preflight, typecheck, migration, strict OpenSpec and full repository gates.

## 3. Integration and Production Acceptance

- [ ] 3.1 Verify implementation against OpenSpec, sync/archive and integrate through ordinary non-force Git/PR flow.
- [ ] 3.2 Deploy the reviewed SHA with Staff Auth disabled and verify Web/API health.
- [ ] 3.3 Run the activation preflight against the external production config, enable only Staff Auth, and perform one real known-owner Feishu login/session/role check.
- [ ] 3.4 On any failure, restore `STAFF_AUTH_ENABLED=false`; on success, keep workbench, Drive, MCP and Scheduler disabled and record actual remote writes.
