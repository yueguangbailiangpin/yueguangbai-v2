# V2 后端重建清单（阶段 1：功能、路由、表和依赖）

日期：2026-08-25。分支：`feature/staging-workflow-rate-ux`（基线 `364ba7a1`，领先 `origin/main` 88 个提交，工作树干净）。同日修订：业务所有者对阶段 1 有条件通过，落实六项修订（历史数据定位、verifier 保护、OpenSpec 分类门槛、看板简化、归档访问规则、platform_* 删除确认）。

依据：业务所有者 2026-08-25 授权 + `docs/decisions/V2_DECISION_REGISTER.md` D-054（无生产数据阶段允许重建干净基线；含 verifier 等价迁移与 OpenSpec 分类两道执行门槛）、D-055（冷归档与后台执行重建，含归档访问规则）。本清单是后续删除、重建阶段的权威工作清单；引用关系确认发生在每个执行阶段，不在本文件内假设完成。

本阶段范围：后端、数据库、contracts、文件系统、后台任务、测试和权威文档。不开始员工端视觉重构。

## 0. 现状基线

- 迁移链：`0001`–`0075`（schema 75 候选），约 200+ 张真实表，另有 `phase3*_backup_*` 备份表与 `*_next` 换代表等迁移脚手架。
- API：263 个唯一端点（261 个 `/api/*` + `/health` + `/ready`），另有 Staff MCP 独立 transport。
- 代码：`apps/api/src` 64 个顶层模块（acquisition 27 文件 / 384K，staff-mcp 20 文件 / 264K），`packages/contracts` 约 60 个合同文件。
- 定时任务：`reservation_expiry`、`instruction_expiry`、`outbox_delivery`、`file_orphan_cleanup`、`drive_archive`。
- 全量测试基线：1905 通过（`364ba7a1`，重建前最后一次实测）。

## 1. 保留（重新整理，不降低约束）

### 1.1 身份与权限

| 能力 | 模块 | 说明 |
|---|---|---|
| Cloudflare Access + D1 Staff Session | `staff-auth`、`http-auth` | D-032；Access 只证明邮箱，D1 是授权权威 |
| 五角色 + Personal DENY + Marketplace scope | `staff`、`staff-access-management` | owner / acquisition / pre_sales / seller_ops / buyer_refund（D-034、D-040） |
| Customer 双身份与隔离 | `customer-auth`、`customers`、`customer-onboarding`、`customer-security`、`customer-identity-resolution` | D-017、D-018、D-044；邀请、恢复、限流、fail-closed 全保留 |
| Buyer/Seller 门户 API | `buyer-portal`、`seller-portal` 及各业务子模块 | DTO 隔离、concealed 404 不变 |

### 1.2 业务主链路

| 能力 | 模块 | 说明 |
|---|---|---|
| 产品、版本、主图 | `catalog` | ASIN/产品编号权威归属 |
| 产品申请、需求批次 | `product-applications`、`demand-batches` | 含 0071 申请金额 |
| 预约与排期 | `reservations`、`product-reservation-scheduling` | D-028、D-052；店铺级互斥 |
| 下单指引 | `order-instructions` | D-051 文字关键词模式；关键词图片能力删除（见 2.3） |
| 待核对订单资料 → 正式订单 | `order-evidence`、`formal-order-shared` | 订单号认领、快照、确认事务 |
| 评论工作流 | `reviews`、`buyer-reviews`、`seller-reviews` | 审核通过生成返款应付 + 服务费应收 |
| 买家返款 + 催办 + Advance | `buyer-refunds`、`buyer-refund-status` | D-043 全额模式、D-046 催办、0070 |
| 卖家本金/服务费/结算/凭证 | `seller-settlements`、`pricing` | 不可变账本、冲正、分配 |
| 汇率中心与服务费版本 | `rate-center`、`pricing` | D-053：订单日基础汇率统一权威；服务费键 `seller_organization + marketplace + review_type + effective_version`，显式 0 ≠ 缺失 |
| 内部财务与导出 | `internal-finance` | FINANCIAL_VIEW / FINANCIAL_EXPORT + Personal DENY |
| 文件子系统 | `files`、`file-policy`、上传/读取意图、audience grants | R2 补偿模式（AGENTS.md §8）不变 |
| 聊天截图 | `buyer-chat-screenshots`、`seller-order-chat-screenshots` | 卖家聊天必须纳入归档（D-055） |
| Staff 待办与全局搜索 | `staff` work-items、`staff-search` | 保留 |
| 经营看板 | `admin-business-dashboard` | 保留但简化（见 3.2） |
| 运行完整性与 staging | `operating-integrity`、`operational-readiness`、`production-readiness`、`staging-bootstrap` | D-041/D-049 边界保留 |

