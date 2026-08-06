# Design: API Contract Baseline Alignment

## Authority

默认 Hono app 的真实 route registration、Contracts runtime types 和正式 Frontend adapters 为事实来源。文档不得声明不存在的 alias。盘点输出按 route family 记录 method/path/request/pagination/auth/idempotency/response。

## Pagination

会增长且需要稳定遍历的列表使用 opaque `cursor`、bounded `limit` 和 nullable `next_cursor`。只有明确有限且不发生并发漂移的 Staff 报表可单独定义 page 模型；例外必须在对应 Contract 中写明。

## Versioning

第一方 Web 与 API 同部署，当前 URL 保持 `/api/*`。未来外部 HTTP API 若需要 breaking-version policy，必须独立 Change。MCP tool name/schema 维护自身 `v1`，不从 HTTP 路径推导。

## Verification

静态 verifier 比较注册路由、Contract 常量和文档 inventory。该 Change 不能更新 route registration。任何 diff 都应能证明是文档/测试基线校正。

## Rejected Alternatives

- 拒绝仅为版本美观重命名所有路由。
- 拒绝让文档继续同时声明两种全局分页方式。
- 拒绝把 MCP 工具版本与 HTTP URL 强耦合。
