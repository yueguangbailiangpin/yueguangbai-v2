# Staff MCP and Agent Access

## Why

业务所有者希望 ChatGPT/Agent 帮助 Staff 查询待办、识别异常、生成私人微信文案、对账和付款批次草稿。第一阶段只允许 Staff，Buyer/Seller 只保留未来身份/授权边界；Agent 可在员工当前权限内读取完整微信号和必要原始截图，但不能接触凭证/Secret 或最终批准正式业务。

## What Changes

- 建立独立 Staff MCP server/tool contract 与可信 Staff OAuth/session 映射。
- 暴露版本化、窄输入/输出的查询工具：任务、客户、订单、评论、返款、结算和异常摘要。
- 暴露草稿工具：中文微信文案、对账草稿、付款批次草稿和审核建议。
- 原始微信号/截图只在当前 Staff 权限和具体业务对象范围内返回，不做无目的批量导出。
- 所有调用重新计算 D1 权限并记录 tool、actor、scope、business object、result、request ID 和时间。
- 最终返款、结算、汇率、审核和正式状态仍要求员工打开受控 Web 点击确认。
- 当前 Change 只交付 hard-disabled 的本地 server/adapter、OAuth 映射接口、mock、合同、测试和 runbook；不注册公开 MCP，不连接真实 OpenAI/ChatGPT，不部署。

## Non-Goals

- 不上线 Buyer/Seller MCP 工具。
- 不让 Agent 自动发送私人微信、转账或最终批准。
- 不把密码、Session、Token、Secret 或全库导出交给模型。
- 不让模型文本、Prompt 或截图内容成为权限/命令参数权威。
- 不创建第二套业务逻辑或直接 SQL 工具。

## Migration and Contract Impact

优先复用 Staff Session/Permission、Audit、Application Service 和文件授权。实施 inventory 后决定是否需要下一连续 Migration 保存 MCP client binding、tool grants 或专用调用审计；不得提前占号。MCP tool schemas 独立 `v1`，返回结构化最小结果和受控文件内容，不暴露内部 HTTP URL/数据库字段。

## Dependencies

依赖 API Contract alignment、Customer/Marketplace 稳定 Contract、Staff Operations Application Services 和正式 OpenAI/MCP 接入方式选择。实现时必须查验当时官方 OpenAI/MCP 认证、数据处理与工具安全文档。本 Change 记录隐私告知/审批和真实 OAuth 为外部激活 hard gate；不把未执行的外部批准声称为完成。

## Rollback Boundary

MCP 有独立总开关和逐工具开关。停用后不影响 Web/D1。第一阶段只读/草稿工具不产生不可逆业务事实；若未来新增写工具必须独立 Change。

当前连续 Migration 末号为 0034。inventory 证明既有 immutable `audit_events` 足以保存低敏调用审计；本地 binding、rate limit、replay 和 kill switch 通过 port/mock 验证，因此不虚构 0035。未来生产持久化需要必须由独立 Change 使用当时下一连续编号。

## Acceptance

必须覆盖 Staff OAuth、权限/DENY/Scope、双租户/未知主体、工具输入严格校验、资源越权、原始截图、Prompt injection、批量导出拒绝、审计、并发、外部 Provider 故障和 Web 最终确认门禁。
