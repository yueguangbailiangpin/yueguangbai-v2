# Staff MCP Production Transport / OAuth 2.1 本地合同

## 1. 结论与真实性

本 Change 只交付 production-capable 的本地代码边界、匿名合同测试、默认关闭模板和零网络 preflight。结论固定为：

`LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`

没有创建、读取或修改真实 OpenAI/ChatGPT workspace、应用、MCP 注册、OAuth client/issuer/JWKS/token、Cloudflare、域名、Secret 或生产数据；匿名 issuer、JWKS、token、时钟和本地 D1 不得写成真实外部验收。

## 2. HTTPS Resource 与 Discovery

- Resource 为一个精确 HTTPS URL，路径固定 `/mcp`，且 `audience === resource`。
- JSON-RPC 只接受 `POST /mcp`、`application/json`、单一对象、最大 1 MiB；拒绝 query、batch、错误 method/content type、过大或无效 JSON。
- RFC 9728 metadata 位于 `/.well-known/oauth-protected-resource/mcp`，只发布 resource、authorization server、`staff:mcp` 与 header bearer method。
- 401 使用 `WWW-Authenticate: Bearer resource_metadata="..."`；不反射 Authorization、token、claim 或 Provider 错误。
- Worker-first 路由把 `/mcp` 与 metadata 送入 Hono，不回退 SPA。MCP 缺配置/关闭只使 MCP 404/503，Web、`/health`、`/api/*` 保持独立。

## 3. OAuth/JWT/JWKS

授权服务器 metadata 必须与配置逐项相等，并声明 authorization code、PKCE `S256`、精确 authorization/token/JWKS/revocation HTTPS endpoint；出现 `plain` 拒绝。

Access token 只接受 compact JWT、`typ=at+jwt`、`alg=RS256`、单一安全 `kid`。header 只允许 `alg/kid/typ`，拒绝嵌入 JWK、remote key pointer、critical header、私钥材料、重复 JSON member 和非唯一 JWKS key。未知 `kid` 只强制刷新一次；仍未知、歧义或 Provider/JWKS 故障即失败关闭。

逐请求验证：

- `iss` 精确等于 issuer；
- `aud` 只包含精确 resource audience，`resource` claim 也必须精确；
- `exp/iat/nbf` 是整数 NumericDate，时钟偏差最多 60 秒，token lifetime 最长 1 小时；
- `scope` 唯一且包含 `staff:mcp`；
- `sub/client_id/sid/jti` 均必需且有长度上限；
- 必需 token-status Cloudflare Service Binding 返回 active；Worker 只发送 issuer/subject/JTI/client 的 HMAC 指纹和时间边界，不发送 token 或原始 Provider 标识；固定 internal HTTPS URL、3 秒默认超时、8 KiB JSON、拒绝重定向，异常或 inactive 失败关闭；
- 本地 D1 revocation denylist 不得命中。

Resource server 不签发 token、不实现 authorization endpoint，也不从 OAuth claim 读取 Staff role/permission/Team/Audience。

## 4. Staff 映射与 D1 权威

`STAFF_MCP_BINDING_HASH_SECRET` 只作为 managed Secret 名称存在于 Git；运行时用 HMAC-SHA-256 保存 issuer、subject、JTI、client/session/replay/rate 标识。bearer token、Secret 和原始 claim 不落 D1、不进入日志/审计。

`issuer_hash + subject_hash` 只能命中一个 ACTIVE binding，且其 `staff_users` 必须当前 ACTIVE。之后每次 catalog/call 仍通过既有 D1 resolver 重算四角色、权限、Personal DENY、Team/Department、Customer、Seller Organization、Store、Marketplace、资源与 File Audience。OAuth claim 不能扩大权限；越权继续统一 404/`NOT_FOUND`。

## 5. Durable State 与审计

Migration `0038_staff_mcp_production_transport_oauth.sql` 在 schema 37 上创建：

