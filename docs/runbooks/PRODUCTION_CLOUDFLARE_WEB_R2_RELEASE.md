# Production Cloudflare / Web / R2 发布与回滚 Runbook

## 当前状态

当前只完成本地 adapter、模板、preflight、Web hosting 合同和匿名测试。没有真实 Cloudflare 配置、资源、Secret、域名、网络或部署证据，Production GO 保持 `NO-GO`。本 Runbook 不授权任何远程动作。

## 发布前备份点与只读核验

1. 冻结唯一 release SHA、Web build digest、Worker dry-run digest、Git 外渲染配置的加密快照和开关矩阵。
2. 保持未获授权的 Scheduler、Drive copy/proxy/delete、MCP 与外部告警关闭；Staff 入口仅允许经批准的 Cloudflare Access 应用与策略。
3. 记录当前线上 Worker/Web release、D1 ledger、D1 可恢复备份、R2/Drive Manifest 和最近隔离恢复证据；不得把 bucket key、Drive ID 或真实行/金额写入 Git。
4. 只读比较生产 D1 ledger 与 release 的连续 `0001`–`0064`。未知、跳号、重复、并行、部分 Migration 或 schema 不匹配立即停止。
5. 若 D1 有数据，先做完整加密备份，并在全新隔离目标通过 attestation、schema、rows、finance、integrity、foreign keys、Staff/Buyer/Seller/file smoke；恢复目标不得覆盖。

## 本地配置准备

1. 从对应模板生成 Git 外配置，不在仓库内替换 `REQUIRED_*`。`--config` 只接受绝对路径，且词法路径和 `realpath` 都必须在仓库外；禁止用 symlink 绕过。
2. 为 staging/production 分别填 account、Worker、HTTPS origin/custom-domain、D1 name/ID、R2 bucket 和 Cron。
3. 通过受管渠道分别注入 Secret；命令历史和日志只出现 Secret 名称。
4. 运行本地 preflight。任何 placeholder、默认/缺失资源、wrong environment、origin/domain mismatch、自动 provisioning 风险、Secret in vars 或已开启 kill switch 都阻断。
5. 本地 preflight 不查询资源是否存在；必须由老板另行授权真实只读/部署前检查。

## 经逐项授权后的部署顺序

1. 老板单独批准 staging 资源、Secret 与域名检查；确认 staging 和 production 完全隔离。
2. 在全部外部开关关闭状态构建 Web，验证无 source map、无 JSX inline style、CSP 无 `unsafe-inline`、SPA fallback、安全 headers、同源 API、CORS 拒绝和匿名 R2 adapter。
3. 老板单独批准线上 Migration 窗口；只应用 ledger 缺少且 release 包含的连续 Migration。当前 Change 自身没有 Migration。
4. 先部署 schema-compatible Worker/Web，再验证 `/health`、根页、三类登录页、深链、API JSON 404 与跨源拒绝。
5. 使用匿名账号验证 R2 put → receipt → HEAD/prefix → D1 final assertion → read-intent/Audience read；分别注入 D1 final failure、PUT 后 Provider rejection 和非 null 回执 metadata/checksum/ETag 异常，验证补偿删除；再注入 delete failure，验证不暴露 key 的 `DELETION_PENDING` 与 cleanup 重试。
6. 所有 smoke 绑定 release SHA、环境、UTC/北京时间、request ID 与操作者证据。失败立即停止后续开关。
7. Scheduler、Drive、MCP、外部告警和首次 R2 归档删除必须在各自 Change/清单中再次单独批准，不随 Worker/Web 部署自动启用。

## Kill switches

- Worker/Web：停止新写入；切回 schema-compatible release。
- Scheduler：`SCHEDULED_OPERATIONS_ENABLED=false`；必要时逐 Job disabled，等待 90 秒租约后重放。
- Staff Access：撤销或收紧 Cloudflare Access 应用策略；必要时回滚 Worker，并通过 Moonwhite Staff 状态/Session 版本即时拒绝账号。
- Drive：total、copy、proxy、R2-delete 全部分离；任何失败先关闭 delete，再关闭 proxy/copy。
- MCP：global 与 local mock 都 false；未来生产 transport/逐工具另有开关。
- 文件/R2：停止新上传；保留 D1 intent/manifest；只通过现有补偿/cleanup 重试，禁止人工公开 key 或 URL。
- 告警：未完成独立接收器 Change 前 `OPERATIONAL_ALERT_MODE=disabled`，因此仍是 Production GO 阻断，不能把“关闭”写成“已验收”。

## Worker/Web 兼容回滚

没有新 schema 事实时，可在停止新写入后切回兼容 Worker/Web。已有后续 schema 事实时保留 schema，以前向修复恢复；不得 down migration、DROP 审计表或覆盖已提交业务/财务事实。Web 与 Worker 必须作为兼容组合回滚：旧 Web 不得调用新 Worker 不支持的合同，新 Web 也不得在旧 Worker 上产生无处理路径。

## 首次 R2 归档删除前后

首次归档删除前：R2 仍保存所有热对象；关闭 Drive copy/proxy/delete 后，可切回 R2-only Worker，但必须先核对 D1/R2 Manifest 与私有读取。

首次归档删除后：禁止直接运行不能代理 Drive 的 Worker。必须选择其一：

- 继续运行支持 Drive proxy 且通过原 Audience/read-intent 的兼容 Worker；或
- 对全部受影响文件执行 Drive→R2 rehydration，逐个校验不可变 Manifest、PUT、HEAD、size/MIME/SHA-256，并确认遗漏数为 0 后才允许 R2-only rollback。

Drive 永久副本不删除。任何 missing、mismatch、授权撤销或未完成回灌都阻断回滚。

## 停止条件

任何真实 ID/域名/Secret 出现在 Git/日志，任何模板被误当成生产配置，任何 preflight、backup/restore、ledger、R2、CORS、headers、SPA、权限/Audience、网络或 smoke 失败，或缺少独立老板批准时，立即停止并保持 `NO-GO`。
