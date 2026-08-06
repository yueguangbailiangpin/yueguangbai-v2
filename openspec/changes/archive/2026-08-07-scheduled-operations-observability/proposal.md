# Scheduled Operations and Observability

## Why

现有代码已有预约/指令到期、Outbox lease、文件补偿、孤立文件清理和安全临时数据清理能力，但生产入口没有统一 Scheduled Handler 驱动，日志也不足以证明 Job 最近成功或及时告警。Google Drive 归档与飞书同步均依赖可靠后台运行闭环。

## What Changes

- 在现有 Worker 中增加唯一 Scheduled Handler，不创建新微服务。
- 建立 Job Registry、租约、游标、幂等运行记录和分批续跑。
- 驱动超时释放、Outbox、文件补偿/孤立清理、安全数据清理，并为 Drive/飞书预留正式 Job Adapter。
- 增加结构化指标、最近成功时间、积压/失败阈值和不依赖飞书的基础告警。
- 提供授权 Staff 的只读运行状态与失败重试入口；正式业务命令继续走原 Application Service。

## Non-Goals

- 不引入队列平台、独立 Scheduler 服务或分布式工作流框架。
- 不在该 Change 实现 Google Drive 或真实飞书业务逻辑。
- 不通过 Cron 直接修改财务已完成事实。
- 不把日志作为业务或审计权威。

## Migration and Contract Impact

预计需要连续 Migration 保存 job definition/run/lease/cursor/failure facts；若现有表足以表达，实施 Design 必须以证据说明并可选择无 Migration。Contracts 增加 Staff-safe Job Status、Run Result 和 Retry Command，不返回 Secret、payload 原文或客户隐私。

## Dependencies

依赖当前业务 Application Service 和 Outbox/文件补偿能力。Google Drive、飞书与生产验收 Change 依赖本 Change 的运行与观测合同。

## Rollback Boundary

Scheduled Handler 必须有环境级总开关和每 Job 开关。回滚先停 Scheduler，再等待/回收过期 lease，旧 HTTP Worker 可继续服务。Job 执行产生的合法业务状态不反向覆盖；错误通过既有更正、重放或补偿前向恢复。

## Acceptance

必须用可控时钟验证重复 Cron、并发 Cron、超时、部分批次、游标续跑、lease 回收、Outbox 重放、R2 删除失败、清理边界、告警抑制和无 Staff/客户数据泄漏。
