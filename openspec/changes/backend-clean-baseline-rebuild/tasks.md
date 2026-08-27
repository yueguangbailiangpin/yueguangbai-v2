# Tasks: backend-clean-baseline-rebuild

## Stage 2 — 删除与 OpenSpec 处置

- [x] 2.1 归档 4 个 completed 变更（reservation-review-order-evidence-readiness、schema64-integration-stabilization、seller-principal-rate-policy、staging-isolated-readiness-bootstrap）
- [x] 2.2 归档 2 个 superseded 变更（google-drive-cold-archive-production-preflight、staging-access-jwks-worker-runtime）
- [x] 2.3 删除自动获客 Agent/machine：3 条 acquisition-machine 路由、3 条 staff machines 路由、machine 运行时、相关测试/脚本/seed 引用（`maintenance.ts` 与其表是 D-026 保留能力，不删）
- [x] 2.4 删除 `acquisition_prospect_signals` 与机器时代指标运行实现（保留人工来源/首触归因事实）
- [x] 2.5 删除 Staff MCP：`apps/api/src/staff-mcp`、`packages/contracts/src/staff-mcp.ts`、0038 表的运行引用、npm 脚本与文档
- [x] 2.6 删除关键词图片：generator service/worker、resvg-wasm、资产路由与 reconciliation 引用
- [x] 2.7 删除旧别名与兼容层：`marketplace_legacy_aliases` 运行引用、旧 Seller Agreement 投影残留、无用途 Feature Flag
- [x] 2.8 删除 Rakuten/TikTok `platform_*` 运行实现与 `marketplace-adapters` 预备（保留 Registry/AMAZON_JP/禁用边界）
- [x] 2.9 每删除类别后 typecheck + 受影响测试通过；被删能力 verifier 按 §7 留核验记录
- [x] 2.10 阶段出口：typecheck/test/build/check + openspec strict 全绿（2026-08-25 复测：npm run check exit 0，270 文件/1772 用例）

## Stage 3 — 数据库 baseline

- [x] 3.1 新建 `0001`–`0019` baseline（19 个按域顺序文件），包含全部保留能力表、整数金额/汇率、source guard、审计/幂等/版本约束（对象级零差异验证：824 保留对象与旧链最终态一致；platform_* 六表按统一模型改造移除）
- [x] 3.2 删除旧迁移链 0001–0075 与历史不可变哈希（`phase3*_backup_*`/`*_next` 脚手架在旧链后续迁移中本已清理，最终态无残留）
- [x] 3.3 重写本地 seed 与匿名测试数据；空库一次初始化成功测试（迁移内种子随 baseline 重建并剪枝 RAKUTEN/TIKTOK 行；testkit 匿名夹具兼容；本地 wrangler D1 重放 19/19）
- [x] 3.4 重建 verify-migrations / verify-migration-version-guards（fresh/sequential/wrong-order 18 拒绝/repeat 19 拒绝/失败快照不变 + FK/integrity；TARGET_SCHEMA 三常量对齐 19）
- [x] 3.5 schema 形状承载 20,000 历史订单导入的字段覆盖清单（docs/migration/V2_BASELINE_HISTORICAL_ORDER_FIELD_MAPPING.md，30/30 列有归宿）

## Stage 4 — Contracts 与 API