### 1.3 人工获客最小能力（D-026 + D-035 + D-040 收窄）

保留：人工选择渠道来源、Buyer/Seller Prospect 与正式 Lead、首触员工 / Marketplace / 渠道记录、渠道日咨询（owner 写）、来源归因与审计。

保留表（进入新 baseline 时清理冗余列）：`acquisition_channels`、`acquisition_channel_events`、`acquisition_staff_channel_assignments`、`acquisition_prospects`、`acquisition_leads`、`acquisition_lead_events`、`acquisition_daily_consultations`、`acquisition_daily_consultation_events`、`acquisition_customer_attributions`。

不保留：机器信号、自动漏斗推进、自动消息、机器凭证（见 2.1）。

### 1.4 历史导入能力

约 20,000 单是真实历史业务数据，但当前未进入本项目生产数据库；所有外部订单源、图片源和导入源必须保留，禁止触碰。新 baseline 必须证明可无损导入这些历史业务数据。保留 0040 卖家总表导入模型（`seller_partner_import_batches`、`seller_partner_import_source_records`、`standard_products`、`seller_product_offerings`）与历史订单导入设计（`docs/migration/HISTORICAL_ORDER_*`），在新 baseline 中重建成干净的一次性导入 + 校验 + dry-run 能力；"无损导入"以字段级映射覆盖、行数守恒与抽样核对证据为准（阶段 6）。

## 2. 删除（执行阶段先确认引用关系）

### 2.1 自动获客 Agent 与机器凭证

- 路由：`POST /api/acquisition-machine/prospects`、`POST /api/acquisition-machine/prospects/:id/analysis`、`POST /api/acquisition-machine/prospects/:id/signals`、`POST /api/staff/acquisition/machines`、`POST /api/staff/acquisition/machines/:id/revoke`、`GET /api/staff/acquisition/machines`。
- 表：`acquisition_machine_credentials`、`acquisition_machine_channels`、`acquisition_machine_marketplaces`、`acquisition_machine_rate_buckets`（0057）。
- 更正（2026-08-25 阶段 2 执行时发现）：`acquisition_maintenance_runs`、`acquisition_maintenance_state` 与 `maintenance.ts` **不是**机器时代产物——它们承载 D-026 保留业务（线索↔注册身份自动关联、卖家确认合作检测、12 个月未转化线索匿名化、游标推进），连同 `ACQUISITION_MAINTENANCE_ENABLED` 就绪门与 dry-run 测试一并保留，归入新 baseline。
- 代码：machine 运行时、机器信号写入路径。
- 业务所有者 2026-08-25 确认删除：`acquisition_prospect_signals`（机器自动信号无现行业务）及机器时代指标（见 3.1）。

### 2.2 Staff MCP / Agent runtime

- 代码：`apps/api/src/staff-mcp/`（20 文件）、`packages/contracts/src/staff-mcp.ts`。
- 表：`staff_mcp_rate_limits`、`staff_mcp_replay_records`、`staff_mcp_runtime_controls`、`staff_mcp_subject_bindings`、`staff_mcp_token_revocations`（0038）。
- 文档：`docs/contracts/STAFF_MCP_V1.md`、`STAFF_MCP_PRODUCTION_TRANSPORT_OAUTH.md`。
- D-021 的 MCP 边界记录保留为历史，新 baseline 不再实现 MCP transport。

### 2.3 飞书与关键词图片残留

