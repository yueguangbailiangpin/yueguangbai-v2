# M9 Staff MCP Agent Access 验收证据

## 结论

本地 Staff MCP v1 server/adapter、OAuth verifier port/mock、13 个 Staff-only 工具合同、严格输入/最小输出、当前 D1 授权重算、重放/并发/限流、immutable safe audit、kill switch、runbook 和协议 dry-run 与 active OpenSpec 一致。

当前没有真实 OAuth、外部 AI 隐私批准、ChatGPT 应用/MCP 注册、公开端点、网络 Provider、部署或生产激活。生产必须继续 hard-disabled，见 `docs/runbooks/STAFF_MCP_EXTERNAL_ACTIVATION_CHECKLIST.md`。

## Spec 到证据映射

| OpenSpec Requirement/Scenario | 实现证据 | 测试/门禁证据 |
| --- | --- | --- |
| 每 session 一个当前 ACTIVE Staff；不信客户端身份 | `mock-oauth.ts`、`server-adapter.ts` | unknown/expired/disabled/forged Staff 测试 |
| 每次调用重算角色、DENY、Team/Department、data scope | `resolveAssignmentStaffAuthorization` + `resolveStaffDataScope` | Personal DENY、Department disabled、Buyer scope 测试 |
| Staff-only bounded read/draft tools | `tools.ts` 13-tool registry | conformance、全工具循环、limit/cursor/extra-field 测试 |
| Buyer/Seller 未注册 | Staff-only registry；Hono 无 `/mcp` route | `tools/list` 与未知 Buyer tool 协议测试；static verifier |
| 微信号/截图允许但 Secret 禁止 | Customer projection；single task screenshot + Audience/Read Intent mock | full WeChat、截图 allow/deny、credential 字段测试 |
| Prompt injection 不扩权 | 草稿只收对象绑定/枚举；输出标记 untrusted | 评论注入、跨 Buyer 404、审核草稿不采纳指令测试 |
| FACT/DRAFT/WARNING；正式动作只返 Web | common result + `get_web_confirmation_step_v1` | 五类正式动作不写 D1、只返 `/staff/...` 测试 |
| immutable safe audit | 复用 `audit_events` + fail-closed | success/replay/conflict/immutability/redaction/audit outage 测试 |
| kill switch、rate、replay/concurrency | runtime、memory limiter/replay ports | global/per-tool disable、rate、in-progress、hash conflict 测试 |
| MCP 关闭不影响 D1/Web | local runtime 不注册生产 route | Staff 状态不变与 `/health` 200 测试 |
| 无需 Migration | 复用既有 audit；本地 state ports | schema 34、0034 末号、wrong-order/repeat/integrity 测试 |

## 已执行门禁

- `npm run check:staff-mcp`
- `npm run check`
- `npx openspec validate staff-mcp-agent-access --strict`
- `npx openspec validate --all --strict`
- `npm run security:scan`
- `npm audit --json`（不得高于既有 React Router 2 high）
- `git diff --check`

Formal Verify 结论：active delta spec 的每个 Requirement 与新增 Scenario 都能映射到实现和至少一条可执行测试/静态门禁；没有通过修改 Spec 掩盖实现缺口。外部激活事项不属于本地完成结论，并保留为老板清单未勾选项。
