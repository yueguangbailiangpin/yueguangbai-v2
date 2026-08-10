# Staff MCP 与 AI 助手生产启用准备本地验收证据

验收日期：2026-08-10（Asia/Shanghai）

Change：`staff-mcp-ai-production-enablement-prep`

基线：`origin/main=513b9402faeb5da3a452315ad08f32cfec778e5d`

结论：`LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`

## 本 Change 实际补齐

- RFC 9728 protected-resource metadata 增加同源 HTTPS 开发说明与隐私/数据使用政策 URL；Bearer challenge 明确最小 `staff:mcp` scope。
- production runtime 必须获得非空、无重复、全已知的显式 enabled-tool allowlist；未列出的工具不可发现且不可调用，disabled list 只能进一步缩小。
- `read_task_screenshot_v1` 与 `list_staff_exceptions_v1` 继续固定不可启用。缺少 File Audience/Read Intent provider 或 D1 exception projection 时 runtime 失败关闭，不以空结果冒充权威事实。
- staging/production 模板增加 public URL 与 enabled-tool placeholders，但所有 MCP 开关仍为 `false`。
- 零网络 preflight 同时验证 Git 外 rendered config 与 Git 外非 Secret activation evidence，包括 custom domain、公开 URL、工具目录、client registration mode、精确 HTTPS redirect URI 与 PKCE `S256`；通过状态仍为 `LOCAL_CONFIG_AND_EVIDENCE_VALID_PRODUCTION_NO_GO`。
- 新增最小账号、域名、隐私、Secret/Binding、客户端注册、分阶段启用、真实验证顺序与 rollback 说明。

## 复用且重新实测的既有安全边界

- `/mcp`、OAuth 2.1/PKCE S256、RS256/JWKS rotation、audience/resource/scope/lifetime、D1 ACTIVE Staff binding 与 Personal DENY/Data Scope 保持不变。
- token-status Service Binding 只传 HMAC 标识；timeout/主动 abort、redirect、非 JSON、oversized 与 malformed response 均失败关闭。
- durable replay/conflict、截图 `REPLAY_NOT_AVAILABLE`、rate/control/cleanup 与 immutable audit failure 均由现有相关测试重新执行。
- D1 仍是 Staff 与业务事实权威；MCP 仅有限权威读取与受控草稿。财务、订单、付款、审核、权限、批准和外部发送的正式动作仍回月光白 Web 重新授权并确认。

## Migration 决策

`NO_SCHEMA_CHANGE`。未新增、修改或删除 Migration；既有 `0038_staff_mcp_production_transport_oauth.sql` 继续拥有 subject binding、revocation、replay、rate 与 runtime-control 持久事实。实测 schema version 43，Migration 0001→0043 连续、错序/重复/部分 DDL 守卫通过。

## 本地门禁实测

- `npm_config_cache=<isolated> npx --yes @fission-ai/openspec@1.7.0 validate staff-mcp-ai-production-enablement-prep --strict --no-interactive`：PASS。
- `npm_config_cache=<isolated> npx --yes @fission-ai/openspec@1.7.0 validate --all --strict --no-interactive`：58 passed，0 failed。
- `npm run check:staff-mcp-production`：PASS；随后最终定向复跑为 10 个测试文件、60 项测试全部通过，API/contracts typecheck 与 schema/Migration/security verifier 通过。
- `npm run preflight:staff-mcp-production`：staging 与 production 均按默认关闭模板返回 `BLOCKED_NEEDS_OPERATOR_INPUT`；external/provider/deployment/resource mutation 均为 0。
- `npm run check`：PASS；敏感信息扫描 1,634 个项目文件、依赖漏洞 0、所有 workspace typecheck、226 个测试文件/1,486 项测试、Worker dry-run 与全仓 build 通过。
- `npm ci`：lockfile 安装成功，audit 232 packages，0 vulnerabilities；使用隔离 npm cache，未修改 manifest/lockfile。

本 Change 不涉及 UI，未运行浏览器视觉测试；完整 Vitest、类型、Worker dry-run 与构建门禁已覆盖实际 diff。

## 仍未由本地证据证明

- 未创建、登录、注册或连接真实 OpenAI/ChatGPT workspace、应用或客户端。
- 未访问真实 OAuth Provider，未验证真实 redirect、authorization code、token、撤销传播、JWKS rotation 或账号恢复。
- 未访问 Cloudflare account/zone/domain/DNS/TLS/Worker/D1/R2，未注入或轮换 Secret，未部署、未执行 remote Migration。
- 未访问真实 Staff、生产数据、Drive、飞书、File provider 或 MCP client；未验证公开隐私页法律内容与老板批准。
- 未执行 staging/production outage、rollback、audit capacity、cleanup capacity 或告警演练。

## 外部触达事实

```text
OPENAI_RESOURCES_TOUCHED=no
OAUTH_PROVIDER_RESOURCES_TOUCHED=no
CLOUDFLARE_RESOURCES_TOUCHED=no
PRODUCTION_DATA_TOUCHED=no
GITHUB_REMOTE_TOUCHED=no
REMOTE_WRITES=no
EXTERNAL_WRITES=0
```

## 最终决定

本地启用准备已完成，但不授权任何 staging/production activation。真实账号、域名、公开政策、客户端注册、Secret、部署、生产验证与 rollback 必须由老板逐项明确授权并在独立窗口完成。
