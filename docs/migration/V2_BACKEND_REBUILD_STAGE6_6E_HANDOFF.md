# 后端重建阶段 6.6E 交接（业务合同缺口收口 + 最小前端接线）

日期：2026-08-28。分支 `feature/staging-workflow-rate-ux`，基线 `e4f18594f`（7A-1R-A 完成点），本阶段两个本地提交（未 push）：后端合同/Migration/测试/文档 + 最小前端合同适配与浏览器测试。依据：用户阶段 6.6E 指令（2026-08-28）、D-056、`V2_BACKEND_REBUILD_STAGE6_6_HANDOFF.md`。

## 0. 范围与非目标

完成买家建档/编号/邀请注册流程修正、订单沟通截图上传人/时间补全、Buyer Refund 权威垫付分区、固定分配与 Personal DENY 管理端点、获客权限残留清除、请求级测试、最小前端接线与 Playwright 浏览器验证。**未进入**：7A-1R-B（视觉/交互/信息架构设计，明确属 ChatGPT 的下一阶段）、7A-2、部署、任何远程操作、真实数据。

## 1. Migration 0030（schema 29→30）

`0030_stage66e_invitation_binding_and_permission_cleanup.sql`（只追加，未改写历史 Migration）：

- `customer_buyer_invitations` 增加 `buyer_customer_id TEXT REFERENCES buyer_customers(id)`（可空，历史行运行时 fail closed）+ 索引 `idx_customer_buyer_invitations_buyer`。
- 删除 `staff_permission_overrides` 中 `ACQUISITION_ADMIN`/`ACQUISITION_BUYER_LEAD`/`ACQUISITION_SELLER_LEAD` 行并重建表收紧 CHECK（0028 同模式：先 DROP `trg_buyer/seller_staff_assignments_staff_guard` 与视图 `staff_effective_assignment_permissions`，重建后按原定义恢复）。
- inventory 变化：157 表 / **481** 索引 / 305 触发器 / 12 视图（SHA-256 已在 `verify-migrations.mjs` 重锚 `ef457643…`）。

## 2. 买家建档、编号与邀请注册（正式规则落地）

- **新端点 `POST /api/staff/buyer-customers`**（`apps/api/src/customers/create-buyer-route.ts`）：thin HTTP 壳复用既有 `createBuyerCustomer` 业务方法（未复制第二套编号逻辑）。必填 `display_name`/`wechat_id`/`buyer_channel_id`/`marketplace_code`；返回 `buyer_customer_id`、`buyer_number`、`access_status='DISABLED'`、`activated=false`、`initial_pre_sales_owner`（建档事务内 `AUTO_INITIAL` 绑定）。幂等重放返回同一买家同一编号。
- **建档支持复用既有微信身份主体**（如卖家双角色身份）：`create-buyer.ts` 在 ACTIVE claim 已存在且其主体无买家档案时复用 subject（不建第二主体/第二档案）；RESERVED claim 或主体已有买家仍 409。BUYER persona 由既有 `trg_customer_account_persona_after_buyer` 在建档时自动挂上。
- **邀请签发绑定既有买家**：`issueBuyerInvitation` 输入增加必填 `buyerCustomerId`；签发前校验买家存在（404）、未激活（409）、身份核验 CLEAR、微信 claim 与提交一致、Marketplace 一致、无未过期 ACTIVE 邀请（均 409）。两条签发路由（`customer-onboarding/buyer-registration-invitations`、`customer-security/buyer-invitations`）body 均增加 `buyer_customer_id`。
- **邀请注册只认领激活**（`invited-registration.ts` 重写）：删除注册阶段创建 buyer_customers、删除注册阶段编号分配（`planBuyerNumberAllocation` 等已移除、`buyerChannelId` 输入与环境变量 `BUYER_SELF_REGISTRATION_CHANNEL_ID` 检查删除）；无绑定/绑定买家缺失/已激活/微信不一致/编号不一致 → fail closed 409（`INVITATION_BUYER_BINDING_UNAVAILABLE` 等 reason_code）。激活前后编号不变；注册不再 bump session_version（persona 在建档时已挂，账号 committed version 即权威）。

