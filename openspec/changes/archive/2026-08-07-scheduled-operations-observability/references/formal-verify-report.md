# Formal Verify: scheduled-operations-observability

Verified on 2026-08-07 Asia/Shanghai against the archived proposal, design, tasks, synchronized delta specification and main `scheduled-operations` specification. Ponytail remained off throughout planning, implementation, review and acceptance.

## Scorecard

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 14/14 tasks, 7/7 requirements |
| Correctness | PASS — 7/7 requirements and 18/18 scenarios have implementation and test evidence |
| Coherence | PASS — Migration 0031, strict DTOs, domain services, leases, cursors, alerts and Staff authorization follow the design |
| Findings | 0 critical, 0 warning, 0 suggestion |

## Requirement and scenario evidence

1. The bounded handler and registry live in `apps/api/src/scheduled-operations/runner.ts`; registered jobs use injected time, bounded batches, persisted safe cursors and round reset. `runner.test.ts` covers stable ordering, partial continuation, earlier-row rescan, duplicate Cron and truthful outcomes.
2. Versioned D1 leases and conditional completion protect concurrency and crash recovery. The runner suite covers a real blocked concurrent run, pre-expiry skip, post-expiry takeover and rejection of a stale token's late cursor/last-fact update. Domain idempotency, version and unique guards remain the final side-effect boundary.
3. Reservation and JP-only instruction expiry, Outbox delivery, instruction-file orphan reconciliation and Staff-auth retention cleanup call their existing domain services. Dedicated runner and `asset-reconciliation.test.ts` fixtures cover due/not-due, retention, active-link protection, dry-run, R2 success/failure, bounded backlog, retry and repeated delivery. `instruction_expiry` reports `LEGACY_JP_ONLY`; Drive and Feishu jobs report `HARD_DISABLED`.
4. `signals.ts` and `alerts.ts` ingest only fixed schemas and persist threshold, cooldown, suppression, recovery and incident facts. Tests cover HTTP 5xx, stale/stuck/backlog, file failure, login anomaly, primary sink failure and future Feishu failure, including duplicate observation, recovery, recurrence, disabled/local adapters and sink-failure recursion protection.
5. Health and alert summary routes require `AUDIT_VIEW`; alert ACK, manual run and dead-letter replay require effective `SCHEDULED_OPERATIONS_RUN` for ACTIVE Staff. Route, authorization and contract tests cover concealment, scope, hard deny, Personal DENY, strict runtime parsing, idempotency conflict and safe DTO projection.
6. Global and per-job kill switches stop lease acquisition for scheduled and manual execution; Drive and Feishu stay hard disabled. Tests verify disabled paths write no run or business fact and that already committed domain facts use forward recovery.
7. `commands.ts` replays only an exact quarantined Outbox dead-letter/event pair and never accepts or returns payload. Idempotency-Key plus request hash handles repeat/conflict/concurrent commands; audit facts are fixed and low cardinality.

## Migration, privacy and recovery evidence

- Consecutive Migration 0031 defines final run outcomes, enablement/version/lease/cursor/last facts, operational signals, alert state/observations, payload-free dead letters and versioned manual command facts. It registers `SCHEDULED_OPERATIONS_RUN` with minimal authorization while existing ACTIVE/scope/hard-deny/Personal-DENY evaluation remains authoritative.
- Fresh and sequential `0001 -> 0031` verification passed with schema version 31, 141 tables, 261 triggers, `integrity_check=ok` and zero foreign-key errors. Wrong-order, repeat and partial-DDL guards all rejected invalid application.
- Runtime contracts accept fixed enums, UTC non-negative safe integers and bounded counts; unknown/raw payload, object key, token, WeChat, financial and customer fields are rejected or never projected.
- The runbook documents global/per-job disable, dry-run with zero business effects, lease takeover, Outbox quarantine/replay, R2 deferred retry, UTC truth/Asia-Shanghai display, local/disabled alert adapters, local-only Cloudflare configuration, backup/restore and forward recovery. No production deployment, external credential, online D1 write, Feishu call or Cloudflare resource mutation occurred.

## Executed gate evidence

- M6-focused Vitest: PASS, 9 files / 64 tests.
- Full `npm run check`: PASS, including 163 files / 1106 tests, all workspace typechecks/builds, D1 checks and Worker dry-run. The API build was repeated with a sandbox-safe Wrangler log path and exited via `--dry-run` without deployment.
- OpenSpec `--all --strict`: PASS, 34/34 items.
- Secrets scan: PASS, 894 project files.
- `npm audit`: exactly 2 pre-existing high entries (`react-router` and `react-router-dom`) from the documented RSC advisory; 0 critical and no dependency or lockfile change.
- `git diff --check`: PASS. `.github/workflows` contains only `.gitkeep`, so no production auto-deployment workflow exists.

Final assessment: the archived change and synchronized main specification match the implemented, tested capability and are ready for independent PR review.
