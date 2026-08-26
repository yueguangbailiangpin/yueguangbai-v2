# 后端阶段 6.6 续作指令（从 6.6B 中断点继续，完成 6.6B/6.6C/6.6D）

> 本指令自包含。上一任务完成了 6.6A 并提交，6.6B 做到一半被中断。本任务从中断现场继续，完成 6.6B 剩余、6.6C、6.6D、交接文档与最终报告。

## 一、项目与基线（开始前必须核对）

项目目录：

`/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller`

分支：

`feature/staging-workflow-rate-ux`

开始前必须核对（**注意：本轮工作树不是干净的，这是预期状态，不要停止**）：

- HEAD：`f7db5b48`（stage 6.6A 提交）
- 本地领先远程跟踪引用 16 个提交，未 push
- 已提交迁移链：`0001`～`0027`（schema 27，API 242 endpoints）
- **工作树含 6.6B 进行中的未提交改动（上一任务中断现场，属于已授权工作，必须接着完成，不得 reset / checkout / stash 丢弃）**：
  - 新文件 `migrations/0028_stage66b_fixed_assignment_and_files.sql`（已通过 fresh 重放 + 逐文件事务化重放，schema 28，integrity/foreign_key 干净）
  - 新文件 `docs/migration/V2_BACKEND_REBUILD_STAGE6_6_RESUME_INSTRUCTION.md`（本指令自身，随 6.6B 提交一起入库）
  - 已改 19 个文件 + 已删 2 个文件（staff 固定分配改造，约完成 90%）：
    `apps/api/src/customers/create-buyer.ts`、`apps/api/src/staff-assignment/*`（assignment-service / candidate-resolver / errors / index / outbox / read-model / routes 修改；reconciliation-service + 其测试删除）、`apps/api/src/staff/authorization-policy.ts(+test)`、`apps/api/src/staff/access-management/read-model.ts`、`apps/api/src/staging-bootstrap/first-owner.ts(+test)`、`packages/contracts/src/staff.ts / staff-assignment.ts / staff-access-management.ts`、`packages/domain/src/staff-assignment/rules.ts(+test)`、`scripts/bootstrap-staging-first-owner.test.mjs`
- 当前 `apps/api` typecheck 剩余错误：`src/acquisition/authorization.ts`、`src/acquisition/channel-privacy.ts`、`src/customer-onboarding/buyer-invitation-guard.ts`、`src/customer-onboarding/buyer-registration-route.ts` 引用已删除的 `'acquisition'` 角色（这些文件多数在 6.6C 整体删除，但 6.6B 提交前必须先做**最小修复**使其编译通过：从角色判断中移除 `'acquisition'`），另 `access-management/read-model.ts` 有 2 个未用导入小错
- 后端阶段 1～6.5、6.6A 已完成；前端阶段 7A-1 已有本地提交，不得覆盖
- 未 push、未部署；当前项目没有生产数据库、生产用户和生产图片
- 约 20,000 条真实历史订单仍在外部来源中，尚未导入；真实历史来源文件、图片来源和导入能力必须保留，不得删除或修改

如果 HEAD 或分支不符，停止并报告。工作树**必须**恰好包含上述改动（`git status --porcelain` 应为 21 个 M/D 行 + 2 个 `??` 未跟踪行：`migrations/0028_...sql` 与本指令文件）；多出或缺少时停止并报告，不得自行补写或丢弃。

## 二、开工要求

开始前完整阅读：

- `AGENTS.md`
- `docs/decisions/V2_DECISION_REGISTER.md` 的 **D-056**（2026-08-26 追加，本轮全部裁决的权威来源）
- `docs/product/V2_PRODUCT_RULES.md`
- `docs/migration/V2_BACKEND_REBUILD_STAGE6_HANDOFF.md`
- `docs/migration/V2_BACKEND_REBUILD_STAGE6_5_HANDOFF.md`
- `docs/contracts/V2_PERMISSION_MATRIX.md`
- `docs/contracts/GOOGLE_DRIVE_COLD_IMAGE_ARCHIVE.md`
- `openspec/changes/backend-clean-baseline-rebuild`（proposal / design / tasks / specs，Stage 6.6 任务组与 spec 增量已建好）
- 本指令全文