## 3. 订单沟通截图与订单详情投影

- `OrderCommunicationScreenshotReferenceDto` 增加 `uploaded_at`、`uploaded_by_staff_id`、`uploaded_by_staff_name`（可安全返回时）；read-model 从 `file_objects.uploaded_at` + `file_upload_intents.owner_actor_*` + `staff_users.display_name` 联查。可见性不变（staff 上传/查看、卖家组织成员查看、买家不可见、跨组织 concealed 404、冷归档链路不变——purpose 未动）。
- 统一订单详情 `GET /api/staff/formal-orders/:id` 新增最小权威垫付分区 `buyer_advance`：`authoritative_advance_amount_cny_fen`（财务快照 `buyer_expected_principal_cny_fen`）、`recorded_advance_amount_cny_fen`（付款-冲正合计）、`remaining_advance_amount_cny_fen`、`can_record_advance_payment`（BUYER_REFUND_RECORD 且无未冲正垫付且无返款义务）。仅 `owner` 与 `buyer_refund` 可见；`financial_snapshot`/`financial_adjustments` 仍仅 owner+FINANCIAL_VIEW——Buyer Refund 看不到利润、卖家服务费明细、卖家结算敏感字段。

## 4. 固定分配管理与 Personal DENY（Owner-only）

- `GET /api/staff/access-management/buyer-assignments` 现同时返回 `pre_sales_owner` 与 `refund_owner`。
- 新增 `POST /api/staff/access-management/buyer-pre-sales-assignments`（`changeBuyerPreSalesOwner`，镜像 refund 版：role=pre_sales 资格校验、reason 必填、幂等、expected_assignment_version、语义重放、审计+assignment event）。
- 新增 `GET/POST /api/staff/access-management/personal-denies` 与 `POST .../personal-denies/revoke`（`setPersonalDeny`/`revokePersonalDeny`：权限码必须是已发布码（获客码已不存在→400）、DENY-only（数据库触发器禁 GRANT）、变更提升 `authorization_version` 立即生效、审计事件 `STAFF_PERSONAL_DENY_SET/REVOKED`、幂等+语义重放）。
- 全部经 `requireStaffAccessManager`（STAFF_MANAGE+PERMISSION_MANAGE，即 owner）；payload 精确键校验。

## 5. 获客残留清除

- 运行时：`STAFF_PERMISSION_CODES`（contracts）与 `authorization-policy.ts`（owner-only 集合、pre_sales/seller_ops 默认）删除三个 `ACQUISITION_*` 码；migration 0030 收紧数据库白名单。
- 文档/Spec：`V2_PERMISSION_MATRIX.md` 删除 acquisition 角色章节与"获客专项权限"章节及各角色线索残留；`STAFF_ACQUISITION_FUNNEL.md` 标记为已退役历史档案；`openspec/specs/staff-acquisition-funnel/` 删除；`staff-portal-visual-refresh` spec 的 acquisition requirement 改写为"保持退役"并把五角色措辞改四角色；`V2_API_ROUTE_INVENTORY.md` 重生成段更新。
- 保留：`buyer_channels`（买家来源渠道，建档必填）完全未动。
- 全仓扫描结果：`apps/api/src`/`apps/web/src`/`packages/contracts/src` 运行时代码零 `ACQUISITION_*` 引用（仅测试断言"必须拒绝该码/路由不存在"的负向用例）；`/staff/acquisition`、双聊天截图入口、旧订单完整性页面、公共池/抢任务入口在前端均不存在（源码 grep + Playwright 实证）。

## 6. 新增路由与合同

- `POST /api/staff/buyer-customers`
- `POST /api/staff/access-management/buyer-pre-sales-assignments`
- `GET/POST /api/staff/access-management/personal-denies`、`POST /api/staff/access-management/personal-denies/revoke`

