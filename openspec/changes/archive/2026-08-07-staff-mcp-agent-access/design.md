# Design: Staff MCP and Agent Access

## Authentication and Authorization

MCP client 使用批准的 OAuth flow 映射到既有 ACTIVE Staff；不得使用共享 API key 代表所有员工。每个 tool call 重新解析当前 D1 `staffAuthorization`、Personal DENY、Team、Department 和 data scope。MCP session 只关联 Staff 与客户端，不内嵌长期权限快照。

当前 Change 只实现 `StaffMcpOAuthVerifier` port 与本地 mock。真实 HTTPS OAuth 2.1/PKCE、Protected Resource Metadata、Authorization Server Metadata、CIMD/DCR、ChatGPT 注册和凭证均未创建，生产装配 hard-disabled。

## Tool Shape

工具只调用 Application Service，不接受 SQL、任意 API path、Staff ID、role 或 scope 作为权威。Read tools 使用明确 business object ID、bounded cursor/limit 和字段白名单。Draft tools 接收已授权的结构化事实，返回 `DRAFT` 与 source references；它们不写正式 Ledger/Approval 状态。

v1 固定 13 个 Staff-only 工具：待办/异常分页、客户/订单/评论/返款/结算摘要、单任务截图、微信/对账/付款批次/审核建议草稿和受控 Web 下一步。Buyer/Seller 工具不在 registry 中。

## Sensitive Data

完整微信号和原始截图允许在具体任务需要且当前 Staff 有权限时返回。文件读取复用 File Audience/Read Intent，MCP Adapter 不接触 object key/Drive ID。密码、hash、Cookie、Session、OAuth/Provider token、Secret、一次性链接和无业务目的全量数据始终禁止。日志不保存截图字节或完整模型 Prompt。

## Agent Safety

客户文本、评论、截图 OCR 和外部平台内容一律视为不可信数据，不得改变系统指令、工具选择或授权范围。工具结果区分 `FACT`、`DRAFT`、`WARNING`；模型生成内容不能成为 idempotency/expected-version/approval authority。

## Formal Action Boundary

第一阶段工具可读取和生成草稿。付款批次草稿保存时也只能处于不可执行 Draft 状态；员工必须进入受控 Web，重新读取最新版本和权限并点击确认。ChatGPT 中的自然语言“确认”不执行正式写入。

## Audit and Operations

每次调用记录 client、Staff、tool version、object/scope、result/failure、request ID 和时间，不记录 Secret/完整内容。提供按 Staff/tool/failure 的受控审计查询和 kill switch。Provider/MCP 故障不影响 Web。

调用审计复用既有不可变 `audit_events`；数据库 trigger 已禁止 UPDATE/DELETE。client binding、rate limit、replay 和 kill switch 当前均为明确 port + local mock，未证明需要新持久化表，因此不创建 0035。生产 durable provider 决策属于外部激活清单/未来 Change。

重放键绑定 client、session 和 request ID，请求哈希绑定 tool 与规范化参数；相同请求重放原结果，不同哈希冲突，并发处理中返回固定状态。全局和逐工具限流、全局和逐工具 kill switch 都 fail closed；审计不可用时不返回业务数据。

## Rejected Alternatives

- 拒绝一个共享 MCP Token 代表全部 Staff。
- 拒绝通用 SQL/HTTP proxy 工具。
- 拒绝第一阶段开放 Buyer/Seller 或财务最终写入。
- 拒绝因为允许原始数据而取消字段/资源权限检查。