如果环境提供以下 Skill，先加载：`security-best-practices`、`cloudflare:workers-best-practices`。Skill 不存在时直接继续，不得因缺失停止。

**已完成勿重做**（6.6A，提交 f7db5b48）：Migration 0027、Marketplace 单一来源、买家编号建档即分配、汇率/加点/服务费单版本即时生效（无审批）、财务快照合并单一不可变表、pricing 路由改单保存、web 财务页接线、242 端点新基线、全部验证绿。**买家编号、Marketplace、汇率、服务费、财务快照这五项收敛不要再动。**

## 三、6.6B 剩余工作（完成后创建本地提交）

### 3.0 收口已中断的员工固定分配改造

1. 最小修复编译：从 `acquisition/authorization.ts`、`acquisition/channel-privacy.ts`、`customer-onboarding/buyer-invitation-guard.ts`、`customer-onboarding/buyer-registration-route.ts` 的角色判断中移除 `'acquisition'`（acquisition 模块 6.6C 整体删除，此处只求编译通过）；清理 `access-management/read-model.ts` 未用导入。
2. 检查中断改动的完整性（round-robin cursor / owner fallback / availability / 重分配 / 部门团队组长 / 角色合并映射是否清干净；`BUYER_AFTER_SALES_OWNER` 是否已全量并入 `BUYER_REFUND_OWNER`；缺绑定是否 fail-closed 且错误码稳定）。
3. 若上一任务计划过 `POST /api/staff/access-management/buyer-assignments`（设置/转移买家返款负责人，owner-only、expected_version、reason、审计），按既有 seller-organization-assignments 路由模式补齐（合同文件 `packages/contracts/src/staff-access-management.ts` 已被改过，先看现状）。
4. 更新迁移 verifier 常量到 28：`scripts/verify-migrations.mjs`（expectedLatestSchema / expectedLastMigration / inventory 计数与 SHA——用 0027 同款方法从 fresh 库计算：`SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name` 计数 + JSON SHA-256）、`scripts/verify-migration-version-guards.mjs`、三个 `TARGET_SCHEMA` 常量（`operational-readiness/routes.ts`、`production-readiness/recovery-attestation-routes.ts`、`staging-bootstrap/first-owner.ts`）、`scripts/verify-production-schema-documents.mjs` 涉及的四份生产文档链声明（`0001`–`0028` + 最新迁移文件名）、`docs/CURRENT_SYSTEM_STATE.md`。
   - **0028 删除的表**加入 forbiddenTables：staff_departments、staff_teams、staff_team_memberships、staff_team_leaders、staff_role_consolidation_cutovers、staff_role_consolidation_mappings、staff_assignment_cursors、staff_assignment_fallbacks、staff_availability、staff_reassignment_batches、staff_reassignment_batch_items、seller_member_portal_store_grants、seller_member_store_scopes、seller_member_store_scope_events、order_evidence_internal_files
   - **0028 新增的表/触发器**加入 required 清单：reservation_participation_exceptions、seller_product_primary_contact_events、trg_reservation_participation_exceptions_*、trg_seller_product_primary_contact_*
   - **0028 删除的触发器**从 requiredTriggers 移除（含 store grant/scope 事件触发器、fallback insert/update guard、single_image_guard、order_evidence_internal_files no_update/no_delete）
   - **新增禁止列**：`order_evidence_versions.evidence_file_object_id`
5. 修复并跑绿受影响测试（staff-assignment、staging-bootstrap、customers、operational-integrity、access-management、bootstrap 脚本测试、testkit 若引用被删表——`packages/testkit/src/sqlite-database.ts` 的 phase3h fixture 若插入 staff_departments 需删）。

### 3.1 卖家成员可见范围（D-056 §4.4）

同一卖家组织所有有效成员可见：全部店铺、产品、订单、订单沟通截图、服务费、汇率、结算金额与凭证。仅组织 OWNER 可管理成员/邀请/停用/组织设置。

