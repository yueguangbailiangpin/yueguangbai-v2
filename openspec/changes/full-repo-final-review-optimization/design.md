# Design: Full Repository Final Review and Optimization

## Baseline and Isolation

审查唯一基线为本地提交 `384873ac3c5c6f83d73e6dd8e1788992081b78e7`。开始时必须同时证明本地 `main` 与 `integration/historical-orders-rakuten-tiktok-platform` 指向该提交，`origin/main` 的本地 tracking ref 仍为 `904c154b66d4acad099c89c0e3719c67837975fe`，远端身份为 `yueguangbailiangpin/yueguangbai-v2`，主工作树仅保留四个已知未跟踪路径。所有源码写入只发生在 `audit/full-repo-final-review-optimization` 的隔离 worktree；基线漂移时停止，不自行 fetch、reset、rebase 或改写主工作树。

## Evidence Matrix

每个结论必须至少绑定一种可执行证据，并优先绑定两种相互独立的证据：

| 审查面 | 权威实现证据 | 必要动态证据 |
| --- | --- | --- |
| 身份、权限、Personal DENY、Scope | Middleware、Application Service、SQL guard、DTO projection | 正向、跨组织/跨店铺、DENY、撤销、防枚举测试 |
| 文件链 | Purpose policy、upload/link/grant/read-intent service、R2 port | intent 创建与消费双重授权、单次/过期/撤销/错误 actor 测试 |
| Migration 0001–0043 | 0001–0042 SHA-256 基线、SQL、schema ledger、trigger/index/table inventory | 字节不可变、fresh/sequential/repeat/wrong-order/no-partial-DDL/FK/integrity |
| 历史订单 | 冻结 SHA、generator、manifest schema | 16,304 行、候选/隔离、订单/重复、H/K 图片守恒与零外写 |
| 跨平台 | registry、neutral identity、formal/evidence/file chain | Amazon 回归、Rakuten/TikTok、跨平台碰撞、混合分页 |
| 卖家本金 | 0041 SQL guard、BigInt domain、snapshot DTO | 精确日期、覆盖优先、显式 0、HALF_UP、不可变、历史不重算 |
| Contract/API/UI | shared Contract、runtime schema、route table、React rendering | null/unavailable、中文、no-store、分页与 lazy-load 测试 |
| 治理与 verifier | package scripts、verifier source、OpenSpec | 故意错误 fixture/边界被拒绝、完整 gate 与 diff 审查 |

旧验收文档只用于定位，不作为当前通过证据。静态字符串或数量断言只有在同时核对真实运行时注册表、SQL 语义或测试失败路径时才可支持结论。

## Triage and Authorized Repair Boundary

发现项分为三类：

1. `FIX_LOCAL`：现有决策、产品规则、Contract 与实现共同给出唯一安全语义；修复保持 fail closed，不创建新业务能力，并可用本地测试证明。直接实施。
2. `REVIEW_ONLY`：复杂度、重复或性能候选尚无足够收益/引用证据，或修改风险高于收益。保留代码，记录证据与建议。
3. `OWNER_AUTH_REQUIRED`：规则冲突或缺失，或需要生产数据/资源/Secret/Provider/部署/远程写入。立即停止该项，不执行。

任何 `FIX_LOCAL` 的物质性改动必须同步本 Change 的 Requirement/Task、focused 回归测试和可恢复说明。不得通过放宽校验、删约束、改测试计数或把 unavailable 显示成可用来让门禁通过。

## Security and Privacy Review

审查从 route 的可信身份入口追到 Application Service、数据库 query/transaction 与 DTO，确认客户端不能指定 Staff、Seller Organization、Store、Buyer、owner、audience 或财务权威。Staff 权限按唯一 active role、默认授权、个人授权、负责人包、Personal DENY、系统硬禁止和 Data Scope 顺序计算。Seller 查询与文件读取必须同时验证 active account/subject/member/organization/store scope；OWNER 也只限本组织 active store。无权资源保持 concealed 404，写入按现有 Contract 返回 403/受控错误，不泄漏另一组织存在性。

文件链固定为 upload intent → verified object → entity link → explicit audience grant → short read intent。intent 创建与字节消费都重新计算当前权限、link/grant/file version 和撤销状态；Seller 文件还必须从 `purpose + entity_type` 回到当前业务实体、ACTIVE Store 与成员角色/Store scope。单次 intent 的条件消费必须断言本次确实取得消费权；Customer 路由把不存在、未链接、无 audience 与撤销统一隐藏为 404。响应不得包含 object key、Drive ID、永久 URL 或可复用 token。

