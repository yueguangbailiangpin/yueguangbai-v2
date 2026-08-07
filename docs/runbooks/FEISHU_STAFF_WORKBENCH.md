# 飞书员工工作台本地运行与外部激活 Runbook

## 本地验收

执行：

```bash
npm run check:feishu-workbench
```

该命令只使用本地 D1、mock adapter 与虚构数据；不创建飞书应用、不访问外网飞书接口、不写入远程 D1，也不需要真实凭证。默认所有工作台开关关闭。UTC 毫秒是时间事实，任何员工可见时间展示为北京时间。

## 本地故障处置

`feishu_sync` 第 5 次 adapter 失败会将对应 `STAFF_WORK_ITEM` Outbox 隔离为 `scheduled_dead_letters.job_name=feishu_sync`，不再自动 claim。仅具备既有调度重放权限的员工可用原死信重放命令、事件 ID 与 Idempotency-Key 重放；重放会复位该事件，且只能由 `feishu_sync` 重新读取 D1 后处理，通用 Outbox adapter 不会投递它。不要修改业务记录、镜像键或死信 source。

adapter 连续三次失败会产生固定、脱敏的 `FEISHU_ADAPTER_FAILURE` 观察；恢复由后续安静调度评估自动关闭。告警投递失败不会回滚 D1 业务或同步状态。公开 callback 超过 16 KiB、签名/时间窗/nonce 冲突或多余字段均应安全拒绝；响应不含原始 body、secret 或业务详情。

## 回滚

保持或恢复以下任一值非 `true`：

- `FEISHU_WORKBENCH_SYNC_ENABLED`
- `FEISHU_WORKBENCH_CALLBACK_ENABLED`

未同时注入本地 adapter 与有效 HTTPS 工作台 origin 时同步同样停用；未提供至少 32 字符 callback secret 时回调停用。停止同步不会回滚 D1 业务命令，镜像表只可由 D1 状态重新同步。

## 最终业务所有者外部清单（本模块未执行）

1. 创建并管理真实飞书应用、App ID/Secret、管理员授权与最小 scope。
2. 以匿名数据验证免费版 Task/Bitable、OAuth、回调签名/加密、事件、深链接、API 限额和八员工/二百订单容量。
3. 验证 callback URL、生产 HTTPS 域名、DNS、移动/联通/电信与飞书移动端可用性。
4. 在独立审批后配置生产 secret、启用开关、分阶段同步匿名/测试数据；禁止直接启用真实业务或财务动作。
5. 审核按负责人/团队的可见性、Personal DENY、跨卖家组织/站点隔离以及 429、5xx、dead-letter 告警。
6. 生产部署、线上 D1 写入和真实飞书资源变更必须由最终业务所有者单独批准；本地通过不等于生产放行。
