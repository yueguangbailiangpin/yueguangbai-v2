# 老板最终 Production GO 分阶段清单

本清单当前全部未执行。每一项都要绑定操作者、UTC 时间、北京时间显示、唯一 release SHA、环境、请求/变更编号和可回读证据。任何本地测试、PR 描述、截图占位、示例配置或口头确认都不能勾选。

## Gate 0：冻结唯一发布候选

- [ ] 总控完成当前收口 Changes 审查、本地提交、干净 Integration 与非强制快进；重新 fetch 并记录最终 `origin/main` 40 位 SHA。
- [ ] 在最终干净候选执行 `npm run release:check`，把其动态输出的 commit 与 tree 绑定到不可变证据；不得沿用历史文档 SHA。
- [ ] 确认工作树干净、无未审查变更、无 open PR、依赖 audit 0、`0001`–`0070` 连续且尾部为 `0070_buyer_refund_reminders.sql`、全量本地/Chromium/OpenSpec 门禁通过。
- [ ] 确认已归档 `pre-wave13-baseline-conformance-audit` 的本地任务状态和仍未完成的外部阻断被分别读取；不得把 archive 状态写成 active，也不得伪勾真实生产项。
- [ ] 选择并批准发布控制：受保护 CI，或有时间戳、双人复核和不可变日志的人工流程。

Gate 0 未通过：`NO-GO`。

## Gate 1：隐私、责任和恢复人

- [ ] 指定发布负责人、D1 恢复负责人、R2/Drive 恢复负责人、安全负责人和独立告警接收人。
- [ ] 批准隐私告知、外部 AI 处理、跨境、永久冷归档、普通附件与安全记录保留期、删除/注销流程。
- [ ] 记录评论/返款业务的平台政策风险；不能标为“无风险”。
- [ ] 批准备份保留期、异地副本、密钥分离、MFA、轮换、恢复演练频率和销毁审批。
- [ ] 若要迁移旧数据，先单独批准只读 AUDIT/PREVIEW；本清单不授权导入。

Gate 1 未通过：`NO-GO`。

## Gate 2：Cloudflare、域名和生产配置

独立 `production-cloudflare-web-r2-release-configuration` 已提供本地 adapter、不可部署模板、preflight 和 runbook；真实资源、Git 外配置、Secret、部署与网络仍全部未执行。以下每项继续保持未勾选，模板或本地测试不能替代。

- [ ] 创建全新的 production D1 与 R2，不复用旧生产资源；另建 staging，记录资源名称/ID到受管配置而非 Git。
- [ ] 完成 Web 静态托管、SPA 深链 fallback、安全 headers、API 同域/CORS、Worker route/custom domain 与 HTTPS。
- [ ] 把真实 R2 binding 通过已验收的 production adapter 接到 `FILE_OBJECT_STORAGE`；验证 put/head/read/delete/补偿和私有访问，禁止裸 key/公开 URL。
- [ ] 建立 production Wrangler/config，绑定 `DB`、R2、Cron 和必要 vars；不含 `REPLACE_BEFORE_USE`。
- [ ] Staging 保持 Scheduler、获客维护和 operational alert sink 关闭；production 仅在独立批准后启用已审查的内部 Scheduler、获客维护和 bound operational alert RPC sink。Drive copy/proxy/delete 与 MCP 继续保持 disabled。
- [ ] 通过 Secret 管理写入并轮换 Customer Session、安全 token、Drive OAuth、关键词服务 Secret 及经独立 Change 批准的其他 Secret；绝不复制到命令日志或 Git。
- [ ] 配置并验证 Cloudflare Access application、policy、team domain、audience、已登记 Staff 邮箱及同源 allowed origins；模板和运行配置不得出现飞书认证或同步键。
- [ ] 实现并配置唯一 `OPERATIONAL_ALERT_SINK` RPC service binding；核对 target、entrypoint、exact props、sink identity、sink deployment/version 以及 preflight 派生 fingerprint。通过 Owner endpoint 触发带随机 nonce 的 delivery、安全 failure-path simulation、recovery receipt 验证，再确认 `/ready` 的 `operational_alerts=ok`。不得用自填 PASS、任意 64 hex、console 日志或旧 release/旧 descriptor 的证明顶替。

Gate 2 未通过：`NO-GO`。

## Gate 3：线上 Migration、备份点和部署顺序

