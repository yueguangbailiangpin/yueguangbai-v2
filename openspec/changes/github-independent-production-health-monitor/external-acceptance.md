# External Acceptance

2026-08-10 在 GitHub Actions 的正式主分支工作流完成以下验收：

- `failure` 模式按设计以失败结束，只创建一个固定标题的开放 Issue；Issue 仅包含固定原因、检测时间与 `/health` 目标，不含响应体、Token 或业务数据。
- `recovery` 模式成功结束，在同一个 Issue 写入固定恢复说明并关闭它；模拟模式未访问生产端点。
- `probe` 模式真实读取固定生产 HTTPS `/health`，收到受控健康 envelope 后成功结束，且没有开放的健康异常 Issue。
- 工作流使用固定 SHA 的官方 Checkout、`contents: read` 与 `issues: write` 最小权限、2 分钟超时与单并发组；历史一次性数据库门禁工作流已手动停用。
- 本次验收的 GitHub 外部写入守恒为：一个 Issue 创建、一个恢复评论、同一个 Issue 关闭；Cloudflare、飞书、D1、R2 与业务数据写入均为 0。

结论：`EXTERNAL_ACCEPTANCE_PASS`。定时探测保持每小时一次，不具备部署权限。
