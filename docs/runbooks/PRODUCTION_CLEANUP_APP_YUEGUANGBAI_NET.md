# app.yueguangbai.net 未文档化部署清理 Runbook

> 状态：2026-08-20，Owner 已决定并授权**清理**该部署；Cloudflare 清理已完成。
> 背景：`https://app.yueguangbai.net` 上存在未文档化部署（08-11 时代旧构建、`/ready` 自 08-11 起
> 持续 not_ready：scheduler/recovery 检查失败；生产健康监控 issue #50 持续 RED）。
> 本 Runbook 由 Owner 本人或 Owner 授权的 Cloudflare 账号持有者执行；原始编写时本机无 Cloudflare 认证，
> 本次执行已使用已授权的 `cf` profile 完成。

## 已完成执行记录（2026-08-20）

- 执行人：Owner 授权的 Cloudflare 账号操作者（`cf v0.6.0`，默认 profile）
- 已删除自定义域名绑定：`app.yueguangbai.net`，domain ID `1c54c610b3d4ceb1907f9964bb4a9cf058e05a9c`
- 已删除 Worker：`yueguangbai-v2-production`
- 已删除 D1：`yueguangbai-v2-production`，UUID `24b04d7f-00ad-4671-8520-ce6ff2c328b1`
- 已删除 R2：`yueguangbai-v2-production-files`
- 删除前只读核验：生产业务表均为 0；另有 1 条 Staff 记录、335 条审计事件、64 条 migration 记录；按 Owner 决定未导出
- 删除后核验：生产 Worker / D1 / R2 / 自定义域名均不再列出；`app.yueguangbai.net` 无 DNS 解析；staging 资源仍保留
- 不可逆性：上述 D1、R2、Worker 删除不可恢复；未保留备份（按 Owner 明确决定）

## 前置：获得 Cloudflare 账号访问

任选其一（二选一即可）：

- **A. Owner 在 Cloudflare 控制台手动执行**（推荐，无需在本机配置凭据）
- **B. 本机登录**：在本仓库根目录执行 `npx wrangler login`（浏览器 OAuth，仅写入本机
  `~/.wrangler` 配置；凭据不进入 Git）——需 Owner 本人在浏览器确认

## 清理步骤（按顺序）

1. **盘点资源**（只读）：在 Cloudflare 控制台或 `wrangler` 中列出 Worker / Pages 项目，
   找到绑定 `app.yueguangbai.net` 自定义域名的项目（可能为 Worker route 或 Pages custom domain）。
2. **确认资源绑定**：记录该项目绑定的 D1 数据库、R2 bucket、KV/队列 与 Secrets 的**名称与 ID**（
   Secrets 值不得复制到任何文档/日志）。注意 `/ready` 返回过 `schema: ok`，说明存在 D1 绑定。
3. **数据评估（关键）**：在删除前确认 D1 数据库内是否有真实业务数据：
   - 若为**空库/测试数据**：随 Worker 一并删除。
   - 若含**疑似真实数据**：先做一次只读导出（`wrangler d1 export` 匿名化/加密后离线保存），
     再删除；导出文件遵循生产备份恢复治理（加密、SHA-256/Manifest、隔离保管）。
4. **删除公开入口**：删除 Worker（或 Pages 项目）及其 `app.yueguangbai.net` 自定义域名路由；
   若该域名需保留给未来正式生产，在 DNS 中移除/暂停对应记录。
5. **处理绑定资源**：按第 3 步结论删除 D1/R2（或保留导出副本后删除）。
6. **验证清理**：
   - `curl https://app.yueguangbai.net/` 应不再返回该 SPA（预期 4xx/5xx 或 DNS 无解析）。
   - 生产健康监控对该域名的探针按监控逻辑转为失败-关闭或停止告警。
7. **收尾**：关闭 issue #50 并在其中记录清理完成时间、执行人、资源 ID（不含 Secrets）。
8. **文档同步**：更新 `docs/CURRENT_SYSTEM_STATE.md` 与
   `docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md` G2 行：部署已清理，状态从
   "Detected running deployment requiring ownership/inventory confirmation" 改为
   "已按 Owner 决定清理（YYYY-MM-DD）"。

## 纪律

- 不读取/不记录任何 Secrets 值；不触碰其他域名/资源。
- 删除是不可逆操作：每一步执行前先完成"盘点 → 数据评估 → 备份/导出"。
- 若发现该域名还承载其他用途（DNS 记录、邮箱、其他服务），立即停止并报告 Owner，不猜测处理。
