# 后端重建阶段 6.6 交接（D-056 业务模型去重、权限收敛与最终验收）

日期：2026-08-27。分支 `feature/staging-workflow-rate-ux`，本阶段三个本地提交（未 push）：`6c9d554f`（6.6B）、`7f4b1b36`（6.6C）、6.6D 收尾提交（见 git log）。依据：Decision Register **D-056**（2026-08-26）、OpenSpec `backend-clean-baseline-rebuild` Stage 6.6 任务组、`V2_BACKEND_REBUILD_STAGE6_6_RESUME_INSTRUCTION.md`。

## 0. 范围与非目标

完成 6.6A（上一任务，f7db5b48）、6.6B、6.6C、6.6D（Stage 7 安全验收 + Stage 8 全量验证）与本文档。**未进入**：阶段 7A-2 前端重构、任何远程操作、真实数据导入、真实 Google Drive / 图片盘点。

## 1. 迁移内容（0001–0029，schema_version=29）

- **0027（6.6A）**：Marketplace Registry 单一来源（runtime_config 退役）、买家编号建档即分配（preorder 表退役、B/C 渠道 seed）、汇率/加点/服务费单版本即时生效（双审批退役）、财务快照合并为单一不可变表。
- **0028（6.6B，schema 27→28）**：
  - 四角色固定分配：`staff_role_assignments`/`staff_marketplace_scopes`/`staff_permission_overrides`/`staff_assignment_role_permission_defaults` 收敛为四角色（`acquisition` 仅允许出现在 REVOKED 历史行）；轮转/兜底/排班/重分配/部门/团队/组长/角色合并映射 11 张表退役；`buyer_staff_assignments` 只剩 `BUYER_PRE_SALES_OWNER`+`BUYER_REFUND_OWNER`（旧 `BUYER_AFTER_SALES_OWNER` 数据并入）；`staff_work_items` 固定到三种 duty。
  - 卖家组织全量可见：`seller_member_portal_store_grants`、`seller_member_store_scopes`、`seller_member_store_scope_events` 三表退役。
  - 产品主要对接人：`products.primary_contact_member_id` 列 + 活跃成员 guard 触发器 + `seller_product_primary_contact_events` 事件表（append-only）。
  - 预约永久限制：`reservation_participation_exceptions` 一次性例外表（用后不可改删）。
  - 订单沟通截图统一：`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` purpose 全链改名为 `ORDER_COMMUNICATION_SCREENSHOT`（file_upload_intents/file_objects/file_entity_links/archive_bundle_files/historical_order_files/historical_image_inventory_files 五表行值改名）；`file_entity_audience_grants` 重建去掉指向已删 `staff_teams` 的 FK（列保留恒 NULL 兼容）。
  - 付款截图单一化：`order_evidence_versions.evidence_file_object_id` 列删除；`order_evidence_version_files` 加 `UNIQUE(version_id)`；`order_evidence_internal_files` 表删除；恢复 `trg_archive_bundle_files_no_delete/update_guard` 与 historical 三表安全触发器（重建时曾丢失）。
- **0029（6.6C，schema 28→29）**：获客 CRM 18 张 `acquisition_*` 表退役（`buyer_channels` 保留，是业务配置不是 CRM 表）；`integration_outbox`、`scheduled_dead_letters` 退役；`scheduled_job_states` CHECK 去掉 `outbox_delivery`；`customer_buyer_invitation_lead_links`/`customer_seller_invitations` 重建去 acquisition FK/列。

当前 inventory：157 表 / 480 索引 / 305 触发器 / 12 视图（`db:verify` SHA-256 锚定 `9bd3220e…`）。

## 2. 源码退役清单

