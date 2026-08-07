# Staff MCP 本地 Runbook

## 目的

只用于本地协议 conformance、adapter/mock、合同和安全测试。不得创建真实 OpenAI/ChatGPT OAuth、应用或凭证，不得注册外部 MCP，不得发真实 Provider 网络请求，不得部署、改域名/DNS 或写线上数据库。

## 默认状态

Staff MCP 默认 hard-disabled。只有同时满足以下本地条件才返回 adapter：

```text
STAFF_MCP_ENABLED=true
STAFF_MCP_LOCAL_MOCK_ENABLED=true
STAFF_MCP_ADAPTER=<本地注入的 adapter>
```

运行时固定报告 `productionActivationSupported=false`。当前 Hono app 没有注册 `/mcp` 端点；Buyer/Seller MCP 工具也未注册。

## 本地验证

```text
npm run verify:staff-mcp
npm run dry-run:staff-mcp
npm run test:staff-mcp
npm run check:staff-mcp
```

dry-run 只启动进程内 mock，执行 `initialize -> tools/list -> tools/call`，不访问外部网络。

## Kill switch

- 全局：`STAFF_MCP_ENABLED` 不为 `true` 时，所有新调用安全失败。
- 本地门禁：`STAFF_MCP_LOCAL_MOCK_ENABLED` 不为 `true` 时，不装配 adapter。
- 逐工具：adapter `disabledTools` 或 `STAFF_MCP_DISABLED_TOOLS` 逗号列表；停用工具从 `tools/list` 移除，并对直接调用返回 `DISABLED`。

关闭 MCP 不修改 D1 业务事实、不改 Staff Web Session、不停止 Web。验证方式：关闭 adapter 后检查 `/health` 仍返回 200，并确认 Staff/财务表行数与状态未变化。

## 事故与回滚

1. 先设置全局 kill switch；如只涉及单工具则只关闭该工具。
2. 保留 `audit_events`，不得 UPDATE/DELETE。
3. 检查低基数 outcome：`RATE_LIMITED`、`UNAUTHENTICATED`、`PROVIDER_UNAVAILABLE`、`AUDIT_UNAVAILABLE`。
4. 不回滚或重写 D1/Web 事实，因为本地 MCP 只有读取与内存草稿。
5. 修复后先跑静态 verifier、专项测试、dry-run，再由老板决定是否恢复本地开关。

## 安全检查

- verifier 返回会话必须先通过 `clientId/sessionId/staffId/expiresAt/scopes` 精确校验；失败审计只能记录 `unverified`，不得使用未验证值构造限流或重放 key。
- 13 个工具的 `structuredContent.data` 由声明的精确 output schema 在运行时递归重建；任何未知嵌套字段、类型/长度错误或超量数组整次失败关闭，并只记录 `INTERNAL_ERROR` 安全审计。
- 审计只允许 Staff/client/tool/version/scope/outcome/request ID/UTC 时间。
- 不得记录 Authorization header、Token、完整 Prompt、微信正文、客户文本、OCR 或截图字节。
- 截图必须绑定一个当前任务，同时通过业务资源权限、文件 Audience 和 Read Intent；结果只允许 JPEG/PNG/WebP inline base64 image，解码后不超过 8 MiB；structuredContent 不允许 data URL、R2 key、Drive ID。
- 所有时间记录使用 UTC ms；中文展示使用 `Asia/Shanghai`。
