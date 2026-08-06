# Tasks: Feishu Staff Workbench PoC and Integration

## 0. Anonymous PoC

- [ ] 0.1 Verify current free-plan OAuth, Task v2/Bitable, callback, scope, quota and admin capabilities with anonymous data.
- [ ] 0.2 Record API call model for eight Staff/two hundred daily orders and choose the smallest supported workbench surface.
- [ ] 0.3 Obtain separate explicit authorization before creating or changing real Feishu resources.

## 1. Contracts and Migration Decision

- [ ] 1.1 Freeze summary whitelist, actions, callback validation, conflict, retry and deep-link contracts.
- [ ] 1.2 Inventory existing identity/task/outbox schema and justify Migration or allocate the next consecutive one.
- [ ] 1.3 Add runtime schemas and secret/sensitive-field static verifiers.

## 2. Adapter and Sync

- [ ] 2.1 Implement testable Feishu OAuth, Task/Bitable and callback adapters using current official APIs.
- [ ] 2.2 Implement Outbox coalescing, idempotent create/update, retry/dead-letter and mirror reconciliation.
- [ ] 2.3 Route inbound task actions through current D1 permission/versioned Application Services.
- [ ] 2.4 Add controlled Web deep links for every formal action.

## 3. Tests and Acceptance

- [ ] 3.1 Test identity mapping, inactive/unknown Staff, signature, replay, duplicate callback and version race.
- [ ] 3.2 Test Provider outage/429/5xx, backlog, retry, rebuild and D1 business independence.
- [ ] 3.3 Test summary field whitelist and absence of full WeChat, screenshots, proofs and finance facts.
- [ ] 3.4 Run anonymous eight-Staff/two-hundred-order load, mainland network and free-quota acceptance.
- [ ] 3.5 Run full workspace, security, strict OpenSpec and formal Verify gates.

## 4. Rollback and Release

- [ ] 4.1 Verify separate login/sync/callback kill switches and mirror rebuild from D1.
- [ ] 4.2 Keep real tenant enablement and production data sync separately approved.
