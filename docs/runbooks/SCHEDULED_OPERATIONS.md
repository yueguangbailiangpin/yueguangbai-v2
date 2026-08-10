# 定时运营与可观测性运行手册

## 本地启用与安全闸

Worker 的 Cron 配置只定义触发频率；`SCHEDULED_OPERATIONS_ENABLED` 必须显式为 `true` 才会获取任何租约。`SCHEDULED_OPERATIONS_DISABLED_JOBS` 为逗号分隔的作业名，可即时停止单一作业。示例配置默认关闭，绝不代表生产部署。

获客维护不由总开关隐式授权。它另受 `ACQUISITION_MAINTENANCE_ENABLED` 控制，只有精确值 `true` 才会执行并读取 `CUSTOMER_SECURITY_TOKEN_SECRET`；缺失、`false` 或其他值均跳过。飞书专用调度必须把六个标准作业全部 disabled 并保持该获客开关为 `false`，因此一次 Cron 只能记录 `feishu_sync`，不会获得获客维护租约或触发线索匿名化。未来启用获客维护必须走独立 Change、候选 dry-run 与发布审批，不能借飞书激活窗口开启。

`wrangler.example.jsonc` 与 `apps/api/wrangler.local.jsonc` 只提供本地 Cron/config/mock 合同；没有执行 Cloudflare 部署、没有线上 Queue 绑定，也没有写线上 D1。生产启用必须由独立发布审批设置开关、告警接收方和恢复负责人。本 Change 不读取 Cloudflare、飞书或其他外部凭证。

全部时间事实使用 UTC 毫秒。员工界面应在客户端以 `Asia/Shanghai` 显示。

## 作业、恢复与人工操作

`reservation_expiry`、`instruction_expiry`、`outbox_delivery`、`file_orphan_cleanup`、`staff_auth_cleanup` 运行既有领域服务；`drive_archive` 与 `feishu_sync` 各自等待独立能力开关与 adapter。每次 Scheduled Handler 设 25 秒墙钟预算，每次作业持有 90 秒 D1 租约；预算耗尽时不再启动新作业，批次内保存“最后已尝试”游标后续跑。进程中断后仅在租约到期后被接管；旧 token 迟到完成只能记为 `lease_lost` 的部分运行，不能覆盖新 owner、游标或成功事实。业务幂等键、版本和唯一约束仍是最终副作用防线。

受已登录 ACTIVE Staff 且完成 scope、hard deny 与 Personal DENY 计算后保护的接口：

- `GET /api/staff/operations/health`：需要 `AUDIT_VIEW`，只返回低基数、无客户 payload 的作业与告警状态摘要；时间字段为 UTC 毫秒，展示约定为 `Asia/Shanghai`。
- `POST /api/staff/operations/jobs/:job/retry`：需要 `SCHEDULED_OPERATIONS_RUN` 与 `Idempotency-Key`，通过同一租约路径运行一个固定作业，不能提交 SQL、任意 job 或 payload。
- `POST /api/staff/operations/dead-letters/:id/replay`：需要 `SCHEDULED_OPERATIONS_RUN` 与 `Idempotency-Key`，只允许固定 dead-letter id 与匹配的未发送 event id。
- `POST /api/staff/operations/alerts/ack`：需要 `SCHEDULED_OPERATIONS_RUN` 与 `Idempotency-Key`，正文只能包含固定 `signal_type`、固定或空 `job_name`、固定 `summary_code` 和当前 `incident_version`；仅该精确身份的当前 OPEN incident 可 ACK。

文件作业只删除 durable orphan / `DELETION_PENDING` 且没有有效授权链接的对象；未配置 R2 adapter 必须记失败，R2 删除失败会保留记录、有限指数退避，之后可重放。作业完成后重新计算积压，不能用删除前计数伪装健康。Outbox 未配置 adapter 或投递失败同样保留事件，按最大一小时退避；不把 payload 写进运行事实或日志。已提交的财务/业务事实不回滚覆盖；错误依赖对应领域的审计重放、补偿或更正。

### Dry-run 演练

所有清理路径默认先在本地测试或显式的 `dryRun` 调用中演练。Dry-run 只扫描符合保留期、状态和链接保护条件的候选，记录安全的候选数、积压和 continuation；它不会获取业务 claim、发送 Outbox、调用 R2 delete、删除 D1 行，或写业务 idempotency/audit/outbox 事实。当前 HTTP 人工命令不接受任意 `dryRun` 或 payload，因此不能用路由绕过安全闸。

生产启用前应使用隔离的本地 D1 fixture 与 mock R2/Outbox adapter 验证候选数，然后核对 cursor 可续跑、早到候选可在轮次重置后回扫、失败只进入有限退避。任何候选或恢复能力未验证时保持全局开关关闭。

## 告警与排障

