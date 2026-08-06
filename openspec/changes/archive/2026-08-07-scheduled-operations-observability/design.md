# Design: Scheduled Operations and Observability

## Runtime Shape

默认 Worker 同时导出 HTTP fetch 与 Scheduled Handler。Handler 读取启用的固定 Job Registry，按顺序尝试获取 D1 lease，使用固定 batch limit 和 continuation cursor 调用现有 Application Service。单次运行受时间预算约束，未完成工作由下一次 Cron 继续。

## Run Facts

每个 Job 保存当前 lease owner/expiry、last_started、last_succeeded、last_failed、cursor、processed/succeeded/failed counts 和 sanitized failure category。每次运行追加不可变 run event；不得保存 Customer payload、Token、图片内容或 Secret。

## Idempotency and Concurrency

业务命令继续依赖自身 Idempotency/Version/Unique guards。Job lease 只防止重复扫描，不替代业务幂等。两个并发 Scheduler 只能有一个持有有效 lease；崩溃后 lease 到期可回收。Cursor 更新和 run summary 使用条件版本写入。

## Observability and Alerts

最小指标包括 Worker 5xx、Job last success age、backlog、failure count、lease stuck、Outbox retry、file cleanup failure、auth anomaly 和外部依赖错误。告警主通道不得只依赖飞书，以便飞书故障仍可发现；具体 Provider 在生产 Change 冻结。

## Staff Controls

受控 Web 只读展示 Job 健康和安全计数。显式重试命令只允许授权 Staff，调用同一 lease/idempotency 路径，不接受任意 SQL、Job name 或 payload。

## Rollback

环境总开关停止新租约；过期 lease 自动回收。回滚 Scheduler 代码不删除 run/audit facts。发现错误 Job 时先 disable 单 Job，再根据其业务语义执行重放、补偿或更正。

## Rejected Alternatives

- 拒绝每个业务模块各自实现 Cron。
- 拒绝为了每日二百订单引入新的队列/工作流平台。
- 拒绝只靠 console error 判断 Job 成功。
