# V2 前端路由重建盘点（阶段 7A-1）

日期：2026-08-26。分支 `feature/staging-workflow-rate-ux`，基线 `754c0f0`。
范围：`apps/web/src` 全部路由、页面组件、导航入口与前端残留。
处理结论枚举：KEEP / MERGE / REBUILD / DELETE / PLACEHOLDER。

## 0. 盘点方法

- 路由来源：`apps/web/src/App.tsx`（顶层 `<Routes>`）+ `apps/web/src/staff/StaffRouteModule.tsx`（员工端二级分发）+ `apps/web/src/buyer/routes/BuyerRouteModule.tsx` + `apps/web/src/seller/routes/SellerRouteModule.tsx`。
- 页面组件：按路由 lazy chunk 追踪到默认导出。
- API 使用：从各页面 `useQuery`/`apiRequest` 调用与 `apps/web/src/staff/api/client.ts`、`buyer/api/client.ts`、`seller/api/client.ts` 交叉核对。
- 角色要求：与 `docs/contracts/V2_PERMISSION_MATRIX.md` 及 `staff-auth-api.ts` session schema 对齐。
- 退役判定：后端 248 端点清单（`docs/contracts/V2_API_ROUTE_INVENTORY.md`）中不存在对应 API、或 `CURRENT_SYSTEM_STATE.md` 明确标记退役的功能。

## 1. 员工端路由（/staff/*）

| URL | 页面组件 | 入口导航 | 使用的 API | 角色要求 | 当前状态 | 处理结论 |
|---|---|---|---|---|---|---|
| `/staff` | `StaffTaskQueuePage` | 侧边栏「工作台」 | `GET /api/staff/me/work-items` | 全部 Active Staff（acquisition 重定向到 /staff/acquisition） | 正常 | KEEP |
| `/staff/queue` | `StaffTaskQueuePage` | 无（与 /staff 同页） | 同上 | 同上 | 正常，与 /staff 重复 | MERGE（保留 /staff，/staff/queue 作别名） |
| `/staff/work/:workItemId` | `WorkItemPage` | 工作台列表点击 | `GET /api/staff/me/work-items/:id` + 各 work type 上下文 API | 按 work type 权限 | 正常 | KEEP |
| `/staff/acquisition` | `AcquisitionCoreWorkbench` | 侧边栏「获客」（owner/acquisition） | `GET /api/staff/acquisition/*` | owner / acquisition | 正常 | KEEP |
| `/staff/buyer-customers` | `CustomerIntakeWorkspace` | 侧边栏「买家与订单」（owner/pre_sales） | `GET /api/staff/customer-onboarding/*`、`GET /api/staff/acquisition/leads` | owner / pre_sales | 正常 | KEEP（归入新 IA「客户」） |
| `/staff/seller-customers` | `CustomerIntakeWorkspace` | 侧边栏「卖家」（owner/seller_ops） | 同上 + seller 目录 | owner / seller_ops | 正常 | KEEP（归入新 IA「客户」） |
| `/staff/products` | `ProductSchedulingWorkspace` | 侧边栏「产品与投放」 | `GET /api/staff/catalog/products` | owner / pre_sales / seller_ops | 正常 | KEEP（归入新 IA「产品与预约」） |
| `/staff/products/:productId` | `ProductSchedulingWorkspace` | 产品列表点击 | `GET /api/staff/catalog/products/:id` | 同上 | 正常 | KEEP |
| `/staff/demands/:demandId/reservations` | `ProductSchedulingWorkspace` | 需求审核上下文跳转 | `GET /api/staff/demand-batches/:id/reservation-schedule` | owner / seller_ops / pre_sales | 正常 | KEEP |
| `/staff/orders/:orderId` | `StaffOrderDetailPage` | 全局搜索 / 工作台 | `GET /api/staff/finance/orders/:formalOrderId`、`GET /api/staff/order-integrity/:id` | 按数据范围 | 正常 | KEEP（归入新 IA「订单」） |
| `/staff/refunds` | `StaffRefundsPage` | 侧边栏「返款工作台」（owner/buyer_refund） | `GET /api/staff/buyer-refunds` | owner / buyer_refund | 正常 | KEEP（归入新 IA「买家返款」） |
| `/staff/refunds/:obligationId` | `StaffRefundDetailPage` | 返款列表点击 | `GET /api/staff/buyer-refunds/:id` | 同上 | 正常 | KEEP |
| `/staff/finance` | `StaffFinanceWorkspace` | 侧边栏「财务配置」（owner/seller_ops+SELLER_MANAGE） | `GET /api/staff/rate-center`、`GET /api/staff/seller-principal-rate-policies`、`GET /api/staff/seller-service-fees` | owner / seller_ops+SELLER_MANAGE | 正常 | KEEP（归入新 IA「财务」，同时承载汇率/加点/服务费） |
| `/staff/rate-center` | 重定向 → `/staff/finance` | 无（旧链接） | 无（重定向） | 同上 | 旧路径，已重定向 | DELETE（移除路由声明，保留 URL 会 404；深度链接已在 StaffRouteModule 处理重定向） |
| `/staff/seller-principal-rate-policies` | 重定向 → `/staff/finance` | 无（旧链接） | 无（重定向） | 同上 | 旧路径，已重定向 | DELETE（同上） |
| `/staff/admin-business-dashboard` | `FrozenAdminBusinessDashboard` + `OperatingIntegrityCenter` | 侧边栏「经营看板」（owner only） | `GET /api/staff/admin-business-dashboard/summary`、`/financial-projection` | owner + FINANCIAL_VIEW | 正常 | KEEP（归入新 IA「系统设置」下的经营看板，owner only） |
| `/staff/access-management` | `StaffAccessManagementWorkspace` | 侧边栏「员工与访问管理」（owner+STAFF_MANAGE） | `GET /api/staff/access-management` | owner + STAFF_MANAGE | 正常 | KEEP（归入新 IA「员工与权限」） |
| `/staff/operations` | `StaffOperatingIntegrityTools` | 侧边栏「运行完整性工具」 | `GET /api/staff/operations/health`、`/api/staff/operating-integrity/order-lookup` | owner / seller_ops / pre_sales / buyer_refund | 正常 | KEEP（归入新 IA「系统设置」） |
| `/staff/*` (catch-all) | `DomainNotFound` | — | — | — | 404 | KEEP |

