# Staff MCP 与 AI 助手生产启用准备

## 1. 当前结论

当前仅为 `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`。本地代码、匿名测试、模板和 preflight 不代表真实 OpenAI/ChatGPT、OAuth Provider、Cloudflare、域名、Secret、Staff 或生产数据已经连接或批准。

本任务不创建账号、不注册客户端、不登录 Provider、不写 Secret、不部署、不执行远程 Migration，也不读写生产 D1/R2/Drive/飞书/MCP。

## 2. 最小外部账号与所有权

真实启用窗口至少需要老板明确指定并掌握：

1. 一个批准用于内部 Staff 的 OpenAI/ChatGPT workspace 与管理员；
2. 一个可发布 OAuth 2.1 Authorization Server Metadata、PKCE S256、JWKS、撤销与客户端注册能力的授权服务器租户和管理员；
3. 月光白 Cloudflare account、目标 zone、自定义域名、Worker、生产 D1 与 token-status Worker 的管理员；
4. D1 中既有 ACTIVE Staff 与 `staff_mcp_subject_bindings` 的受控管理者；OAuth 不得自动创建 Staff；
5. 隐私/安全/跨境/保留删除流程的业务批准人。

账号恢复、MFA、最小管理员数量和离职交接必须在外部完成。本仓库不保存账号 ID、注册链接或凭证。

## 3. 域名与公开说明

- `workers_dev=false`、`preview_urls=false`，只允许一个与 `APP_ORIGIN` 完全一致的 Cloudflare Custom Domain。
- MCP resource 固定为该 origin 的 `/mcp`；audience 与 resource 完全相等。
- 同一 origin 必须发布两个不同的公开 HTTPS 页面：开发/连接说明与经批准的隐私/数据使用政策。
- 两页不得使用根路径、`/mcp`、protected-resource metadata 路径、query、fragment、用户名或密码；metadata 分别发布为 `resource_documentation` 与 `resource_policy_uri`。
- preflight 只验证 URL 结构，不验证 DNS、TLS、页面存在或法律内容。真实窗口必须用外部只读请求核验 HTTP 200、证书域名、内容版本与负责人签字。

隐私页至少由老板/合规方决定并发布：Staff 使用场景、会发送给外部 AI 的字段/截图范围、禁止字段、Provider 数据控制、保存/删除/注销、跨境说明和联系渠道。本仓库不代写法律结论。

## 4. 客户端注册

依据当前 MCP authorization 规范，按以下顺序选择且只选一种：

1. 已有可信关系时使用预注册 client；
2. 授权服务器 metadata 明确声明支持时，使用 Client ID Metadata Document；client ID 必须是包含路径的 HTTPS metadata URL；
3. 授权服务器明确发布 registration endpoint 且老板批准时，才使用 Dynamic Client Registration。

无论何种模式：

- 从真实 OpenAI/ChatGPT 客户端界面复制精确 redirect URI，不猜测、不模糊匹配；
- authorization code 与 token 请求都携带精确 MCP `resource`；
- 只允许 PKCE `S256`，拒绝 `plain`；
- authorization server 对 redirect URI 做完全匹配；
- client ID、mode、redirect URI 仅写入 Git 外 activation evidence；client Secret 永不进入该 evidence 或 Wrangler `vars`；
- 完成连接、断开、重新授权、scope 变化、过期、撤销、client rotation 与错误 redirect 演练。

本地 evidence template 的 client-registration object 是 mode-specific：

- `pre_registered` / `client_id_metadata_document` 使用 `client_id`；
- `dynamic_client_registration` 删除 `client_id` 并使用 `registration_endpoint`；
- 三种模式都使用非空 `redirect_uris` 与 `pkce_method: "S256"`。

## 5. Secrets 与绑定

Staff MCP Worker 唯一新增的 managed Secret 名称为 `STAFF_MCP_BINDING_HASH_SECRET`，必须随机、高熵、至少 32 字符，只经 Cloudflare Secret 管理注入并有轮换/回退窗口。值不得进入 Git、Wrangler `vars`、activation evidence、日志、审计或聊天。

`STAFF_MCP_TOKEN_STATUS_SERVICE` 是 Service Binding，不是 URL 或 Secret。MCP Worker 只发送 HMAC 后 issuer/subject/JTI/client 指纹和时间边界；token-status Worker 自己需要的 Provider 凭证由其独立 Secret/权限边界管理，不进入本仓库这份 MCP 配置。