**API 端点基线：224**（222 `/api/*` + `/health` + `/ready`）。`buyer-assignments` GET 响应扩展（非新增端点）；邀请签发两端点请求体增加必填 `buyer_customer_id`（破坏性合同变更，前端已同步）。

## 7. 前端最小接线（不做视觉重构）

- 买家客户页：新买家流程改为"建立买家档案（站点/微信号/名称/来源渠道 B/C）→ 立即显示买家编号+未激活状态+初始售前负责人 → 签发注册邀请"；历史客户查询的邀请走 `subject_id` 绑定。
- 订单详情：沟通截图每张显示上传员工与上传时间（北京时间）；AdvanceBlock 改用 `buyer_advance` 分区（权威/已记录/剩余金额 + can_record 提示），不再回退快照字段。
- 员工与权限页：新增"负责买家售前"管理区、"Personal DENY 管理"区（设置/撤销、原因必填、生效中列表）；返款管理区数据结构同步双 owner。
- 布局、导航、视觉风格、仪表盘均未改动。

## 8. 测试

新增/重写：`customers/create-buyer-route.test.ts`（HTTP 建档 B/C 独立编号、幂等重放、重复微信 409、非授权 403、邀请绑定/激活编号不变/已激活 409、微信与站点不匹配 409、旧无绑定邀请 fail closed、失败不跳号）、`staff-order-detail/staff-order-detail.test.ts`（buyer_refund 见垫付分区不见财务快照/卖家敏感字段、owner 见快照、pre_sales 两者皆无、截图上传人/时间）、`staff/access-management/stage66e-assignments-deny.test.ts`（售前分配列表/设置/语义重放/版本冲突、非 owner 403、不合格岗位 409、DENY 设置实际生效/撤销恢复/未知码 400/审计 2 条）。既有 suites 全部按新合同更新（邀请/注册、schema 30、MSW、backup、inventory 等）。

Playwright：`apps/web/e2e/stage66e.spec.ts` 7 个用例（建档见编号→签发邀请、沟通截图上传人/时间、buyer_refund 见垫付不见利润、pre_sales 无垫付分区、owner 双分配+DENY 管理、非 owner 无权限管理入口且直访 403 文案、获客中心/公共池/抢单/订单完整性/双聊天入口不存在）。

## 9. 验证真实结果（2026-08-28，最终提交前）

| 命令 | 退出码 |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | 0（250 文件 / 1,682 用例全过） |
| `npm run build` | 0 |
| `npm run check` | 0 |
| `openspec validate --all --strict` | 0（62/62） |
| `npm run db:verify` | 0（157 表/481 索引/305 触发器/12 视图，SHA-256 一致） |
| `npm run verify:migration-guards` | 0 |
| `npm run verify:api-contract` | 0（224 documented endpoints 双向一致） |
| `npm run verify:web-source-boundaries` | 0 |
| `npm run verify:web-static-build` | 0 |
| wrangler 本地 D1 空库重放 0001→0030 | 全部 ✅；schema_version=30 |
| Playwright `stage66e.spec.ts` | 7/7 PASS |
| 获客/双截图/公共池残留全仓扫描 | 0 运行时引用 |

## 10. 远程边界与风险

零远程操作：无 push/PR、无 Cloudflare/Google Drive 触碰、无真实数据。开放风险：

1. 真实历史导入仍未执行（不变，见 6.6 交接）。
2. `AMAZON_US`/`COUPANG_KR` 仍 fail-closed；建档合同已接受三码但运行时仅 AMAZON_JP 可写。
3. 卖家双角色买家的建档复用路径已由测试覆盖，但真实数据中如出现同一微信多主体历史脏数据，建档会按 WECHAT_ID_CONFLICT 拒绝并需 owner 身份治理流程处理。
4. 7A-1R-A 交接中记录的四项后端合同缺口中"沟通截图上传人/时间、advance 金额投影、Personal DENY/售前负责人端点"三项已由本阶段收口；"权限矩阵文档漂移"已同步修正。