- 删除代码引用：`seller_member_portal_store_grants`、`seller_member_store_scopes`、店铺授权事件、`assign-member-store` 服务（`apps/api/src/catalog/assign-member-store.ts`，本就未挂路由）、`catalog/seller-member-store-access.ts` 的 scope UNION 口径（改为组织内全量 ACTIVE 店）
- `seller-portal/actor.ts`：非 OWNER 成员也获得组织内全部 ACTIVE 店铺（storeIds 口径统一）；`seller-members/create-seller-member.ts` 不再批量写 scopes
- `seller-order-chat-screenshots/read-model.ts` 的"只认 scopes"过滤随沟通截图统一一起消失（见 3.3）

### 3.2 产品主要对接人（D-056 §4.4）

- 每个产品至多一个当前主要对接人（`products.primary_contact_member_id`，0028 已加列 + 活跃成员 guard 触发器 + `seller_product_primary_contact_events` 事件表）
- 新增受控命令与路由（owner 或 seller_ops + `SELLER_MANAGE` + 组织 scope；expected_version、幂等、reason 必填、审计；写 products 版本 + 事件行；对接人只是责任标记，不限制其他成员查看）
- 路由路径自定（建议 `POST /api/staff/products/:id/primary-contact`），加入 contracts 与 `V2_API_ROUTE_INVENTORY.md`

### 3.3 订单沟通截图统一（D-056 §4.1）

统一为 `ORDER_COMMUNICATION_SCREENSHOT`（0028 已改 purpose 枚举与 `file_entity_links` 的 purpose↔entity 约束为 `entity_type='ORDER'`）：

- 删除两套重复模块：`apps/api/src/buyer-chat-screenshots/` 与 `apps/api/src/seller-order-chat-screenshots/`（及其 contracts：`buyer-chat-screenshot.ts`、`seller-order-chat-screenshot.ts`；上传 intent 路由 `file-http.ts` 中两个入口；`files/routes.ts` 注册矩阵中对应行；`packages/domain/src/files/file-policy.ts` 的旧 purpose 条目）
- 新建一套正式路由（员工订单详情入口，不属获客中心）：
  - 上传 intent：`POST /api/staff/formal-orders/:id/communication-screenshots/intents`（purpose=ORDER_COMMUNICATION_SCREENSHOT、visibility=SELLER_VISIBLE、owner=STAFF）
  - 挂载：`POST /api/staff/formal-orders/:id/communication-screenshots`（一单多张；文件 link 到 `entity_type='ORDER'`；写卖家组织 audience grant；保留上传人、时间、哈希、审计）
  - 读取：卖家门户读取 intent 走同一 audience（组织内全部有效成员可读，不再看店铺 scope）；其他组织 concealed 404；买家端不可见（DTO/边界测试证明）
- 冷归档：确认归档单元（ORDER bundle 的文件事实收集，`cold-image-archive/selector.ts`）改为 `entity_type='ORDER'` + purpose=ORDER_COMMUNICATION_SCREENSHOT 的 link（取代旧的 internal_files slot=1 与买家聊天挂 ORDER 的路径）；六个月冷归档、恢复不扩大权限沿用既有机制；0025/0026/0024 的历史导入 purpose 枚举 0028 已同步改名，导入器 TS 常量里的 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 字符串改为新值（`tools/imports/historical-order-importer/`）
- `order_evidence_internal_files` 表与 slot=1 限制已由 0028 删除；清理其全部代码引用（buyer-refund/seller-settlement 读模型若引用请一并指向新表）

### 3.4 订单付款截图单一化（D-056 §4.2）

- 0028 已删 `order_evidence_versions.evidence_file_object_id` 双指针列、`order_evidence_version_files` 已加 `UNIQUE(version_id)`、旧 single_image_guard 已删
- 代码收口：`order-evidence/submit-order-evidence.ts`、`http-one-screenshot-guard.ts`、`order-evidence/approve-order-evidence.ts` 的 source 查询、`buyer-order-evidence-portal`、`formal-order-shared`、各读模型中残余 `evidence_file_object_id` 引用改为以 `order_evidence_version_files` 为唯一来源；数据库层每版本恰好一张由 UNIQUE 保证，加负向测试（第二张 INSERT 必须失败）

### 3.5 预约规则补全（D-056 §五，指令原文第五节全部要求）