### 员工端导航退役项

| 项目 | 位置 | 原因 | 处理结论 |
|---|---|---|---|
| `RAKUTEN_JP` / `TIKTOK_JP` 在 `MARKET_LABELS` | `StaffShell.tsx` | 后端阶段 2/3/4 已删除 Rakuten/TikTok，canonical registry 仅三码 | DELETE |
| `/staff/rate-center` 路由声明 | `App.tsx` | 已在 StaffRouteModule 重定向到 /staff/finance，App.tsx 仍声明 slot 但无实际页面 | DELETE（移除 App.tsx 中的 Route 声明，StaffRouteModule 内重定向保留以兼容书签） |
| `/staff/seller-principal-rate-policies` 路由声明 | `App.tsx` | 同上 | DELETE |
| `获客` 描述中的「自动开发入口」 | `StaffShell.tsx` context 文案 | 机器获客已退役，文案误导 | REBUILD（文案修正为「渠道、潜在线索与咨询」） |

## 2. 买家端路由（/buyer/*）

| URL | 页面组件 | 入口导航 | 使用的 API | 角色要求 | 当前状态 | 处理结论 |
|---|---|---|---|---|---|---|
| `/buyer` | `BuyerRouteModule` 分发 | 底部导航 | — | Buyer Session | 正常 | KEEP（本阶段不重构） |
| `/buyer/products` | BuyerProducts | 底部导航 | `GET /api/buyer-portal/demands` | Buyer | 正常 | KEEP |
| `/buyer/tasks` | `BuyerTasksPage` | 底部导航 | `GET /api/buyer-portal/reservations`、`/order-evidence`、`/reviews` | Buyer | 正常 | KEEP |
| `/buyer/demands` | `BuyerDemandsPage` | 底部导航 | `GET /api/buyer-portal/demands` | Buyer | 正常 | KEEP |
| `/buyer/demands/:demandId` | `BuyerDemandDetailPage` | 需求列表 | `GET /api/buyer-portal/demands/:id` | Buyer | 正常 | KEEP |
| `/buyer/reservations` | `BuyerReservationsPage` | 任务页 | `GET /api/buyer-portal/reservations` | Buyer | 正常 | KEEP |
| `/buyer/reservations/:reservationId` | `BuyerReservationDetailPage` | 预约列表 | `GET /api/buyer-portal/reservations/:id` | Buyer | 正常 | KEEP |
| `/buyer/reservations/:reservationId/instruction` | `BuyerInstructionPage` | 预约详情 | `GET /api/buyer-portal/reservations/:id/order-instruction` | Buyer | 正常 | KEEP |
| `/buyer/order-materials` | `BuyerOrderMaterialsPage` | 任务页 | `GET /api/buyer-portal/order-evidence` | Buyer | 正常 | KEEP |
| `/buyer/order-materials/new` | `BuyerOrderEvidenceFormPage` | 提交凭证 | `POST /api/buyer-portal/order-evidence` | Buyer | 正常 | KEEP |
| `/buyer/order-materials/:submissionId` | `BuyerOrderEvidenceDetailPage` | 凭证列表 | `GET /api/buyer-portal/order-evidence/:id` | Buyer | 正常 | KEEP |
| `/buyer/orders` | `BuyerFormalOrdersPage` | 底部导航 | `GET /api/buyer-portal/formal-orders` | Buyer | 正常 | KEEP |
| `/buyer/orders/:formalOrderId` | `BuyerFormalOrderDetailPage` | 订单列表 | `GET /api/buyer-portal/formal-orders/:id` | Buyer | 正常 | KEEP |
| `/buyer/reviews` | `BuyerReviewsPage` | 任务页 | `GET /api/buyer-portal/reviews` | Buyer | 正常 | KEEP |
| `/buyer/reviews/new` | `BuyerReviewFormPage` | 提交评价 | `POST /api/buyer-portal/reviews` | Buyer | 正常 | KEEP |
| `/buyer/reviews/:reviewCaseId` | `BuyerReviewDetailPage` | 评价列表 | `GET /api/buyer-portal/reviews/:id` | Buyer | 正常 | KEEP |
| `/buyer/refunds` | `BuyerRefundsPage` | 任务页 | `GET /api/buyer-portal/refunds` | Buyer | 正常 | KEEP |
| `/buyer/refunds/:refundId` | `BuyerRefundDetailPage` | 返款列表 | `GET /api/buyer-portal/refunds/:id` | Buyer | 正常 | KEEP |
| `/buyer/me` | `BuyerMePage` | 底部导航 | `GET /api/buyer-portal/me` | Buyer | 正常 | KEEP |