- 飞书表已由 0065 条件退役（当时确认全空）；新 baseline 不再包含 0033/0034/0065 的飞书对象。D-032 继续禁止复活飞书运行能力。
- 关键词图片：`keyword-image-generator-service.ts`、`keyword-image-generator-worker.ts`、`resvg-wasm` 依赖、表 `order_instruction_keyword_images`、`order_instruction_asset_batches`、`order_instruction_asset_items`，路由 `POST /api/staff/order-instructions/:id/assets/prepare`、`GET /api/staff/order-instructions/:id/assets/:batchId`、资产 reconciliation 任务。D-051 已停用新版本关键词图片，历史表仅审计保留——无生产数据阶段直接删除。

### 2.4 旧别名、兼容层与迁移脚手架

- `marketplace_legacy_aliases`（0029）：canonical registry 已替代。执行更正（2026-08-25 阶段 2）：买家侧 DTO 仍以 `JP` 短码为现行 API 合同投影，DB 行亦存 `JP`；别名表、`LegacyMarketplaceCode` 类型、registry 短码查找与 `legacyMarketplaceProjection` 存储投影必须在阶段 3（schema 重建）与阶段 4（DTO 合同重建）中原子移除，不得提前单独删除。
- 全部 `phase3*_backup_*` 表、`*_next` 换代表：迁移脚手架，不进入新 baseline（随阶段 3 旧链整体消失）。
- 旧 Seller Agreement Rate 兼容投影：D-045 已退役；`verify-seller-agreement-rate-retirement` 2026-08-25 实测 0 残留（581 文件扫描），该 verifier 按 §7 在 baseline 建成后废弃。
- `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED` 等已无现行业务用途的 Feature Flag：实测已全部消失；现存 flag（Drive 归档四开关、OUTBOX/SCHEDULER/ACQUISITION_MAINTENANCE、BUYER_SELF_REGISTRATION、RESERVATION_AUTO_APPROVE）均有现行业务用途，保留。
- 仅为旧前端兼容存在的 DTO 别名与 re-export（D-036/D-038/D-039 已退役大部分，重建时扫尾）。

### 2.5 Rakuten/TikTok JP 平台预备层（业务所有者 2026-08-25 已确认删除）

0042 引入的 `platform_product_identities`、`platform_order_identities`、`platform_identity_events`、`platform_order_evidence_records`、`platform_formal_orders`、`platform_order_evidence_internal_files` 及对应运行实现（`apps/api/src/marketplace-adapters` 的 Rakuten/TikTok 预备、`verify:marketplace-adapters` / `preflight:marketplace-adapters`）：确认删除。保留 Marketplace Registry、`AMAZON_JP`（唯一写路径）以及禁用状态的 `AMAZON_US` / `COUPANG_KR` 扩展边界（fail-closed 种子与 Adapter 接口边界进入新 baseline）；未来需要 Rakuten/TikTok 时按新的 OpenSpec Change 重新引入。

### 2.6 被删除功能对应的测试、脚本与文档（受 D-054 执行门槛 1 约束）

- **旧验证脚本禁止直接删除**：`verify-phase3*`、`verify-wave11/12/13*`、`verify-module1*` 等脚本先经 §7 映射表逐个列出保护的业务断言，把仍然有效的断言迁移到新 baseline 测试和新命名 verifier；等价测试真实执行通过后，才允许删除对应旧脚本与 package.json 条目。绑定旧迁移链序号（0022–0028、0036–0037 等）的保真断言按"断言所描述的约束进入新 baseline schema 测试"认定等价。
- `docs/ACQUISITION_CHANNEL_PRIVACY_FREEZE.md` 等仅约束已删能力的冻结文档移入 archive 或删除。
- 绑定被删表的测试与 seed。

## 3. 合并 / 简化

### 3.1 获客漏斗与指标（业务所有者 2026-08-25 确认）

- 删除：`acquisition_prospect_signals`、机器时代漏斗/信号指标及 `/api/staff/acquisition/funnel`、`handoffs`、`reporting-config`、`source-corrections` 中只服务机器归因的部分。
- 保留：人工来源与首触归因事实（渠道事件、线索来源、创建员工、日咨询）、看板所需的最小人工漏斗事实。
- `acquisition_reporting_config`、`acquisition_historical_source_exemptions`、`acquisition_customer_intake_facts`、`acquisition_lead_source_corrections`、`acquisition_channel_privacy_profiles`：按简化后的人工归因模型重建或删除。

### 3.2 经营看板（业务所有者 2026-08-25 确认范围）

