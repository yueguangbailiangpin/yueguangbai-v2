# Staff MCP v1 合同

## 1. 交付状态与边界

本合同定义 Staff MCP 工具与业务授权边界。后续 Change `staff-mcp-production-transport-oauth` 已增加默认关闭的 production-capable `/mcp`、OAuth/JWKS 与 D1 durable security boundary；详见 `STAFF_MCP_PRODUCTION_TRANSPORT_OAUTH.md`。当前仍没有真实 ChatGPT/OpenAI OAuth、应用、凭证、外部 MCP 注册、Provider 验收或部署，结论仍为 `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`。

第一阶段只允许 Staff。Buyer/Seller 继续复用现有 Actor、授权和 Application Service 边界，但不创建、不注册、不广告任何 Buyer/Seller MCP 工具或公开端点。

所有事实时间为 UTC 毫秒整数，展示时区固定为 `Asia/Shanghai`。所有工具标题、说明、错误和草稿均为中文。

## 2. 官方要求核验（2026-08-07）

本 Change 于 2026-08-07 核验以下一手资料：

- OpenAI [Authentication](https://developers.openai.com/plugins/build/auth)：认证 MCP 应使用符合 MCP authorization spec 的 OAuth 2.1；资源服务器逐请求验证 issuer、audience、expiry 和 scopes；授权码流使用 PKCE S256；不得使用共享客户端 Secret 代表所有员工。
- OpenAI [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)：工具应按单一用户目标拆分，提供显式 input/output schema、准确 safety annotations，并在 handler 内授权；结果只包含任务所需数据，不得放入 Secret、Token 或不必要个人数据。
- OpenAI [Security & Privacy](https://developers.openai.com/plugins/guides/security-privacy)：最小权限、服务端输入校验、Prompt injection 防御、不可逆动作人工确认、PII 日志脱敏、逐工具 scope 校验和异常流量监测。
- MCP [2025-11-25 Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：工具名、`tools/list`、`tools/call`、JSON Schema 2020-12 默认语义、structured result/output schema、输入校验、访问控制、限流、输出清理与审计要求。
- MCP [2025-11-25 Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)：HTTP MCP 作为 OAuth 2.1 resource server，使用 Protected Resource Metadata 和 Authorization Server Metadata，并验证 Token 专用于本 MCP resource。

本地实现已落地 schema、annotations、当前身份/权限重算、durable 限流/重放/kill switch、低敏不可变审计、fail closed、人工 Web 确认、HTTPS resource、Protected Resource Metadata 及匿名 OAuth/JWKS 校验。以下仍是外部待办且 hard-disabled：真实 authorization server/client、PKCE 回调、token/JWKS/撤销传播、ChatGPT 注册、Cloudflare 部署、外部隐私审批和生产安全评审。

## 3. 身份、授权与会话

- MCP access token 只能由 `StaffMcpOAuthVerifier` 映射为批准的 `clientId + sessionId + staffId + expiry + scopes`。
- verifier 返回值仍是不可信边界：服务端只接受精确的五字段对象；`clientId/sessionId/staffId` 仅允许 1–128 个安全字母、数字、点、下划线或连字符（禁止控制字符和用于 key 拼接的冒号）；`expiresAt` 必须是未过期的非负安全整数；`scopes` 必须是 1–16 个唯一、1–64 字符的安全字符串并包含 `staff:mcp`。验证前的值一律不进入审计、限流或重放 key。
- token 必须具有 `staff:mcp` scope，且只能映射一个已存在的 Staff。
- 每次 `tools/call` 都重新读取 D1：Staff 必须为 `ACTIVE`；至少一个有效角色；Team 和 Department 必须有效；Personal DENY 最终优先；随后重新计算 Customer、Seller Organization、Team 和资源范围。
- 客户端不得传入或覆盖 `staff_id`、role、permission 或 scope。伪造字段因 `additionalProperties: false` 直接拒绝。
- 不使用共享总 API key，不在 MCP session 中保存长期权限快照。
- Token、Cookie、Session、OAuth code、Provider token、Secret 和 Authorization header 不进入工具结果、日志或审计。

## 4. 工具清单

所有工具版本都在工具名中固定为 `_v1`，`readOnlyHint=true`、`destructiveHint=false`、`openWorldHint=false`、`taskSupport=forbidden`。

| 工具 | 类型 | 权限/范围 | 主要输入边界 | 最小输出 |
| --- | --- | --- | --- | --- |
| `list_staff_tasks_v1` | FACT | `TASK_VIEW_OPEN`，本人或获准团队 | `cursor`、`limit<=50`、可选状态 | 待办摘要页 |
| `list_staff_exceptions_v1` | FACT | `TASK_VIEW_OPEN`，本人或获准团队 | `cursor`、`limit<=50`、可选异常类别 | 异常摘要页 |
| `get_customer_summary_v1` | FACT | `BUYER_VIEW` 或 `SELLER_VIEW` + Customer/Org/Marketplace | 单一客户对象 | 最小客户摘要；任务必需时完整微信号 |
| `get_order_summary_v1` | FACT | `ORDER_VIEW` + Customer/Marketplace/资源 | 单一正式订单 | 状态、币种、最小金额摘要 |
| `get_review_summary_v1` | FACT | `REVIEW_VIEW` + Customer/Marketplace/资源 | 单一评论 | 状态与标记为不可信的客户文本 |
| `get_refund_summary_v1` | FACT | `BUYER_REFUND_VIEW` + Customer/Marketplace/资源 | 单一返款义务 | 应付摘要与 Web 下一步 |
| `get_settlement_summary_v1` | FACT | `SELLER_SETTLEMENT_VIEW` + Org/Store/Marketplace | 单一组织和店铺 | 结算摘要与 Web 下一步 |
| `read_task_screenshot_v1` | FACT | 当前任务权限 + 文件 Audience + Read Intent | 单一任务、截图种类 | inline image；无 R2 key/Drive ID/裸链接 |
| `draft_wechat_message_v1` | DRAFT | 对源对象的当前读取权限 | 单一对象、用途、语气枚举 | 中文私人微信文案；不发送 |
| `draft_reconciliation_v1` | DRAFT | `SELLER_SETTLEMENT_VIEW` + Org/Store/Marketplace | 最长 31 天 UTC 区间 | 不可执行对账草稿 |
| `draft_payment_batch_v1` | DRAFT | 每一笔均需 `BUYER_REFUND_VIEW` 和 Customer scope | 1–20 个去重返款 ID | 不可执行付款批次草稿 |
| `draft_review_recommendation_v1` | DRAFT | `REVIEW_VIEW` + Customer/Marketplace/资源 | 单一评论 | 审核建议；不构成决定 |
| `get_web_confirmation_step_v1` | WARNING | 正式动作对应的读取权限 | 动作枚举、单一对象 | 仅 `/staff/...` 受控相对路径 |

完整 JSON Schema 与运行时解析器位于 `apps/api/src/staff-mcp/tools.ts`。列表 cursor 只接受最多 128 字符的 opaque 值；所有对象 ID、枚举、数组和时间区间均有服务端边界；`tools/call.params` 只允许 `name` 与 `arguments`，工具 arguments 只允许各工具声明字段，任何多余字段都拒绝。

### 4.1 structuredContent.data 正向白名单

每个嵌套 object 均为 `additionalProperties:false`；字段名、类型、字符串长度、数组数量和整数范围由同一份 `STAFF_MCP_OUTPUT_SCHEMAS` 同时驱动工具声明与运行时递归投影/校验：

| 工具 | `data` 唯一允许形状 |
| --- | --- |
| `list_staff_tasks_v1` | `items[]:{task_id,title,status,updated_at}`（最多 50）+ `next_cursor` |
| `list_staff_exceptions_v1` | `items[]:{exception_id,title,status,category,updated_at}`（最多 50）+ `next_cursor` |
| `get_customer_summary_v1` | `summary:{customer_id,customer_type,marketplace_code,name,status,wechat_id}` |
| `get_order_summary_v1` | `summary:{order_id,marketplace_code,order_number_masked,status,amount_minor,currency}` |
| `get_review_summary_v1` | `summary:{review_id,marketplace_code,status,untrusted_data}` |
| `get_refund_summary_v1` | `summary:{refund_id,marketplace_code,status,amount_cny_fen}` |
| `get_settlement_summary_v1` | `summary:{seller_organization_id,store_id,marketplace_code,status,due_cny_fen}` |
| `read_task_screenshot_v1` | `summary:{task_id,screenshot_kind,protected_representation="INLINE_IMAGE"}` |
| 四个 draft 工具 | 仅 `{draft_text}` |
| `get_web_confirmation_step_v1` | `summary:{formal_action_executed=false,confirmation_required=true}` |

Application Service 返回未知嵌套字段、错误类型、越长字符串或越界数组时，整次调用在成功审计前以稳定 `INTERNAL_ERROR` 失败关闭；结果没有 `structuredContent`，安全失败审计不保存 payload。通用敏感字段/URL blacklist 仅作为第二层防御，不替代正向白名单。

## 5. 结果与不可信数据

- 成功结果固定区分 `FACT`、`DRAFT`、`WARNING`，含 `tool_version`、UTC `generated_at`、`Asia/Shanghai`、安全 source references、warnings 和 next step。
- 截图只能由 `read_task_screenshot_v1` 返回为单个 inline image content，MIME 仅允许 JPEG/PNG/WebP、base64 必须有效且解码后不超过 8 MiB；`structuredContent` 只含 `INLINE_IMAGE` 标记，不含 data URL、R2/Drive 标识或存储链接。
- 评论、客户文本、OCR 与截图内容始终是数据，不能选择工具、改变参数、创建 scope、提供 `expected_version`、幂等键或批准权威。
- Draft 文案只使用服务端已授权结构化事实与枚举目的，不接收自由 Prompt。
- 正式返款、卖家本金/服务费结算、汇率、审核和订单关闭不由 MCP 执行。`get_web_confirmation_step_v1` 只返回受控 Web 路径；员工必须在 Web 重新授权、读取最新版本并点击。

## 6. 错误、重放、限流与审计

稳定低基数结果包括：`UNAUTHENTICATED`、`NOT_FOUND`、`VALIDATION_REJECTED`、`RATE_LIMITED`、`DISABLED`、`IN_PROGRESS`、`REPLAY_CONFLICT`、`REPLAY_NOT_AVAILABLE`、`PROVIDER_UNAVAILABLE`、`AUDIT_UNAVAILABLE`、`INTERNAL_ERROR`。资源越权统一 `NOT_FOUND`，不泄露对象是否存在。

adapter 按 `client + session + requestId` 建立重放边界，请求哈希绑定 `tool + normalized arguments`：普通 text-only 请求相同哈希返回原结果；不同请求哈希冲突；并发处理中返回 `IN_PROGRESS`。截图只记录 `COMPLETED_NO_RESPONSE` metadata，同一请求返回 `REPLAY_NOT_AVAILABLE`，不保存或重放图片字节。local mock 仍使用 memory；production transport 强制使用 Migration 0038 的 D1 replay/fixed-window limiter、bounded cleanup 与 GLOBAL/TOOL control。

每次工具调用写入既有不可变 `audit_events`：Staff、client、tool/version、受限 scope、outcome、request ID 和 UTC 时间。不保存参数正文、完整 Prompt、微信正文、评论/OCR、截图字节或 Secret。审计不可用时调用失败关闭且不返回业务数据。

## 7. Migration 决策

原 `staff-mcp-agent-access` Change 的 NO_SCHEMA_CHANGE 是当时历史事实。后续 `staff-mcp-production-transport-oauth` 评审确认生产跨实例安全状态必须持久化，因此使用当时下一连续 Migration `0038_staff_mcp_production_transport_oauth.sql`；当前仓库 schema 为 39，0038 的 MCP 归属保持不变。它只保存 HMAC 后 binding/revocation/replay/rate/control，仍复用不可变 `audit_events`；普通 replay 限 256 KiB text-only，截图 replay 不保存 response；token、Secret、Prompt、Provider identifier 或图片字节不进入 replay/audit/log。
