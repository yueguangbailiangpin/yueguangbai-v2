# Change: GitHub Independent Production Health Monitor

## Why

飞书运营告警只能作为辅助通道，必须有独立于 Cloudflare 与飞书的接收器。当前 Cloudflare Free Website 不提供 Standalone Health Checks，仓库也没有外部健康监控工作流。

## What Changes

- 新增每小时一次的 GitHub Actions readiness 检查，只读取生产 `/ready` 的完整 readiness envelope。
- 检查失败时创建或重新打开一个固定标题的 GitHub Issue；持续失败不重复创建，恢复时记录固定恢复事实并关闭。
- 提供手动故障/恢复演练模式，用真实 Issue 生命周期证明独立接收器可用；它不能替代 current-SHA 的真实 `/ready` 连续观察。
- 所有输出只含固定低基数原因和 UTC 时间，不保存响应正文、请求编号、客户、订单、财务、文件或凭证。

## Non-goals

- 不新增 Cloudflare 付费 Health Check、第三方账号或 Secret。
- 不修改生产 D1/R2，不执行 Migration，不部署 Worker。
- 不以 GitHub Issue 执行业务、财务、权限或恢复命令。

## Migration Decision

`NO_SCHEMA_CHANGE`。监控状态只存在于独立 GitHub Issue 与 Actions 运行记录中。

## Rollback

禁用或删除 `production-health-monitor.yml` 即停止检查；保留历史 Issue 作为验收和故障证据。
