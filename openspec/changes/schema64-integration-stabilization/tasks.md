# Tasks: Schema 64 Integration Stabilization

## 1. Database and integration baseline

- [x] 1.1 Verify the feature branch/worktree and preserve main.
- [x] 1.2 Stabilize migrations 0044–0064 and prove 0001–0043 immutability.
- [x] 1.3 Run fresh local migration, continuity, wrong-order, repeat, FK and integrity gates.

## 2. Staff identity and Feishu retirement

- [x] 2.1 Replace active Staff authentication with Cloudflare Access email bootstrap.
- [x] 2.2 Remove Feishu Staff auth, binding, workbench sync, callback and alert runtime/configuration.
- [x] 2.3 Replace invitation/binding UI and API contracts with direct email account management.
- [x] 2.4 Verify role defaults, Marketplace scope, PRIMARY/SUPPORT, Personal DENY and session invalidation.

## 3. API and Web stabilization

- [x] 3.1 Remove duplicate acquisition channel route registration.
- [x] 3.2 Align affected Contract/API/Web fixtures and release preflight.
- [x] 3.3 Resolve remaining route, DTO, pagination, finance and frontend test failures without weakening fail-closed behavior.

## 4. Documentation and final gates

- [x] 4.1 Update base specs and current docs to the final non-Feishu architecture.
- [x] 4.2 Run targeted tests, all typechecks, OpenSpec strict, complete repository check/build and browser acceptance.
- [x] 4.3 Review the final diff, commit by concern and push only `feature/frozen-portals-staff-acquisition-core`.

## 5. First production deployment repair

- [x] 5.1 Remove disabled Staff MCP Provider variables and service binding from release templates.
- [x] 5.2 Re-run release preflight tests, OpenSpec strict, repository gates and production dry-run.
- [x] 5.3 Route production `/ready` through the Worker readiness handler and prove it cannot fall through to the SPA shell.
- [x] 5.4 Resolve production bindings for the Scheduled Handler and prove file cleanup receives the R2 adapter.

## 6. First Owner production sign-in repair

- [x] 6.1 Add privacy-safe Cloudflare Access JWT rejection diagnostics without logging the token, email or claims.
- [ ] 6.2 Reproduce the production rejection, fix the evidenced validation boundary and retain fail-closed signature, issuer, audience, time and email checks.
- [ ] 6.3 Re-run Staff authentication gates, deploy the exact pushed commit and verify Owner session creation through the real Access flow.
