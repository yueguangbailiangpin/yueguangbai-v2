# 最终 Production GO 本地准备证据审计

> Historical / supporting evidence（本地准备审计）。Final Production GO/NO-GO authority: `docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md`

审计日期：2026-08-13（Asia/Shanghai）

当前收口 Change：`release-gate-evidence-alignment` 及其边界清晰的配套 Change

结论：`LOCAL_IMPLEMENTATION_PRESENT_EXTERNAL_UNVERIFIED / PRODUCTION_NO-GO`

## 1. 候选与证据语义

- 本地收口从已核对的 `main=origin/main=1870c031a136a20e2bf96165e7d15a1da9d6dbbb` 建立独立 `fix/final-go-governance-alignment` 分支；该值只是本任务起点，不是冻结的发布候选。
- 唯一当前候选证据由 `npm run release:check` 在干净、已提交工作树中动态读取并输出 `HEAD` 与 `HEAD^{tree}`。本文不硬编码历史 SHA 冒充当前候选。
- 聚合门禁任一子命令失败即失败；全绿仍只表示本地候选证据完整，不产生生产授权。
- `LOCAL_PASS` 只覆盖仓库静态、匿名 fixture、隔离 D1、local Worker、Chromium 和零外部调用 preflight/dry-run；不表示线上 Migration、部署、真实 Provider、生产数据、真实网络、Web Vitals 或老板批准。

## 2. 当前历史状态

- `production-readiness-backup-validation`、`pre-wave13-baseline-conformance-audit`、`production-cloudflare-web-r2-release-configuration`、`feishu-workbench-production-adapter-activation`、`staff-mcp-production-transport-oauth` 和 `final-production-go-local-preparation` 均已归档并合入当前基线；它们不是 active 或“未提交”工作。
- `pre-wave13-baseline-conformance-audit` 的归档任务记录了本地治理收口，也明确保留真实 Provider、生产网络、数据与最终签字阻断；归档不等于线上完成。
- M10 历史提交 `8c4fdaa382fd1e2c56d76aa23bb6b960c4f6f72c` 只作历史谱系证据。当前仓库 Migration 为连续 `0001`–`0025`，尾部为 `0025_historical_order_import.sql`，不能据此推断线上 ledger 已到 0075。
- 备份与恢复 CLI 已删除 schema 34 默认回退，遗漏、无效或非正整数 `--expected-schema` 会在读取数据库或备份文件前失败关闭。当前操作目标是 Schema 25 / `0001`–`0025`，仍要求上线前授权只读核对真实 ledger。
- Seller 页面不提供自愿“退出登录”入口；Buyer 退出保留。Seller 的 401、Persona/身份不匹配、会话失效仍触发共享 Customer transport 与两类 Customer cache 安全清理。

## 3. 本地发布聚合门禁

`npm run release:check` 依次覆盖：

1. OpenSpec strict all 与高等级依赖审计；
2. 当前主线 `npm run check`；
3. production-readiness、Drive、Staff Auth、Staff MCP 的本地 verifier/preflight；
4. Cloudflare 静态 verifier 与 staging/production 零调用 dry-run；
5. final-production-go 本地 verifier；
6. Chromium/Playwright Wave 14A 验收。

聚合命令要求工作树完全干净，输出实际 commit/tree，并在成功尾部仍固定声明：外部证据 `UNVERIFIED`、Production GO `NO_GO`、preflight 声明外部调用数为 0。模板、mock、dry-run 或 `productionActivationSupported=true` 都不能被写成线上完成。

## 4. 依赖、Migration、权限与产品安全边界

- `react-router` 精确锁定 8.3.0，`react-router-dom` 不存在；每个候选仍须重新运行依赖审计，不能继承历史“0 vulnerabilities”文字。
- Migration verifier 只证明仓库 `0001`–`0025` 连续（尾部为 `0025_historical_order_import.sql`）、fresh/顺序/错序/重复/部分失败关闭；真实 D1 ledger、备份和恢复必须另获授权。
- Personal DENY、四角色唯一性、Team/Customer/Seller/Store/文件 Audience 和财务字段投影保持失败关闭；本任务未读取真实员工、客户或财务数据。
- 金额使用整数最小单位/BigInt，事实时间使用 UTC 毫秒，业务显示使用 `Asia/Shanghai`；本地中文 UI 与 Chromium 合同不能替代真实移动网络矩阵。

## 5. 性能再核验

- 当前入口为 245,784 B raw / 74,236 B gzip；Buyer 登录后 JavaScript 40,216 B，Seller 36,149 B，与接受基线一致。
- 五轮匿名本地 production-preview 中位数：Buyer 357.2 ms、Seller 353.5 ms。Buyer 三个、Seller 六个认证/API 路径每轮各出现一次，没有非认证 React Query 重复请求；接口完成时间约 0.5–13.2 ms。
- 未发现需要进一步拆包、改会话缓存或弱化实时权限的证据，因此本收口不做推测性运行时代码优化。
- 以上仅为同机实验室数据；真实生产 LCP、INP、CLS 未运行、未通过、未声明。

## 6. Production GO 阻断

1. 无老板批准的真实 Cloudflare account、D1/R2、Worker、域名/DNS、Git 外配置、Secrets、部署、HTTPS 与三网验收。
2. 无生产 D1 ledger 只读核验、release-bound 备份、隔离恢复、线上 Migration 窗口与回滚证据。
3. 无真实 R2/Drive Manifest 对账、Drive read-back、恢复与首次 R2 删除批准。
4. 旧 Feishu Staff Auth、同步、回调与告警 adapter 已退出现行架构；发布模板禁止重新引入相关配置。
5. Staff MCP production-capable HTTPS/OAuth/D1/Service Binding/bounded-cleanup 边界已具备且默认关闭，但无真实 issuer、JWKS、token-status、ChatGPT/OpenAI 注册、部署或安全验收。
6. 无真实 Buyer/Seller/Staff 权限隔离、Personal DENY、文件 Audience、财务、渗透、容量与网络验收。
7. 无隐私、外部 AI、跨境、保存/删除/注销和平台政策批准。
8. 无受保护 CI 或已批准的双人不可变人工发布控制，也无老板最终 `PRODUCTION_GO=APPROVED` 签字。

## 7. 当前决定

`NO-GO`。本任务只允许完成本地代码、规范、测试与本地提交；没有部署、线上 Migration、生产数据/Secret 读取、Provider 调用、推送、PR 或合入 main。后续每个真实资源或写动作必须由老板单独授权，并按[老板最终 Production GO/NO-GO Gate](../runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md)留存可回读证据。
