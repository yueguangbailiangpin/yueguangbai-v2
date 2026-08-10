# Design: Feishu Production App and Operational Alert Readiness

## Existing Capability Inventory

- Staff Auth 已有 FEISHU Provider、单次 state、OAuth callback、D1 identity 映射、opaque internal session 与生产配置 preflight。
- Workbench 已有官方 Task v2 adapter、tenant token cache、稳定 client token、mirror/outbox/dead letter、签名/加密 callback、receipt replay 与独立 kill switch。
- Scheduled Operations 已有严格 notification DTO、observation 去重、阈值、冷却、恢复、incident version、ACK 和 `FEISHU_ADAPTER_FAILURE`。

本 Change 不重写以上能力，只补组合激活与飞书安全消息 sink。

## Runtime Shape

`FEISHU_OPERATIONAL_ALERT_ENABLED` 默认 `false`。只有精确为 `true`，且正式 App ID/Tenant/Secret、官方 API origin、内部私有群 Secret、超时/重试/Task 限流与告警限流全部有效时，runtime 才暴露 Feishu operational alert sink。配置不完整时返回 disabled，不发 token 或消息请求。

同一个 production adapter 复用既有 tenant token cache、超时、64 KiB 响应上限、有限重试和脱敏错误分类；告警另有每秒 1–5 次的保守本地限流，默认 1。发送接口固定为 `POST /open-apis/im/v1/messages?receive_id_type=chat_id`，`receive_id` 只来自托管 Secret，`msg_type` 固定为 `text`，`uuid` 是固定命名空间加 notification DTO SHA-256 截断值。

## Safe Message Projection

中文正文只从 server-owned enum 映射生成，包含告警/恢复、WARNING/CRITICAL、固定摘要、固定 job 或“全局”、incident version、整数计数、`Asia/Shanghai` 时间与 `${APP_ORIGIN}/staff`。不接受任意标题、说明、URL、@用户、卡片按钮、Provider action 或原始 payload。

## Failure and Retry Evidence

既有 signal pipeline 在 threshold/cooldown 前阻止重复通知。Provider `uuid` 保护网络重试。Feishu sink 抛出的固定错误被归类为既有 `FEISHU_ADAPTER_FAILURE`，不会误记为独立主告警 sink 失败，也不会回滚业务请求或作业。失败 signal/state 不保存消息正文或接收方；后续健康评估和冷却后的 reminder 从当前 alert state 重建通知。Task v2 同步继续使用既有 Outbox dead letter，不改变 replay 命令。

## Combined Preflight

新的 preflight 只读取仓库外绝对路径的渲染配置，要求：

- Staff Auth、Workbench sync/callback、Feishu alert 显式启用，Scheduler 只运行 `feishu_sync`，获客/Drive/MCP/本地主告警均关闭；
- Staff Auth 与 Workbench App ID、Tenant Key 完全相同；两个 callback 均为同一受控 HTTPS origin；
- 声明现有 Staff/Workbench Secret 名称与 `FEISHU_OPERATIONAL_ALERT_CHAT_ID`，vars 中不得出现 Secret/token/chat ID 值；
- 只输出缺失字段名、精确 scope/路径/顺序、`external_calls=0`、`provider_calls=0`、`resource_mutations=0` 与 Production NO-GO blockers。

preflight 不验证真实 scope、可用范围、群成员、机器人、管理员审批、独立主告警或 Provider 收发，因此不能输出 Production GO。

## Authority and App Isolation

正式应用只服务月光白 V2 Staff。测试应用和未来 AI 应用必须使用不同 App ID、Secret、callback、可用范围和发布版本；禁止共享正式应用 Secret 或把 AI 消息事件加入正式应用。D1 继续是 Staff、Permission、Personal DENY、Task、订单、财务、Audit 和业务事实唯一权威。

## Rejected Alternatives

- 不使用群自定义 Webhook：它会引入另一套 token/签名与群级配置，无法复用正式自建应用的身份、scope 和版本治理。
- 不申请 `im:message` 或消息读取 scope：告警只需 `im:message:send_as_bot`。
- 不降为 `task:task:writeonly`：现有 adapter 更新前会读取任务成员，必须保留 `task:task:write`。
- 不新增告警 payload dead-letter 表：现有无 payload incident/state 可确定性重建通知，额外保存正文或接收方扩大泄露面。
- 不让飞书成为唯一告警：飞书故障必须由独立主告警通道发现。
