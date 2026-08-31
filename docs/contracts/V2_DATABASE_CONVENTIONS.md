# V2 数据库约定

## 1. 基础类型

- 主键：`TEXT`，使用全新 UUID。
- 时间点：UTC 毫秒 `INTEGER`。
- 中国业务日期：`TEXT`，格式 `YYYY-MM-DD`，由 `Asia/Shanghai` 推导。
- 布尔：`INTEGER NOT NULL CHECK(value IN (0,1))`。
- 枚举：`TEXT` + CHECK 或应用层严格枚举。
- JSON：`TEXT`，写入前规范化并限制大小。
- 金额、汇率、利润：禁止 `REAL`。

## 2. 金额

- 所有金额：整数最小货币单位 + ISO `currency_code` + 冻结 exponent。
- JPY/KRW exponent 为 0；USD/CNY exponent 为 2。
- 汇率：保存来源币种、报价币种、整数值、整数比例尺与取整规则，禁止含糊的无方向 `rate`。
- 计算先使用 BigInt 或等价安全整数逻辑，最后检查 JavaScript 安全整数范围。
- 每个财务事实保存币种和比例尺。
- JSON 金额使用十进制字符串；财务计算使用 BigInt，禁止浮点转换。

## 3. 版本和并发

可变聚合根必须有：

