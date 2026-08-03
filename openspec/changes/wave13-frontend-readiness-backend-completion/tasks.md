# Tasks: Wave 13 Frontend Readiness Backend Completion

本文件记录远程 Feature 上的源码完成状态。`[x]` 仅表示对应源码、Contract、Migration、测试源码或静态门禁源码已经写入；不表示 npm、Vitest、D1、R2、Wrangler、OpenSpec CLI 或浏览器验收已经运行。当前总状态固定为 `NO_GO_PENDING_LOCAL_VALIDATION`。

## 0. Authority and Controller Decisions

- [x] 0.1 读取并对齐治理、审计、Decision、产品规则、Contract、架构、Migration 和现有源码。
- [x] 0.2 冻结 Staff 权威、`PRICE_MISMATCH`、`/api/*`、10 分钟 state、12 小时绝对 Session、0027 最小范围和 Wave 16 告警边界。
- [x] 0.3 保持单一 Change 目录并维护 Proposal、Design、Tasks 和六份 Delta Spec。
- [x] 0.4 记录 `REMOTE_IMPLEMENTATION_EVIDENCE`，不以远程静态审查代替本地验收。
- [x] 0.5 每笔远程写入前核验 Feature HEAD，并只使用普通 fast-forward Commit。

## 1. Migration Analysis

- [x] 1.1 盘点 Staff、Customer Auth、File、Evidence、Refund、Audit、Outbox 和 Idempotency 能力。
- [x] 1.2 冻结 `0027_staff_auth_sessions.sql`：`session_version` 加四张 Staff Auth 表，不复用 Customer Auth 表。

## 2. Migration 0027

- [x] 2.1 实现连续 Migration `0027_staff_auth_sessions.sql`。
- [x] 2.2 实现 CHECK、unique、FK、生命周期、expiry、immutable-event 和索引约束。
- [x] 2.3 添加前向升级与 `apps/api/src/wave13-migration-0027.test.ts`，现有 Staff 默认 `session_version=1`。

## 3. Contracts

- [x] 3.1 添加 Staff Auth、内部 Session 和 Provider 配置 Contract。
- [x] 3.2 添加 File HTTP、Staff Order Evidence 和 Staff Buyer Refund Contract。
- [x] 3.3 添加 `PRICE_MISMATCH` 和正式 HTTP status mapping，保持 `/api/*` 唯一路径。

## 4. Staff Auth Provider Adapter

- [x] 4.1 实现环境配置化飞书授权、v2 code exchange 和 identity 读取 Adapter。
- [x] 4.2 校验 tenant、稳定 `open_id` 和可选 `user_id` 冲突，不自动创建 Staff。
- [x] 4.3 提供 Fake Provider、timeout 和 fail-closed 配置边界。

## 5. Staff Login State

- [x] 5.1 实现 `POST /api/staff-auth/login/start`、Origin/return allowlist 和固定 10 分钟 TTL。
- [x] 5.2 实现 hashed state 原子单次消费和 callback replay 拒绝。
- [x] 5.3 增加认证流量触发的 24 小时有界清理：每张临时表每次最多 100 行，失败时在 state/session 创建前以 `DEPENDENCY_UNAVAILABLE` 关闭；第一版不引入 Cron 或 Scheduled Handler。

## 6. Internal Staff Session

- [x] 6.1 实现 256-bit opaque token、hash 持久化、`__Host-` Cookie 和固定 12 小时绝对 TTL。
- [x] 6.2 实现 current session、logout、Cookie clear 和 Session revoke。
- [x] 6.3 实现 logout-all：`session_version` 增量、全部 ACTIVE Session 撤销和受限 COMMITTED replay。

## 7. Staff Session Middleware

- [x] 7.1 校验 ACTIVE、expiry、revoke、`session_version` 和签发 `authorization_version`。
- [x] 7.2 每次请求复用 D1 resolver 重算 Role、Permission、Personal DENY、Team、Department 和 Data Scope。
- [x] 7.3 统一 401/503/security-event 边界并忽略飞书/客户端 Actor Header。

## 8. Default App Registration

