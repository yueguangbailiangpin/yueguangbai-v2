# V2 验收矩阵

> 状态同步（2026-08-17）：A–H 各项状态逐项映射自 T9 staging acceptance register
> （`openspec/changes/archive/2026-08-17-staging-t9-acceptance-evidence/references/acceptance-register.md`，
> 共 67 项：62 PASS / 3 CONFLICT / 2 BLOCKED，证据日期 2026-08-16/17）。
> 这些状态属于 STAGING / LOCAL 证据范围，不构成生产放行；生产门禁须另行独立验收（当前 Production 状态 NO-GO）。
> PASS 项已勾选，CONFLICT / BLOCKED 项保持未勾选。I/J/K 为本地交付与 CI 治理区，保持原有记录。

## A. 基础

- [ ] 从空目录初始化全新 Git。（CONFLICT — register A01：既有受管仓库，不重建 Git 历史）
- [ ] 无远程 origin。（CONFLICT — register A02：当前仓库要求 GitHub origin，不得移除）
- [ ] 无旧 Migration、资源 ID、Secrets 或真实数据。（CONFLICT — register A03：历史 migration 不可变，staging 数据须为合成）
- [x] TypeScript 严格检查通过。（PASS — register A04，LOCAL_FIXED_SHA：typecheck exit 0 at 9cd4a113，2026-08-16）
- [x] Secret/PII 扫描通过。（PASS — register A05，LOCAL_FIXED_SHA：security:scan 1712 文件，2026-08-16）
- [x] Hono `/health` 本地通过。（PASS — register A06，LOCAL_FIXED_SHA：app.test.ts 3/3；staging 认证探针 pending）
- [x] 所有 Migration 从空库连续执行。（PASS — register A07，LOCAL：db:verify 71 migrations / schema 71；staging ledger 仍待授权升级核验）
- [x] `PRAGMA integrity_check=ok`。（PASS — register A08，REMOTE_D1：wrangler d1 export 重构核验）
- [x] `PRAGMA foreign_key_check` 为 0。（PASS — register A09，REMOTE_D1：wrangler d1 export 重构核验）

## B. 身份与权限

- [x] Cloudflare Access 邮箱唯一映射到 ACTIVE Staff。（PASS — register B01，REMOTE_D1：5 个 email identity 唯一且 ACTIVE）
- [x] Role 权限与 Marketplace 可见范围正确组合。（PASS — register B02，LOCAL_FIXED_SHA）
- [x] 个人 deny 优先。（PASS — register B03，LOCAL_FIXED_SHA：本地 personal-deny 测试）
- [x] Owner 全局；PRIMARY 负责 OPEN 队列；SUPPORT 不竞争 OPEN 队列。（PASS — register B04，REMOTE_D1）
- [x] 五岗位字段与入口隔离。（PASS — register B05，LOCAL_FIXED_SHA）
- [x] 卖家成员四角色正确。（PASS — register B06，LOCAL_FIXED_SHA）
- [x] 非 OWNER 不能导出财务。（PASS — register B07，LOCAL_FIXED_SHA：FINANCIAL_EXPORT 权限模型本地测试覆盖）
- [x] 越权资源返回 404。（PASS — register B08，REMOTE_HTTP：统一 NOT_FOUND，无存在性泄露）
- [x] 客户停用后 Session 立即失效。（PASS — register B09，REMOTE_HTTP：停用后读写全 401）
- [x] 微信号冲突进入人工审核。（PASS — register B10，REMOTE_HTTP：resolution case 201 OPEN，身份脱敏）

## C. 编号

