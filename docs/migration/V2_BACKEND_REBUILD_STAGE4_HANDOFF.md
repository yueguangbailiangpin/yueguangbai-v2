# 后端重建阶段 4 交接（合同、API、路由与权限边界）

日期：2026-08-26。分支 `feature/staging-workflow-rate-ux`，基线 = 阶段 3 交接的 `b3dfbd70` + 阶段 4 本地提交（未 push）。依据：D-054/D-055、`docs/migration/V2_BACKEND_REBUILD_INVENTORY.md`（§1/§3/§7）、OpenSpec `backend-clean-baseline-rebuild`。

## 1. 删除的旧合同与旧路由

### 数据库（migration 0020–0023，schema 19 → 23）

- **`0020`–`0022` marketplace canonical 统一**（legacy JP 别名层原子移除，由生成器从 0019 最终态机械导出；因超出 D1 本地单迁移文件大小限制拆为三个顺序文件 0020 表重建 / 0021 表触发器重建 / 0022 外部触发器与视图重建，同一变更集内顺序应用，运行时不观察中间态）：
  - DROP `marketplaces`（旧 JP 独立表）与 `marketplace_legacy_aliases`；
  - 21 张 FK 指向旧 `marketplaces` 的表全部重建为 FK `marketplace_registry`，存储值 'JP' 同事务改写为 'AMAZON_JP'（受影响：buyer_customers、seller_organizations、seller_stores、products、product_applications、demand_batches、product_reservations、order_instructions、order_evidence_submissions/versions/duplicate_signals、formal_orders、formal_order_number_claims/conflicts、order_instruction_expiry_scan_cursors、staff_assignment_cursors/fallbacks、staff_work_items、acquisition_channels/leads、marketplace_runtime_config）；
  - `formal_orders` 的 JP 短码列删除，`canonical_marketplace_code` 列改名为 `marketplace_code`（单 canonical 列，CHECK 三码、FK registry）；
  - `marketplace_runtime_config` 删除 `legacy_order_code` 列；
  - 五码枚举（RAKUTEN_JP/TIKTOK_JP 预备残留）在 formal_orders / staff_work_items / acquisition_channels / acquisition_leads 收敛为三码；
  - `trg_seller_staff_assignments_staff_guard` 去 LEFT JOIN 别名表；`trg_seller_customer_group_after_org` 去 JP→AMAZON_JP CASE；`formal_order_effective_dates` 视图去 Rakuten/TikTok 死分支；
  - 39 个引用被重建表的外部触发器/视图先 DROP 后原样重建（RENAME 全 schema 重解析约束）。
- **`0023_retire_acquisition_machine_fields`**：DROP `acquisition_reporting_config`（机器归因配置）；`acquisition_prospects` 删 `ai_score`/`origin_mode` 列；`acquisition_leads`、`acquisition_customer_attributions` 删 `origin_mode` 列；首触归因触发器与 prospect 队列索引同步改写。
- 当前 schema inventory：189 表 / 552 索引 / 366 触发器 / 12 视图；`db:verify` 与 `verify:migration-guards`（wrong-order 22 拒绝、repeat 23 拒绝、失败快照不变、FK/integrity）全绿。

### 合同（packages/contracts + packages/domain）

- `MARKETPLACE_CODES` / `CanonicalMarketplaceCode` / runtime 定义 / 显示名收敛为三码；删除 `LEGACY_MARKETPLACE_CODES`、`LegacyMarketplaceCode`（`MarketplaceCode` = canonical 三码）、`legacy_order_code` 字段、`legacyOrderMarketplaceCode()`、domain `canonicalMarketplaceCode()` 的 JP/US/KR 短码分支；`MARKETPLACE_PLATFORMS` 删 RAKUTEN/TIKTOK。
- `SellerFormalOrderPortalDto` 删除 `legacy_projection` 判别与 RAKUTEN/TIKTOK 'NONE' 变体，收敛为单一 AMAZON_JP 形态（非 AMAZON_JP fail-closed 503）。
- acquisition 合同删除 `AcquisitionOriginMode`、`ai_score`、`AcquisitionHandoffDto`、funnel 相关常量。
- 看板合同重写为简化 `AdminBusinessDashboardSummaryDto`（见 §4）。
- 新增 `ARCHIVE_BUNDLE_STATES` / `ARCHIVE_BUNDLE_TRANSITIONS`（见 §7）。