## 3. 卖家端路由（/seller/*）

| URL | 页面组件 | 入口导航 | 使用的 API | 角色要求 | 当前状态 | 处理结论 |
|---|---|---|---|---|---|---|
| `/seller` | `SellerRouteModule` 分发 | 侧边栏 | — | Seller Session | 正常 | KEEP（本阶段不重构） |
| `/seller/products` | `SellerPages` | 侧边栏 | `GET /api/seller-portal/products`、`/product-applications` | Seller | 正常 | KEEP |
| `/seller/products/new` | `SellerSubmissionPages` | 新品提交 | `POST /api/seller-portal/product-applications` | Seller | 正常 | KEEP |
| `/seller/products/:applicationId` | `SellerPages` | 产品列表 | `GET /api/seller-portal/product-applications/:id` | Seller | 正常 | KEEP |
| `/seller/demands` | `SellerPages` | 侧边栏 | `GET /api/seller-portal/demand-batches` | Seller | 正常 | KEEP |
| `/seller/demands/new` | `SellerSubmissionPages` | 需求提交 | `POST /api/seller-portal/demand-batches` | Seller | 正常 | KEEP |
| `/seller/orders` | `SellerPages` | 侧边栏 | `GET /api/seller-portal/formal-orders` | Seller | 正常 | KEEP |
| `/seller/reviews` | `SellerPages` | 侧边栏 | `GET /api/seller-portal/reviews` | Seller | 正常 | KEEP |
| `/seller/settlements` | `SellerPages` | 侧边栏 | `GET /api/seller-portal/settlement/*` | Seller | 正常 | KEEP |
| `/seller/settings` | `SellerSettingsV2Page` + `SellerMemberManagement` | 侧边栏 | `GET /api/seller-portal/me`、`/members`、`/member-invitations` | Seller | 正常 | KEEP |

