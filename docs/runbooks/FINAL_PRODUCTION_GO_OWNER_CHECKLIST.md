# 老板最终 Production GO 分阶段清单

本清单当前全部未执行。每一项都要绑定操作者、UTC 时间、北京时间显示、唯一 release SHA、环境、请求/变更编号和可回读证据。任何本地测试、PR 描述、截图占位、示例配置或口头确认都不能勾选。

## Gate 0：冻结唯一发布候选

- [ ] 总控完成本 Change 审查、提交、干净 Integration 与非强制快进；重新 fetch 并记录最终 `origin/main` 40 位 SHA。
- [ ] 确认工作树干净、无未审查变更、无 open PR、依赖 audit 0、0001–0037 连续、全量本地/Chromium/OpenSpec 门禁通过。
- [ ] 正式处置 active `pre-wave13-baseline-conformance-audit`，不得伪勾历史未执行项。
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
- [ ] 初始把 Scheduler、Drive copy/proxy/delete、Feishu sync/callback、MCP 和获客维护等所有外部/破坏性开关保持 `false` 或 disabled；获客维护必须核对精确变量 `ACQUISITION_MAINTENANCE_ENABLED=false`。
- [ ] 通过 Secret 管理写入并轮换所需值：Customer Session、安全 token、Staff auth hash、Staff Auth 飞书 Secret，以及工作台独立的 `FEISHU_WORKBENCH_APP_SECRET`、`FEISHU_WORKBENCH_ENCRYPT_KEY`、`FEISHU_WORKBENCH_VERIFICATION_TOKEN`，另含 Drive OAuth、关键词服务 Secret及经独立 Change 批准的其他 Secret；绝不复制到命令日志或 Git。
- [ ] 配置并验证 Staff Auth 的飞书 endpoints、App ID、tenant、redirect URI、allowed origins/return-to；所有域名精确匹配。
- [ ] 配置独立于飞书的主告警接收器，执行一次带时间戳的投递、失败和恢复演练。

Gate 2 未通过：`NO-GO`。

## Gate 3：线上 Migration、备份点和部署顺序

每个写动作单独授权，禁止把本清单当作一次性总授权。

1. [ ] 冻结写入，记录当前线上 Worker SHA、配置快照、D1 ledger、R2/Drive Manifest 和所有开关。
2. [ ] 若目标 D1 已有任何数据，先做迁移前完整导出、加密、SHA-256/Manifest/attestation，并在全新隔离目标恢复通过；恢复目标不得覆盖。
3. [ ] 只读比较线上 ledger 与 release SHA 的 `0001`–`0037`；发现未知、跳号、重复、并行或部分 Migration 立即停止。
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

## Gate 5：飞书应用、机器人、通知和安全深链

本地已具备 production-capable Task v2 adapter/factory 与官方加密 callback 合同，但没有任何真实飞书资源或验收；不能靠本地测试、模板或填写 Secret 激活。先运行 `npm run preflight:feishu-workbench`，其正确结果仍是 `LOCAL_NO_GO`。

飞书激活预检必须同时证明 `ACQUISITION_MAINTENANCE_ENABLED=false`，六个标准调度作业全部 disabled；否则 Gate 5 立即失败，禁止以工作台窗口夹带获客维护或读取其 Secret。

- [ ] 老板创建真实自建应用，批准最小 OAuth/用户/任务或多维表格/机器人/回调 scope，并记录当前免费版/API 版本和额度。
- [ ] 使用匿名 A/B/C Staff 完成 OAuth、tenant 唯一映射、inactive/unknown/冲突失败关闭。
- [ ] 验证工作台只同步安全任务摘要，不含完整微信、截图、凭证、内部利润或 Secret；D1 始终权威。
- [ ] 验证机器人/内部通知只发送提醒与最小摘要，不执行返款、结算、审核、汇率或正式业务状态。
- [ ] 深链只能是批准的 production HTTPS origin 下 `/staff/work-items/{id}`；打开后必须重新用当前 Staff Session、Personal DENY 和 Scope 授权。
- [ ] 验证官方 `X-Lark-*` SHA-256 签名、AES-256-CBC 加密 challenge/card action、Verification Token/App/Tenant、五分钟窗口、16 KiB 上限、nonce/event 重放、版本冲突、跨团队改派拒绝、429/5xx retry/dead-letter。
- [ ] 验证 Feishu outage 不影响 D1/Web，并由独立告警通道通知；分别演练 sync 与 callback kill switch。
- [ ] 完成飞书桌面/移动端及三大运营商匿名容量 PoC 后，老板再分别批准 Staff Auth、sync、callback/机器人阶段。