### 路由（253 → 246 端点）

删除 7 个退役端点（`app.routes` 与清单同步）：

- `GET /api/staff/acquisition/funnel`（机器漏斗）
- `GET /api/staff/acquisition/handoffs`（机器交接队列）
- `GET/POST /api/staff/acquisition/reporting-config[/activate]`（机器归因配置）
- `GET /api/staff/admin-business-dashboard/trends`、`drill-down`（复杂趋势/drill-down）
- `GET /api/staff/admin-business-dashboard/acquisition-daily`（machine daily 聚合）

删除行为已由测试固化：staff 前缀下未认证请求先得 401（鉴权门不泄漏路由存在性），认证后 404；非 staff 退役路径与 `/api/v2/*` 直接 concealed 404（`stage4-contract-regression.test.ts`）。

### 旧 verifier（21 个脚本 + npm 条目，§7.3 核销）

`verify-module1-*`（×2）、`verify-phase3i/j/k/l/m`、`verify-seller-finance-security`、`verify-wave11-dto-isolation`、`verify-wave12-{migrations,formulas,security,dto}`、`verify-wave13-{migration,staff-auth-routes,secret-dto}`、`verify-customer-multipersona-security`、`verify-multi-marketplace-multicurrency`、`verify-admin-business-dashboard`、`verify-product-reservation-order-scheduling`、`verify-seller-agreement-rate-retirement`（最后一次执行 0 残留后废弃）。`verify:api-contract` 脚本重写：不再 `git diff origin/main`，改为清单自洽（计数/重复/退役族缺席）+ vitest 真实 `app.routes` 双向相等——本地领先远程 10+ 提交时既不漏报也不需要 push。

## 2. 保留的核心业务 API

清单 §1 全部保留能力未削弱：买家/卖家门户全回路、订单证据→正式订单、评论工作流、买家返款（含催办/Advance）、卖家结算（冲正/分配/凭证）、汇率中心、服务费与本金加点版本、内部财务与导出、文件子系统（意图/租约/补偿/audience）、聊天截图、Staff 待办与全局搜索、人工获客面、customer-onboarding/安全、运营完整性、staging bootstrap。所有正式订单与财务写路径的 Idempotency-Key、request hash、expected_version、状态机、事务内最终断言、Audit、Outbox、append-only 边界原样保留（本阶段全量回归通过即证据；`AGENTS.md` §8 约束未动）。

## 3. canonical write endpoint 清单（每个业务写动作唯一入口）

正式订单与财务写路径（全部保留幂等键/请求哈希/版本/状态机/审计/Outbox）：

- `POST /api/buyer-portal/order-evidence`（提交）→ `POST /api/staff/order-evidence/:id/approve`（确认生成正式订单，事务断言）→ `POST /api/staff/order-evidence/:id/request-changes`
- `POST /api/staff/buyer-refunds/:id/payments`（返款支付）+ `POST .../payments/:paymentEntryId/reversals`（冲正）
- `POST /api/staff/buyer-advance-principal/:formalOrderId/payments` + `.../reversals`
- `POST /api/staff/seller-settlements/:organizationId/payments` + `POST /api/staff/seller-payments/:paymentId/allocations` / `.../reallocate` / `.../reverse`
- `POST /api/staff/rate-center/base-rates/submit` / `.../:id/confirm`；`POST /api/staff/seller-principal-rate-policies/submit|confirm|reject`；`POST /api/staff/seller-service-fees/submit|confirm|reject`
- `POST /api/staff/finance/exports/csv`（FINANCIAL_EXPORT）
- 获客人工写：channels 创建/停用、privacy-profile、channel-assignments、consultations、prospects 创建/更新、leads 全生命周期、source-corrections（人工纠正，审计保留）