- [x] 4.1 按 §1/§3 重建 contracts（删除兼容 DTO）——migration 0020–0023 原子移除 legacy JP 别名层与获客机器字段；MARKETPLACE_CODES 收敛三码；legacy_projection/AcquisitionOriginMode/ai_score/Handoff DTO 删除
- [x] 4.2 重建路由并以真实 `app.routes` 重生成 `V2_API_ROUTE_INVENTORY.md`——246 端点（244 /api/* + /health + /ready）；verify:api-contract 去 origin/main 依赖
- [x] 4.3 看板简化为清单 §3.2 范围；删除 funnel/drill-down/trends 机器维度——summary + financial-projection 双端点，纯 D1 聚合
- [x] 4.4 幂等/expected_version/请求哈希/状态机/审计/Outbox 全路径回归——1664 用例全过；新增 stage4-contract-regression（三码/fail-closed/退役路由 404/归档状态合同）

## Stage 5 — 冷归档、Queue 与恢复

- [x] 5.1 归档单元与状态机（ORDER 含卖家聊天、BUYER_REFUND_PAYMENT、SELLER_SETTLEMENT_PAYMENT；资格为关闭最晚事实 + 6 个 UTC 日历月——本轮所有者指令措辞，见 STAGE5 交接 §0）
- [x] 5.2 ZIP + manifest 流式 bundle → 临时 R2 → resumable upload（fake Drive）→ 回读校验 → 条件删除（migration 0024 + 流式 writer/增量哈希 + DriveArchiveClient 端口）
- [x] 5.3 Queues 本地模板（batch 1–5、DLQ 模板、逐消息 ack/retry、指数退避、Drive 并发 3 可配置；D1 租约幂等）
- [x] 5.4 Staff-only 恢复 + 占位提示（FILE_ARCHIVED 410 全受众）+ 原 audience 授权 + 7 天清理；首次 shadow-copy 默认
- [x] 5.5 容量指标与 100k Manifest 容量测试（verify:archive-capacity：20k 单/100k 文件，13.8s，无重复、无 O(N²)）

## Stage 6 — 历史导入与容量

- [x] 6.1 导入工具重建：字段级映射、行数守恒、抽样核对
- [x] 6.2 20,000 单 dry-run 无损证据
- [x] 6.3 每日 200 单/1,000 图合成负载与吞吐 ≥1.5 倍验证（verify:historical-import-capacity：20,000 单/100,000 文件计划全链 15.8s，单日 200 单增量仅为该吞吐的 ~0.06%，远超 1.5 倍要求；synthetic，REAL_HISTORICAL_IMPORT=NOT_RUN）

## Stage 6.5 — 收口（Drive 适配器、图片盘点、身份边界、时间统一、多行订单）

- [x] 6.5.1 真实 Google Drive HTTP 适配器代码（resumable 协议、OAuth refresh provider、429/5xx 退避、401/403 fail-closed、错误脱敏、无分享/删除调用；runtime 从 GOOGLE_DRIVE_* 构造接入，默认关闭零 HTTP——单测 12 + 集成 3 全走本地假 server；REAL_DRIVE_REQUESTS=0）
- [x] 6.5.2 历史图片盘点 CLI（inspect-images/inventory-images/resume-image-inventory/reconcile-images；源目录只读、流式 SHA-256、MIME 嗅探、checkpoint/resume、重复/缺失/orphan/未识别/findings、LINKED/ORPHAN/QUARANTINE 映射、输出仅入显式输出目录；migration 0026 三表；100,000 文件容量验证；REAL_IMAGE_INVENTORY=NOT_RUN）
- [x] 6.5.3 未匹配身份显式 unresolved 边界（IDENTITY_UNMATCHED durable quarantine、override 表补 import_batch_id 审计列、门户零可见测试：无路由/无视图/无 FK 链接 formal_orders）
- [x] 6.5.4 归档时间统一为 6 个 UTC 日历月 + 月底截断（archiveDueAt==bundleEligibilityAt；1/31、2/29、8/31、UTC 跨日测试；容量验证 183 天近似移除）
- [x] 6.5.5 多商品多行订单合同（HISTORICAL_LINE_DEFINING_COLUMNS；MULTI_LINE_ORDER_REQUIRES_MAPPING critical——保留全部原始行、can_apply=false、绝不取首行/求和；非行定义差异仍 CONFLICTING_DUPLICATE_GROUP；0026 CHECK 扩展）

## Stage 6.6 — 业务模型去重、权限收敛与后端最终验收（D-056）

- [x] 6.6.1 Decision Register D-056 + OpenSpec Stage 6.6 合同与 spec 增量（岗位四角色、沟通/付款截图、买家编号、卖家可见范围、Marketplace/汇率/服务费/财务快照单一来源、看板与订单详情收敛、获客/Outbox 退役、历史导入隔离、预约永久限制）
- [x] 6.6.2 Migration 0027（schema 26→27）：Marketplace runtime_config 退役并入 Registry、买家编号建档即分配（preorder 表退役、B/C 渠道 seed、first_valid_order_business_date 退役）、汇率/服务费/加点单一版本表（审批状态与镜像触发器退役）、财务快照合并为单一不可变表及依赖视图重建
- [x] 6.6.3 Migration 0028（schema 27→28）：固定分配简化（round-robin cursor/fallback/availability/reassignment/部门团队组长/角色合并映射退役、买家两职责、acquisition 角色退役）、卖家组织全量可见（store grants/scopes/events 退役）、产品主要对接人、预约永久限制一次性例外表、订单沟通截图数据关联与付款截图每版本唯一约束
- [x] 6.6.4 Migration 0029（schema 28→29）：获客 CRM 表退役（保留 buyer_channels）、Integration Outbox 与 dead-letter 表退役
- [x] 6.6.5 员工统一正式订单详情聚合入口 + 退役重复详情/lookup 路由；订单沟通截图/付款截图合同与路由重建；被删路由真实 404 测试
- [x] 6.6.6 获客 CRM、Integration Outbox、旧注册死代码、financial-projection 重复读模型的源码/合同/脚本/定时任务/前端删除；历史导入中间表源码边界验证（门户零读取）
- [x] 6.6.7 验证矩阵：typecheck/test/build/check、openspec strict、db:verify、migration-guards、api-contract（新基线）、archive/historical-import capacity、fresh D1 replay 0001→终版 + integrity/foreign_key、安全源码扫描、B/C 编号并发/重放/历史最大号续排、预约永久限制与例外、卖家组织内可见与跨组织 404、多张沟通截图与一张付款截图约束
- [x] 6.6.8 OpenSpec Stage 7（权限/DTO 隔离/幂等/财务不可变/文件 audience/归档回归/Queue DLQ/R2 补偿/历史表零可见/容量）与 Stage 8（真实执行验证与交接文档）完成并勾选

## Stage 7 — 安全与隐私测试

- [x] 7.1 权限/Personal DENY/scope/concealed 404 全套
- [x] 7.2 幂等重放、payload mismatch、expected_version 冲突、财务不可变
- [x] 7.3 Buyer/Seller DTO 隔离、R2 失败补偿、Drive 校验失败、Queue 重复投递/DLQ
- [x] 7.4 归档/恢复/7 天清理/卖家聊天归档回归

## Stage 8 — 验证与交付

- [x] 8.1 npm run typecheck / test / build / check + openspec strict 真实执行
- [x] 8.2 旧 verifier 按 §7 映射逐行核销（迁移或废弃）
- [x] 8.3 中文交接报告 + AGENTS.md 报告格式
