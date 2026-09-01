# Proposal: reservation-auto-approval-protection

## Why

预约自动审核当前只检查预约自身的资格、名额、资料和既有预约例外，没有把买家在其他卖家组织上的正式订单责任与运营异常纳入自动批准保护。这样同一买家即使已有全局逾期的正式订单或未解决的正式订单运营异常，新的预约仍可能被系统自动批准。

## What Changes

- 在自动批准动作开始前，按买家跨全部卖家组织读取正式订单责任模型。
- 只有正式订单责任模型中的 `BUYER_REFUND` 或 `SELLER_SETTLEMENT` 阶段且 `is_overdue=true` 才触发逾期保护。
- 只有正式订单当前存在指定类型的未解决运营异常才触发人工风险保护；`RESOLVED` 后不再触发。
- 自动批准命中保护时返回内部稳定 `reason_code`，预约保持 `PENDING_REVIEW`，既有 hold 和人工待办保持有效。
- 买家提交响应不增加逾期、异常类型、订单或内部风险字段；有权限的 Staff 人工批准路径不受该自动批准保护影响。

## Non-goals

- 不改变永久参与限制、一次性例外、名额、资料、主图、六小时窗口或 24 小时节流规则。
- 不新增 buyer risk 表、Migration、API 路由或买家可见错误合同。
- 不把待核对订单资料、非正式订单或 `internal_finance_exceptions` 纳入买家级保护。
- 不重写提交预约与自动批准之间现有的两个事务，也不访问 staging、Cloudflare、远端 CI 或生产资源。

## Migration

不需要 Migration。实现只读复用现有正式订单责任和运营事件事实。

## Risk and rollback

风险限定在自动批准命令会把更多预约留在人工审核；人工批准、取消、过期和重开状态机不变。回退边界为本 Change 的本地提交，不涉及远程数据或生产资源。