- **获客 CRM（后端）**：`apps/api/src/acquisition/` 整目录（微信身份加密函数先迁到 `customer-onboarding/wechat-identity-crypto.ts`，HMAC/AES 派生不变、旧密文可读）、`packages/contracts/src/acquisition.ts`、`index.ts` 4 处路由注册、`customer-onboarding/lead-guard.ts`、`buyer-registration-route.ts` 的 lead 门（改为直接发邀请）、`historical-seller-directory.ts` 改读正式表、`seller-registration` 弃 lead 路径、`worker.ts` 的 acquisition maintenance、`operational-readiness` 的 `acquisition_maintenance` 检查项、wrangler 模板与环境变量（`ACQUISITION_MAINTENANCE_ENABLED`）。
- **获客 CRM（前端）**：`apps/web/src/staff/acquisition/` 整目录（`CustomerIntakeWorkspace` 迁至 `staff/` 并去掉获客 API 依赖）、`StaffAcquisitionRouteModule`、导航获客项、`acquisition` 角色枚举、`staffApi` 12 个获客方法、query keys、MSW demo handlers。`/staff/buyer-customers`、`/staff/seller-customers` 两页保留可用。
- **Integration Outbox**：`foundation/outbox.ts`+测试、`staff-assignment/outbox.ts`、runner 的 `outbox_delivery` 分支、dead-letter replay 命令与路由、`OUTBOX_DELIVERY_*` 环境变量与模板、contracts 的 dead-letter DTO/解析器、约 61 个业务命令文件的双写调用点（业务事实仍在同一 D1 batch；幂等/审计/transaction_assertions/`audit_events`/冷归档 `archive_jobs` 与 Queue 全部保留）。
- **旧注册死代码**：`buyer-self-registration/register-buyer.ts`。
- **看板重复**：`admin-business-dashboard/financial-projection.ts` 读模型与端点；工作台只读精简摘要，财务进 internal-finance。
- **订单详情收敛**：新增唯一聚合端点 `GET /api/staff/formal-orders/:id`（+ `GET /api/staff/formal-orders?amazon_order_number=` 查单模式），按权限返回基础信息/买家卖家/付款截图/沟通截图/运营事件/（Owner+FINANCIAL_VIEW）人工财务调整与快照事实；退役 order-integrity 详情 GET、operating-integrity order-lookup、buyer-advance-principal-lookup 别名（事件/调整的 POST 路由保留在原处）。
- **历史表边界**：新增 `architecture-guards/historical-import-boundary.test.ts`——`apps/api/src`（guard 自身除外）不得引用 13 张导入中间/`historical_*` 表；customer-onboarding 四处运行时读取改正式表或删除；`tools/imports/historical-seller-customers/staging-sql.ts` 的 exemptions 写入删除。

## 3. 新增路由与合同

- `POST /api/staff/access-management/buyer-assignments` + `GET`（列表）：设置/转移买家返款负责人（owner-only、reason 必填、幂等、expected_assignment_version、审计+outbox 事件行）。
- `POST /api/staff/products/:id/primary-contact`：产品主要对接人（owner/seller_ops + SELLER_MANGE + 组织 scope；expected_version、幂等、reason 必填、事件表+审计；设为已在位成员=语义重放）。
- `POST /api/staff/reservations/participation-exceptions`：一次性人工例外（owner/pre_sales + RESERVATION_DECIDE；幂等、reason 必填、valid_until）。
- 订单沟通截图五条路由：staff intents/attach/list + seller list/read-intent（`ORDER_COMMUNICATION_SCREENSHOT_HTTP_PATHS`）。
- `GET /api/staff/formal-orders/:id`、`GET /api/staff/formal-orders`（详见 §2）。

**API 端点基线：219**（217 `/api/*` + `/health` + `/ready`），`V2_API_ROUTE_INVENTORY.md` 已按运行时 `app.routes` 重生成。

## 4. 新错误码