自动通过只在全部满足时成立：买家 ACTIVE；身份无冲突无待人工处理；**买家从未在该卖家组织下获得 APPROVED 预约或形成正式订单，或存在有效一次性人工例外**；对应店铺没有其他进行中预约；批次有名额；无逾期未完成订单；无异常/人工风险标记；下单排期和指引完整有效。预约阶段不要求订单日汇率存在（汇率在正式订单确认时按实际订单日期解析并快照——6.6A 已实现精确当日解析，确认 preflight 不因汇率缺失改变预约资格）。

历史参加规则：APPROVED 即算参加过；形成正式订单永久算参加过；同一卖家组织跨店铺跨产品禁止再次预约；批准前 REJECTED/CANCELLED/EXPIRED 不算；检测到历史参加返回稳定错误并提示联系售前；不得通过删除旧预约绕过（预约表 append-only 触发器已保证，加测试）。

一次性人工例外（表已建：`reservation_participation_exceptions`，绑定买家+卖家组织+具体需求批次+原因+操作者+有效期，用后失效且不可改删）：

- 创建路由：`POST /api/staff/reservations/participation-exceptions`（owner 或 pre_sales，`RESERVATION_DECIDE`，幂等、reason 必填、审计）
- `reservations/submit-reservation.ts` 资格检查与 `auto-approve.ts` 条件中加入历史参加检查 + 例外匹配（例外仅覆盖其绑定的批次；使用时在同一事务内写 `used_at`/`used_by_reservation_id` 并断言 changes()=1；无有效例外时拒绝且错误码稳定，如 `RESERVATION_HISTORY_PARTICIPATION`）
- 历史参加判定 SQL：`formal_orders JOIN seller_stores ON store 组织` 或 `product_reservations JOIN demand_batches/products` 按卖家组织维度查 APPROVED/已转正式订单

### 3.6 验证并提交 6.6B

至少执行并记录真实退出码：`npm run typecheck`、`npm test`、`npm run build`、`npm run check`、`openspec validate --all --strict`、`npm run db:verify`、`npm run verify:migration-guards`、`npm run verify:api-contract`（新端点数更新基线文档与 alignment 测试）、`npm run verify:archive-capacity`、`npm run verify:historical-import-capacity`、fresh 本地 D1 从 `0001` 重放到 `0028` + `PRAGMA integrity_check` + `PRAGMA foreign_key_check`。

新增测试（6.6D 汇总验收，这里先建）：预约同卖家永久限制与一次性例外（用后失效、不可删）、卖家组织内全量可见与跨组织 concealed 404、多张沟通截图 + 一张付款截图约束、产品对接人变更事件与审计、四角色权限矩阵回归。

全绿后提交：`stage 6.6B: fixed assignment, org-wide seller visibility, communication/payment screenshots, reservation permanent rules (D-056) — migration 0028, schema 28`。

## 四、6.6C：删除重复运行模块（完成后创建本地提交）

新增前向 Migration `0029`（schema 28→29）：

- 删除获客 19+ 张表（0017 建的 `acquisition_*` 全家 + 0020/0022/0023 改造残留）；**保留 `buyer_channels`**（不是 acquisition 表）。先删两处硬 FK（`customer_buyer_invitation_lead_links.acquisition_lead_id NOT NULL UNIQUE`、`customer_seller_invitations.acquisition_lead_id` + 索引）与 `trg_buyer_invitation_consumed_link_acquisition_lead`，重建这两表去列
- 删除 `integration_outbox`、`scheduled_dead_letters`（唯一生产者是 outbox drain）；`scheduled_job_states` 的 CHECK 去掉 `'outbox_delivery'` 值并删种子行

源码删除（先删依赖最深处，每删一类跑 typecheck+相关测试）：