生产仍需既有 `DB` D1 binding。不得用公开 HTTP 替代 D1/Service Binding，也不得通过 Wrangler vars 注入 JavaScript service object。

## 6. 显式工具能力门禁

`STAFF_MCP_ENABLED_TOOLS` 必须列出本阶段实际批准的非空工具集合。建议：

1. 第一阶段只列批准的 D1 权威读取工具；
2. 观察 audit、rate、revocation、Provider outage 和 rollback；
3. 第二阶段才增加批准的草稿工具；
4. 正式退款、结算、付款、汇率、审核、订单关闭、权限变更或外部发送永不加入 MCP，只回受控 Web 确认。

`list_staff_exceptions_v1` 在真实 D1 exception projection 完成前、`read_task_screenshot_v1` 在真实 File Audience + Read Intent provider 完成前均禁止加入。缺失、空、重复、未知或包含这两个名称时 runtime 失败关闭。`STAFF_MCP_DISABLED_TOOLS` 只能进一步减少。

## 7. 零网络 preflight

先检查 checked-in 默认关闭模板：

```bash
node scripts/preflight-staff-mcp-production.mjs --environment staging
node scripts/preflight-staff-mcp-production.mjs --environment production
```

预期：`BLOCKED_NEEDS_OPERATOR_INPUT`，且 external/provider/deployment/resource mutation 都为 0。

获单独授权后，把 rendered Wrangler config 与 activation evidence 放到 Git 仓库之外的绝对路径，复制 `STAFF_MCP_ACTIVATION_EVIDENCE.example.json` 后按所选 mode 删除不适用字段，再运行：

```bash
node scripts/preflight-staff-mcp-production.mjs \
  --environment production \
  --config /absolute/git-external/production.jsonc \
  --evidence /absolute/git-external/production-staff-mcp-evidence.json
```

结构通过只返回 `LOCAL_CONFIG_AND_EVIDENCE_VALID_PRODUCTION_NO_GO`。脚本不联网、不读取 Secret、不部署、不修改资源，也不打印 client ID、URL、redirect URI 或文件路径。

## 8. 经授权的真实验证顺序

以下全部属于未来独立授权窗口，本 Change 未执行：

1. 所有开关和 D1 GLOBAL control 保持 disabled；只读确认线上 Migration ledger 已包含原始 0038 且 schema 与当前发布兼容。
2. 验证 Custom Domain、TLS、公开 metadata/docs/privacy 页面和 Authorization Server Metadata。
3. 注入/轮换 managed Secret，绑定 D1 与 token-status Service Binding；禁止记录值。
4. 在 staging 注册选定客户端与精确 redirect URI，验证 PKCE S256、resource/audience、scope、JWT/JWKS rotation、撤销传播和 ACTIVE Staff 唯一映射。
5. 以只读工具子集启用 staging；演练 timeout、redirect、非 JSON、Provider outage、重放/冲突、限流、audit failure、D1 control 和 Web 健康独立性。
6. 验证 File Audience/Read Intent 未解析时截图不可发现，exception projection 未解析时异常列表不可发现且不会返回空权威结果。
7. 老板确认隐私、工具目录、审计/告警、保留清理、回滚证据后，才可在另一个明确窗口讨论 production。

## 9. Rollback

1. 首选 `STAFF_MCP_ENABLED=false`；若环境配置路径不可用，立即把 D1 `GLOBAL/staff-mcp` control 设为 disabled。
2. 验证 `/mcp` 拒绝，`/health`、Web deep link 与 `/api/*` 正常。
3. 保留 Migration 0038、subject bindings、revocations、runtime controls、replay/rate 安全状态和 immutable audit；不得 down migration、truncate 或删除审计。
4. 冻结客户端授权并按事件范围撤销 JTI/binding、轮换 key/Secret；操作必须另行授权。
5. 只有 prior Worker 与 schema 兼容且 MCP 保持 disabled 时才回退应用版本；Cloudflare Worker rollback 不替代 D1、OAuth、客户端和 Secret 的独立回滚检查。

## 10. 本任务外部触达

```text
OPENAI_RESOURCES_TOUCHED=no
OAUTH_PROVIDER_RESOURCES_TOUCHED=no
CLOUDFLARE_RESOURCES_TOUCHED=no
PRODUCTION_DATA_TOUCHED=no
REMOTE_WRITES=no
```
