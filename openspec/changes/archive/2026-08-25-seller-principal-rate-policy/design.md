## Baseline and compatibility

基线为 `origin/main=6c233e26e043c23d64fab58e9b7e9792e580de48`，当前连续 Migration 为 0001–0040。现有代码有两条正式订单确认路径：`confirmFormalOrder` 与 `approveOrderEvidenceAtomically`；两者都继续写旧 `formal_order_financial_snapshots`，旧 Seller agreement 字段和触发器保留为向前兼容投影。新卖家本金金额由 0041 的策略快照决定，旧 agreement 版本变化不再改变新快照金额。

## Source of truth and formula

Amazon 的 `amazon_order_date` 是平台页面提交的日期事实，系统按该日期作为中国业务日期匹配 `buyer_daily_currency_rate_versions.business_date`。确认时要求该日 `CONFIRMED`、`confirmed_at <= confirmed_at_of_order` 的 JPY→CNY 版本；没有精确日期版本直接返回 `SELLER_PRINCIPAL_RATE_NOT_FOUND`。

策略解析顺序为：

1. 找到确认时间已生效且已确认的 `SELLER_ORGANIZATION` 覆盖；
2. 若不存在覆盖，找同一币种对的 `CURRENCY_PAIR_DEFAULT`；
3. 无策略则 fail closed。

最终汇率为 `base_rate_value + markup_rate_value`，两者均为 `100000000` 整数刻度。金额为 `round_half_up(payment_minor × final_rate_value / 1000000)`（当前 JPY 零位货币到 CNY 分）；实现全程 BigInt，D1/JSON 使用安全整数或十进制字符串。加点 `400000` 表示绝对 `+0.004`，0 是合法值。

## Database and transaction boundary

Migration 0041 的策略版本表保存 scope、币种对、版本号、加点整数、固定刻度、生效时间、提交/确认身份、决策版本和状态。策略事件表提供不可变审计轨迹。策略写入使用现有命令幂等、请求哈希、版本检查、Audit、Outbox 和事务断言；在当前四角色目录下，只有 GLOBAL 的 Owner 可提交全局默认或任意已激活组织的覆盖，局部 Seller Ops 只能提交其分配组织的覆盖，Owner 且具有有效 `FINANCIAL_CORRECT` 的 Staff 确认/拒绝。Migration 0041 在数据库层固定初始 `SUBMITTED`、唯一决策转换、终态/事件不可变、禁止删除、pending/effective boundary 唯一性；快照 guard 还证明基准日等于平台下单日，并证明组织覆盖等于正式订单卖家组织、默认策略组织为 NULL。读取只从可信 Staff Session 的有效授权进入：范围外读取 concealed 404，范围外写入 403，Personal DENY 已在授权解析层生效；Seller Customer 路由没有写入口。

两条正式订单确认路径在创建 `formal_order_financial_snapshots` 后、创建 Seller Principal payable 前，插入 `seller_principal_rate_snapshots`。触发器校验正式订单的下单日/支付金额、基准汇率版本和值、策略版本/范围/生效和值、最终汇率加法关系，并用 `payment_minor × final_rate / 1,000,000` 的正整数商/余数分解证明 `HALF_UP` 本金金额；每个中间乘法先以 `9007199254740991` 上界保护，避免 SQLite 溢出。快照不可更新、不可删除。策略和日汇率都必须在订单确认时间之前已确认且已生效。

## API and DTO boundary

- `GET /api/staff/seller-principal-rate-policies` 读取给定币种对和卖家组织的默认/覆盖/实际选中策略。
- `POST /api/staff/seller-principal-rate-policies/submit` 提交策略版本；body 使用无浮点误差的十进制字符串 `markup_rate_value`（例如 `0.004`，服务端归一化为 E8 整数）和整数 `effective_from`，不接受百分比/basis points。
- `POST .../:id/confirm` 与 `POST .../:id/reject` 使用 `Idempotency-Key`、`expected_version` 和 Staff Session。
- Staff 工作台入口为 `/staff/seller-principal-rate-policies`，可读取默认/组织覆盖、显示明确 `+0`；Owner 可提交默认或组织覆盖，Seller Ops 只看到并提交其已分配组织覆盖，Owner 负责决策；后端独立消费 `staffDataScope`，默认全局写入只接受 GLOBAL Owner；所有策略响应（包括稳定错误）带 `Cache-Control: no-store`，范围外读取 concealed 404 且不枚举组织存在性。
- 正式订单确认返回 `financial_snapshot.seller_principal_rate_snapshot`；Seller formal-order DTO 对新订单展示平台下单日、基准汇率、卖家本金汇率加点、最终汇率、策略版本和本金结果。历史旧订单该字段为 null，继续展示兼容 agreement 摘要。
- Buyer DTO、Buyer refund DTO、Seller service-fee DTO 和内部利润 DTO 不增加该策略以外的财务信息。

## Concurrency, rollback, and rejected alternatives

同一策略 scope/币种对的 `expected_version` 和 `SUBMITTED` pending 检查防止并发重复版本；同一幂等键重放原响应，不同请求哈希冲突。确认中的订单命令仍由既有订单幂等和证据版本保护。缺日汇率时自动使用最近日期、把当前 Seller agreement 当作最终汇率、或在 migration 中回填历史快照都会制造无法审计的事实，因此拒绝。

代码停用/回退时，旧路径仍可读取 0040 的兼容字段；0041 表不删除、不回写。`SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED` 默认关闭，关闭时允许先部署 schema/工作台并继续 0040 兼容计算；开启时两条确认路径才强制 0041 策略，缺策略或缺精确日汇率即稳定失败。生产顺序必须是：备份/核验候选 SHA 与线上 ledger → 应用 0041 → 部署开关关闭的 Worker → 通过受控 Staff 入口创建并 Owner 确认默认 JPY→CNY 策略并记录生效时间 → 核验该策略和下单日基准汇率可解析 → 由单独生产授权将开关设为 `true` → 受控 smoke。生产 Migration 与远程回滚不在本 Change 中执行。