1. **获客 CRM**：`apps/api/src/acquisition/` 整目录（**先**把 `privacy.ts` 的微信身份加密函数迁到独立模块，customer-onboarding/customer-security 6 个文件 import 它）；路由注册 `index.ts` 的 4 处；`packages/contracts/src/acquisition.ts`；前端 `apps/web/src/staff/acquisition/` 整目录 + `StaffAcquisitionRouteModule.tsx` + App/StaffRouteModule/staff-navigation/queries-keys/api-client 中的引用（获客中心导航项删除；`/staff/buyer-customers`、`/staff/seller-customers` 复用的 `CustomerIntakeWorkspace` 保留并保住这两页）；`dry-run:staff-acquisition` script；`acquisition` 角色残留（contracts/staff.ts、authorization-policy、web 角色枚举）；`customer-onboarding/lead-guard.ts`、`buyer-registration-route.ts`、`historical-seller-directory.ts`、`seller-registration/service.ts`/`staff-read.ts` 的 acquisition 表引用改读正式表（卖家目录统一读 `seller_organizations`、`seller_organization_members`、`wechat_identity_claims`、`seller_stores`、`products`，不再读 acquisition 表）；`tools/imports/historical-seller-customers/staging-sql.ts` 的 exemptions 写入删除；文档 `docs/contracts/STAFF_ACQUISITION_FUNNEL.md`、`docs/runbooks/STAFF_ACQUISITION_FUNNEL.md`、`docs/ACQUISITION_CHANNEL_PRIVACY_FREEZE.md`、openspec `staff-acquisition-funnel` spec 归档或删除
2. **Integration Outbox**：`foundation/outbox.ts` + 测试、`staff-assignment/outbox.ts`、runner 的 outbox_delivery 段、commands/routes 的 dead-letter replay、`integration_outbox`/`scheduled_dead_letters` 全部引用；**约 55 个业务命令文件去掉 outbox 双写语句**（`prepareOutboxEvent`/`createOutboxStatements` 调用点，grep 全仓逐一清理，业务事实仍须在同一 D1 batch）；worker/app/cloudflare-runtime 的 `OUTBOX_DELIVERY_*`、wrangler 模板 var；operational-readiness 的 `outbox_delivery` 检查项与 `acquisition_maintenance` 检查项、probe/health-monitor/formal verifier 对应项、contracts/scheduled-operations 的相关常量。**不得误删冷归档 `archive_jobs`、Queue/DLQ、`audit_events`、领域事件表、幂等、transaction_assertions**
3. **旧注册死代码**：`apps/api/src/buyer-self-registration/register-buyer.ts` 删除（barrel 注释同步）；保留员工建档、邀请注册、微信认领、密码/会话安全、限流、token、冲突人工处理、冻结/撤销会话
4. **看板重复**：`admin-business-dashboard/financial-projection.ts` 读模型与端点删除（`internal-finance` 唯一财务来源）；`routes.ts` 只留 summary；`verify:admin-dashboard-simplified` 断言同步；员工工作台只读精简摘要
5. **订单详情收敛**：新建唯一员工正式订单详情聚合端点（建议 `GET /api/staff/formal-orders/:id`，按权限返回：基础信息、买家卖家、产品预约、付款截图、沟通截图、评论、返款、结算、财务快照、运营事件、人工财务调整、当前允许操作）；删除独立 order-integrity 详情路由、operating-integrity order lookup、buyer-advance-principal lookup 别名路由、internal-finance 订单详情的重复基础字段（运营事件、评论可见性观察、Advance、人工财务调整作为分节保留在同一结构里）；更新 contracts、`V2_API_ROUTE_INVENTORY.md`、alignment 测试与端点数
6. **历史导入中间模型隔离**：`seller_partner_import_*`、`standard_products`、`seller_product_offerings`、`product_reservation_openings`、historical importer 保留但只准导入 CLI/对账/隔离报告使用——新增 architecture-guard 源码扫描测试：`apps/api/src` 的门户与正式业务路由（buyer-portal、seller-portal、非 import 的 staff 路由）不得 import/SQL 引用这些表与 `historical_*` 表；`customer-onboarding` 现存 4 处运行时读取（lead-guard 判重、lookup 端点、historical-seller-directory、first-owner 清点）改为读正式表或删除

验证（含每类删除后的 typecheck/test），全绿后提交：`stage 6.6C: retire acquisition CRM, integration outbox, dead registration, duplicate projection/detail routes (D-056) — migration 0029, schema 29`。

被删路由真实返回 404 的测试、新员工订单详情合同测试在此阶段一并完成。

## 五、6.6D：后端最终安全验收（完成后创建独立收尾提交）

完成 OpenSpec `backend-clean-baseline-rebuild` Stage 7 与 Stage 8（tasks.md 中 7.1–7.4、8.1–8.3）：