只保留：今日 / 本周 / 本月（`Asia/Shanghai`，自然周从周一开始）的客户、预约、正式订单计数，待返款、待结算，异常逾期，以及 Owner 财务摘要（预计利润 / 已完成利润，CNY 整数分，复用正式内部财务公式，仅 Active owner + `FINANCIAL_VIEW`，Personal DENY 最终优先）。

删除：复杂获客漏斗图、多维渠道趋势和大型 drill-down（对应 `/api/staff/admin-business-dashboard/drill-down`、`trends`、`acquisition-daily` 中的机器时代维度）；保留人工来源与首触归因事实供最小归因统计。看板只读后端业务与人工获客事实，不允许手工填写任何业务数字。

### 3.3 多市场基础

- 0029 + 0042 + 0060 合并为干净 Marketplace Registry：AMAZON_JP（唯一写路径）、AMAZON_US、COUPANG_KR（预留禁用）；`marketplace_runtime_config` 简化。

## 4. 重建

### 4.1 数据库 baseline（阶段 3）

- 删除 `0001`–`0075` 迁移链，新建单一 `0001_backend_baseline.sql`（可按域拆分为顺序文件），后续变更前向追加。
- 新 baseline 内容 = 第 1 节保留能力 + 第 3 节简化结果；金额/汇率整数、UTC 毫秒、审计、幂等、版本、source guard 触发器、财务不可变约束全部进入新 schema。
- 本地 seed 与匿名测试数据重写；`app_schema_state` 从新链重新计数。
- `scripts/verify-migrations.mjs`、`verify-migration-version-guards.mjs` 同步重建（fresh/sequential/wrong-order/repeat/dirty-stock 回滚与 FK/integrity 检查保留）。

### 4.2 Contracts 与 API（阶段 4）

- 按 1.1–1.3 重建合同与路由，删除兼容 DTO；`V2_API_ROUTE_INVENTORY.md` 在重建后以真实 `app.routes` 重新生成（端点数会显著下降）。
- 幂等、expected_version、请求哈希、状态机、审计、Outbox 模式按 AGENTS.md §8 原样保留。

### 4.3 冷归档 + Queue + 恢复状态机（阶段 5，D-055）

- 归档单元：ORDER（含卖家聊天截图）、BUYER_REFUND_PAYMENT、SELLER_SETTLEMENT_PAYMENT。
- ZIP + manifest.json 流式生成临时 R2 bundle（JPEG store 模式不重压缩，TransformStream，不整包缓冲）→ resumable upload → 回读校验 size/MIME/SHA-256 → 条件删除 R2。
- Queues push consumer 模板：`max_batch_size` 1–5、`max_retries`、DLQ、`retry_delay`、逐消息 `delaySeconds` 指数退避、Drive 并发信号量初始 3；消息仅含 `bundle_id/version/trace_id`。
- 恢复：只有 Staff 可以触发"恢复图片"；后台异步恢复到临时 R2 → 7 天自动清理 → Drive 原包永久保留。Buyer/Seller 对已归档文件只看到占位状态与"联系工作人员"提示；恢复成功后仍按原 file audience 与资源归属授权，恢复不得扩大可见范围；首次历史归档 shadow-copy。
- 容量指标：backlog、成功、失败、重试、最老积压、最近成功。

### 4.4 历史导入与容量（阶段 6）

- 20,000 真实历史订单 dry-run import，以字段级映射覆盖、行数守恒与抽样核对证明无损；外部订单源、图片源、导入源文件全程只读、永不触碰。
- ≥5 图/单场景、≥100,000 Manifest；cursor 分页全面化；归档吞吐 ≥ 日增到期量 1.5 倍的合成验证。

## 5. OpenSpec 变更分类（D-054 执行门槛 2：分类完成前不得建立 backend-clean-baseline-rebuild）

以下为 `openspec/changes/` 全部 11 个非归档变更的逐项分类（2026-08-25 盘点，依据各 change 的 proposal.md 与 tasks.md 完成度）。归档动作在阶段 2 执行；在此之前本表是处置权威。

