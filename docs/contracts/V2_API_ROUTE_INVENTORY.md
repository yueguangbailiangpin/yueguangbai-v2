# V2 API Route Inventory

这是默认 App 的可复现 route inventory。现有 224 个唯一端点：222 个 `/api/*`，以及 `/health`、`/ready`。阶段 6.6E（D-056）：新增员工买家建档（`POST /api/staff/buyer-customers`，建档即分配 B/C 编号）、买家售前负责人管理（`POST /api/staff/access-management/buyer-pre-sales-assignments`）与 Personal DENY 管理（`GET/POST /api/staff/access-management/personal-denies`、`POST .../personal-denies/revoke`）；邀请签发合同改为必须绑定已建档买家（`buyer_customer_id`），邀请注册只认领并激活既有档案。阶段 6.6C（D-056）：获客 CRM 全部路由、Integration Outbox 与 dead-letter replay 路由、经营看板 financial-projection、order-integrity 详情、operating-integrity order-lookup 与 buyer-advance-principal-lookup 别名全部退役（一律真实 404）；新增唯一员工正式订单详情聚合端点 `GET /api/staff/formal-orders/:id`。阶段 6.6B（D-056）：员工固定分配新增买家返款负责人管理端点（`/api/staff/access-management/buyer-assignments`）；订单沟通截图统一为 `ORDER_COMMUNICATION_SCREENSHOT`（员工订单详情上传/挂载/列表 + 卖家组织读取 intent，替代退役的 buyer-chat / seller-order-chat 两套路由）；新增产品主要对接人（`/api/staff/products/:id/primary-contact`）与预约一次性人工例外（`/api/staff/reservations/participation-exceptions`）端点。阶段 5（D-055）以 ZIP Bundle 冷归档替换单文件 Drive 归档：per-file rehydrate 路由退役，新增 staff-only 的 bundle restore、bundle 列表与归档指标端点。Staff MCP、机器获客、关键词图片、飞书与 Rakuten/TikTok 预备层已随干净基线重建退役；经营看板收敛为 summary 与 financial-projection 两个只读端点（清单 §3.2）。卖家投放提交仍使用现有 `POST /api/seller-portal/demand-batches`；该 Seller body 不再接受 `open_at`、`reservation_deadline`、`order_deadline`，窗口由服务端版本化策略生成。

阶段 6.6（D-056）收敛说明：汇率/卖家服务费/本金汇率策略改为单次保存、即时生效；`rate-center/base-rates`、`seller-service-fees`、`seller-principal-rate-policies/save` 三个保存端点取代原有的 submit/confirm/reject/apply-defaults 双审批路由（被删除路由一律返回 404）。

阶段 4（D-054）收敛说明：marketplace 运行时合同只接受 AMAZON_JP / AMAZON_US / COUPANG_KR（历史 'JP' 短码只存在于阶段 6 历史导入映射层）；获客只保留人工面（渠道、咨询、Prospect、Lead、负责员工、有审计的人工纠正），funnel / handoffs / reporting-config / acquisition-daily 机器维度已删除；被删除路由一律返回 404，不保留兼容别名。

验证器以运行时 `app.routes` 的连续 METHOD/PATH 注册块去重后与本表核对；同一路由的 middleware 不增加端点数，重复的非连续注册会失败。任何 `/api/v2/*` 别名、未注册路径或 route count 变化都必须经过合同更新与复核。

## GET

