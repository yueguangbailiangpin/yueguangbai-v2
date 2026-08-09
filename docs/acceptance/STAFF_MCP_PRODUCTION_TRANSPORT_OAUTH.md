# Staff MCP Production Transport / OAuth 本地验收证据

验收日期：2026-08-09（Asia/Shanghai）

Change：`staff-mcp-production-transport-oauth`

结论：`LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`

## 已由本地实现证明

- 基于已核验 `origin/main=b17395006e21d90f2450665450d05bb46518fd3c` 的独立 worktree/branch 实施，未修改主工作树。
- 连续 Migration `0038` 以 schema 37 guard 创建 hashed subject binding、JTI revocation、durable replay/rate 和 default-disabled D1 control；复用 immutable audit。
- `/mcp` HTTPS JSON-RPC、RFC 9728 metadata/challenge、严格 body/method/content/bearer 边界已实现。
- 匿名 RSA/JWT/JWKS 测试覆盖 issuer/audience/resource/expiry/lifetime/scope/PKCE metadata/signature/rotation/outage/撤销与 ACTIVE Staff 映射。
- durable replay/rate/control 在独立 adapter instance 间由本地 D1 约束；audit、Personal DENY、Team/Customer/Seller/Store、File Audience 与 404 权威不弱化。
- 截图成功只把 request hash、tool、`COMPLETED_NO_RESPONSE` 与 expiry 写入 D1；`response_json=NULL`，同 request ID 重试明确返回 `REPLAY_NOT_AVAILABLE`。普通 replay 仅允许最多 256 KiB 的 text-only 安全结果；图片/base64/raw bytes 与 Provider 存储标识不进入 replay、audit 或日志。
- 每次 MCP 请求前执行显式启用的有界 cleanup：过期 replay、rate、revocation 各默认最多删除 100 行、硬上限 1000；失败时 MCP 返回 503。subject bindings、runtime controls 与正式 audit 永不作为 cleanup 目标。
- production runtime 已由真实 D1-backed application service 和 Wrangler 可绑定的 token-status Service Binding 构造；后者只发送 HMAC 标识，默认 3 秒超时并主动取消，响应上限 8 KiB，拒绝重定向/非 JSON/漂移并失败关闭。生产 factory 在真实 File Audience reader 和 D1 exception projection 分别完成前固定禁用截图与异常列表，不用空结果冒充权威事实；其余 11 个有限读取/草稿工具可构造。
- staging/production 模板继续默认关闭；preflight 只输出字段/Secret 名称，网络/Provider/部署/资源修改计数为 0。
- 没有正式写工具；所有正式动作仍只返回 `/staff/...`，需回 Web 重新授权并点击确认。

## 未由本地实现证明（Production blockers）

- 没有真实 OpenAI/ChatGPT workspace、应用、MCP 注册、连接、断开或审核。
- 没有真实 OAuth issuer/client/redirect/discovery/JWKS/token/revocation/rotation/账号/Secret；token-status Service Binding 边界只有匿名零网络合同，没有已部署服务或真实撤销传播验收。
- 没有 Cloudflare Worker/D1/R2/domain/DNS/HTTPS/部署/remote Migration 或生产数据证据。
- 没有真实网络、真实 Staff、真实 File Audience、真实外部隐私/跨境/保留删除或老板批准。
- 生产 cleanup 容量、运行频率、告警与真实保留/删除效果仍需独立授权验收；检查入库模板保持 cleanup 关闭。

## 外部触达事实

```text
OPENAI_RESOURCES_TOUCHED=no
CLOUDFLARE_RESOURCES_TOUCHED=no
GITHUB_REMOTE_TOUCHED=no
OAUTH_PROVIDER_RESOURCES_TOUCHED=no
PRODUCTION_DATA_TOUCHED=no
REMOTE_WRITES=no
```

## 本地门禁实测

- Strict OpenSpec：目标 Change 通过；全库 `49 passed, 0 failed`。
- `npm run check:staff-mcp-production`：10 个测试文件、52 项测试通过；schema 38、170 tables、313 triggers、Migration 0001→0038 顺序/错序/重复/部分 DDL 守卫通过。
- `npm run check:production-readiness`、`npm run verify:cloudflare-release`、`npm run verify:final-production-go:local`：全部通过，外部验收仍为 blocked/NO_GO。
- `npm run check`：205 个测试文件、1325 项测试通过；安全扫描 1442 个项目文件、依赖漏洞 0、类型检查、Worker dry-run 和全仓构建通过。
- `npm run test:wave14a:browser`：Chromium 180 passed、1 skipped、0 failed。
- staging/production Staff MCP preflight：均为 `BLOCKED_NEEDS_OPERATOR_INPUT`；external/provider/deployment/resource mutation 均为 0。
- P1 修复完成后的只读 Ponytail 审查发现 production catalog 仍广告一个只返回安全空页的异常列表；随后将该工具固定失败关闭并删除空页 helper，再从头重跑专项、完整仓库与 Chromium。未发现可删除依赖、重复 factory 或 speculative abstraction；本 Change 未增加依赖。

以上均使用匿名 issuer/JWKS、假 token/时钟、本地 D1 或静态模板；不构成真实 OpenAI、OAuth Provider 或 Cloudflare 验收。

## 最终决定

本地 Change 已完成并维持 `PRODUCTION_NO_GO`，不授权 staging/production activation。真实值不得补入 Git；任何外部验证必须建立独立、老板明确授权的执行窗口，并继续以全部 kill switch disabled 为起点。
