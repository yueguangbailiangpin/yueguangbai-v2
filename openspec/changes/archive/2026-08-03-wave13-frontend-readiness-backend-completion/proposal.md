# Wave 13 Frontend Readiness Backend Completion

## Why

大模块 5 正式前端即将依赖现有后端，但当前正式生产入口仍不能完成 Staff 运营闭环：Staff 路由虽然已经注册，却没有可信登录、Worker 内部 Session 和默认中间件生成 `staffAuthorization`；文件领域已有完整 Service，但没有可达的正式 HTTP 上传闭环；订单资料审核和 Buyer Refund 账本已有 Domain/Application 能力，但缺少 Staff 列表、详情和写入 HTTP API。Pre-Wave 13 审计因此固定为 `P1=3`、`overall=NO_GO`。

Wave 13 只规划关闭这些后端前置阻塞，不以测试注入 Actor、前端模拟、飞书 Header 或第二套文件/财务模型替代正式生产能力。

## What Changes

### Staff Auth and Internal Session

- 以飞书作为第一版生产 Staff 登录认证 Provider。
- 以 D1 `staff_users`、角色、Personal GRANT/DENY、Team、Department 和 Data Scope 作为唯一 Staff 主体与权限权威。
- 规划短期、单次消费的登录 `state`，服务端交换并验证飞书身份声明。
- 规划 Worker 自行签发、可撤销的 HttpOnly Staff Session。
- 规划默认生产入口安装 Staff Session Middleware，每次请求从 D1 重新计算有效授权并设置 `staffAuthorization`。
- 规划 current session、logout 和 logout-all Contract，以及停用、`session_version` 和 `authorization_version` 失效语义。

### File HTTP Flow

- 将现有 upload intent、对象上传、complete、entity link、audience grant、short read intent、补偿和 cleanup Service 暴露为受 Actor 与 Purpose 约束的正式 HTTP Flow。
- 所有权、组织、客户、Staff、Scope、Audience、`object_key` 和实体权威均由可信 Session 与业务路由派生。
- 业务命令内部完成 link/grant；不提供“任意文件 + 任意实体 + 任意 Audience”的通用客户 API。

### Staff Order Evidence API

- 增加 Staff 待审核列表、详情、请求修改和审核通过 HTTP Contract。
- 从 HTTP 入口与 Domain 同时要求严格一张截图。
- 请求修改复用固定两小时期限、版本、幂等、Audit 和 Outbox。
- 审核通过规划为一个原子业务编排：验证资料、形成正式订单、唯一占用 Amazon 订单号、保存财务快照、关联唯一资料版本并完成事务断言。
- 保留 `PRICE_MISMATCH` 的 fail-closed 处理，不修改财务公式。

### Staff Buyer Refund API

- 增加 Staff Refund 列表、详情、记录付款和冲销付款 HTTP Contract。
- 复用现有 Buyer Refund append-only ledger、Payment/Reversal、文件授权、幂等、Audit、Outbox 和 Transaction Assertion。
- Buyer Refund 权限与 Seller Settlement 权限严格分离；Buyer Refund 成本不进入 Seller DTO。

### HTTP Contract Hardening

- 冻结大模块 5 会直接依赖的 JSON、Query、Error、Cursor、Money、Date、Idempotency、Version、Resource Concealment 和 DTO 投影规则。
- 仅修改本 Wave 涉及的 Staff Auth、File HTTP、Staff Order Evidence、Staff Buyer Refund 以及其直接依赖的关键入口；不为代码统一而重写全仓。
- 记录平台 JSON 解析层无法可靠识别重复 Key 的限制，不声称完全防止。

### Audit Closure

- 实现完成后更新现有 Pre-Wave 13 审计和矩阵，不创建互相冲突的新审计。
- 重新统计原 108 个注册端点及新增端点，重新评估 READY、READY_WITH_LIMITATIONS、NOT_READY、P0/P1/P2/P3 和 GO/NO_GO。
- 保留已经完成的审计本地门禁证据；新增真实生产入口 Staff E2E、R2 故障补偿、D1 Migration 和 OpenSpec 验证结果。

## Non-Goals

- React 正式前端。
- 完整 Staff 运营工作台。
- 飞书消息、队列、提醒或任务镜像开发。
- 历史数据迁移或真实数据导入。
- 部署、生产资源配置、Secrets 或远程 Migration。
- 全仓重构或 API 全量版本化迁移。
- Ponytail 简化或自动修改。
- 财务公式、Seller Settlement 模型或 Buyer Refund 账本重构。
- Wave 1–12 历史 Spec 补写。

## Impact

- 预计需要最小 Migration `0027_staff_auth_sessions.sql`，但本规划阶段不创建 SQL。
- 预计为 `staff_users` 增加 `session_version`，并增加 Staff 登录状态、内部 Session、认证限流和认证安全事件数据结构。
- 新增 Staff Auth、File HTTP、Staff Order Evidence 和 Staff Buyer Refund Contracts。
- 默认 Hono app 将安装 Staff Session Middleware，并让所有 Staff/Internal Finance Route Family 取得可信 `staffAuthorization`。
- 新增 Production Entrypoint E2E、D1 Migration/Behavior、R2 故障补偿、安全与 DTO 隔离验证。
- 实现阶段需要保留 D-004 历史并增加澄清决策，正式消除 Staff 权威边界冲突。
- 实现完成后更新 Pre-Wave 13 审计结论；规划本身不会提前关闭 P1。

## Dependencies

- 现有 D1 Staff 主体、飞书身份绑定、Role Assignment、Permission Override、Personal DENY、Team、Department 和 Data Scope。
- 现有 `resolveAssignmentStaffAuthorization` 与 Staff Assignment/Work Item 能力。
- 现有 File Service、R2 Adapter、显式 Audience Link、Short Read Intent、Compensation 和 Cleanup。
- 现有 Order Evidence、Order Instruction、Formal Order、Financial Snapshot 和 Amazon Order Number Claim。
- 现有 Buyer Refund append-only ledger、Payment/Reversal 与 proof authorization。
- 现有 Audit、Outbox、Idempotency、Request Hash 和 Transaction Assertion 基础。
- Pre-Wave 13 审计、Requirement Traceability Matrix 和 Frontend API Readiness 报告。

## Success Boundary

本 Change 只有在后续实现、测试、真实生产入口验证、D1/R2 验证、OpenSpec validation/verify 和审计更新全部完成后，才可用于重新判断三个 P1 是否关闭。规划 Artifact 完成与远程语义审查本身不等于 P1 已关闭，也不授权开始正式前端。