```text
GET /api/buyer-auth/invitations/:token
GET /api/buyer-portal/demands
GET /api/buyer-portal/demands/:id
GET /api/buyer-portal/file-read-intents/:id/content
GET /api/buyer-portal/formal-orders
GET /api/buyer-portal/formal-orders/:id
GET /api/buyer-portal/me
GET /api/buyer-portal/order-evidence
GET /api/buyer-portal/order-evidence/:id
GET /api/buyer-portal/order-evidence/eligible-reservations
GET /api/buyer-portal/refunds
GET /api/buyer-portal/refunds/:id
GET /api/buyer-portal/reservations
GET /api/buyer-portal/reservations/:id
GET /api/buyer-portal/reservations/:id/order-instruction
GET /api/buyer-portal/reservations/:id/order-instruction/state
GET /api/buyer-portal/reviews
GET /api/buyer-portal/reviews/:id
GET /api/buyer-portal/reviews/eligible-orders
GET /api/customer-auth/session
GET /api/seller-auth/invitations/:token
GET /api/seller-auth/member-invitations/:token
GET /api/seller-portal/demand-batches
GET /api/seller-portal/demand-batches/:id
GET /api/seller-portal/file-read-intents/:id/content
GET /api/seller-portal/formal-orders
GET /api/seller-portal/formal-orders/:id
GET /api/seller-portal/formal-orders/:id/communication-screenshots
GET /api/seller-portal/me
GET /api/seller-portal/member-invitations
GET /api/seller-portal/members
GET /api/seller-portal/product-applications
GET /api/seller-portal/product-applications/:id
GET /api/seller-portal/products
GET /api/seller-portal/products/:id
GET /api/seller-portal/products/:id/versions
GET /api/seller-portal/reviews
GET /api/seller-portal/reviews/:id
GET /api/seller-portal/settlement/payables
GET /api/seller-portal/settlement/payables/:id
GET /api/seller-portal/settlement/payments
GET /api/seller-portal/settlement/payments/:id
GET /api/seller-portal/settlement/summary
GET /api/seller-portal/stores
GET /api/staff-auth/session
GET /api/staff/access-management
GET /api/staff/access-management/buyer-assignments
GET /api/staff/access-management/personal-denies
GET /api/staff/access-management/seller-organization-assignments
GET /api/staff/admin-business-dashboard/summary
GET /api/staff/buyer-advance-principal/:formalOrderId
GET /api/staff/buyer-refunds
GET /api/staff/buyer-refunds/:id
GET /api/staff/catalog/products
GET /api/staff/catalog/products/:id
GET /api/staff/customer-identity-resolution/candidates
GET /api/staff/customer-identity-resolution/cases
GET /api/staff/customer-onboarding/lookup
GET /api/staff/customer-onboarding/seller-directory
GET /api/staff/customer-security/buyer-invitations/:id
GET /api/staff/customer-security/seller-invitations/:id
GET /api/staff/customer-security/seller-invitations/current
GET /api/staff/demand-batches/:id/reservation-schedule
GET /api/staff/demand-batches/:id/review-context
GET /api/staff/file-read-intents/:id/content
GET /api/staff/finance/cash-flow
GET /api/staff/finance/exceptions
GET /api/staff/finance/groups
GET /api/staff/finance/orders
GET /api/staff/finance/orders/:formalOrderId
GET /api/staff/finance/summary
GET /api/staff/formal-orders/:id
GET /api/staff/formal-orders
GET /api/staff/formal-orders/:id/communication-screenshots
GET /api/staff/me/assignments
GET /api/staff/me/work-items
GET /api/staff/me/work-items/:id
GET /api/staff/operations/archive/bundles
GET /api/staff/operations/archive/metrics
GET /api/staff/operations/health
GET /api/staff/order-evidence
GET /api/staff/order-evidence/:id
GET /api/staff/order-evidence/:id/preflight
GET /api/staff/order-instructions/:id
GET /api/staff/order-instructions/:id/versions
GET /api/staff/order-instructions/expiry-scan/state
GET /api/staff/product-applications/:id/review-context
GET /api/staff/production-readiness/recovery-attestations/latest
GET /api/staff/rate-center
GET /api/staff/reservations/:id/review-context
GET /api/staff/reviews/:id
GET /api/staff/reviews/:id/evidence-versions
GET /api/staff/reviews/:id/visibility
GET /api/staff/search
GET /api/staff/seller-principal-rate-policies
GET /api/staff/seller-service-fees
GET /api/staff/seller-settlements/:organizationId/payables
GET /api/staff/seller-settlements/:organizationId/payables/:payableId
GET /api/staff/seller-settlements/:organizationId/payments
GET /api/staff/seller-settlements/:organizationId/payments/:paymentId
GET /api/staff/seller-settlements/:organizationId/reconciliation/conflicts
GET /api/staff/seller-settlements/:organizationId/summary
GET /health
GET /ready
```

## PATCH

```text
PATCH /api/buyer-portal/me/refund-account
PATCH /api/seller-portal/me/settlement-account
PATCH /api/staff/seller-payments/:paymentId/paid-at
```

## POST