- [x] 买家编号只在第一张正式订单生成。（PASS — register C01，REMOTE_D1）
- [x] 渠道序号原子递增。（PASS — register C02，LOCAL_FIXED_SHA + staging 并发 5x201）
- [x] 序号不复用。（PASS — register C03，LOCAL_FIXED_SHA）
- [x] 历史编号保持原样。（PASS — register C04，GOVERNANCE：staging 无历史编号导入，已消耗号保留原样）
- [x] 卖家渠道序号独立。（PASS — register C05，REMOTE_D1：seller_sequence 9001 独立）
- [x] ASIN Marketplace 唯一。（PASS — register C06，REMOTE_HTTP：同市场重复 409；跨市场缺陷 PR #99 修复，非 JP 创建 409 MARKETPLACE_NOT_SUPPORTED）
- [x] 订单号 Claim 并发测试通过。（PASS — register C07，LOCAL_FIXED_SHA）

## D. 产品、需求和预约

- [x] 产品申请与需求批次分表。（PASS — register D01，REMOTE_D1：产品申请全生命周期 2026-08-16）
- [x] 同店铺重复和跨店铺冲突正确。（PASS — register D02，REMOTE_HTTP：409 DUPLICATE_PRODUCT / ASIN_STORE_CONFLICT）
- [x] R2 上传失败无残留业务记录。（PASS — register D03，REMOTE_R2：403 时 file_object 保持 RESERVED、零残留）
- [x] 需求追加不覆盖旧批次。（PASS — register D04，REMOTE_D1：批次 10/20 共存）
- [x] 普通买家只看到公开需求。（PASS — register D05，REMOTE_HTTP：未公开/未开放统一 404）
- [x] 预约预检正确。（PASS — register D06，REMOTE_HTTP：eligible/full/duplicate/ineligible 全覆盖）
- [x] 同一名额并发批准最多成功一次。（PASS — register D07，REMOTE_HTTP：并发一 200 一 503，名额只减一次）
- [x] 过期释放名额。（PASS — register D08，REMOTE_D1：受控 OPERATOR_RETRY 释放名额）
- [x] 预约重开保留历史事件。（PASS — register D09，REMOTE_D1：PR #98 补 HTTP 路由，append-only 事件链 1→2→3）

## E. 订单

- [x] 买家提交先进入待核对。（PASS — register E01，REMOTE_HTTP）
- [x] 售前确认才生成正式订单。（PASS — register E02，REMOTE_D1：正式订单 d0df4863 确认后才生成）
- [x] 无对应日期汇率时拒绝确认。（PASS — register E03，REMOTE_HTTP：404 且零残留）
- [x] 正式订单保存完整快照。（PASS — register E04，REMOTE_D1：rate/service fee 5000 分/principal 9900 分，HALF_UP）
- [x] 重复请求返回相同结果。（PASS — register E05，REMOTE_HTTP：replayed=true，无重复事实）
- [x] 同 Key 不同请求返回冲突。（PASS — register E06，REMOTE_HTTP：409 IDEMPOTENCY_CONFLICT）
- [x] 图片上传失败补偿。（PASS — register E07，REMOTE_R2 + 本地 file-storage.test.ts 覆盖补偿路径）
- [x] 客户不能伪造 buyer/seller/product 等主体字段。（PASS — register E08，REMOTE_HTTP：跨主体 404，无泄露）

## F. 评论与财务

- [x] 评论状态只能通过工作流。（PASS — register F01，REMOTE_HTTP）
- [x] 审核命令要求 Idempotency-Key 和 expected_version。（PASS — register F02，REMOTE_HTTP：缺 key 400、旧版本 409）
- [x] 评论通过产生返款应付和服务费应收。（PASS — register F03，REMOTE_D1：9900 分 + 5000 分）
- [x] 重放不重复产生财务事实。（PASS — register F04，REMOTE_D1 + 本地原子性测试）
- [x] 已完成返款不可直接编辑。（PASS — register F05，REMOTE_HTTP：trigger 拒绝直接 UPDATE）
- [x] 卖家本金和服务费独立。（PASS — register F06，REMOTE_D1：SELLER_PRINCIPAL 9900 vs SELLER_SERVICE_FEE 5000）
- [x] 冲正、更正和重新入账完整。（PASS — register F07，REMOTE_D1：WECHAT→REVERSAL→ALIPAY，ledger append-only）
- [x] 差额由系统计算。（PASS — register F08，REMOTE_HTTP + 本地 wave13 PRICE_MISMATCH 测试）
- [x] 多口径利润可追溯到事实。（PASS — register F09，REMOTE_D1：payable_due 14900 = 9900 + 5000）
- [x] 卖家 DTO 不含买家返款或内部利润。（PASS — register F10，REMOTE_HTTP：5 个 seller 端点扫描零命中）

