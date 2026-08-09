# Tasks: Pre-Wave 13 Baseline Conformance Audit

## Historical Remote Audit Work

- [x] Confirm historical formal main `f28c52a36e9498c37453a4a12755d9ad8459ae65`.
- [x] Confirm historical audit branch and merge base.
- [x] Inspect authority, route registration, implementation, contracts, migrations, tests and verifier source.
- [x] Create historical requirement traceability and frontend readiness inventory.
- [x] Record P1 findings, governance conflict, frontend blockers and local validation requests.
- [x] Record the historical remote semantic review and low-risk Ponytail candidates without running Ponytail.

## Historical Local Supplement

- [x] Record the historical schema-26 local gate and D1 baseline evidence already produced on the audit branch.
- [x] Record that historical OpenSpec strict validation ran before the Wave 13 implementation changes.
- [x] Preserve that historical schema-26/test evidence does not validate the later Wave 13 Feature.

## Wave 13 REMOTE_IMPLEMENTATION_EVIDENCE

- [x] Update the existing audit document with Staff Auth, File HTTP, Order Evidence, Buyer Refund and Migration 0027 source evidence.
- [x] Update the existing traceability matrix with 52 Requirements / 104 Scenarios and current static classifications.
- [x] Update the existing frontend readiness inventory with 30 active additions and static total 138.
- [x] Record D-014 Staff authority and Feishu authentication boundary without erasing D-004 history.
- [x] Record `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` as an approved Wave 13 scope reduction assigned to Wave 15.
- [x] Record constrained logout-all COMMITTED replay semantics.
- [x] Record Default App, D1, R2, service rollback and recursive DTO test source.
- [x] Keep all P1 findings at `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` rather than formally closed.
- [x] Keep the audit conclusion `NO_GO_PENDING_LOCAL_VALIDATION`.

## Current Local Validation

- [x] Install dependencies for the current Feature through the authorized local workflow.
- [x] Run the current repository full check gate.
- [x] Run current Vitest, typecheck and build.
- [x] Apply and verify 0001–0027 against real local D1.
- [x] Upgrade a schema-26 fixture to 27 and verify Customer Auth preservation.
- [x] Run real D1 state/session/logout-all/approve/refund transaction behavior.
- [x] Run repository Mock R2 put/receipt/HEAD/compensation/delete-pending/cleanup coverage; production R2 remains unverified.
- [x] Record real R2 as `NOT_PRODUCTION_VERIFIED`; it is an external Production GO gate, not an audit-archive acceptance item.
- [x] Recount current schema, tables, triggers, views, test files and tests.
- [x] Re-run strict OpenSpec validation after the File HTTP semantic scope reduction.
- [x] Run the repository OpenSpec Verify workflow.
- [x] Validate production-entrypoint Staff login and every Staff route family in the authorized local workflow.
- [x] Record browser, approved Feishu app and real network validation as later release gates, not historical audit evidence.
- [x] Preserve the Controller decision that Ponytail was skipped for this historical audit; later read-only reviews do not rewrite that snapshot.

## Integration and Release Pending

- [x] Record that the Wave 13 implementation later passed authorized Integration; this audit closeout adds no implementation behavior.
- [x] Record that Wave 13 later entered main through the authorized process; the historical pending state remains unchanged above.
- [x] Record that any later PR/main action required project authorization; the historical audit itself created none.
- [x] Record deployment as not executed and still governed by the final Production GO workflow.

## Historical Explicit Non-Actions Snapshot

- [x] Preserve the historical remote snapshot: no npm/Vitest/D1/R2/Wrangler execution had yet been performed.
- [x] Preserve the historical remote snapshot: no OpenSpec Verify had yet been executed after the Wave 13 semantic update.
- [x] Preserve that no Ponytail review was run in the historical audit.
- [x] Preserve that the historical remote snapshot created no PR, Integration, deployment or main advancement.

## Controller Closure Status（2026-08-03）

当前总控已确认本地完整门禁、Local D1、26→27 升级、R2 Mock、Default App、OpenSpec strict、正式 Verify 和 P1 重新分类均已完成。生产 R2、真实飞书、浏览器、中国大陆网络、部署和 main 推进保持未完成；这些项目不得因本次 Controller Closure 被误标完成。

`WAVE13_IMPLEMENTATION_ACCEPTED=yes`

`P1-01=CLOSED`、`P1-02=CLOSED`、`P1-03=CLOSED`；历史 NO_GO 与此前其他 P2/P3/历史风险保持保留。

`WAVE13_READY_FOR_INTEGRATION`

`PRODUCTION_GO=no`

## Final Archival Reconciliation（2026-08-09）

- [x] Confirm the original three P1 findings remain historically visible and formally closed only by the later Controller Closure evidence.
- [x] Confirm the current main descendant contains the accepted Wave 13 implementation and all later local gates without rewriting the historical counts.
- [x] Keep production R2, real Feishu, real networks, deployment and rollback as explicit `NOT_PRODUCTION_VERIFIED` items in the final owner checklist.
- [x] Confirm this Change has no unresolved local implementation finding and may be archived as an audit record.
- [x] Run strict OpenSpec validation after sync/archive and complete ordinary non-force Git integration.
