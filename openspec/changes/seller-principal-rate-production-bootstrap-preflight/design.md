# Design: Seller Principal Rate Production Bootstrap Preflight

## Baseline inventory and decision

唯一基线为 `origin/main=513b9402faeb5da3a452315ad08f32cfec778e5d`。0040 只增加卖家主数据导入/产品供给结构且不创建任何卖家业务行；0041 增加版本化策略、事件和正式订单本金快照；0042 增加平台中性 Rakuten/TikTok 基础且不创建业务 Seller/Store/Order/Product 行；0043 前向增加策略事件和本金快照完整性保护。现有 Worker 在两条 Amazon 正式订单确认路径都只在 `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED === "true"` 时解析新策略，缺精确下单日汇率或生效策略则在事务事实产生前失败关闭。

Staff API/UI 已实现可信 Session、唯一有效角色、Permission、Personal DENY、Staff Data Scope、Idempotency-Key、request hash、expected version、Audit、Outbox 和事务断言。但现有组合读取强制要求 `seller_organization_id`，导致尚无 ACTIVE 组织主数据时 GLOBAL Owner 也无法读取默认策略的 `next_version` 并从页面提交。此 Change 让该字段在 default-only 读取中为 null：GLOBAL Owner 可读取 default/default pending/default next version；override/pending/next version 保持 null。组织读取仍要求 ACTIVE 组织和现有 Scope，Seller Ops 不能使用 default-only 读取。安全初始化继续采用 Staff 流程，不新增 bootstrap SQL、后台绕过或 Migration。

## Read-only preflight boundary

CLI 分两层：

1. template 模式只读取仓库内 staging/production 模板，证明卖家本金强制开关仍明确为 `false`，输出 `LOCAL_TEMPLATE_SAFE_PRODUCTION_BLOCKED`；
2. snapshot 模式要求操作者提供绝对路径的本地恢复 SQLite 普通文件、显式 `--expected-schema 43`、`--as-of` 和 phase。数据库用 `DatabaseSync(..., { readOnly: true })` 打开并立即设置 `PRAGMA query_only=ON`。脚本没有 apply、remote、deploy 或 mutation 参数。

snapshot 模式不证明该副本就是当前生产；它只证明给定本地副本在指定时点的结构和聚合事实。真实 backup attestation、候选 SHA、线上 ledger、配置、Staff 账号、Cloudflare binding 与部署状态仍需批准窗口内独立复核。

## Policy state classification

预检固定目标 `CURRENCY_PAIR_DEFAULT / NULL / JPY / CNY / +0.004`，但从不假定版本 1 或零行：

- 当前选中策略已为 `400000/100000000`：`NO_POLICY_MUTATION_REQUIRED`，预期策略/Audit/Outbox/Idempotency 增量均为 0；
- 正确未来 confirmed 策略已存在：`WAIT_FOR_EFFECTIVE_BOUNDARY`，增量为 0；
- 正确 future pending 策略已存在：`OWNER_CONFIRM_EXISTING`，预期 version +0、event/audit/outbox/committed-idempotency 各 +1；
- 没有 pending 且没有正确当前/未来策略：`SUBMIT_AND_OWNER_CONFIRM`，预期 version +1、event/audit/outbox/committed-idempotency 各 +2；
- stale/wrong pending、重复 pending、错误 scale、事实图不守恒或其他冲突：`BLOCKED_MANUAL_REVIEW`。

明确 `0` 是一个存在的组织或默认策略值，不会被归类为“未设置”；它也不等于冻结的默认 `+0.004`。组织覆盖只统计聚合数量，不枚举组织或生成写入计划。

## Staff default-only boundary

共享 DTO 把 `seller_organization_id` 与 `seller_override_next_version` 扩展为 nullable。`GET /api/staff/seller-principal-rate-policies?source_currency_code=JPY` 只允许 GLOBAL Data Scope，返回 default facts 且不查询或推断任何组织；带 `seller_organization_id` 的既有读取继续先做 Scope，再要求 ACTIVE organization。Staff UI 对 GLOBAL Owner 默认启用 default-only 读取和默认提交；选择组织后才显示或提交组织覆盖。Seller Ops 缺少组织 ID 时仍禁用读取，伪造无组织请求由后端 403 拒绝。

## Conservation and audit

preflight 对所有卖家本金策略版本重建期望事件集合：SUBMITTED 需要一条 submitted event，CONFIRMED 还需要一条 confirmed event，REJECTED 还需要一条 rejected event。每条事件必须恰有一条相同 aggregate/event/idempotency/actor 的 Audit 和 Outbox，并有相同 Staff/idempotency key 的 COMMITTED command record。任何 missing、duplicate 或 orphan 计入 `fact_graph_anomalies` 并阻断。

输出只含聚合计数：policy versions、default/organization versions、events、audits、outbox、committed idempotency 和 anomalies；不输出业务 ID、Staff ID、组织 ID、request ID 或 idempotency key。

## Enablement gate and rollback

`enablement` phase 还要求至少一个明确 `--business-date YYYY-MM-DD`。每个日期只按精确日期读取确认时间不晚于 `as_of` 的 JPY→CNY 权威版本，不使用最近日期。当前默认策略必须已是正确且生效，所有指定日期都必须可解析，开关输入仍必须为 `false`。成功只输出 `LOCAL_READY_PRODUCTION_BLOCKED`，不能自动改开关。

生产回滚边界：开关未开启前停止即可；错误 pending 由 Owner 拒绝；已 confirmed 版本保留并用新未来版本纠正；开关开启后如 smoke 失败，先恢复 `false`，不删除策略/事件/快照、不重算历史订单。任何配置写入、Staff 操作、Cloudflare 变更、Migration 或 smoke 都必须由总控逐项授权。

## Test strategy

- 匿名 schema-43 SQLite fixture 覆盖零策略、正确 pending、正确生效、明确 0、stale/wrong pending、事实图缺口、缺精确日期汇率和启用阶段就绪。
- 对同一只读副本重复运行，文件 SHA-256 与数据库 total changes 保持不变。
- 复用既有策略 service/HTTP tests 覆盖幂等重放、并发只有一个 pending winner、GLOBAL/assigned scope、Personal DENY 和无越权事实。
- 复用两条正式订单测试覆盖 enforcement off 兼容路径、on 缺策略零财务事实、on 成功时 legacy/new snapshot/payable 金额相等和历史不可变。