- `RESERVATION_HISTORY_PARTICIPATION`（409，稳定）：同卖家组织历史参加（APPROVED 预约或正式订单）被永久限制，提示联系售前；一次性例外绑定具体需求批次、用后即失效。
- `BUYER_PRE_SALES_OWNER_NOT_ASSIGNED` / `BUYER_REFUND_OWNER_NOT_ASSIGNED` / `SELLER_ACCOUNT_MANAGER_NOT_ASSIGNED`（503）：固定绑定缺失时 fail-closed 的稳定码（6.6B 引入）。
- `ORDER_COMMUNICATION_SCREENSHOT` 作为 purpose 值取代 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION`（导入器 TS 常量同步，历史 0025/0026 行值已由 0028 改名）。

## 5. 验证真实结果（2026-08-27，最终收尾提交前）

| 命令 | 退出码 |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | 0（257 文件 / 1,675 用例全过） |
| `npm run build` | 0 |
| `npm run check` | 0（含全部命名 verifier、容量验证、web 边界、静态构建） |
| `openspec validate --all --strict` | 0（63/63） |
| `npm run db:verify` | 0（157 表/480 索引/305 触发器/12 视图，SHA-256 一致 + 负向 DML） |
| `npm run verify:migration-guards` | 0（wrong-order 28 拒绝、repeat 29 拒绝、失败快照不变、FK/integrity） |
| `npm run verify:api-contract` | 0（219 documented endpoints 双向一致） |
| `npm run verify:archive-capacity` | 0 |
| `npm run verify:historical-import-capacity` | 0 |
| wrangler 本地 D1 空库重放 0001→0029 | 全部 ✅；schema_version=29，`PRAGMA integrity_check`=ok，`PRAGMA foreign_key_check` 0 行 |
| 安全源码扫描 | check 链内通过；被删路由真实 404 测试（dead-letters replay、acquisition 族）通过 |

Stage 7 专项全部由通过的测试覆盖：四角色权限矩阵与 Personal DENY（authorization-policy/staff-assignment/access-management 套件）、concealed 404（沟通截图跨组织、order-integrity、seller 三端）、幂等重放/payload mismatch/expected_version 冲突（idempotency+各命令套件）、财务快照不可变（formal-order-shared `makes formal orders, snapshots, and events immutable`）、Buyer/Seller DTO 隔离（dto-isolation verifier + portal 套件）、R2 失败补偿（r2-object-storage/wave13-r2-runtime）、Drive 校验失败不删热件（drive-http-integration）、Queue 重复投递（bundle-archive）、归档/恢复/7 天清理 + 订单沟通截图归档回归（bundle-archive 三档全过，沟通截图随 ORDER bundle 归档）、预约永久限制与例外用后失效/不可删（reservations）、B/C 编号并发/重放/历史最大号续排（customers）。

## 6. 角色与权限变化（最终合同）

- Staff canonical 角色严格四个：`owner`、`pre_sales`、`seller_ops`、`buyer_refund`（`acquisition` 只允许作为 REVOKED 历史行存在）。分配=固定绑定：买家分别绑定售前负责人与返款负责人、卖家组织绑定卖家运营负责人、owner 全局查看处理；缺绑定 fail-closed。
- 卖家组织全部有效成员可见全部店铺/产品/订单/沟通截图/服务费/汇率/结算金额与凭证；仅组织 OWNER 管理成员/邀请/停用/组织设置。
- 产品主要对接人只是责任标记，不限制任何成员查看。
- 预约：历史参加永久限制 + 一次性人工例外（owner/pre_sales + RESERVATION_DECIDE）。

## 7. 远程边界声明

零远程操作：无 git push/PR/Issue、无 Cloudflare（D1/R2/Worker/Queue/DLQ/部署）操作、无 Google Drive 请求、无真实凭据读写、无真实数据导入或图片上传、未触碰任何外部历史来源文件。全部验证基于本地 checkout、本地空库与本地 wrangler D1（`--persist-to /tmp`）。

## 8. 未解决风险

1. 真实历史导入仍未执行（材料清单见阶段 6 交接 §10）；CLI 全链就绪。
2. Drive 适配器代码就绪但从未对真实 Google Drive 运行（REAL_DRIVE_REQUESTS=0；激活属阶段 8 部署准备）。
3. 前端获客中心删除后的客户接入页（CustomerIntakeWorkspace）是功能降级的最小接线（静态渠道、买家列表占位），完整工作台体验等阶段 7A-2 重构。
4. `verify-production-readiness-formal.mjs` 是阶段 3 历史文件（期望 schema 19/0019 链），不在任何验证链中、仅被 final-go verifier 按内容断言引用——未更新其常量，属已知无害漂移。

## 9. 阶段 7A-2 可依赖的最终合同

- **Schema**：连续 `0001`–`0029`，`app_schema_state.schema_version=29`。
- **API**：219 端点（见 `V2_API_ROUTE_INVENTORY.md`）；新增路由见 §3；被删路由（获客族、financial-projection、order-integrity 详情 GET、order-lookup 别名、buyer-chat/seller-order-chat 两套截图、dead-letters replay）一律真实 404。
- **角色**：四角色 + 固定分配 + Personal DENY 最终优先。
- **文件 purpose**：`ORDER_COMMUNICATION_SCREENSHOT`（挂 ORDER，一单多张，SELLER_VISIBLE+组织 audience grant）；付款截图 `ORDER_EVIDENCE` 每版本恰好一张（UNIQUE 数据库级）。
- **冷归档**：ORDER bundle 收集付款+沟通+评论截图；六个月 UTC 日历月、恢复不扩大权限机制不变。