## 4. 认证与通用路由

| URL | 页面组件 | 使用的 API | 角色要求 | 当前状态 | 处理结论 |
|---|---|---|---|---|---|
| `/` | `RootEntry` | — | 公开 | 正常 | KEEP |
| `/buyer/login` | `CustomerLoginPage` | `POST /api/customer-auth/buyer/login` | 公开 | 正常 | KEEP |
| `/buyer/register` | `BuyerRegistrationPage` | `POST /api/buyer-auth/register` | 邀请 token | 正常 | KEEP |
| `/customer/reset-password` | `CustomerPasswordResetPage` | `POST /api/customer-auth/password-reset/complete` | 公开 | 正常 | KEEP |
| `/seller/login` | `CustomerLoginPage` | `POST /api/customer-auth/seller/login` | 公开 | 正常 | KEEP |
| `/seller/register` | `SellerRegistrationPage` | `POST /api/seller-auth/register` | 邀请 token | 正常 | KEEP |
| `/seller/member-register` | `SellerMemberRegistrationPage` | `POST /api/seller-auth/member-register` | 邀请 token | 正常 | KEEP |
| `/buyer/change-password` | `CustomerChangePasswordPage` | `PATCH /api/buyer-portal/me/refund-account`（实际是改密码） | Buyer Session | 正常 | KEEP |
| `/seller/change-password` | `CustomerChangePasswordPage` | `PATCH /api/seller-portal/me/settlement-account` | Seller Session | 正常 | KEEP |
| `/staff/login` | `StaffLogin`（内联于 App.tsx） | `POST /api/staff-auth/access/bootstrap` | 公开（需 Cloudflare Access） | 正常 | KEEP |
| `/forbidden` | `PermissionDenied` | — | 公开 | 正常 | KEEP |
| `/dependency-error` | `ErrorState` | — | 公开 | 正常 | KEEP |

## 5. Review 运行时（/review/*）

| URL | 页面组件 | 说明 | 处理结论 |
|---|---|---|---|
| `/review/` | `ReviewHome` | 演示首页，使用 `demo-data.ts` / `demo-api.ts` | KEEP（独立运行时，lazy 加载不进入生产首屏；`CURRENT_SYSTEM_STATE.md` 明确 `/review` 仅 Demo 数据） |
| `/review/buyer/*` | 同买家端路由 + review adapter | 评审环境 | KEEP |
| `/review/seller/*` | 同卖家端路由 + review adapter | 评审环境 | KEEP |
| `/review/staff/*` | 同员工端路由 + review adapter | 评审环境 | KEEP |

## 6. 前端残留与无引用代码排查