每个写动作单独授权，禁止把本清单当作一次性总授权。

1. [ ] 冻结写入，记录当前线上 Worker SHA、配置快照、D1 ledger、R2/Drive Manifest 和所有开关。
2. [ ] 若目标 D1 已有任何数据，先做迁移前完整导出、加密、SHA-256/Manifest/attestation，并在全新隔离目标恢复通过；恢复目标不得覆盖。
3. [ ] 只读比较线上 ledger 与 release SHA 的完整 `0001`–`0070` 链（尾部为 `0070_buyer_refund_reminders.sql`）；线上可以是该链的连续前缀，但发现未知、跳号、重复、并行或部分 Migration 立即停止。
4. [ ] 老板单独批准 Migration 窗口；只按连续顺序应用尚未应用的 Migration，逐步核验 schema_version、integrity、foreign keys、关键表/触发器/视图和权限事实。
5. [ ] 生成迁移后、绑定最终 release SHA 的 D1 加密备份，并再次在新隔离目标恢复；核对 schema、全表行数、关键财务聚合、Staff/Buyer/Seller/订单/文件/调度 smoke。
6. [ ] 保持所有外部开关关闭，老板另行批准部署 schema-compatible API Worker 与 Web 制品。
7. [ ] 用匿名生产测试账号运行根页、三类登录、会话撤销、404 隐藏、中文、北京时间、上传/HEAD/受控读取和长列表 smoke；记录 request ID。
8. [ ] 任何 smoke 失败先停止新写入和后续开关。没有新 schema 事实时按批准边界切回兼容 Worker；已有新事实时保留 schema，用前向修复。不得 down migration 或覆盖已提交财务/业务事实。

Gate 3 未通过：`NO-GO`。

## Gate 4：Google Drive 冷归档真实验收

- [ ] 老板账号启用 MFA/恢复，建立专用非公开目录，批准最小 OAuth scope、Refresh Token 轮换/吊销、容量告警和误删保护。
- [ ] 使用匿名图片先只启用 shadow copy，R2 继续作为读取源；禁止启用 delete。
- [ ] 对每个样本执行：R2 读取 → Drive upload → Drive 真实 read-back → 同时核对 byte size、MIME、SHA-256。
- [ ] 三项完全一致后，才把 `drive_file_id`、verified time、size/MIME/SHA 和状态写入不可变 D1 Manifest；标识不得出现在浏览器 DTO。
- [ ] 单独启用 proxy-read，用 Buyer、Seller、Staff 三种 Audience 验证授权成功、越权 404、token 过期/重放和 `no-store/nosniff`。
- [ ] 演练授权撤销、Drive missing、Manifest mismatch、账号失效和独立告警；任何失败都停止删除并保留 R2。
- [ ] 完成 Drive→R2 rehydration、PUT 后 HEAD/SHA 校验和重复重试演练；Drive 永久副本不删除。
- [ ] 只有以上全部通过后，老板再单独批准环境和 D1 两层 R2-delete 开关。删除顺序必须是“Drive 回读三项一致 → D1 Manifest 已提交 → proxy 验收 → 明确批准 → 删除 R2”，绝不提前。
- [ ] 首次删除后验证 R2 不存在、D1 为 `DRIVE_ARCHIVED`、受控 Drive 代理仍可读；此后不支持 Drive proxy 的 Worker 不能直接回滚。

Gate 4 未通过：`NO-GO`，R2 delete 必须关闭。

## Gate 5：OpenAI/ChatGPT Staff MCP

`staff-mcp-production-transport-oauth` 已补齐本地可构造、默认关闭的 production-capable runtime；当前仍没有已部署的公开 `/mcp`、真实 issuer/JWKS/token-status service 或 ChatGPT 注册，因此 Gate 仍未开始，不能把本地 `productionActivationSupported=true` 写成已激活。