## G. 内部任务与告警

- [x] D1 是任务权威源。（PASS — register G01，REMOTE_D1）
- [x] 任务领取原子。（PASS — register G02，REMOTE_HTTP：并发原子性经 D07 证明）
- [x] 工作项命令重复请求保持幂等。（PASS — register G03，REMOTE_HTTP：E05/E06/F02）
- [x] 不存在飞书登录、绑定、同步、回调或告警运行入口。（PASS — register G04，LOCAL_FIXED_SHA：源码零 feishu 引用；运行时探针 pending）
- [x] 内部任务异常进入受控重试或人工处理。（PASS — register G05，REMOTE_D1：D08 OPERATOR_RETRY）
- [x] 外部独立健康告警不包含完整敏感数据。（PASS — register G06，REMOTE_HTTP：零敏感词命中）
- [x] 正式动作必须打开受控 Web 页面。（PASS — register G07，REMOTE_HTTP：Staff Web 批准产品申请 2026-08-16）

## H. 备份与上线

- [x] D1 完整备份生成哈希和 Manifest。（PASS — register H01，T10_LINK：backup bundle + attestation manifest_sha256，2026-08-16）
- [x] 隔离恢复演练通过。（PASS — register H02，T10_LINK：t10-restored.sqlite 含 sqlite_sequence 修复 PR #92，回归 6/6）
- [x] R2 Manifest 可核对。（PASS — register H03，T10_LINK：备份时 bucket 为空；D1 manifest/attestation 可核对；R2 一致性由 upload intent/verify 链覆盖）
- [x] Staging 全流程通过。（PASS — register H04，GOVERNANCE：D/E/F/B/C/G 可执行项全 PASS，T10 PASS）
- [ ] 中国大陆主要网络实测门户可用。（BLOCKED — register H05，EXTERNAL_OPERATOR：需真实大陆运营商/微信网络证据）
- [x] 真实导入先 PREVIEW、再人工审批。（PASS — register H06，GOVERNANCE：当前代码无批量导入功能端点可测，记 not applicable；生产导入 PREVIEW/批准仍属 Production Gate 未执行项）
- [ ] 生产部署有显式授权和回滚方案。（BLOCKED — register H07，GOVERNANCE：Production 保持 NO-GO，out of scope）

## I. Staff MCP 本地交付（M9）

- [x] Staff-only 13 工具合同、schema、mock 和 protocol dry-run 通过。
- [x] ACTIVE Staff、角色、Personal DENY、Team/Department 和资源 scope 每次调用重算。
- [x] 微信号/单任务截图允许路径与 Credential/Secret/批量导出禁止路径通过。
- [x] Prompt injection/OCR/客户文本不能扩工具、参数或权限。
- [x] Immutable safe audit、重放/并发、限流和全局/逐工具 kill switch 通过。
- [x] MCP 关闭不影响 D1/Web，Buyer/Seller MCP 未注册。
- [x] 无需 0035 的 Migration 证据、回滚 Runbook 和本地验收矩阵完成。
- [ ] 真实 OAuth、外部 AI 隐私批准、ChatGPT 注册和生产激活完成（必须按老板清单另行执行）。

## J. 员工获客漏斗本地交付（M14）