## 4. 权限与隐私边界（阶段 4 结论）

- 看板两个端点复用 `requireFinancialActor`（Active owner + `FINANCIAL_VIEW`，Personal DENY 最终优先）；非 owner/禁用者失败关闭（routes.test 断言）。
- 运行时 marketplace 合同三码：`AMAZON_JP` 唯一写路径；`AMAZON_US`/`COUPANG_KR` fail-closed（registry 状态 + `MARKETPLACE_NOT_SUPPORTED` 守卫保留）；'JP' 只允许出现在阶段 6 历史导入映射层（tools/imports 写库值已全部 canonical）。
- Buyer 只读自身资源、Seller 只读所属组织、concealed 404、DTO 隔离（禁字段清单由 `verify:dto-isolation` / `verify:secret-dto-hygiene` 承载）——阶段 4 未放松任何断言；seller formal-order 投影移除判别字段后仍不输出买家隐私/内部利润字段。
- 员工端旧功能（机器漏斗/drill-down/daily/precision 开关/handoff 队列/ai_score 列）按"最小适配"删除调用面，未做视觉重构。

## 5. 分页方案

- 增长列表统一 cursor + limit + next_cursor（seller/buyer 门户、order-evidence、buyer-refunds、reviews、leads/prospects、staff work-items、文件 read-intent batch 等）；drill-down 是唯一显式分页的看板端点，已随复杂分析一起删除——简化看板为纯聚合（COUNT/SUM），无列表分页需求。
- 禁止一次性读取全量历史订单/图片/客户的边界由既有 pagination 测试与 `verify-web-source-boundaries` 延续；20,000 历史订单导入的容量验证按计划在阶段 6 执行。

## 6. 看板简化结果（§3.2 范围）

- 保留端点：`GET /api/staff/admin-business-dashboard/summary?window=TODAY|WEEK|MONTH` 与 `GET .../financial-projection?from_date&to_date`。
- summary 合同：`cards`（新买家/新卖家客户、预约、正式订单）、`pending`（待处理买家返款、待处理卖家结算）、`overdue`（OPEN 工作项、财务异常）、`owner_summary`（projected/completed 利润，复用 `internal_order_finance_positions` 正式公式 + 审计过的人工调整，冲突单排除）。
- 全部指标为 D1 聚合查询（COUNT/SUM + 窗口参数绑定），无行加载、无漏斗 cohort、无 per-staff/per-channel 矩阵、无 N+1；窗口 Asia/Shanghai、周一为一周开始（time.ts 保留语义，bucket 生成器删除）。
- 前端 `FrozenAdminBusinessDashboard` 同步简化（数据面收缩，未做视觉重构）；渠道统计（channel-stats）保留人工咨询/Prospect/Lead 归因事实。

## 7. 历史订单导入兼容边界

- 字段级映射覆盖清单（`V2_BASELINE_HISTORICAL_ORDER_FIELD_MAPPING.md`，30/30 列）继续有效；0020 后所有 marketplace 存储列为 canonical 三码，导入工具写库值已全部改写为 `AMAZON_JP`（历史源文件中的 'JP' 由映射层转换）。
- external 源文件只读原则不变；20,000 单 dry-run 无损证据（字段映射、行数守恒、抽样核对）与容量验证（≥100,000 Manifest、吞吐 ≥1.5×）仍在阶段 6 执行。

## 8. 阶段 5 可依赖的归档状态合同

`packages/contracts/src/cold-image-archive.ts` 新增（合同-only，未实现运行时，未注册任何路由）：

