# Tasks: Scheduled Operations and Observability

## 0. Inventory and Contract

- [ ] 0.1 Inventory every expiry, outbox, compensation, orphan and retention service plus current indexes.
- [ ] 0.2 Freeze Job names, frequency, batch size, time budget, alert thresholds and Staff permissions.

## 1. Migration and Runtime

- [ ] 1.1 Decide with evidence whether run/lease facts require the next consecutive Migration.
- [ ] 1.2 Add fixed Job Registry, run/lease/cursor repository and default Worker Scheduled Handler.
- [ ] 1.3 Wire existing services without duplicating domain rules or bypassing idempotency.

## 2. Observability and API

- [ ] 2.1 Emit privacy-safe metrics/logs and persist last-success/backlog/failure facts.
- [ ] 2.2 Add Staff-safe health list/detail and controlled retry contracts with permission checks.
- [ ] 2.3 Configure independent primary alerting plus optional Feishu notification fallback.

## 3. Tests and Acceptance

- [ ] 3.1 Test concurrent Scheduler, duplicate delivery, lease expiry, crash recovery and continuation.
- [ ] 3.2 Test each existing Job's due/not-due/partial/failure/retry path with controlled time.
- [ ] 3.3 Test metrics, alert thresholds, suppression, DTO privacy and Staff authorization.
- [ ] 3.4 Run local Scheduled Handler, D1, R2 failure, full workspace, strict OpenSpec and formal Verify gates.

## 4. Rollback and Release

- [ ] 4.1 Verify global/per-Job kill switches and expired-lease recovery before production enablement.
- [ ] 4.2 Keep production schedules disabled until runbooks, alert receiver and rollback approval exist.