- [x] Migration 0036 仅从 schema 35 升级，错序、重复和部分 DDL 失败关闭，隔离备份恢复/前向重新升级通过。
- [x] owner / pre_sales / seller_ops / buyer_refund 职责、Scope 和 Personal DENY 通过，客户端无渠道权威。
- [x] 微信规范化、同类型唯一有效线索、服务端加密/HMAC、脱敏 DTO 与秘钥失败关闭通过。
- [x] 北京日咨询更正、不可变初始归因、自动 Buyer/Seller 关联、未参加与 Seller ACTIVE 合作口径通过。
- [x] 正式订单/利润只计 Buyer 初始来源，Seller 投影无利润字段。
- [x] 十二个北京日历月匿名化、业务/安全/争议/法律豁免、租约重试和只读 Worker dry-run 通过。
- [x] 员工工作台中文入口、`/staff/acquisition` 可收藏路由、窄屏浏览器与 buyer_refund 隐藏控件通过。
- [ ] 正式 Implementation Verify、总控验收、归档与 Production GO（不属于本地实现授权）。

## K. GitHub CI 与治理状态（2026-08-13，canonical main `1870c031a136a20e2bf96165e7d15a1da9d6dbbb`；当前 canonical main = `f7d321c`，2026-08-21）

- [x] External-evidenced（2026-08-13）：canonical main 的 GitHub Actions [run 31660766794](https://github.com/yueguangbailiangpin/yueguangbai-v2/actions/runs/31660766794) 在 `1870c031a136a20e2bf96165e7d15a1da9d6dbbb` 的 push 上完成；`static-governance` 与 `tests-and-build` 两个 job 均为 `success`。
- [x] Code-verified/local（2026-08-13）：PR 与 `main` push 的非生产 CI workflow 使用 locked `npm ci`、Node `24.19.0`、runner 临时 Wrangler/XDG 目录、最小 GitHub token、concurrency/cancel，并调用 canonical `check:ci:static` / `check:ci:test-build`。`static-governance` 现额外只运行 final-go workflow 的 Node 负向 fixture/verifier；不增加第二次全量 Vitest、workspace build 或 E2E。
- [x] External-evidenced（2026-08-13）：Draft PR [#65](https://github.com/yueguangbailiangpin/yueguangbai-v2/pull/65) 的本轮代码证据 HEAD `3123b50f5f610924b124f527e47905fdc35f778c` 已回读 GitHub Actions [run 31667120494](https://github.com/yueguangbailiangpin/yueguangbai-v2/actions/runs/31667120494)：`static-governance` 于 04:30:21Z、`tests-and-build` 于 04:39:07Z 均为 `success`；后者固定记录为 239 个测试文件、1,588 项测试通过，`static-governance` 的 final-go Node fixture/verifier 为 23/23 通过。该 run 的 job 数为 2；它只证明该固定代码 HEAD 的 CI，记录此证据的后续文档 commit 仍必须单独回读，`pending` 不算通过。
- [ ] External-unverified：GitHub branch protection / rulesets 查询因当前私有仓库套餐返回 403，required checks enforcement 未能确认或配置。
- [ ] Production-operator gate：真实 Playwright E2E、staging/production、Cloudflare Access、D1/R2、DNS、Secrets、Scheduler、数据和网络验收均不属于此 CI，须逐项独立授权与验收。
- [x] Current CI status（2026-08-21）：GitHub Actions billing 阻断已解除，CI 恢复可用。PR #112（Merge commit `f7d321c`）远端 CI 三项全部 `success`（run 32466985887：browser-e2e / static-governance / tests-and-build，2026-08-21）。billing 阻断期（2026-08-16 13:42 – 2026-08-21）的 #103–#111 合并依据为 owner 豁免 + 本地完整证据（详见 `docs/CURRENT_SYSTEM_STATE.md` CI 节），该期间 Remote CI = NOT VERIFIED 的历史事实不变。阻断前最后一次远端全绿：2026-08-16 09:51 UTC（run 31940127005，main `e02682f`）。