```text
POST /api/buyer-auth/register
POST /api/buyer-portal/demands/:id/reservations
POST /api/buyer-portal/file-read-intents/batch
POST /api/buyer-portal/file-upload-intents/:id/complete
POST /api/buyer-portal/file-uploads/order-evidence/intents
POST /api/buyer-portal/file-uploads/review-evidence/intents
POST /api/buyer-portal/files/:fileObjectId/read-intents
POST /api/buyer-portal/order-evidence
POST /api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent
POST /api/buyer-portal/order-evidence/:id/resubmit
POST /api/buyer-portal/order-evidence/:id/withdraw
POST /api/buyer-portal/refunds/:id/remind
POST /api/buyer-portal/reservations/:id/cancel
POST /api/buyer-portal/reservations/:id/order-instruction/images/:position/read-intent
POST /api/buyer-portal/reviews
POST /api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent
POST /api/buyer-portal/reviews/:id/resubmit
POST /api/buyer-portal/reviews/:id/withdraw
POST /api/customer-auth/buyer/login
POST /api/customer-auth/change-password
POST /api/customer-auth/logout
POST /api/customer-auth/password-reset/complete
POST /api/customer-auth/seller/login
POST /api/seller-auth/member-register
POST /api/seller-auth/register
POST /api/seller-portal/demand-batches
POST /api/seller-portal/demand-batches/:id/withdraw
POST /api/seller-portal/file-read-intents/batch
POST /api/seller-portal/file-upload-intents/:id/complete
POST /api/seller-portal/file-uploads/product-application-images/intents
POST /api/seller-portal/files/:fileObjectId/read-intents
POST /api/seller-portal/formal-orders/:id/communication-screenshots/:fileObjectId/read-intent
POST /api/seller-portal/member-invitations
POST /api/seller-portal/member-invitations/:id/revoke
POST /api/seller-portal/product-applications
POST /api/seller-portal/product-applications/:id/withdraw
POST /api/seller-portal/reviews/:id/files/:fileLinkId/read-intent
POST /api/seller-portal/stores
POST /api/staff-auth/access/bootstrap
POST /api/staff-auth/logout
POST /api/staff-auth/logout-all
POST /api/staff/access-management/buyer-assignments
POST /api/staff/access-management/buyer-pre-sales-assignments
POST /api/staff/access-management/employees
POST /api/staff/access-management/employees/:id/status
POST /api/staff/access-management/employees/:id/update
POST /api/staff/access-management/personal-denies
POST /api/staff/access-management/personal-denies/revoke
POST /api/staff/access-management/seller-organization-assignments/:id/manager
POST /api/staff/buyer-customers
POST /api/staff/buyer-advance-principal/:formalOrderId/payments
POST /api/staff/buyer-advance-principal/:formalOrderId/payments/:paymentId/reversals
POST /api/staff/buyer-refunds/:id/payments
POST /api/staff/buyer-refunds/:id/payments/:paymentEntryId/reversals
POST /api/staff/buyers/:id/marketplace-correction
POST /api/staff/catalog/product-versions/:versionId/main-image
POST /api/staff/catalog/products
POST /api/staff/catalog/products/:id/versions
POST /api/staff/customer-identity-resolution/cases
POST /api/staff/customer-identity-resolution/cases/:id/resolve
POST /api/staff/customer-onboarding/:customerType/:subjectId/change-wechat
POST /api/staff/customer-onboarding/:customerType/:subjectId/password-reset
POST /api/staff/customer-onboarding/buyer-registration-invitations
POST /api/staff/customer-security/buyer-invitations
POST /api/staff/customer-security/buyer-invitations/:id/revoke
POST /api/staff/customer-security/password-resets
POST /api/staff/customer-security/seller-invitations
POST /api/staff/customer-security/seller-invitations/:id/revoke
POST /api/staff/demand-batches/:id/review
POST /api/staff/demand-batches/:id/schedule/confirm
POST /api/staff/demand-batches/:id/schedule/preview
POST /api/staff/file-read-intents/batch
POST /api/staff/file-upload-intents/:id/complete
POST /api/staff/file-uploads/buyer-refund-proofs/intents
POST /api/staff/file-uploads/product-images/intents
POST /api/staff/file-uploads/seller-settlement-proofs/intents
POST /api/staff/files/:fileObjectId/read-intents
POST /api/staff/finance/exports/csv
POST /api/staff/formal-orders/:id/communication-screenshots
POST /api/staff/formal-orders/:id/communication-screenshots/intents
POST /api/staff/operations/alerts/ack
POST /api/staff/operations/archive/bundles/:id/restore
POST /api/staff/operations/archive/orders/:id/close
POST /api/staff/operations/archive/orders/:id/reopen
POST /api/staff/operations/jobs/:job/retry
POST /api/staff/order-evidence/:id/approve
POST /api/staff/order-evidence/:id/request-changes
POST /api/staff/order-instructions/:id/cancel
POST /api/staff/order-instructions/:id/publish
POST /api/staff/order-instructions/expiry-scan/run
POST /api/staff/order-instructions/reconciliation/run
POST /api/staff/order-integrity/:id/events
POST /api/staff/order-integrity/:id/financial-adjustments
POST /api/staff/product-applications/:id/review
POST /api/staff/production-readiness/operational-alert-attestations
POST /api/staff/production-readiness/recovery-attestations
POST /api/staff/products/:id/primary-contact
POST /api/staff/rate-center/base-rates
POST /api/staff/reservations/:id/decision
POST /api/staff/reservations/:id/reopen
POST /api/staff/reservations/participation-exceptions
POST /api/staff/reviews/:id/approve
POST /api/staff/reviews/:id/reject
POST /api/staff/reviews/:id/request-changes
POST /api/staff/reviews/:id/visibility
POST /api/staff/seller-allocations/:allocationId/reallocate
POST /api/staff/seller-allocations/:allocationId/reverse
POST /api/staff/seller-payments/:paymentId/allocations
POST /api/staff/seller-payments/:paymentId/proof/read-intent
POST /api/staff/seller-payments/:paymentId/reverse
POST /api/staff/seller-principal-rate-policies/save
POST /api/staff/seller-service-fees
POST /api/staff/seller-settlements/:organizationId/payments
POST /api/staff/seller-settlements/:organizationId/reconciliation
```

## PUT

```text
PUT /api/buyer-portal/file-uploads/:fileObjectId/content
PUT /api/seller-portal/file-uploads/:fileObjectId/content
PUT /api/staff/file-uploads/:fileObjectId/content
```
