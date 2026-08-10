# 飞书员工工作台本地运行与外部激活 Runbook

## 本地验收

执行：

```bash
npm run check:feishu-workbench
```

该命令只使用本地 D1、匿名 adapter transport、假时间与假响应；不创建飞书应用、不访问外网飞书接口、不写入远程 D1，也不需要真实凭证。它同时检查 production factory 可装配性，但不会把 mock/模板认作真实验收。默认所有工作台开关关闭。UTC 毫秒是时间事实，任何员工可见时间展示为北京时间。

零网络模板预检：

```bash
npm run preflight:feishu-workbench
```

正确结果必须是 `LOCAL_NO_GO`，且 `external_calls/provider_calls/resource_mutations` 全为 `0`。这表示本地结构完整而生产仍禁止放行，不表示飞书租户、权限、回调或消息可用。

## 本地故障处置

`feishu_sync` 第 5 次 adapter 失败会将对应 `STAFF_WORK_ITEM` Outbox 隔离为 `scheduled_dead_letters.job_name=feishu_sync`，不再自动 claim。死信分类保留实际 `provider_rate_limited`、`provider_unavailable` 或 `contract_rejected`；如果当前 lease 已丢失，原子批次会回滚且不得手工补建死信。仅具备既有调度重放权限的员工可用原死信重放命令、事件 ID 与 Idempotency-Key 重放；缺少本地 adapter 或有效 HTTPS origin 时结果必须是 `DISABLED`，死信与 Outbox 原样保留。成功重放只能由 `feishu_sync` 重新读取 D1 后处理，通用 Outbox adapter 不会投递它。不要修改业务记录、镜像键或死信 source。

adapter 连续三次失败会产生固定、脱敏的 `FEISHU_ADAPTER_FAILURE` 观察；恢复由后续安静调度评估自动关闭。告警投递失败不会回滚 D1 业务或同步状态。公开 callback 超过 16 KiB、官方签名/五分钟时间窗/AES 解密/Verification Token/App/Tenant/nonce 冲突或多余字段均应安全拒绝；响应不含原始 body、Secret、open_id 或业务详情，并应在飞书三秒响应窗口内尽快返回。

## 配置与 Secret 名称

普通变量必须显式配置且不得放入 Secret 值：

- `FEISHU_WORKBENCH_SYNC_ENABLED=false`
- `FEISHU_WORKBENCH_CALLBACK_ENABLED=false`
- `FEISHU_OPERATIONAL_ALERT_ENABLED=false`
- `FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND=1`
- `ACQUISITION_MAINTENANCE_ENABLED=false`（飞书激活预检要求精确为 `false`）
- `FEISHU_WORKBENCH_WEB_ORIGIN=https://<受控员工网页 origin>`
- `FEISHU_WORKBENCH_API_ORIGIN=https://open.feishu.cn`（仅允许此精确值）
- `FEISHU_WORKBENCH_APP_ID`
- `FEISHU_WORKBENCH_TENANT_KEY`
- `FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS=3000`
- `FEISHU_WORKBENCH_MAX_ATTEMPTS=3`
- `FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND=10`

托管 Secret 只允许按名称注入，不得写入模板、日志、测试或报告：

- `FEISHU_WORKBENCH_APP_SECRET`
- `FEISHU_WORKBENCH_ENCRYPT_KEY`
- `FEISHU_WORKBENCH_VERIFICATION_TOKEN`
- `FEISHU_OPERATIONAL_ALERT_CHAT_ID`（仅在独立批准辅助告警时声明）

生产 callback 路径固定为 `<APP_ORIGIN>/api/feishu-workbench/callback`。Staff Auth 的 App、Secret、Tenant、redirect 和 `STAFF_AUTH_ENABLED` 是独立运行时配置；工作台单独激活不得要求或自动打开 Staff Auth。正式应用组合激活时，专用 preflight 要求 Staff Auth 与 Workbench 明确使用同一 App ID/Tenant，但仍保留各自 kill switch、callback 和 Secret 名称；详见 [正式自建应用与运营告警运行手册](./FEISHU_PRODUCTION_APP_AND_ALERTS.md)。

飞书专用调度只允许 `SCHEDULED_OPERATIONS_ENABLED=true`、`FEISHU_WORKBENCH_SYNC_ENABLED=true`、六个标准作业全部 disabled 且 `ACQUISITION_MAINTENANCE_ENABLED=false` 的精确组合。获客维护不是 `SCHEDULED_OPERATIONS_DISABLED_JOBS` 中的标准作业，只有其独立开关精确为 `true` 时 Worker 才运行并读取 `CUSTOMER_SECURITY_TOKEN_SECRET`；缺失、`false` 或其他值均不读取该 Secret、不获取维护租约、不匿名化线索。当前 staging/production 激活边界拒绝把它与飞书同步同时开启。

## 回滚

按以下顺序回滚，并保留 D1 业务事实：

1. 将 `FEISHU_WORKBENCH_SYNC_ENABLED=false`，停止新的 Provider 写请求。
2. 将 `FEISHU_WORKBENCH_CALLBACK_ENABLED=false`，停止入口处理。
3. 核对 `ACQUISITION_MAINTENANCE_ENABLED=false`，防止回滚或飞书调度夹带获客维护。
4. 如仍需隔离，再将调度的 `feishu_sync` 禁用；不得删除镜像、receipt、Outbox 或 dead letter。
5. 真实凭证吊销/轮换与 callback 注销只能由外部所有者在独立批准下执行。

缺少任一开关、官方 API origin、HTTPS 工作台 origin、App/Tenant/Secret、数值边界或唯一 ACTIVE tenant identity 时相应能力自动失败关闭。停止同步不会回滚 D1 业务命令，镜像表只可由 D1 状态重新同步。

## 最终业务所有者外部清单（本模块未执行）

1. 创建并管理真实飞书应用、App ID/Secret、Encrypt Key、Verification Token、管理员授权与精确 `contact:user.base:readonly`、`task:task:write`、`im:message:send_as_bot` scope；不得申请消息读取权限或订阅消息事件。
2. 以匿名数据验证 Task v2、tenant token、加密 challenge/card callback、深链接、API 限额和八员工/二百订单容量。
3. 验证 callback URL、生产 HTTPS 域名、DNS、移动/联通/电信与飞书移动端可用性。
4. 在独立审批后按 Secret 名称注入，先注册/验证 callback，再在受控窗口逐项启用 callback、调度和 sync；禁止直接启用真实业务或财务动作。
5. 审核按负责人/团队的可见性、Personal DENY、跨卖家组织/站点隔离以及 429、5xx、dead-letter 告警。
6. 记录真实回调三秒内响应、token 轮换、429/5xx、重复事件、移动端/三运营商和回滚演练证据。
7. 生产部署、线上 D1 写入和真实飞书资源变更必须由最终业务所有者单独批准；本地通过不等于生产放行。

在上述真实证据全部存在前，最终结论固定为 `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`。