- 7.1 权限矩阵 / Personal DENY / Marketplace scope / concealed 404 全套（四角色新矩阵）
- 7.2 幂等重放、payload mismatch、expected_version 冲突、财务快照不可变（含 6.6A/6.6B 新表）
- 7.3 Buyer/Seller DTO 隔离、R2 失败补偿、Drive 校验失败、Queue 重复投递 / DLQ
- 7.4 归档 / 恢复 / 7 天清理 / 订单沟通截图归档回归
- Stage 8：全部验证命令真实执行 + 旧 verifier 映射核销 + 中文交接报告

必须真实执行并记录退出码的验证（不得写"预计通过"）：

`npm run typecheck`、`npm test`、`npm run build`、`npm run check`、`openspec validate --all --strict`、`npm run db:verify`、`npm run verify:migration-guards`、`npm run verify:api-contract`、`npm run verify:archive-capacity`、`npm run verify:historical-import-capacity`、fresh 本地 D1 从 `0001` 重放到最终版 + `PRAGMA integrity_check` + `PRAGMA foreign_key_check`、安全源码扫描（`npm run check` 链内 security:scan）、被删路由真实 404 测试、新员工订单详情合同测试、预约永久限制与例外测试、B/C 编号并发/重放/历史最大号续排测试、卖家组织内可见与跨组织 404 测试、多张沟通截图与一张付款截图约束测试。

## 六、交接文档与文档更新

生成 `docs/migration/V2_BACKEND_REBUILD_STAGE6_6_HANDOFF.md`（含：范围、0027/0028/0029 迁移内容、验证真实结果表、新错误码、被删模块清单、远程边界声明、未解决风险、阶段 7A-2 可依赖的最终合同——schema 版本、端点数、新路由清单、角色与权限变化）。

同步更新：Decision Register（D-056 状态行如需补充实施事实）、Product Rules（预约规则、沟通/付款截图、汇率/服务费单保存、四角色）、`docs/CURRENT_SYSTEM_STATE.md`、`docs/contracts/V2_API_ROUTE_INVENTORY.md`、权限矩阵、数据库说明、历史导入字段映射、冷归档文件类型说明（purpose 改名）、OpenSpec tasks（6.6.x 与 Stage 7/8 真实完成后才勾选）。

## 七、禁止与允许

禁止：push、deploy、创建 PR、修改 Cloudflare 资源、访问真实 Google Drive、导入真实订单、盘点真实图片、读写真实 secret、reset/rebase/squash/drop/force checkout 已有提交、进入前端视觉重构、为通过测试弱化断言。

允许：前端最小必要接线与类型修复（删除旧 API 后使 `typecheck/test/build` 通过）；不得重新设计界面。

## 八、最终报告格式

```ini
TASK=
LOCAL_COMMITS=（f7db5b48 之后的新提交数）
FINAL_HEAD=
SCHEMA_VERSION=
API_ENDPOINT_COUNT=
TABLES_REMOVED=（0028+0029 合计）
TABLES_ADDED=
ROUTES_REMOVED=
ROUTES_ADDED=
DUPLICATE_MODELS_ELIMINATED=
BUYER_NUMBER_RESULT=（6.6A 已完成，引用验证证据）
RESERVATION_RULE_RESULT=
SELLER_VISIBILITY_RESULT=
ORDER_PAYMENT_SCREENSHOT_RESULT=
ORDER_COMMUNICATION_SCREENSHOT_RESULT=
OUTBOX_RESULT=
ACQUISITION_RESULT=
HISTORICAL_IMPORT_BOUNDARY=
COMMANDS_RUN=
TESTS_PASSED=
TESTS_FAILED=
REMOTE_WRITES=no
CLOUDFLARE_RESOURCES_TOUCHED=no
GOOGLE_DRIVE_RESOURCES_TOUCHED=no
REAL_HISTORICAL_IMPORT=NOT_RUN
REAL_IMAGE_INVENTORY=NOT_RUN
GITHUB_REMOTE_TOUCHED=no
OPEN_RISKS=
NEXT_SAFE_STEP=继续阶段 7A-2 前端重构，按新的后端合同重做员工工作台、订单列表和统一订单详情
```

完成后确认：每个阶段有独立本地提交、旧提交全部保留、工作树干净、没有 push、没有部署、没有真实外部操作、本地测试不得写成 Staging/Production 已通过，然后停止等待下一条指令。