| 项目 | 位置 | 状态 | 处理结论 |
|---|---|---|---|
| Staff MCP 前端代码 | 全仓 grep `staff-mcp` / `StaffMCP` | 不存在（后端阶段 2 已删除） | 无需操作 |
| 飞书前端代码 | 全仓 grep `feishu` / `lark`（排除 lark- skill 路径） | 不存在运行时代码 | 无需操作 |
| 关键词图片生成 | grep `keyword-image` / `KeywordImage` / `resvg` | 不存在 | 无需操作 |
| Rakuten/TikTok 前端 adapter | grep `rakuten` / `tiktok` / `Rakuten` / `TikTok` | `StaffShell.tsx` MARKET_LABELS 中有 RAKUTEN_JP/TIKTOK_JP 标签 | DELETE（仅标签常量，无运行时引用） |
| legacy marketplace alias | grep `legacy_order_code` / `marketplace_legacy` | 不存在 | 无需操作 |
| trends/drill-down 前端 | grep `trends` / `drill-down` / `funnel` | 不存在 | 无需操作 |
| 自动获客机器前端 | grep `acquisition-machine` / `machine-signal` | 不存在 | 无需操作 |
| `StaffCallbackModule.ts` | `apps/web/src/staff/StaffCallbackModule.tsx` | 检查是否被引用 | 待核查 |
| `second-layer-ui-routing.source.test.ts` | `apps/web/src/staff/second-layer-ui-routing.source.test.ts` | 测试文件 | KEEP（回归测试） |
| `ui/CursorPagination.tsx` | `apps/web/src/ui/CursorPagination.tsx` | 独立组件 | KEEP（合并入基础组件层 CursorControls） |
| `ui/FileDropZone.tsx` | `apps/web/src/ui/FileDropZone.tsx` | 独立组件 | KEEP |
| `review/demo-data.ts` / `demo-api.ts` | `apps/web/src/review/` | Review 运行时演示数据 | KEEP（独立 lazy chunk） |

## 7. 统计

- 员工端路由：19 条（含 2 条重定向旧路径）
- 买家端路由：18 条
- 卖家端路由：10 条
- 认证与通用路由：11 条
- Review 运行时：4 组（复用上述路由 + review adapter）
- **前端路由总数（去重，不含 review 复用）：58 条**

处理结论分布：
- KEEP：52
- MERGE：1（/staff/queue → /staff）
- REBUILD：1（获客文案）
- DELETE：4（RAKUTEN_JP/TIKTOK_JP 标签、/staff/rate-center 路由声明、/staff/seller-principal-rate-policies 路由声明、获客误导文案）
- PLACEHOLDER：0

## 8. 新员工端信息架构（11 项）

本阶段建立的一级导航结构（根据真实路由和权限决定链接）：

1. **工作台** → `/staff`（全部角色；acquisition 重定向到获客）
2. **客户** → 二级：`/staff/buyer-customers`（owner/pre_sales）、`/staff/seller-customers`（owner/seller_ops）
3. **产品与预约** → `/staff/products`（owner/pre_sales/seller_ops）
4. **订单** → `/staff/orders/`（当前无列表页，仅有详情 `/staff/orders/:orderId`；通过全局搜索和工作台进入；本阶段不创建假列表页）
5. **评论与凭证** → （当前无独立员工端列表页；评论审核通过工作台 work item 进入；本阶段 PLACEHOLDER，不创建假页面）
6. **买家返款** → `/staff/refunds`（owner/buyer_refund）
7. **卖家结算** → （当前无独立员工端卖家结算列表页；卖家结算通过 `/staff/finance` 中的卖家组织维度查看；本阶段不创建假页面）
8. **财务** → `/staff/finance`（owner/seller_ops+SELLER_MANAGE；承载汇率中心、加点政策、服务费）
9. **文件归档** → （当前无独立前端页面；归档操作通过运营工具和订单详情触发；本阶段 PLACEHOLDER，不创建假页面）
10. **员工与权限** → `/staff/access-management`（owner+STAFF_MANAGE）
11. **系统设置** → 二级：`/staff/admin-business-dashboard`（owner，经营看板）、`/staff/operations`（运行完整性工具）

不存在的功能（订单列表、评论与凭证列表、卖家结算列表、文件归档）不创建假页面，在导航中以禁用态或不显示处理，待后续阶段重构时补齐。