| Change | 分类 | 理由 | 涉及源码 | 处置 |
|---|---|---|---|---|
| current-reservable-product-seller-mapping | merge-into-rebuild | 历史导入预览与卖家资料映射规则属于重建阶段 6 保留能力；12/14 完成，剩余 2 项须在新 baseline 上执行 | `tools/imports`、`scripts/dry-run-current-reservable-*`、`fetch-current-reservable-*` | 数据映射业务规则原样保留；工具按新 baseline 重建后在 rebuild Change 内关闭 |
| github-independent-production-health-monitor | unrelated/keep | 独立生产健康监控属运维域，与后端重建无冲突；6/7 完成 | `.github/workflows`、`scripts/production-health-monitor*` | 保留；阶段 8 必须保持 `/ready` 语义或同步更新 workflow |
| google-drive-cold-archive-production-preflight | superseded | 7/7 完成，但其预检对象（单文件 Drive 归档模型）被 D-055 ZIP Bundle + Queues 模型取代 | `scripts/preflight-google-drive-cold-archive*` | 归档（superseded by D-055）；新预检在阶段 5 按 Bundle 模型重建 |
| moonwhite-frontend-review-mode | unrelated/keep | 前端演示评审面属前端域，本阶段不动前端；10/13 完成 | `apps/web` review 路由、fixtures、Demo adapter | 保留至前端重构阶段再裁决；其后端隔离 guard（`REVIEW_MODE_REAL_API_BLOCKED`）不得被重建弱化 |
| reservation-review-order-evidence-readiness | completed | 实现已进入 main 并由 D-051/D-052 固化；32/35 完成，剩余 3 项为 staging 重建验证 | `apps/api` 预约审核/订单证据就绪/文字指引、staging 流程 | 主体归档；staging 开放任务并入 rebuild Change 在新 baseline 重做 |
| schema64-integration-stabilization | completed | 飞书退役、acquisition 路由去重、0044–0064 稳定化已由 0065 + D-032 落地；18/20 完成 | `staff-auth`、acquisition 路由、迁移链、release preflight | 归档；残留 2 项开放任务并入 rebuild |
| security-command-integrity-readiness | merge-into-rebuild | 机器凭证加固对象将删除；但命令协议（请求哈希、幂等完成、Audit/Outbox、最终断言、同源严格 body）是保留断言；13/14 完成 | acquisition machine 命令、`customer-security` 改密、`order-instructions` 写路由 | 仍有效断言迁入新 baseline 测试（见 §7）；机器凭证部分随删除废弃 |
| seller-principal-rate-policy | completed | D-031/D-045/D-053 已实现并决策固化；23/25 完成，剩余为生产激活项（本就 out of scope） | `pricing`、`formal-order-shared`、Migration 0041 | 归档；schema 断言由新 baseline 财务测试承接 |
| staging-access-jwks-public-fetch | unrelated/keep | JWKS 公网取回合同（`global_fetch_strictly_public`）是保留的 Access 运行边界；8/12 完成，未完成项为 staging 部署验证（待远程授权） | wrangler 模板、`preflight-cloudflare-release`、`staff-auth` | 仓库侧合同迁入新 release 模板；staging 部署任务保留待授权 |
| staging-access-jwks-worker-runtime | superseded | redirect 模式修复已被 staging-access-jwks-public-fetch 取代（redirect 修复后仍需 compat flag 才能生效）；5/8 完成 | `staff-auth` JWKS 取回 | 归档（superseded by staging-access-jwks-public-fetch） |
| staging-isolated-readiness-bootstrap | completed | D-041/D-049 全部落地；12/12 完成 | `operational-readiness`、`staging-bootstrap`、`scripts/bootstrap-staging-first-owner*` | 归档；bootstrap 工具在阶段 3/4 按新 baseline schema 重建 |

`openspec/specs/` 中绑定已删能力（MCP、机器获客、关键词图片、Rakuten/TikTok 预备）的 spec 随对应删除阶段同步归档；`verify:openspec:strict` 必须在每个删除/重建阶段结束时保持通过。

## 6. 风险与执行门槛