- `staff_mcp_subject_bindings`：唯一 ACTIVE Staff 映射；
- `staff_mcp_token_revocations`：有效期内 JTI denylist；
- `staff_mcp_replay_records`：PROCESSING lease / COMPLETED text response / COMPLETED_NO_RESPONSE / 24 小时 expiry；普通 response 最多 256 KiB；
- `staff_mcp_rate_limits`：跨实例 fixed window；
- `staff_mcp_runtime_controls`：GLOBAL 默认关闭、可选 TOOL override。

重复 request ID 与相同 canonical hash 返回经输出白名单再次验证的原文本结果；不同 hash 冲突；处理中返回 `IN_PROGRESS`。`read_task_screenshot_v1` 成功后只保存请求哈希、工具、完成态和 expiry，`response_json` 必须为 NULL；重复请求返回 `REPLAY_NOT_AVAILABLE`，不重新读取、不返回旧图片。任何 image/base64/raw bytes 均不得进入 replay、audit 或日志。普通 replay 只允许 text content，序列化后最多 256 KiB，并拒绝 token/Secret/object key/Drive/Provider identifier 字段。

cleanup 必须显式开启才能装配 production runtime。每个 MCP 请求先按 `expires_at/window_ends_at` 从 replay、rate、revocation 各删除最多 `STAFF_MCP_CLEANUP_LIMIT` 行，默认 100、最大 1000；任一 D1 cleanup 失败则本次 MCP 返回 503。subject binding、runtime control 和 immutable `audit_events` 永不属于 cleanup 目标。

## 6. 工具边界不变

工具仍只有 `STAFF_MCP_V1.md` 中的有限读取与草稿。没有新增正式写工具。退款、结算、付款、汇率、审核、订单关闭等正式动作只能返回受控 `/staff/...` 相对路径；员工回到 Web 后必须重新授权、读取最新 D1 版本并点击确认。MCP 不接收 Web confirmation token、`expected_version` 或正式幂等键。

## 7. 配置与 Secrets

staging/production 模板必须同时保持：

```text
STAFF_MCP_ENABLED=false
STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED=false
STAFF_MCP_LOCAL_MOCK_ENABLED=false
```

公开 URL、rate/cleanup/timeout 只使用常量或 `REQUIRED_*` placeholder；Secret 只列名称 `STAFF_MCP_BINDING_HASH_SECRET`，不得写入 `vars` 或 Git。`STAFF_MCP_TOKEN_STATUS_SERVICE` 是 Cloudflare Service Binding 名称，模板只保存占位 service 名称。运行时必须同时具备 D1、由 D1 构造的 application service、metadata/JWKS provider、token-status Service Binding、显式 cleanup enabled 与 D1 GLOBAL enabled；任一缺失即仅关闭 MCP。

D1 application service 直接读取现有 Staff work item、Customer、Seller、Order、Review、Refund、Settlement 权威表/视图并复用当前权限和 Data Scope，不新增业务镜像表。production factory 固定停用截图工具，直到另一个获批边界能复用 File Audience + Read Intent + 受控文件 provider；同时固定停用尚无真实 D1 exception projection 的异常列表，不得用安全空页冒充权威“无异常”。其余 11 个有限读取/草稿工具可由 D1 factory 构造；local Mock 不构成这两个工具的 production 激活能力。

## 8. 官方依据

- OpenAI Authentication（OAuth 2.1、resource server、PKCE S256、逐请求 issuer/audience/expiry/scope）：<https://developers.openai.com/plugins/build/auth>
- OpenAI Build an MCP server：<https://developers.openai.com/plugins/build/mcp-server>
- OpenAI Security & Privacy：<https://developers.openai.com/plugins/guides/security-privacy>
- RFC 9728 Protected Resource Metadata：<https://www.rfc-editor.org/rfc/rfc9728>
- RFC 9700 OAuth 2.0 Security BCP：<https://www.rfc-editor.org/rfc/rfc9700>
- RFC 8707 Resource Indicators：<https://www.rfc-editor.org/rfc/rfc8707>
- RFC 7636 PKCE：<https://www.rfc-editor.org/rfc/rfc7636>
- RFC 8725 JWT BCP：<https://www.rfc-editor.org/rfc/rfc8725>

上述链接是公开规范依据，不是本 Change 的真实 Provider 调用或验收证据。
