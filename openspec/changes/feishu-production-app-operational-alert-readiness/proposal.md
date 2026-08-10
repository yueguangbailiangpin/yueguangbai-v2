# Change: Feishu Production App and Operational Alert Readiness

## Why

Staff Feishu OAuth、Task v2 同步、正式 callback 与 Scheduled Operations 告警状态机已经存在，但当前两个飞书激活 preflight 互相要求另一能力关闭，不能复核“同一正式自建应用”同时承担网页入口、Staff 登录、Task v2、card callback 与脱敏运营告警的完整配置。运营告警也只有 `disabled/local` sink，没有复用正式应用机器人发送最小安全消息的 production-capable adapter。

## What Changes

- 新增同一正式自建应用的组合激活 preflight，要求 Staff Auth 与 Workbench 使用相同 App ID、Tenant Key、受控 HTTPS origin 和精确 callback/redirect，并只报告字段名、固定状态与外部阻塞项。
- 新增默认关闭的飞书运营告警 sink，使用既有自建应用 tenant token 与 `POST /open-apis/im/v1/messages?receive_id_type=chat_id`，只向一个托管 Secret 指定的内部私有群发送固定中文低基数消息。
- 复用现有告警 observation 去重、阈值、冷却、incident version、恢复和固定 `FEISHU_ADAPTER_FAILURE` 失败证据；Provider `uuid` 再按安全 DTO 哈希稳定生成，避免重试重复消息。
- 保留 Task v2 Outbox 第五次失败的既有 `scheduled_dead_letters` 证据；告警消息不新增 payload 死信，失败状态由既有无 payload signal/state 持久化并在冷却后的评估中重试。
- 新增中文管理员 Runbook，冻结最小 scope、网页入口、OAuth redirect、card callback、可用范围、机器人私有群、版本发布/管理员审批、匿名验收、回滚，以及正式/测试/未来 AI 应用隔离。

## Non-goals

- 不创建、修改、发布或调用真实飞书应用、机器人、群、权限、版本、回调、用户或租户。
- 不部署、不运行生产 Migration、不读取或写入生产 D1/R2/Drive/Secrets，不执行真实账号登录。
- 不把飞书设为唯一或主告警通道；独立于飞书的主告警接收器仍是 Production GO 前置。
- 不允许消息或 callback 完成订单、财务、权限、审批、归档或其他正式业务动作；所有正式动作回到受控 Web。
- 不订阅或读取群消息，不新增 `im.message.receive_v1`，不扩大通讯录或 Task scope。
- 不包含历史订单、产品库、卖家编号或 R2 历史图片数据导入。

## Migration Decision

`NO_SCHEMA_CHANGE`。Migration 0031 已提供去重 observation、告警 incident/cooldown/recovery 与 `FEISHU_ADAPTER_FAILURE`；0033/0034 已提供 Workbench mirror、receipt 和 Task v2 Outbox dead letter。告警通知 DTO 可由既有低基数状态完整重建，不保存消息正文、chat ID、App/Tenant、Provider message ID、token 或错误原文，因此不新增 0044。

## Permission and Privacy Impact

正式应用最小 scope 固定为 `contact:user.base:readonly`、`task:task:write` 与 `im:message:send_as_bot`。现有 Task adapter 会读取任务成员后再更新负责人，因此不能降为只写 scope。机器人只向一个内部私有告警群发送，不申请读取群消息。消息仅含固定 signal/category/severity/summary/job/incident/count、北京时间显示和受控 `/staff` 深链，不含客户、订单、金额、图片、凭证、微信号、内部 Staff ID、open_id、chat_id、App/Tenant、Secret、token、Provider body 或原始错误。

## Rollback

先将 `FEISHU_OPERATIONAL_ALERT_ENABLED=false`，再按既有顺序关闭 Workbench sync、callback 与 Scheduler；Staff Auth 可独立关闭。保留 D1 告警状态、Outbox、mirror、receipt 和 dead letter。外部机器人移群、scope 回收、callback 注销和 Secret 轮换只由业务所有者在独立授权下执行。

## Acceptance

本地匿名测试必须覆盖精确消息请求、稳定 `uuid`、中文安全投影、限流、token 缓存/401 刷新、429/5xx/超时/超大响应、失败信号、无敏感字段、组合 runtime 失败关闭与零网络 preflight。严格 OpenSpec、相关 typecheck、Migration guards、Feishu/Scheduled Operations 回归和完整 `npm run check` 必须如实报告。没有真实管理员、scope、群、机器人、callback、Provider 收发、独立主告警和老板批准证据时，结论保持 `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`。
