# Design: reservation-auto-approval-protection

## 1. Read-only source of truth

自动批准调用现有 `staff-order-detail/responsibility.ts` 的责任投影选择器和责任构造逻辑。对指定买家读取全部 `formal_orders`，不按 `seller_organization_id` 过滤：

1. `responsibilitySelects('o')` 继续从 `buyer_refund_ledger_balances` 与 `seller_payable_balances` 推导当前阶段和权威截止时间。
2. `buildResponsibility(..., now)` 继续给出 `BUYER_REFUND` / `SELLER_SETTLEMENT`、`is_overdue` 和 `overdue_since`。
3. 只有上述两个阶段且 `is_overdue=true` 才是逾期保护事实；没有责任截止时间的订单不会被自行推导为逾期。
4. 运营异常沿用该责任投影读取的正式订单事件最新状态。`PLATFORM_CANCELLED`、`RETURN_REFUND`、`BUSINESS_VOID`、`MANUAL_INVESTIGATION` 为 OPEN 风险；最新事件为 `RESOLVED` 时不触发。

投影只返回是否阻断和稳定 reason code，不返回订单 ID、卖家组织、异常类型或异常文本给买家命令响应。逾期 reason code 优先于 OPEN 风险 reason code，优先级在测试中固定。

## 2. Automatic approval boundary

提交预约沿用当前事实边界：提交预约的 D1 batch 先落下 `PENDING_REVIEW`、hold、提交事件、审计和 `RESERVATION_DECISION` 待办；之后才调用自动批准。自动批准自己的 D1 batch 在构造任何批准状态更新、名额计数、指引、完成待办或批准审计语句之前读取风险投影并在命中时返回人工审核结果。

当前这两个 batch 是两个事务。代码注释会明确这一点，不声称提交与自动批准在同一原子事务中。自动批准失败仍按现有兜底处理，已提交预约不被自动拒绝。

## 3. Stable internal result and buyer projection

自动批准结果使用两个稳定 reason code：

- `OVERDUE_FORMAL_ORDER_REQUIRES_MANUAL_REVIEW`
- `OPEN_FORMAL_ORDER_RISK_REQUIRES_MANUAL_REVIEW`

自动审核内部结果可携带 `MANUAL_REVIEW` 与 `reason_code`；`SubmitReservationResult` 继续固定为 Buyer-safe 的 `PENDING_REVIEW` 结构，不把该内部结果拼入响应或通用失败文本。自动批准命中保护不是业务拒绝，不写 reservation rejection reason，也不改状态机。

## 4. Manual approval and concurrency

`decideReservation` 不调用自动批准风险投影，仍由具备 `RESERVATION_DECIDE` 的 Staff 按现有 `expected_version`、状态机、名额、事务断言、审计和待办完成逻辑批准。自动批准成功路径继续使用现有条件更新和最终断言；保护路径不生成批准副作用。重复提交继续由原有 Idempotency-Key/request hash 重放，自动批准重试或并发只允许一个条件更新成功，不重复释放 hold、增加 approved 或完成待办。

## 5. Rejected alternatives

- 不新增 buyer risk 表或风险字段：会产生第二套事实、Migration 和失效同步。
- 不用 `internal_finance_exceptions`：它是内部财务投影，不是买家级运营风险语义。
- 不在前端计算逾期或读取异常：买家只接收既有人工审核状态，Staff 端仍以后端责任模型为准。
- 不复制一套 `due_at` SQL：责任阶段、截止时间和 `is_overdue` 必须与正式订单列表/详情一致。