Gate 5 未通过：`NO-GO`，Feishu workbench sync/callback 必须关闭。

## Gate 6：OpenAI/ChatGPT Staff MCP

必须先完成 `staff-mcp-production-transport-oauth` Change；当前没有公开 `/mcp`，且 runtime 明确不支持生产激活。

- [ ] 老板批准 OpenAI/ChatGPT workspace、应用、数据控制、工具白名单、字段白名单、保存/删除和外部 AI 隐私。
- [ ] 部署 HTTPS MCP resource 与 OAuth 2.1 authorization server/discovery，完成 PKCE S256、issuer/audience/resource/expiry/scope/JWKS/rotation 验证；一个 token 只映射一个 ACTIVE Staff。
- [ ] 先只开放有限读取：待办/异常和单对象摘要；逐调用重算 Personal DENY、Team/Customer/Seller/Store/文件 Audience。
- [ ] 再开放草稿：中文微信文案、对账草稿、付款批次草稿、审核建议；明确标记 DRAFT，不自动发送或执行。
- [ ] 密码/hash/Cookie/Session/一次性凭证/OAuth token/Secret/无目的批量导出永久禁止。
- [ ] 原始截图只能按一个授权任务读取，不暴露 R2 key/Drive ID/裸链接；验证 Prompt injection、OCR 注入和跨客户 404。
- [ ] 返款、结算、审核、汇率、订单关闭等正式动作只能返回受控 Web 相对路径；员工必须回网页重新授权、读取最新版本并点击确认。
- [ ] 验证 durable rate/replay/audit/kill switch、异常流量、连接/断开/撤销/过期和 Provider outage；MCP 关闭不得影响 Web。
- [ ] 老板单独批准有限读取、再批准草稿；任何正式写工具必须另建 Change。

Gate 6 未通过：`NO-GO`，Staff MCP 必须关闭。

## Gate 7：真实网络、浏览器、权限、安全、备份恢复

- [ ] 中国移动、中国联通、中国电信分别完成 Buyer/Seller/Staff 的根页、登录、深链、上传、受控图片、长列表、中文/北京时间、错误恢复，记录延迟、request ID 和失败重试。
- [ ] 微信内置浏览器完成相同关键旅程；飞书移动端完成 Staff 深链。
- [ ] 真实生产测试账号验证 Buyer/Seller/Staff、双 Persona、跨组织/店铺/客户/Marketplace 越权统一 404，Query cache 不串身份。
- [ ] 验证 owner/pre_sales/seller_ops/buyer_refund 唯一角色、零/多/旧角色失败、Personal DENY 最终优先、部门/团队/资源 Scope。
- [ ] 验证内部财务只有 ACTIVE owner + `FINANCIAL_VIEW`，导出额外需要 `FINANCIAL_EXPORT`；Seller OWNER、Buyer 和飞书/MCP 摘要不得看到内部利润或返款成本。
- [ ] 完成 session/cookie/CSRF/origin/rate/replay/idempotency/version/Secret scan/安全 headers/文件 Audience/上传补偿和渗透验收。
- [ ] 用不含真实客户内容的受控样本跑 8 Staff、200 单/日与峰值；验证 D1/R2/Provider 限额和告警。
- [ ] 再做一次 release-bound D1 隔离恢复、R2/Drive reconciliation 和关键 smoke；任何 missing/orphan/duplicate/size/MIME/SHA/public-link finding 都阻断。
- [ ] 演练 Worker rollback、停止写入、Scheduler/单 Job、Drive copy/proxy/delete、Feishu sync/callback、MCP 全局/单工具 kill switch。

Gate 7 未通过：`NO-GO`。

## Gate 8：最终 Production GO

- [ ] 汇总 Gate 0–7 的时间戳证据，确认全部绑定同一 release SHA、同一 production 环境且没有 P0/P1。
- [ ] 老板逐项确认 Migration、部署、Scheduler、Drive copy、Drive proxy、首次 R2 delete、Feishu、MCP 和历史数据导入批准彼此独立。
- [ ] 老板明确写下：`PRODUCTION_GO=APPROVED`、release SHA、批准时间、范围、已接受风险和回滚负责人。

未完成最后一项时，结论永远是 `NO-GO`。本地通过、Integration、main、PR、部署成功或 Provider 单项通过都不能代替老板最终批准。