运营摘要包含最近成功/失败、积压、租约到期和失败分类。主告警接收器必须独立于飞书；当前仓库内主告警只使用内存/mock/disabled sink。默认关闭的飞书正式应用机器人仅可作为辅助安全消息通道，不能代替独立主告警。固定策略如下：

| 信号 | 开启阈值 | 冷却 | 级别 |
| --- | --- | --- | --- |
| Worker 5xx | 5 分钟 3 次 | 30 分钟 | CRITICAL |
| 作业陈旧 | 6 小时无成功 | 60 分钟 | WARNING |
| 租约停滞 | 到期后再持续 5 分钟 | 60 分钟 | CRITICAL |
| 持续积压 | 30 分钟内连续 3 次评估 | 60 分钟 | WARNING |
| 文件失败 | 30 分钟 3 次 | 60 分钟 | WARNING |
| 登录异常 | 10 分钟 5 次 | 30 分钟 | CRITICAL |
| 主告警 sink 失败 | 5 分钟 1 次 | 30 分钟 | CRITICAL |
| 未来飞书 adapter 失败 | 15 分钟 3 次 | 60 分钟 | WARNING |

连续两次健康评估自动恢复；事件型信号在观察窗口安静后由定时评估补充健康事实，因此不依赖新的业务事件才能恢复。重复 observation id 不重复计数或通知；恢复后复发建立新的 incident version。告警身份为 `signal_type + job_name + summary_code`，主告警 sink 与未来飞书 adapter 等独立故障不能互相覆盖。冷却期内继续持久化状态但不重复通知。sink 失败不影响原请求或作业，只写固定 `PRIMARY_ALERT_SINK_FAILURE` 信号且不得递归通知。信号、日志和 DTO 只能包含固定枚举、哈希 observation id、UTC 毫秒、整数计数及固定 job 名；禁止路径、用户 id、token、凭证、微信号、对象 key、原始错误、金额或客户内容。

`OPERATIONAL_ALERT_MODE` 默认为 `disabled`；本 Change 唯一可启用值为 `local`。`local` 可使用内置安全日志 adapter 或注入内存 mock，二者都只接受正式通知 DTO。disabled 状态配置 adapter、未知 mode 或任何外部 adapter 名均视为无效配置并安全退回不发送。这里不读取外部凭证，也不发起网络调用。

`FEISHU_OPERATIONAL_ALERT_ENABLED` 是另一条独立且默认关闭的辅助 sink 开关，不扩展 `OPERATIONAL_ALERT_MODE`。只有组合正式应用 preflight、独立主告警验收和管理员批准全部具备后，外部所有者才可在受控窗口启用。它只发送严格 DTO 映射出的固定中文摘要与受控 `/staff` 链接；复用现有 observation 去重、阈值、冷却、恢复和 incident version，另以稳定 Provider UUID 与每秒 1–5 次限流约束网络重试。接收群 ID 只允许通过托管 Secret `FEISHU_OPERATIONAL_ALERT_CHAT_ID` 注入，日志、D1 状态、死信和报告均不得保存该值或消息正文。发送失败只产生 `FEISHU_ADAPTER_FAILURE`，不会递归通知或回滚业务结果。

Staff 登录拒绝、频控、State 重放/无效、身份拒绝、Cookie/Session 拒绝会从既有 security event id 派生 `LOGIN_ANOMALY_DETECTED`；正常登录不触发。飞书 Provider 失败单独使用 `FEISHU_ADAPTER_FAILURE`。该派生不得保存登录名、IP 原文、密码、token、User-Agent、Provider subject 或底层错误。

## 回滚/恢复演练

1. 将全局开关设为关闭，或将故障 job 写入禁用列表。
2. 等待不超过租约期限；不删除 `scheduled_job_states` / `scheduled_job_runs` / audit facts。
3. 对 Worker 中断，保留原 lease/token；到期后由新 version 接管，旧 token 的迟到完成不能覆盖 cursor、last facts 或新 owner。
4. 对 Outbox poison，保留无 payload 的 dead-letter；修复 adapter 后由受控 replay 重置固定 event，禁止直接改 payload/status。对 R2 deferred，保留 `DELETION_PENDING` 和下一次退避时间，不提前把 D1 标为已删除。
5. 修复 adapter 或领域问题后，使用受控 retry/replay；确认最近成功、积压下降、incident 恢复和低基数审计记录。ACK 只表示人员确认，不会解决底层故障。
6. 清理任务先以本地 mock dry-run/失败注入验证；从不删除未经验证可恢复的数据。

Migration `0031_scheduled_operations.sql` 是连续前向升级，包含运行、租约、信号、告警、dead-letter、人工命令和权限事实；仓库没有宣称存在可安全删除这些审计事实的 down migration。升级前必须先取得可验证的 D1 导出并保持调度关闭。若 DDL 升级本身失败，停止 Worker，修复后按 migration ledger 重试；若必须回到旧程序，继续保持调度关闭并从升级前已验证导出恢复，而不是局部 DROP 表。已经提交的领域副作用只能按对应领域规则前向补偿。
