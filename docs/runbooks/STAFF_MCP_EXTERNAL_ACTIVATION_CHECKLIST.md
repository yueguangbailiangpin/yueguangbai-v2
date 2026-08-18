# Staff MCP 外部激活老板清单

> Historical / supporting evidence（G5 外部集成子清单）。Final Production GO/NO-GO authority: `docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md`

本清单全部未执行。OpenSpec 本地 Change 的完成或归档不代表以下事项已批准或已上线；全部完成前，生产 Staff MCP 必须 hard-disabled。

## 隐私与业务批准

- [ ] 老板批准外部 AI 使用场景、工具清单、字段白名单和保存期限。
- [ ] 完成完整微信号、评论/客户文本、OCR 和选定原始截图的外部 AI 隐私告知、授权、删除与注销流程。
- [ ] 完成适用法律、跨境、供应商数据处理和 OpenAI workspace 数据控制审查。
- [ ] 明确禁止密码、hash、Cookie、Session、一次性凭证、OAuth/Provider token、Secret 和无业务目的批量数据。

## 真实 OAuth 与 ChatGPT 注册

- [ ] 老板本人创建/选择真实 OpenAI/ChatGPT workspace 和应用；本仓库不保存真实凭证。
- [ ] 选择并批准 CIMD、DCR 或预注册 client；配置精确 redirect URI。
- [ ] 部署 HTTPS MCP resource 和独立 authorization server/discovery。
- [ ] 发布 RFC 9728 Protected Resource Metadata 与 OAuth/OIDC Authorization Server Metadata。
- [ ] 在 MCP 同一自定义域名发布并人工审核开发说明页和隐私/数据使用政策页；metadata 的 `resource_documentation` / `resource_policy_uri` 必须精确匹配，禁止 placeholder、裸 `workers.dev` 或 preview URL。
- [ ] 实施 OAuth 2.1 authorization-code + PKCE S256，并验证 issuer、audience/resource、expiry、scope、签名与 key rotation。
- [ ] 每个 token 只映射一个既有 ACTIVE Staff；禁止共享总 API key。
- [ ] 完成真实 ChatGPT 连接、断开、重授权、scope 变化、过期、撤销和 client rotation 验收。

## 生产基础设施与安全

- [x] 本地独立 Change 已决定并实现 Migration 0038 的 hashed binding/revocation、durable rate/replay 和 default-disabled kill switch；此勾选只表示本地合同完成，不表示线上已 Migration、启用或验收。
- [x] 本地已实现每次 MCP 请求前的有界 cleanup（replay/rate/revocation 各默认最多 100、硬上限 1000），且 cleanup 未显式启用或失败时 MCP 失败关闭；subject bindings、runtime controls 与正式 audit 不在删除目标中。
- [x] 本地生产组合由 D1 application-service factory 与 Cloudflare token-status Service Binding 构造，不依赖无法由 Wrangler 提供的 JavaScript 对象；Service Binding 只接收 HMAC 标识，并有 3 秒默认超时/主动取消、8 KiB 响应上限、拒绝重定向和失败关闭。
- [x] production factory 当前只广告 11 个已有 D1 权威实现的有限读取/草稿工具；截图与异常列表分别等待 File Audience reader 和 D1 exception projection，不以 mock 或空页冒充生产能力。
- [x] production runtime 现要求显式非空 `STAFF_MCP_ENABLED_TOOLS`；缺失、重复、未知或未解析投影使 runtime 失败关闭，legacy disabled list 只能继续缩小。
- [ ] 老板授权后只读核验真实 ledger，并在独立窗口验证 production D1 容量、24 小时 replay/窗口期 rate/token-expiry revocation 保留与有界清理、撤销传播、告警与回滚；本任务未执行。
- [ ] 确认 immutable safe audit 的容量、索引、保留期、查询权限与告警；不得记录 Prompt/正文/截图字节/Secret。
- [ ] 实施全局及逐工具生产 kill switch、异常流量告警、超时、重试和 Provider outage 演练。
- [ ] 将截图 reader 接到真实 File Audience/Read Intent；在此之前生产 factory 固定禁用该工具。验证图片字节只在单次响应中出现，D1 replay 仅记录 `COMPLETED_NO_RESPONSE` 安全元数据，重复 request ID 返回 `REPLAY_NOT_AVAILABLE`，且 R2/Drive 标识永不出界。
- [ ] 完成 Prompt injection、OCR、客户文本、伪造身份、越权 404、重放、并发、限流、Secret scan 和渗透测试。
- [ ] 完成 OpenAI/MCP 当时最新官方 schema、认证、安全、数据处理与应用审核要求复核。

## 分阶段放行

- [ ] 先仅放行受限读取工具并观察审计/告警。
- [ ] 再放行草稿工具；确认微信不自动发送、付款不执行、审核不落正式状态。
- [ ] 每一阶段把实际工具集合与 Git 外 activation evidence 对齐并重跑零网络 preflight；不得依赖“默认全部 11 个”。
- [ ] 任何正式写工具必须建立独立 OpenSpec Change；不能通过配置偷偷启用。
- [ ] Buyer/Seller MCP 继续未注册、未广告，直到各自独立 Change 和隐私/权限验收。
- [ ] 老板完成最终生产放行签字；规划、本地测试和 Draft PR 都不等于生产批准。