- [x] 8.1 在 `/api/*` 下先注册 Staff Auth，再注册受保护 Staff 路由；无 `/api/v2` alias。
- [x] 8.2 为全部 `/api/staff/**` 与 Internal Finance 安装 Staff Session Middleware。
- [x] 8.3 保留 Fake Provider 测试注入 seam，生产入口不接受直接 Actor 注入。

## 9. File HTTP Flow

- [x] 9.1 注册五个有真实业务消费者的 Purpose-bound intent 路由；`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 保留全局常量但正式延期到 Wave 15。
- [x] 9.2 实现 Buyer、Seller、Staff 的 multipart upload 和 complete HTTP 生命周期。
- [x] 9.3 实现短期 read-intent create/consume；Link/Grant 继续只由业务命令创建。
- [x] 9.4 删除内部沟通 Purpose 的活动 route 和 `STAFF_UPLOADS` mapping，不创建通用 Link/Grant 替代。

## 10. Staff Order Evidence API

- [x] 10.1 实现 SQL Scope 过滤的 list/detail 和安全截图引用。
- [x] 10.2 复用现有两小时 request-changes 服务。
- [x] 10.3 实现单 batch atomic approve、`PRICE_MISMATCH` ack/reason、Formal Order、Snapshot、Payable、Audit、Outbox、Idempotency 和 Assertions。

## 11. Staff Buyer Refund API

- [x] 11.1 实现 `BUYER_REFUND_VIEW` scoped list/detail。
- [x] 11.2 复用 append-only Payment 服务和明确 Staff proof audience。
- [x] 11.3 复用 Reversal 服务，保留 OVERPAID 和不可变事实。

## 12. HTTP Contract Hardening

- [x] 12.1 为 Wave 13 路由添加 bounded exact-key JSON/part 校验和条件 mismatch 校验。
- [x] 12.2 添加 bounded limit/cursor/query 解析源码。
- [x] 12.3 冻结 `/api/*`、401/403/404、Mismatch、Version、Idempotency、File 和 Dependency mapping。

## 13. Audit, Security Events, Outbox and Idempotency

- [x] 13.1 实现 Staff Auth immutable security events；实时告警仍属于 Wave 16。
- [x] 13.2 Evidence/Refund 复用 Audit、Outbox 和 Idempotency；Mismatch facts 进入正式事件。
- [x] 13.3 为 composite boundary 添加 transaction assertion 和确定性 FAILED marking。
- [x] 13.4 logout-all 丢失响应时只读匹配已 COMMITTED 记录，不创建新 Claim、不重算授权、不重复写事实。

## 14. Unit Test Source

- [x] 14.1 添加 state/token/Cookie/redirect/absolute expiry/Provider config 测试源码。
- [x] 14.2 添加 parser、exact-one-file、Purpose/Visibility 测试源码。
- [x] 14.3 添加 mismatch conditional validation 与 request-hash 测试源码。
- [x] 14.4 添加 logout-all 同 Cookie/同 Key replay、不同 Key、不同 revoke reason、过期、伪造和并发测试源码。

## 15. Route Test Source

- [x] 15.1 添加 Staff Auth start/callback/session/logout/logout-all 真实 Route 测试源码。
- [x] 15.2 添加五个活动 Purpose 的 File HTTP 与 R2 故障测试源码。
- [x] 15.3 添加 Staff Order Evidence 和 Buyer Refund Route 测试源码。

## 16. Production Entrypoint E2E Source

- [x] 16.1 添加 Fake Feishu Provider → login/start → callback → Set-Cookie → Default App → Middleware 的真实请求测试源码。
- [x] 16.2 为 Assignment、Catalog、Review、Seller Settlement、Settlement Proof、Internal Finance、Staff File、Order Evidence、Buyer Refund 添加有效 Session、无 Session、Permission、Scope 和 Header bypass 矩阵源码。
- [x] 16.3 代表性 File、Evidence、Refund 操作全部使用 `/api/*`；没有直接 `context.set(staffAuthorization)`。

## 17. D1 Migration Test Source

- [x] 17.1 添加空库执行 0001–0027、schema 27、integrity 和 FK 检查入口。
- [x] 17.2 添加匿名 schema 26 → 27 升级与 Customer Auth schema/row-count 不变测试源码。
- [x] 17.3 添加 duplicate/lifecycle/FK/immutable-trigger/STRICT/assertion 负向测试源码。

## 18. D1 Behavior Test Source

- [x] 18.1 添加 state 并发单次消费、Session revoke/version 和 logout-all replay 源码。
- [x] 18.2 添加真实 `approveOrderEvidenceAtomically`、Refund Payment、Refund Reversal 最终 batch 故障注入与无部分事实断言源码。
- [x] 18.3 添加 integrity、foreign-key、STRICT、Trigger 和 assertion 检查入口。

## 19. R2 Failure and Compensation Test Source

- [x] 19.1 添加 put、receipt、HEAD 故障源码。
- [x] 19.2 添加 R2 put 后 D1 final commit 失败与 compensation delete 成功源码。
- [x] 19.3 添加 delete 失败、`DELETION_PENDING`、`FILE_COMPENSATION_REQUIRED` 和 cleanup retry 源码。

## 20. Security Verifier Source

- [x] 20.1 添加 Staff Middleware、`/api/v2`、authority Header 门禁源码。
- [x] 20.2 添加 Auth secret、Provider token、Session hash 和 object-key 泄漏门禁源码。
- [x] 20.3 添加 FilePurpose、Visibility、通用 Link/Grant、Mismatch 和 Refund/Settlement Permission 隔离门禁源码。

## 21. DTO Isolation Verifier Source

- [x] 21.1 保留 Buyer/Seller 历史 DTO 门禁，并添加 Wave 13 递归运行时响应对象检查源码。
- [x] 21.2 检查 Seller DTO 不包含 Buyer Refund 成本、proof 或内部利润。
- [x] 21.3 检查 Staff DTO 不包含 Provider/Session secret、token hash 或 R2 authority；一次性 upload token 仅允许出现在首次 intent 响应指定路径。

## 22. Pre-Wave13 Audit Closure Source

- [x] 22.1 更新既有 Decision、Audit、Traceability、Readiness 和 Audit Tasks，不创建第二套审计。
- [x] 22.2 静态重算：原 108 + Wave 13 活动新增 30 = 138；延期 Purpose 不计入活动端点。
- [x] 22.3 将 P1 标记为 `IMPLEMENTED_AWAITING_LOCAL_VALIDATION`，总体保持 `NO_GO_PENDING_LOCAL_VALIDATION`。

## 23. Local Validation

- [x] 23.1 运行依赖安装和完整 `npm run check`。
- [x] 23.2 运行真实本地 D1 migration/behavior 与 R2 Mock fault/compensation 验收；本地配置无真实 R2 binding，生产 R2 未运行。
- [x] 23.3 记录真实 test files/tests/build/counts/warnings；完整门禁为 111 files / 571 tests，typecheck/build 通过，非致命 npm/Wrangler 警告已记录。

## 24. OpenSpec Validation

- [x] 24.1 历史上曾对本 Change 执行 strict validation；本次语义更新后尚未重新运行。
- [x] 24.2 历史上曾执行 repository-wide strict validation；本次语义更新后尚未重新运行。
- [x] 24.3 重新运行 OpenSpec CLI strict validation，确认 52 Requirements / 104 Scenarios 和 Delta 结构。

## 25. OpenSpec Verify

- [ ] 25.1 执行正式 OpenSpec Verify workflow。
- [ ] 25.2 对 52 Requirements / 104 Scenarios 逐项核对运行证据。
- [ ] 25.3 未验证项保持显式开放。

## 26. Ponytail Review Gate

- [ ] 26.1 完成本地门禁、OpenSpec validation 和 Verify 后再判断资格。
- [ ] 26.2 获得单独批准后才运行只读 Ponytail review。
- [ ] 26.3 记录 findings；当前 `PONYTAIL_REVIEW=not-run`。

## 27. Integration

- [ ] 27.1 所有门禁和审计正式关闭后才创建 Integration。
- [ ] 27.2 当前 Feature 不创建 PR、不部署、不推进 main。