## Migration, Historical Data and Financial Review

Migration 审查使用隔离 SQLite/D1 fixture，不接触生产。0001–0042 必须逐字节等于基线提交，并由 42 项逐文件 SHA-256 清单和文件名/原始字节聚合 SHA-256 自动门禁；不得为补 guard 改写已存在、可能已执行的 Migration。0043 及以后采用只追加的连续版本，已集成版本不回写。

除 schema version 外，验证关键表、trigger、index、FK、transaction assertion 与失败后的完整 schema 和全表数据快照，避免“只改计数”。本地 verifier 把每次尝试包在显式事务中：原始 SQL 失败时回滚；若旧 SQL 在缺少直接前驱时仍成功执行，则在提交前根据事务内读取的前驱版本拒绝并回滚。结果必须如实区分 35 个 SQL 自身错序拒绝与 7 个 verifier 外层事务拒绝，不能宣称七个历史文件自身已有 guard，也不能把该本地 harness 外推为 Wrangler 或生产 D1 证据。0043 以附加 index/trigger 前向修复 0041 的审计与财务完整性。0041–0043 的 forward recovery 边界必须保持：新事实产生后不 down-migrate，不删除不可变策略、订单、证据、文件关联或审计事实。

历史订单完整 dry-run 必须重新计算 source SHA 与 manifest SHA，证明 `source_rows = structural_candidates + quarantined_rows = 16,304`，recognized rows、unique marketplace orders、duplicate groups/exact duplicates、Amazon/Rakuten/TikTok 分类、H/K 图片计划均守恒。所有 external/database/R2/image-byte/Migration/deployment counter 必须为 0；dry-run 结果不升级为生产导入资格。

卖家本金复核固定 `base_rate(platform_order_date) + absolute_markup`，组织覆盖优先且显式 0 不等于缺失；金额只用整数/BigInt 和 HALF_UP，正式订单确认快照不可变，历史订单和既有账务不重算。0043 进一步要求策略确认严格晚于生效时间的反向表述为 `effective_from > confirmed_at`、事件 actor/time/reason 与策略版本一致且同类型唯一、主快照时间等于订单确认时间，并与既有正式订单财务快照的卖家本金金额相等。任何无法从现有 0041/0042 规则确定的非 Amazon 财务事实保持 null/unavailable。

历史 dry-run 输出仍保留治理要求的 raw source 字段，因此新建本地输出目录与所有 JSONL/summary 文件必须为当前用户私有权限；即使调用者复用既有目录，新建或覆盖的输出文件也必须强制为 `0600`。0042 已使 Rakuten/TikTok 成为正式 registry truth，但冻结 manifest 仍携带旧的 registry-unsupported blocker；在没有老板授权新 manifest schema/hash 版本前，不得重签 `a9eb…ede87`，该冲突保持 `OWNER_AUTH_REQUIRED`，且生产导入资格继续为 false。

## Contract, UI, Pagination and Performance Review

共享 Contract、API 实际 DTO、runtime schema 与 UI 必须对同一 discriminator/nullability/错误语义一致。客户界面使用中文与北京时间展示；缺失历史字段、未接入 provider 和不可用财务事实分别显示明确的 unavailable 状态，不由客户端推算权威金融或权限事实。

可增长列表使用服务端 opaque keyset cursor。混合 legacy/platform 来源必须以同一 `(confirmed_at DESC, formal_order_id DESC)` 排序并证明连续翻页不遗漏、不重复。文件图片保持显式展开后才创建 read intent/读取字节；缓存 key 包含身份根并在 Customer Session 失效时同时清理 Buyer/Seller Customer roots，不影响 Staff root。

性能优化只在当前构建、测试或可复现实验显示实际回归时实施。不得通过延长授权缓存、减少动态权限复核、提高 chunk 警告阈值或预加载受保护图片换取表面指标。

## Verification Sequence and Rollback

先运行基线/专项测试定位失败，再实施最小修复并重跑专项；随后运行历史订单完整 dry-run、`db:verify`、Migration guards、OpenSpec strict 和完整 `npm run check`。完整门禁与实现一致性通过后才运行 Ponytail 全仓只读审查。若采纳任何只读建议，必须再跑受影响专项与完整门禁；否则建议保持 `REVIEW_ONLY`。

最终报告记录实际文件、diff 统计、测试文件/测试项数字、Migration inventory、历史 manifest 与守恒数字、权限负向矩阵、性能证据和所有外部写入计数。工作树停在未提交、未推送的“待总控复核”状态。