- `ARCHIVE_BUNDLE_STATES = ONLINE | ARCHIVED | RESTORE_REQUESTED | RESTORING | RESTORED_TEMPORARILY | RESTORE_FAILED`
- `ARCHIVE_BUNDLE_TRANSITIONS`：ONLINE→ARCHIVED；ARCHIVED→RESTORE_REQUESTED；RESTORE_REQUESTED→RESTORING|ARCHIVED；RESTORING→RESTORED_TEMPORARILY|RESTORE_FAILED；RESTORED_TEMPORARILY→ARCHIVED（7 天临时副本到期）；RESTORE_FAILED→RESTORE_REQUESTED（可重试）。任何状态不得回到 ONLINE。
- 现存文件级状态机（`FILE_DRIVE_ARCHIVE_STATES`，R2_HOT→…→DRIVE_ARCHIVED）不变；stage4 回归测试断言当前 app.routes 无 restore 路由。

## 9. 验证命令与真实结果（2026-08-26，工作树 = 阶段 4 提交前状态）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test`（vitest run） | 252 文件 / 1664 用例全部通过（含新增 stage4-contract-regression 4 用例与看板重写套件） |
| `npm run build` | 通过 |
| `npm run check`（check:ci:static + check:ci:test-build，后者已重组为新 verifier 链） | exit 0（CI 治理 allowlist 与四份生产发布文档的链引用同步至 `0001`–`0023` + `0023_retire_acquisition_machine_fields.sql`） |
| `openspec validate --all --strict` | 全部通过 |
| `npm run db:verify` | PASS（fresh/sequential inventory SHA-256 一致 + 负向 DML；21 链，189/552/366/12） |
| `npm run verify:migration-guards` | PASS（wrong-order 22 拒绝、repeat 23 拒绝、失败快照不变） |
| `npm run verify:api-contract` | PASS（246 端点双向一致；无 origin/main 依赖） |
| 7 个新命名 verifier（buyer-portal-contract / dto-isolation / secret-dto-hygiene / finance-security / staff-auth-composition / marketplace-registry / admin-dashboard-simplified） | 全部 PASS |
| `npm run verify:seller-agreement-rate-retirement`（删除前最后一次执行） | PASS（0 残留） |
| `npm run db:migrate:local`（wrangler 本地 D1 全新重放 23 链） | 23/23 应用成功（0001–0023 全部 ✅；空库一次通过） |

## 10. 未解决风险

1. **本地 D1 重放前提**：0020 的表重建在"被重建表被子表引用且子表有行"时会因 FK 检查失败。当前所有环境（fresh :memory:、testkit、重放后的本地 wrangler D1）均为空业务表，验证通过；若未来有人在含业务数据的库上重放 0020 之前的链再跳至 0020，需先清业务数据。生产导入前该窗口不存在（生产库将从 0001 全新初始化）。
2. **AMAZON_US 投影未开放**：seller formal-order 投影对非 AMAZON_JP fail-closed（503）；AMAZON_US 开店前如需卖家侧只读投影，需显式开放合同。
3. **前端占位**：看板与获客的机器面数据删除后，员工端对应区块为简化版而非视觉重构；阶段 7 处理布局与信息层级。
4. **`github-independent-production-health-monitor` 依赖 `/ready`**：阶段 8 需核对（本轮未改 `/ready` 语义）。
5. **`docs/decisions/V2_DECISION_REGISTER.md`** 的 marketplace 相关历史叙述（如"买家侧 DTO 仍以 JP 短码为现行合同"）已被阶段 4 事实取代，Register 历史正文按惯例不改写，以本交接与 CURRENT_SYSTEM_STATE 为准。

## 11. 远程操作声明

本阶段未执行任何远程操作：无 push、无 PR/Issue 修改、无 Cloudflare（D1/R2/Worker/Queue/部署/staging）操作、无 Google Drive 与飞书操作、无真实历史数据导入。全部验证基于本地 checkout。

## 12. 下一阶段

阶段 5（冷归档、异步恢复与容量验证）：按 D-055 实现 §8 状态合同的运行时（ZIP+manifest 流式 bundle、临时 R2、resumable upload、回读校验、条件删除、Queues 本地模板、Staff-only 恢复、7 天清理、shadow-copy 首扫）；只写代码/本地模板/测试，不创建真实 Queue、不做远程操作。等待下一条指令后再执行。
