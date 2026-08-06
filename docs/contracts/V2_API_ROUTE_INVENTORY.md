# V2 API Route Inventory

这是默认 App 在 `origin/main` 基线 `fa12ae29905c03fd7ec35d95bf3e6fc00d832f67` 的可复现 route inventory。共有 139 个唯一业务/健康端点：138 个 `/api/*` 端点和 1 个 `/health`。参数占位符使用 Hono 注册表的 `:name` 形式。

验证器以运行时 `app.routes` 的连续 METHOD/PATH 注册块去重后与本表精确比较；同一路由的 middleware 不增加端点数，重复的非连续注册会失败。任何 `/api/v2/*` 别名、未注册路径或 route count 变化都会失败。

## GET

```text
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
GET /api/seller-portal/demand-batches
GET /api/seller-portal/demand-batches/:id
GET /api/seller-portal/file-read-intents/:id/content
GET /api/seller-portal/formal-orders
GET /api/seller-portal/formal-orders/:id
GET /api/seller-portal/me
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
GET /api/staff-auth/feishu/callback
GET /api/staff-auth/session
GET /api/staff/assignment-fallbacks/:marketplaceCode
GET /api/staff/buyer-refunds
GET /api/staff/buyer-refunds/:id
GET /api/staff/file-read-intents/:id/content
GET /api/staff/finance/cash-flow
GET /api/staff/finance/exceptions
GET /api/staff/finance/groups
GET /api/staff/finance/orders
GET /api/staff/finance/orders/:formalOrderId
GET /api/staff/finance/summary
GET /api/staff/me/assignments
GET /api/staff/me/work-items
GET /api/staff/me/work-items/:id
GET /api/staff/order-evidence
GET /api/staff/order-evidence/:id
GET /api/staff/order-instructions/:id
GET /api/staff/order-instructions/:id/assets/:batchId
GET /api/staff/order-instructions/:id/versions
GET /api/staff/order-instructions/expiry-scan/state
GET /api/staff/reassignment-batches/:id
GET /api/staff/reviews/:id
GET /api/staff/reviews/:id/evidence-versions
GET /api/staff/seller-settlements/:organizationId/payables
GET /api/staff/seller-settlements/:organizationId/payables/:payableId
GET /api/staff/seller-settlements/:organizationId/payments
GET /api/staff/seller-settlements/:organizationId/payments/:paymentId
GET /api/staff/seller-settlements/:organizationId/reconciliation/conflicts
GET /api/staff/seller-settlements/:organizationId/summary
GET /health
```

## PATCH

```text
PATCH /api/staff/me/availability
PATCH /api/staff/seller-payments/:paymentId/paid-at
```

## POST

```text
POST /api/buyer-auth/register
POST /api/buyer-portal/demands/:id/reservations
POST /api/buyer-portal/file-upload-intents/:id/complete
POST /api/buyer-portal/file-uploads/order-evidence/intents
POST /api/buyer-portal/file-uploads/review-evidence/intents
POST /api/buyer-portal/files/:fileObjectId/read-intents
POST /api/buyer-portal/order-evidence
POST /api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent
POST /api/buyer-portal/order-evidence/:id/resubmit
POST /api/buyer-portal/order-evidence/:id/withdraw
POST /api/buyer-portal/reservations/:id/cancel
POST /api/buyer-portal/reservations/:id/order-instruction/images/:position/read-intent
POST /api/buyer-portal/reviews
POST /api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent
POST /api/buyer-portal/reviews/:id/resubmit
POST /api/buyer-portal/reviews/:id/withdraw
POST /api/customer-auth/change-password
POST /api/customer-auth/login
POST /api/customer-auth/logout
POST /api/seller-portal/demand-batches
POST /api/seller-portal/demand-batches/:id/withdraw
POST /api/seller-portal/file-upload-intents/:id/complete
POST /api/seller-portal/file-uploads/product-application-images/intents
POST /api/seller-portal/files/:fileObjectId/read-intents
POST /api/seller-portal/product-applications
POST /api/seller-portal/product-applications/:id/withdraw
POST /api/seller-portal/reviews/:id/files/:fileLinkId/read-intent
POST /api/staff-auth/login/start
POST /api/staff-auth/logout
POST /api/staff-auth/logout-all
POST /api/staff/assignments/reassign
POST /api/staff/buyer-refunds/:id/payments
POST /api/staff/buyer-refunds/:id/payments/:paymentEntryId/reversals
POST /api/staff/catalog/products
POST /api/staff/catalog/products/:id/versions
POST /api/staff/demand-batches/:id/review
POST /api/staff/file-upload-intents/:id/complete
POST /api/staff/file-uploads/buyer-refund-proofs/intents
POST /api/staff/file-uploads/seller-settlement-proofs/intents
POST /api/staff/files/:fileObjectId/read-intents
POST /api/staff/finance/exports/csv
POST /api/staff/order-evidence/:id/approve
POST /api/staff/order-evidence/:id/internal-communication-files
POST /api/staff/order-evidence/:id/request-changes
POST /api/staff/order-instructions/:id/assets/prepare
POST /api/staff/order-instructions/:id/cancel
POST /api/staff/order-instructions/:id/publish
POST /api/staff/order-instructions/assets/reconciliation/run
POST /api/staff/order-instructions/expiry-scan/run
POST /api/staff/order-instructions/reconciliation/run
POST /api/staff/product-applications/:id/review
POST /api/staff/reassignment-batches
POST /api/staff/reassignment-batches/:id/run
POST /api/staff/reviews/:id/approve
POST /api/staff/reviews/:id/reject
POST /api/staff/reviews/:id/request-changes
POST /api/staff/seller-allocations/:allocationId/reallocate
POST /api/staff/seller-allocations/:allocationId/reverse
POST /api/staff/seller-payments/:paymentId/allocations
POST /api/staff/seller-payments/:paymentId/proof/read-intent
POST /api/staff/seller-payments/:paymentId/reverse
POST /api/staff/seller-settlements/:organizationId/payments
POST /api/staff/seller-settlements/:organizationId/reconciliation
POST /api/staff/work-items/:id/reassign
```

## PUT

```text
PUT /api/buyer-portal/file-uploads/:fileObjectId/content
PUT /api/seller-portal/file-uploads/:fileObjectId/content
PUT /api/staff/assignment-fallbacks/:marketplaceCode
PUT /api/staff/file-uploads/:fileObjectId/content
```

## 合同与分页索引

| 范围 | 权威 path/DTO | 分页事实 |
| --- | --- | --- |
| Buyer Portal | `packages/contracts/src/buyer-portal.ts` 及各 Buyer Portal Contract | `limit` + `next_cursor` |
| Buyer evidence/formal order/refund/review | 对应 `packages/contracts/src/*portal.ts` | `items` + `next_cursor` |
| Seller Portal、formal orders、reviews | `seller-portal.ts`、`seller-formal-order-portal.ts`、`seller-review-portal.ts` | `page.limit` + `page.next_cursor`，仍为 cursor |
| Staff order evidence/refund | `staff-order-evidence.ts`、`staff-buyer-refund.ts` | `limit` + `cursor` 请求；`next_cursor` 响应 |
| Staff finance reports | `internal-finance.ts` | 受控例外：`page.limit` + `page.next_cursor` |
| File lifecycle | `file-http.ts` | 非列表；path constants 必须逐一注册 |

所有关键写操作继续使用既有认证、授权、幂等、版本、状态机和审计合同；本 Change 不修改 DTO、权限、业务语义或 route registration。