1. D-054 门槛 1：旧 verifier 按 §7 映射迁移并等价通过后才能删除（未通过前旧脚本保留在树中，即使其断言对象已被删除——此时应先修脚本或先迁移）。
2. D-054 门槛 2：OpenSpec 分类已完成（§5）；`backend-clean-baseline-rebuild` Change 的建立还须等待业务所有者对本修订版清单的确认。
3. 新 baseline 必须通过 20,000 真实历史订单的无损导入形状验证（字段级映射、行数守恒、抽样核对）后才能视为完成。
4. 重建期间 `verify:api-contract` 基线会随路由删除失效，须与新路由清单同步重生成，不得保留旧端点计数。
5. 旧迁移链删除后，`docs/CURRENT_SYSTEM_STATE.md` 的 schema 叙述需重写。
6. `github-independent-production-health-monitor` 依赖 `/ready` 合同；阶段 8 需同步核对。

## 7. 旧 verifier → 新测试映射表（D-054 门槛 1 的执行依据）

"等价通过"标准：新测试/新 verifier 真实执行通过，且覆盖旧脚本保护且仍然有效的业务断言；断言因能力删除而失效的，标注"随能力废弃"并在删除阶段留一次性核验记录。旧脚本删除发生在其映射行全部达成之后。

| 旧脚本（npm 名） | 保护的业务断言 | 新归属 | 删除条件 |
|---|---|---|---|
| `verify:module1:buyer`（verify-module1-buyer-security） | Buyer 完整业务回路的路由注册与安全组合（register/login/logout/session/change-password、buyer-portal 全家、read-intent 入口） | 新 `verify:buyer-portal-contract`（阶段 4 按新路由重生成）+ 既有 route-registration vitest | 新路由清单 verifier 通过 |
| `verify:module1:buyer`（verify-module1-migration-0028） | 0001–0028 迁移保真：0028 对象计数、`amazon_order_date` 日期合法 guard 触发器 | 断言转入新 baseline schema 测试（日期 guard 进 baseline）；迁移序号断言随旧链废弃 | baseline schema 测试覆盖 `amazon_order_date` guard |
| `verify:phase3i` | review_url 元数据：0022 列、URL 校验 guard 触发器、files ≤3、dedup key | 评论合同 + D1 集成测试（`reviews` 模块） | 新评论测试通过 |
| `verify:phase3j` | `seller_payables` 不可变（no-update/no-delete 触发器、双重唯一约束、事件唯一） | 新 baseline 财务不可变套件（schema 约束测试） | 财务不可变套件通过 |
| `verify:phase3k` | payments/allocations/reversals 触发器与余额视图 | 同上（结算模块 D1 测试） | 同上 |
| `verify:seller-finance-security` | 结算路由权限组合 + 凭证文件 audience 授权链 | 权限 + 文件 audience 集成测试（保留断言） | 新集成测试通过 |
| `verify:wave11-dto-isolation` | Seller DTO 不泄漏 `buyer_refund`、`profit`、`object_key`、staff id 等禁字段 | 新 `verify:dto-isolation`（禁字段清单迁入并扩展） | 新 DTO 套件通过 |
| `verify:phase3l` | 内部财务读模型表与利润公式字段（projected/completed/attributed_cash/overpaid/unallocated） | 内部财务 D1 测试 + 公式 vitest | 新内部财务测试通过 |
| `verify:phase3m` | 导出事件不可变 + CSV 防注入（`=+-@\t\r` 前缀转义）+ 50k 行 / 25MB 上限 | 导出安全测试（断言原样保留） | 新导出测试通过 |
| `verify:wave12:formulas` | 财务公式 vitest 编排（partial/reversal/overpayment/integer-boundary） | 直接由 vitest 测试承载，脚本退役 | 对应 vitest 在新 baseline 通过 |
| `verify:wave12:security` | FINANCIAL_VIEW/EXPORT owner-only、精确参数化查询、Cache-Control、CSV 注入正则 | 新 `verify:finance-security` | 新 verifier 通过 |
| `verify:wave12:dto` | 财务订单详情使用隔离投影、禁字段清单 | 并入 `verify:dto-isolation` | 同 wave11-dto 行 |
| `verify:wave12:migrations` | 0025–0028 迁移保真（staff_sessions、internal finance 表） | 断言转入 baseline schema 测试；序号断言随旧链废弃 | baseline schema 测试通过 |
| `check:wave13:migration` | 0001–0028 保留 + 0027 staff_sessions 存在 | 同上 | 同上 |
| `check:wave13:staff-auth` | Staff auth 注册先于 Staff 中间件、全部 staff 路由注册、不信任 `X-Staff-Id`/`X-Feishu-Open-Id` 头 | 新 `verify:staff-auth-composition`（保留 header 不信任断言；飞书 token 断言随能力废弃） | 新 verifier 通过 |
| `check:wave13:dto`（secret-dto） | 公共合同与 HTTP 响应不含 `token_hash`、`app_secret`、`object_key`、`permanent_url`、`signed_url` 等 | 新 `verify:secret-dto-hygiene`（清单迁入） | 新 verifier 通过 |
| `check:wave13:file` | FilePurpose→上传路由映射、`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 卖家聊天上传、audience 校验 | 文件架构测试（卖家聊天纳入归档后保留并加强） | 新文件架构测试通过 |
| `check:wave13:price-mismatch` | `PRICE_MISMATCH` 错误目录 + 审核确认合同（acknowledged/reason 进请求哈希） | 订单证据审核测试 | 新测试通过 |
| `check:wave13:buyer-refund` | BUYER_REFUND_VIEW/RECORD 与 SELLER_SETTLEMENT 权限分离；payment/reversal append-only、禁 UPDATE | 权限套件 + 财务不可变套件 | 两套件通过 |
| `verify:api-contract` | 运行时路由与 `V2_API_ROUTE_INVENTORY.md` 一致 + 变更检测 | 机制保留；阶段 4 后按新路由清单重生成基线 | 新基线生成并通过 |
| `verify:web-source-boundaries` | 前端源边界（禁 legacy api 别名、cookie 访问、unsafe HTML、raw error 等） | 前端域保留不动；阶段 4 改 API 形状时同步 | 前端阶段处理 |
| `verify:admin-dashboard` | M14/M16 迁移所有权 + schema 版本链 | 旧链断言废弃；新 `verify:admin-dashboard-simplified` 按 §3.2 范围重建 | 新 verifier 通过 |
| `verify:product-reservation-scheduling` | 0037 排期列、排期版本不可变触发器、`+8h` 业务日窗口 | baseline schema 测试（排期约束） | 新 schema 测试通过 |
| `verify:marketplace-money` | 0029 registry/currency 种子、COUPANG_KR fail-closed 禁用态 | 新 `verify:marketplace-registry`（registry 保留，断言保留） | 新 verifier 通过 |
| `verify:marketplace-adapters` / `preflight:marketplace-adapters` | Rakuten/TikTok adapter 预备结构 | 随能力删除废弃（§2.5 业务所有者已确认） | 删除阶段一次性核验后废弃 |
| `verify:seller-agreement-rate-retirement` | 旧 Seller Agreement Rate 字段/开关全灭 | 重建后主题消失；并入"无旧汇率投影"一次性检查后废弃 | baseline 建成后核验 |
| `verify:customer-security` | 0030 多身份表、邀请/重置事件不可变、无明文安全列、密码哈希路径 | 客户安全 D1 测试（断言保留） | 新客户安全测试通过 |
| `db:verify` / `verify:migration-guards` | 迁移链连续、fresh/sequential/wrong-order/repeat/dirty-stock 回滚 | 阶段 3 同步重建（D-054 已要求） | 新链 verifier 通过 |
| `verify:staff-mcp` / `dry-run:staff-mcp` / `preflight:staff-mcp-production` / `test:staff-mcp` | Staff MCP 安全/传输/生产预检 | 随 MCP 删除废弃（§2.2） | 删除阶段一次性核验后废弃 |
| `dry-run:staff-acquisition` | acquisition 维护任务 dry-run | 随机器维护删除废弃 | 同上 |
| `preflight:drive-archive` | 单文件 Drive 归档生产预检 | 按 D-055 Bundle 模型重建（阶段 5） | 新预检通过 |
| `preflight:cloudflare-release` / `verify:cloudflare-release` / `release:check` / `verify:final-production-go:local` / `verify-production-readiness-formal` / `probe-production-readiness` / `verify:web-static-build` / `verify:dependency-lifecycle` | 发布配置、生产就绪、静态构建、依赖生命周期（部署配置域，非业务断言） | 保留；在新 release 模板与 `/ready` 合同上适配（阶段 8） | 适配后通过 |