- [ ] 老板批准 OpenAI/ChatGPT workspace、应用、数据控制、工具白名单、字段白名单、保存/删除和外部 AI 隐私。
- [ ] 部署 HTTPS MCP resource 与 OAuth 2.1 authorization server/discovery，完成 PKCE S256、issuer/audience/resource/expiry/scope/JWKS/rotation 验证；一个 token 只映射一个 ACTIVE Staff。
- [ ] 在 Wrangler 中配置 D1-backed application service 所需 `DB` 与独立 `STAFF_MCP_TOKEN_STATUS_SERVICE` Service Binding；验证仅传 HMAC 标识、超时主动取消、8 KiB 上限、拒绝重定向、撤销与 outage 失败关闭。
- [ ] 先只开放已有 D1 权威 projection 的有限读取：待办和单对象摘要；逐调用重算 Personal DENY、Team/Customer/Seller/Store/文件 Audience。异常列表须先另行完成并验收真实 D1 projection，不能用空页替代。
- [ ] 再开放草稿：中文微信文案、对账草稿、付款批次草稿、审核建议；明确标记 DRAFT，不自动发送或执行。
- [ ] 密码/hash/Cookie/Session/一次性凭证/OAuth token/Secret/无目的批量导出永久禁止。
- [ ] 原始截图只能按一个授权任务读取，不暴露 R2 key/Drive ID/裸链接；生产 factory 当前固定禁用，只有真实 File Audience/Read Intent 验收后才能另行放行。D1 replay 不得保存 image/base64/raw bytes；同 request ID 的成功截图重试必须返回 `REPLAY_NOT_AVAILABLE`。
- [ ] 返款、结算、审核、汇率、订单关闭等正式动作只能返回受控 Web 相对路径；员工必须回网页重新授权、读取最新版本并点击确认。
- [ ] 显式启用并验证有界 replay/rate/revocation cleanup；保留期为 replay 24 小时、rate 到窗口结束、revocation 到 token expiry，每表每次最多 100（可配、硬上限 1000），不得清理 subject binding/runtime control/audit。再验证 durable rate/replay/audit/kill switch、异常流量、连接/断开/撤销/过期和 Provider outage；cleanup 或 MCP 关闭不得影响 Web。
- [ ] 老板单独批准有限读取、再批准草稿；任何正式写工具必须另建 Change。

Gate 5 未通过：`NO-GO`，Staff MCP 必须关闭。

## Gate 6：真实网络、浏览器、权限、安全、备份恢复

- [ ] 中国移动、中国联通、中国电信分别完成 Buyer/Seller/Staff 的根页、登录、深链、上传、受控图片、长列表、中文/北京时间、错误恢复，记录延迟、request ID 和失败重试。
- [ ] 微信内置浏览器完成 Buyer/Seller 关键旅程；Staff 在受 Cloudflare Access 保护的桌面与移动浏览器完成登录和深链。
- [ ] 真实生产测试账号验证 Buyer/Seller/Staff、双 Persona、跨组织/店铺/客户/Marketplace 越权统一 404，Query cache 不串身份。
- [ ] 验证 owner/pre_sales/seller_ops/buyer_refund 唯一角色、零/多/旧角色失败、Personal DENY 最终优先、部门/团队/资源 Scope。
- [ ] 验证内部财务只有 ACTIVE owner + `FINANCIAL_VIEW`，导出额外需要 `FINANCIAL_EXPORT`；Seller OWNER、Buyer 和 MCP 摘要不得看到内部利润或返款成本。
- [ ] 完成 session/cookie/CSRF/origin/rate/replay/idempotency/version/Secret scan/安全 headers/文件 Audience/上传补偿和渗透验收。
- [ ] 用不含真实客户内容的受控样本跑 8 Staff、200 单/日与峰值；验证 D1/R2/Provider 限额和告警。
- [ ] 再做一次 release-bound D1 隔离恢复、R2/Drive reconciliation 和关键 smoke；任何 missing/orphan/duplicate/size/MIME/SHA/public-link finding 都阻断。
- [ ] 演练 Worker rollback、停止写入、Scheduler/单 Job、Drive copy/proxy/delete、MCP 全局/单工具 kill switch。

Gate 6 未通过：`NO-GO`。

## Gate 7：最终 Production GO

- [ ] 汇总 Gate 0–6 的时间戳证据，确认全部绑定同一 release SHA、同一 production 环境且没有 P0/P1。
- [ ] 老板逐项确认 Migration、部署、Scheduler、Drive copy、Drive proxy、首次 R2 delete、MCP 和历史数据导入批准彼此独立。
- [ ] 老板明确写下：`PRODUCTION_GO=APPROVED`、release SHA、批准时间、范围、已接受风险和回滚负责人。

未完成最后一项时，结论永远是 `NO-GO`。本地通过、Integration、main、PR、部署成功或 Provider 单项通过都不能代替老板最终批准。
