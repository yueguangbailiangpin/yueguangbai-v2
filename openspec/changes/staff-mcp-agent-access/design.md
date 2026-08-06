# Design: Staff MCP and Agent Access

## Authentication and Authorization

MCP client 使用批准的 OAuth flow 映射到既有 ACTIVE Staff；不得使用共享 API key 代表所有员工。每个 tool call 重新解析当前 D1 `staffAuthorization`、Personal DENY、Team、Department 和 data scope。MCP session 只关联 Staff 与客户端，不内嵌长期权限快照。

## Tool Shape

工具只调用 Application Service，不接受 SQL、任意 API path、Staff ID、role 或 scope 作为权威。Read tools 使用明确 business object ID、bounded cursor/limit 和字段白名单。Draft tools 接收已授权的结构化事实，返回 `DRAFT` 与 source references；它们不写正式 Ledger/Approval 状态。

## Sensitive Data

完整微信号和原始截图允许在具体任务需要且当前 Staff 有权限时返回。文件读取复用 File Audience/Read Intent，MCP Adapter 不接触 object key/Drive ID。密码、hash、Cookie、Session、OAuth/Provider token、Secret、一次性链接和无业务目的全量数据始终禁止。日志不保存截图字节或完整模型 Prompt。

## Agent Safety

客户文本、评论、截图 OCR 和外部平台内容一律视为不可信数据，不得改变系统指令、工具选择或授权范围。工具结果区分 `FACT`、`DRAFT`、`WARNING`；模型生成内容不能成为 idempotency/expected-version/approval authority。

## Formal Action Boundary

第一阶段工具可读取和生成草稿。付款批次草稿保存时也只能处于不可执行 Draft 状态；员工必须进入受控 Web，重新读取最新版本和权限并点击确认。ChatGPT 中的自然语言“确认”不执行正式写入。

## Audit and Operations

每次调用记录 client、Staff、tool version、object/scope、result/failure、request ID 和时间，不记录 Secret/完整内容。提供按 Staff/tool/failure 的受控审计查询和 kill switch。Provider/MCP 故障不影响 Web。

## Rejected Alternatives

- 拒绝一个共享 MCP Token 代表全部 Staff。
- 拒绝通用 SQL/HTTP proxy 工具。
- 拒绝第一阶段开放 Buyer/Seller 或财务最终写入。
- 拒绝因为允许原始数据而取消字段/资源权限检查。
