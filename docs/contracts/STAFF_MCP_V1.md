# Staff MCP v1 合同

## 1. 交付状态与边界

本合同只定义本地 Staff MCP server/adapter、OAuth 映射接口、mock、协议 conformance、测试和 runbook。当前没有公开 `/mcp` 端点，没有真实 ChatGPT/OpenAI OAuth、应用、凭证或外部 MCP 注册，没有网络 Provider、部署或生产激活路径。

第一阶段只允许 Staff。Buyer/Seller 继续复用现有 Actor、授权和 Application Service 边界，但不创建、不注册、不广告任何 Buyer/Seller MCP 工具或公开端点。

所有事实时间为 UTC 毫秒整数，展示时区固定为 `Asia/Shanghai`。所有工具标题、说明、错误和草稿均为中文。

## 2. 官方要求核验（2026-08-07）

本 Change 于 2026-08-07 核验以下一手资料：

- OpenAI [Authentication](https://developers.openai.com/plugins/build/auth)：认证 MCP 应使用符合 MCP authorization spec 的 OAuth 2.1；资源服务器逐请求验证 issuer、audience、expiry 和 scopes；授权码流使用 PKCE S256；不得使用共享客户端 Secret 代表所有员工。
- OpenAI [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)：工具应按单一用户目标拆分，提供显式 input/output schema、准确 safety annotations，并在 handler 内授权；结果只包含任务所需数据，不得放入 Secret、Token 或不必要个人数据。
- OpenAI [Security & Privacy](https://developers.openai.com/plugins/guides/security-privacy)：最小权限、服务端输入校验、Prompt injection 防御、不可逆动作人工确认、PII 日志脱敏、逐工具 scope 校验和异常流量监测。
- MCP [2025-11-25 Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：工具名、`tools/list`、`tools/call`、JSON Schema 2020-12 默认语义、structured result/output schema、输入校验、访问控制、限流、输出清理与审计要求。
- MCP [2025-11-25 Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)：HTTP MCP 作为 OAuth 2.1 resource server，使用 Protected Resource Metadata 和 Authorization Server Metadata，并验证 Token 专用于本 MCP resource。

本地实现落地了 schema、annotations、当前身份/权限重算、限流、重放、低敏不可变审计、fail closed 和人工 Web 确认边界。以下事项仍是外部待办且 hard-disabled：真实 HTTPS transport、Protected Resource Metadata、Authorization Server Metadata、CIMD/DCR、PKCE 回调、issuer/audience/JWKS 校验、真实 ChatGPT 注册、外部隐私审批和生产安全评审。

## 3. 身份、授权与会话

- MCP access token 只能由 `StaffMcpOAuthVerifier` 映射为批准的 `clientId + sessionId + staffId + expiry + scopes`。
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

完整 JSON Schema 与运行时解析器位于 `apps/api/src/staff-mcp/tools.ts`。列表 cursor 只接受最多 128 字符的 opaque 值；所有对象 ID、枚举、数组和时间区间均有服务端边界；任何多余字段都拒绝。

## 5. 结果与不可信数据

- 成功结果固定区分 `FACT`、`DRAFT`、`WARNING`，含 `tool_version`、UTC `generated_at`、`Asia/Shanghai`、安全 source references、warnings 和 next step。
- 评论、客户文本、OCR 与截图内容始终是数据，不能选择工具、改变参数、创建 scope、提供 `expected_version`、幂等键或批准权威。
- Draft 文案只使用服务端已授权结构化事实与枚举目的，不接收自由 Prompt。
- 正式返款、卖家本金/服务费结算、汇率、审核和订单关闭不由 MCP 执行。`get_web_confirmation_step_v1` 只返回受控 Web 路径；员工必须在 Web 重新授权、读取最新版本并点击。

## 6. 错误、重放、限流与审计

稳定低基数结果包括：`UNAUTHENTICATED`、`NOT_FOUND`、`VALIDATION_REJECTED`、`RATE_LIMITED`、`DISABLED`、`IN_PROGRESS`、`REPLAY_CONFLICT`、`PROVIDER_UNAVAILABLE`、`AUDIT_UNAVAILABLE`、`INTERNAL_ERROR`。资源越权统一 `NOT_FOUND`，不泄露对象是否存在。

本地 adapter 按 `client + session + requestId` 建立重放边界，请求哈希绑定 `tool + normalized arguments`：相同请求返回原结果；不同请求哈希冲突；并发处理中返回 `IN_PROGRESS`。本地 fixed-window limiter 同时约束 client 全局和 Staff/工具；生产启用前必须替换/验证持久化实现。

每次工具调用写入既有不可变 `audit_events`：Staff、client、tool/version、受限 scope、outcome、request ID 和 UTC 时间。不保存参数正文、完整 Prompt、微信正文、评论/OCR、截图字节或 Secret。审计不可用时调用失败关闭且不返回业务数据。

## 7. Migration 决策

当前连续 Migration 末号为 0034。本地 MCP 不产生新业务事实；client binding、rate limit、replay 和 kill switch 均为明确 port + local mock，真实持久化方案属于外部激活评审。专用 MCP 审计表也不需要：既有 `audit_events` 已具不可更新/不可删除 trigger，并能保存所需低敏字段。

因此本 Change 不创建 0035。`migration-decision.test.ts` 证明 schema 仍为 34、末号仍为 0034，并验证复用审计 trigger。若未来生产评审证明必须持久化 binding/grant/kill switch 或专用调用审计，只能通过新的 OpenSpec Change 使用当时下一连续 Migration，不能回填本 Change。
