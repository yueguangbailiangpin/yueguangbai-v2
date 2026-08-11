# Staff MCP Production Transport / OAuth Runbook

## 1. 当前可做与禁止事项

当前只允许本地匿名检查。禁止登录或调用真实 OpenAI/ChatGPT/OAuth/Cloudflare，禁止部署、域名/DNS、Secret、远程 Migration、生产数据和任何真实资源写入。checked-in 核心模板不包含 Staff MCP，不能用于激活该能力。

本地查看模板所需字段（零网络）：

```bash
node scripts/preflight-staff-mcp-production.mjs --environment staging
node scripts/preflight-staff-mcp-production.mjs --environment production
```

预期为 `ABSENT_FROM_CORE_RELEASE`，且 `external_calls/provider_calls/deployments/resource_mutations` 全为 0。只有老板另行授权后，才可把 Git 外绝对路径同时传给 `--config` 与 `--evidence`；脚本仍只做本地结构检查，不读取 Secret、不联网、不部署：

```bash
node scripts/preflight-staff-mcp-production.mjs \
  --environment staging \
  --config /absolute/git-external/staging.jsonc \
  --evidence /absolute/git-external/staging-staff-mcp-evidence.json
```

通过状态也只能是 `LOCAL_CONFIG_AND_EVIDENCE_VALID_PRODUCTION_NO_GO`。证据结构见 `STAFF_MCP_ACTIVATION_EVIDENCE.example.json`，完整账号/域名/注册/分阶段步骤见 `STAFF_MCP_AI_PRODUCTION_ENABLEMENT.md`。

## 2. 本地启用条件

匿名集成测试必须显式提供：精确 HTTPS resource/audience/issuer/endpoints、同源公开 docs/policy URL、显式 production enabled-tool 子集、匿名 metadata/JWKS provider、匿名 token-status Service Binding、本地 D1、测试 HMAC Secret、`STAFF_MCP_CLEANUP_ENABLED=true`，并把 D1 GLOBAL control 设为 enabled。production runtime 自动构造 D1 application service；不得通过 Wrangler vars 注入 JavaScript service object。截图与异常列表分别在 File Audience reader 和 D1 exception projection 完成前固定禁用，不以 mock/空页替代；其余 11 个工具只是可选全集。核心模板不得加入 Staff MCP 字段，激活必须走独立评审配置。

真实环境未来还必须由老板完成：OAuth client 与 redirect 注册、authorization code + PKCE S256、撤销传播、JWKS 轮换、Secret 注入、Cloudflare/域名/HTTPS、隐私/安全审核、ChatGPT/OpenAI 连接与逐工具批准。未完成前 Production `NO_GO`。

## 3. 预期故障与失败关闭

| 故障 | MCP 行为 | Web 行为 |
| --- | --- | --- |
| 环境 switch 关闭或配置缺失 | 404，不发布可用 resource | 正常 |
| D1 GLOBAL/TOOL 关闭 | 503 或 `DISABLED` | 正常 |
| metadata/JWKS/token-status Provider 故障 | 401/`PROVIDER_UNAVAILABLE`，无业务数据 | 正常 |
| token 过期、scope/audience/resource/issuer 错误、JTI revoked | 401/`UNAUTHENTICATED` | 正常 |
| Staff/binding 非 ACTIVE | 401/`UNAUTHENTICATED` | 正常 |
| Replay/rate D1 故障 | 失败关闭；不执行或不返回业务结果 | 正常 |
| bounded cleanup D1 故障 | 503；认证和工具执行均不开始 | 正常 |
| token-status Service Binding 超时、重定向、非 JSON、超 8 KiB、inactive | 401；不返回 Provider 错误或标识 | 正常 |
| immutable audit 写失败 | `AUDIT_UNAVAILABLE`；覆盖成功结果 | 正常 |

日志只能记录低基数 route/status/request ID；不得记录 Authorization、token、Secret、claim、Prompt、正文、OCR 或截图。

## 4. 回滚

1. 首选把运行环境 `STAFF_MCP_ENABLED=false`；若环境变更不可用，把 D1 `GLOBAL/staff-mcp` control 设为 disabled。真实操作必须由老板单独授权；本 Change 不执行。
2. 匿名验证 `/mcp` 已拒绝，同时 `/health`、Web deep link 与 `/api/*` 仍正常。
3. 保留 Migration 0038、全部 binding/control/audit 和所有未过期 revocation/replay/rate 行；禁止 down migration、truncate 或删除审计。正常 cleanup 可以继续删除已过期临时行。
4. 只有 schema-compatible prior Worker 且 MCP 保持 disabled 时才可回退应用版本。
5. issuer/key/token 事件需先冻结 MCP，再由授权方撤销受影响 JTI/binding、轮换 key/Secret，并在 staging 完成 old/new key overlap、unknown-kid refresh、过期与撤销演练。

## 5. 清理与保留

production activation 要求 `STAFF_MCP_CLEANUP_ENABLED=true`，但 checked-in staging/production/local 核心模板不含 Staff MCP 配置。经独立评审启用后，每个 `/mcp` 请求在认证前执行一次有界清理：

- replay：创建后保留 24 小时；截图行同样只保留 metadata；
- rate：固定窗口结束后可删；
- revocation：token expiry 到达后可删；
- 每表每次最多 `STAFF_MCP_CLEANUP_LIMIT` 行，默认 100、最大 1000；
- 不删除 subject binding、runtime control、audit 或任何业务/文件事实；
- cleanup 失败则 MCP 503，Web/health 不受影响。

停止 cleanup：先把 MCP 全局关闭，再将 cleanup flag 恢复 false。停止只会保留更多已过期临时行，不恢复已删除临时行，也不修改业务权威。

## 6. 验收顺序

Migration fresh/repeat/wrong-order -> contract/static verifier -> anonymous OAuth/JWKS/transport -> durable replay/rate/control/audit -> Staff Auth/Personal DENY/File Audience regressions -> zero-network preflight -> type/build/security/dependency -> full `npm run check` -> Chromium -> strict OpenSpec。任何 mock/template 成功只记 `LOCAL_IMPLEMENTATION_READY`。