```text
version INTEGER NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

更新使用：

```sql
UPDATE ...
SET ..., version=version+1, updated_at=?
WHERE id=? AND version=?;
```

受影响行数不是 1 时返回版本冲突。

## 4. 删除规则

- 财务事实、审计事件、编号认领、订单号认领不得删除。
- 客户、产品、店铺使用停用/归档，而不是物理删除。
- 仅未被引用且不影响审计的临时草稿可以物理清理。
- 禁止对核心表使用危险的级联删除。

## 5. 事件和不可变事实

状态变化必须有事件表。事件至少保存：

- event_id
- aggregate_type
- aggregate_id
- previous_state
- next_state
- actor_type
- actor_id
- actor_roles
- idempotency_key
- request_hash
- reason
- created_at

财务事实采用追加式账本。更正通过：

```text
原事实
→ reversal
→ correction/reposting
```

## 6. 幂等

关键命令必须使用幂等记录：

- actor；
- key；
- action；
- target；
- request_hash；
- PROCESSING/COMMITTED/FAILED；
- lease_token；
- lease_expires_at；
- response_json；
- result IDs。

相同 Key、相同请求返回原响应；相同 Key、不同请求返回 409。

## 7. 快照

正式订单至少保存：

- 买家；
- 卖家组织；
- 卖家成员/渠道；
- 店铺；
- 产品和产品版本；
- Marketplace；
- 平台中性订单/产品标识；
- 付款金额、ISO 币种和 exponent；
- 需求批次；
- 评论/任务类型；
- 最终支付金额；
- 买家日汇率版本和值；
- 卖家协议汇率版本和值；
- 服务费规则版本和值；
- 创建时业务日期。

快照不得通过 JOIN 当前默认值动态替代。

## 8. Migration

- V2 从 `0001_...sql` 重新开始。
- 不迁入旧 Migration。
- 每个 Migration 从空库连续执行。
- Migration 不读取生产数据。
- Schema、Trigger、Index 和 Seed 都必须可重复验证。
- 已进入集成基线的 Migration 字节不可修改，只能追加下一连续版本；完整连续 ledger、当前 schema tail 与逐文件/聚合保护以 `migrations/`、Migration verifier 和 `docs/CURRENT_SYSTEM_STATE.md` 为准，不得把本节的历史版本说明复制成第二个当前版本来源。
- 本地 verifier 用显式外层事务证明失败/错序尝试不提交并比较完整 schema 与数据快照；历史 SQL 自身拒绝和 verifier 提交前拒绝必须分开报告，不能外推为生产 Wrangler/D1 已验证。
- 当前 checkout（2026-08-31）的连续尾部是 `0037_stage75_multimarket_staff_order_list_index.sql`（Schema 37），只追加 Staff 订单列表的未来多市场性能索引；下列 `0037`–`0043` 是旧历史链的边界说明，不是当前 checkout 的 schema tail，也不是当前可执行的并行 Migration。

以下是旧历史链中 `0037`–`0043` 的边界说明，不声明当前 schema tail：`0037_product_reservation_order_scheduling.sql` 曾拥有排期边界；`0038_staff_mcp_production_transport_oauth.sql` 新增 Staff MCP production transport 安全状态；`0039_staff_access_binding_management.sql` 新增仅存哈希的一次性员工绑定邀请、绑定 OAuth state 与不可变状态转换边界；`0040_seller_partner_master_data_import.sql` 新增卖家来源追溯、标准产品、卖家供给与预约资格边界；`0041_seller_principal_rate_policy.sql` 新增版本化卖家本金汇率策略和正式订单不可变策略快照；`0042_rakuten_tiktok_jp_marketplace_foundation.sql` 新增乐天/TikTok 日本站平台注册、店铺站点隔离与平台中性订单/产品身份边界；`0043_seller_principal_rate_integrity_hardening.sql` 以前向附加索引/触发器绑定策略事件身份与时间、future-effective、订单确认时点及旧/新卖家本金快照金额，不回填或重算历史事实：

- 卖家本金汇率只在正式订单确认时按 `平台下单日（Amazon 的 amazon_order_date，按中国业务自然日解释）` 读取权威日基准汇率，并加上生效策略的绝对汇率加点；组织覆盖优先于币种对默认值，明确的 0 与无覆盖不同。
- 策略版本保存生效时间、提交/确认审计身份和幂等事件。订单快照同时保存基准版本和值、策略版本/范围/值、最终汇率、取整口径和本金计算结果；正式订单、旧账务和既有快照不回写。
- 0041 的 D1 约束固定策略初始 `SUBMITTED`、唯一 `SUBMITTED→CONFIRMED/REJECTED` 决策、终态/事件不可变与禁止删除，并保护同一 scope/卖家/null/币种对的 pending 和 confirmed effective boundary 唯一性。
- 0041 快照 guard 强制基准业务日期等于平台下单日期；默认策略的卖家组织必须为 NULL，组织覆盖必须等于正式订单卖家组织；并用商/余数分解在 SQLite 安全整数范围内证明本金金额等于 `payment × final_rate` 的 `HALF_UP` 结果，拒绝直接 SQL 篡改金额。
- 策略 API 必须使用 Staff middleware 提供的可信 `staffDataScope`：范围外读取 concealed 404、范围外写入 403；当前五角色模型下仅 GLOBAL Owner 可提交币种对默认或任意组织覆盖，局部 Seller Ops 只能提交已分配组织覆盖，Personal DENY 不得绕过。
- 下单日无权威日汇率或无生效策略时确认 fail closed；不得回退最近日期或猜测。旧 `seller_agreement_rate_versions` 及旧财务快照字段保留为向前兼容投影，新卖家本金金额以 0041 快照为权威。

- issuer/subject/JTI/client/session/replay/rate 只保存 keyed hash，不保存 bearer token、Secret 或 Prompt；一个 issuer/subject 只能映射一个 Staff，运行时仍要求 binding 与 Staff 当前 ACTIVE。
- replay 使用 PROCESSING lease / COMPLETED text response / COMPLETED_NO_RESPONSE / expiry；text response 不超过 256 KiB，截图只保存 metadata 且 response 必须 NULL；rate 使用独立 fixed window；GLOBAL control seed 必须默认 disabled；审计继续复用不可变 `audit_events`。
- 显式启用的 bounded cleanup 只按 expiry/window 从 replay、rate、token revocation 各删除有限行；subject binding、runtime control、audit 和业务事实不是清理目标。
- Migration 只允许 37→38；错序、重复和部分 DDL 必须事务失败。回滚先关闭 MCP并前向修复，不 down migrate 或删除 revocation/audit 事实。

`0037_product_reservation_order_scheduling.sql` 的历史边界为：

- `product_versions.order_interval_days` 与 `orders_per_run` 对 0037 前历史记录保持 `NULL`，受治理的新增产品版本写路径必须同时提供正整数；历史记录不得回填当前默认值。
- `demand_order_schedule_versions` 是追加式不可变事实；数据库拒绝更新、删除、版本跳号、非 ACTIVE Staff、错误产品版本、错误需求版本和超出北京时间下单截止日的写入。
- 当前排期通过 `(demand_batch_id, version_no DESC)` 索引读取；预约排名仍以现有预约事实动态计算，不建立每日派生表或定时任务。
- Migration 只允许 36→37；错序、重复执行和部分 DDL 必须事务失败。恢复采用迁移前备份恢复后再前向执行 0037，不提供破坏不可变事实的 down migration。
