# Feishu Workbench Production Adapter Activation

## Why

现有飞书员工工作台只有无网络 mock。最终 Production GO 因缺少真实 API adapter、生产运行装配、官方 callback 验签和可执行预检而保持 NO-GO。需要补齐一套可在后续老板独立授权后启用、但在当前仓库和模板中默认失败关闭的生产能力。

## What Changes

- 新增基于飞书开放平台官方 Task v2 与自建应用 `tenant_access_token` 的 production-capable adapter，所有 HTTP、时间与等待均可注入，以匿名假响应完整测试。
- 使用稳定 `client_token`、D1 镜像键、当前负责人飞书 `open_id`、中文最小摘要和受控 HTTPS 深链；不发送裸 D1 Staff ID、客户隐私、财务、截图、凭证或 Provider body。
- 将 callback 边界改为飞书官方 `X-Lark-*` SHA-256 签名、Encrypt Key AES-256-CBC 解密、Verification Token、五分钟窗口、16 KiB 原始 body、nonce/event replay 和既有 D1 versioned command。
- 新增 tenant token 缓存/并发合并/提前过期、请求超时、本地限流、有限重试、Retry-After 上限和脱敏错误分类。
- 新增 production factory、独立同步/callback kill switch、配置模板、Secret 名称和零网络预检；Staff Auth 保持独立，不因工作台启用而强制绑定飞书登录。
- 为既有获客维护增加独立、默认关闭的 `ACQUISITION_MAINTENANCE_ENABLED`；飞书专用调度要求它精确为 false，且关闭时不读取获客 Secret。
- 更新合同、Runbook 和最终 NO-GO 证据；真实应用、租户、机器人、用户、权限、Secret、回调地址、部署和 Provider 调用继续不执行。

## Non-Goals

- 不创建、修改或调用任何真实飞书、Cloudflare、D1、R2、Drive、域名或 DNS 资源。
- 不把飞书变成订单、财务、权限、审计、归档或 Staff Auth 的权威来源。
- 不允许飞书 callback 执行审核、返款、结算、汇率、权限或其他正式业务动作；正式动作仍需员工在受控网页重新授权并点击确认。
- 不实现飞书登录，不修改 Staff Auth Provider 选择或 Session 语义。
- 不提交、不推送、不建 PR、不归档 Change。

## Migration Decision

`NO_SCHEMA_CHANGE`。0033 已持久化 `feishu_workbench_mirrors` 与签名后 callback receipts；0034 已扩展飞书安全失败分类；`feishu_staff_identities` 已能把同租户 `open_id` 映射到 ACTIVE D1 Staff。token 是短期 Provider 凭证，只允许内存缓存，不写 D1。当前实现不需要新增业务事实、字段、索引或约束，因此不得创建 0038。

## Permission and Privacy Impact

callback 只把已验签、已解密的来源 `open_id` 和目标 `open_id` 映射到当前 ACTIVE Staff，再复算唯一角色、Personal DENY、Team 和 Scope，并复用 `reassignWorkItem`。Provider 请求只含中文安全标题、状态、受控深链和当前负责人的 Provider `open_id`。不输出原始 Provider body、token、secret、裸内部 Staff ID 或客户/财务事实。

## Rollback Boundary

分别关闭 `FEISHU_WORKBENCH_SYNC_ENABLED`、`FEISHU_WORKBENCH_CALLBACK_ENABLED` 或全局 Scheduler 即停止入口，并始终保持 `ACQUISITION_MAINTENANCE_ENABLED=false`。缺少或冲突配置时 factory 返回 disabled 且绝不发网络请求；获客开关未精确为 true 时也不读取其 Secret 或运行维护。回滚不删除 D1 镜像/收据/死信，不从飞书恢复业务事实，也不撤销已合法提交的 D1 命令。

## Acceptance

匿名本地测试必须覆盖官方 token/task/callback 请求响应、token 缓存和过期、并发 refresh、超时、429/5xx/合同错误、有限重试、限流、稳定幂等、callback challenge/验签/解密/重放/版本竞争、Staff 权限、深链白名单、配置失败关闭和 Secret/Provider body 泄露扫描。完整 `npm run check`、Chromium、OpenSpec、安全、依赖与 Migration 门禁必须通过；最终证据仍为 `PRODUCTION_NO_GO`。
