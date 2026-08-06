# 定时运营与可观测性运行手册

## 本地启用与安全闸

Worker 的 Cron 配置只定义触发频率；`SCHEDULED_OPERATIONS_ENABLED` 必须显式为 `true` 才会获取任何租约。`SCHEDULED_OPERATIONS_DISABLED_JOBS` 为逗号分隔的作业名，可即时停止单一作业。示例配置默认关闭，绝不代表生产部署。

全部时间事实使用 UTC 毫秒。员工界面应在客户端以 `Asia/Shanghai` 显示。

## 作业、恢复与人工操作

`reservation_expiry`、`instruction_expiry`、`outbox_delivery`、`file_orphan_cleanup`、`staff_auth_cleanup` 运行既有领域服务；`drive_archive` 与 `feishu_sync` 始终禁用，等待各自 Change 提供 adapter。每次运行持有 90 秒 D1 租约；进程中断后仅在到期后被接管。业务幂等键、版本和唯一约束仍是最终副作用防线。

受已登录 ACTIVE Staff 且 `AUDIT_VIEW`（包括 Personal DENY 计算后）保护的接口：

- `GET /api/staff/operations/health`：只返回低基数、无客户 payload 的状态摘要。
- `POST /api/staff/operations/jobs/:job/retry`：通过同一租约路径运行一个固定作业，不能提交 SQL、任意 job 或 payload。

文件作业只删除 durable orphan / `DELETION_PENDING` 且没有有效授权链接的对象；R2 失败会保留记录、有限指数退避，之后可重放。Outbox 未配置 adapter 或投递失败同样保留事件，按最大一小时退避；不把 payload 写进运行事实或日志。已提交的财务/业务事实不回滚覆盖；错误依赖对应领域的审计重放、补偿或更正。

## 告警与排障

运营摘要包含最近成功/失败、积压、租约到期和失败分类。告警接收器必须独立于飞书；飞书 adapter 失败只以 `dependency_unavailable` 类别计数。生产放行前配置接收器，并对以下信号建立阈值：5xx、作业陈旧、租约停滞、连续 Outbox/文件失败、登录异常、积压。日志只能包含 request id、固定 route/job 名、状态和允许的失败类别，禁止 token、凭证、微信号、对象 key 或客户内容。

## 回滚/恢复演练

1. 将全局开关设为关闭，或将故障 job 写入禁用列表。
2. 等待不超过租约期限；不删除 `scheduled_job_states` / `scheduled_job_runs` / audit facts。
3. 修复 adapter 或领域问题后，使用受控 retry；确认最近成功、积压下降和审计记录。
4. 清理任务先以本地 mock dry-run/失败注入验证；从不删除未经验证可恢复的数据。
