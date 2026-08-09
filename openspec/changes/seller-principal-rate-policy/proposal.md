## Why

现有正式订单确认将卖家本金按确认时生效的 Seller agreement rate 计算，不能表达“平台下单日权威日汇率 + 卖家本金汇率加点”的业务口径，也无法在组织覆盖、明确 0、未来生效和历史不可变之间形成可复核事实。本 Change 为卖家本金建立最小版本化策略和确认时快照闭环。

## What Changes

- 新增按币种对默认、按卖家组织覆盖的版本化卖家本金汇率加点策略；组织覆盖优先，明确 0 与未设置覆盖不同。
- 新增 `SELLER_PRINCIPAL_RATE_NOT_FOUND` fail-closed 错误；Amazon 正式订单以 `amazon_order_date` 作为中国业务日读取权威日基准汇率，不使用最近日期回退。
- 在独立正式订单确认和审核并原子确认两条路径中，以 BigInt/整数刻度计算最终卖家本金汇率和 CNY 分金额，并写入不可变策略快照。
- 增加 Staff 受控配置 API 与 `/staff/seller-principal-rate-policies` 工作台入口，提供默认/覆盖读取、明确 0 展示、Seller Ops 提交和 Owner 确认/拒绝；同时提供订单确认/卖家订单安全展示；买家返款、服务费、退款和旧账务口径不变。
- 新增 Migration 0041，仅向前追加表、索引和不可变触发器；保留旧 Seller agreement/financial snapshot 字段作为兼容投影。

## Non-Goals

- 不修改买家日汇率的确认日规则、买家返款、服务费、退款、评论或付款流程。
- 不回写或重算历史正式订单、既有账务和旧财务快照。
- 不执行生产/远程 D1 Migration，不部署，不调用 Cloudflare、R2、飞书、Drive、腾讯文档、MCP、真实 secrets 或生产数据。
- 不把 Seller agreement 表删除或把未来通用平台日期一次性重构为新订单模型；本 Change 只保留清晰的通用扩展字段边界。

## Migration and Rollback

需要 Migration 0041，且必须在 `origin/main` 的 0040 之后连续应用。迁移只追加 `seller_principal_rate_policy_versions`、事件表和 `seller_principal_rate_snapshots`，不修改历史行。生产回滚采用代码停用/回退到兼容旧代码并保留 0041 空闲 schema；不得 down-migrate、删除策略或删除快照。若已存在 0041 快照，任何财务更正必须走既有冲销/更正流程。

## Risks and Privacy

缺少下单日汇率或策略会减少可确认订单，但这是防止猜测和错误财务事实的必要 fail-closed 行为。Staff 配置值、组织标识和审计身份仅在可信 Staff 边界内可读；Seller DTO 只展示本组织订单所需的基准、加点、最终汇率和取整结果，不展示其他卖家、Staff 或内部利润。
