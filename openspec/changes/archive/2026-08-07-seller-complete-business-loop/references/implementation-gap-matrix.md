# Seller Implementation Gap Matrix

| Area | Implemented at baseline | Verified gap | M4 scope | Explicitly not done |
| --- | --- | --- | --- | --- |
| Identity | Customer Session, Seller Persona resolver, dual-persona account model | Seller placeholder UI does not expose safe persona/account flow | Protected Seller shell and persona-safe cache/session behavior | Staff identity redesign |
| Organization/Stores | Global Organization foundation, Store grants and scope helpers | Seller `me` and DTOs still expose organization-level JP assumption; no UI context switch | Authorized Store/Marketplace context, multi-store isolation | Seller in two organizations |
| Catalog/Demand | Seller APIs, idempotent submit/withdraw and tests | No production Seller pages; JP-only DTO fields | Chinese list/detail/forms and generic Marketplace display | New marketplace workflow |
| Formal orders | Immutable snapshots and Seller read API | JP/Amazon field names; no aggregate completion | Generic compatibility projection and completion components | Editing confirmed order |
| Reviews | Seller-safe review and evidence read intent | No Seller UI; no completion integration | Review list/detail/evidence and completion projection | Seller review approval |
| Principal | Separate payable/payment/allocation/reversal ledger | No frontend; no order progress projection | Read-only CNY amount/status/proof display | Seller confirms payment |
| Service fee | Separate accrual/payable/payment ledger | No frontend; risk of visually combining facts | Independent CNY amount/status/proof display | Merge with principal |
| Buyer refund | Buyer/Staff refund ledger and Buyer-safe API | Seller must not see amount/proof but completion needs truth | Server-only component status with no sensitive Buyer fields | Seller reads refund details |
| Rates | Versioned Seller org+currency rates; immutable order snapshots | Seller-safe contract is JP-only and no UI | Read-only generic snapshot plus JP compatibility | Seller rate mutation |
| Files | Staff-only explicit audience grants and short read intents | Seller proof access would violate the current INTERNAL_ONLY audience | Preserve Staff-only read flow; verify association/audit and Seller denial | Permanent URL/object key/archive |
| UI | Vite/React foundation and Seller placeholder shell | Entire business loop is placeholder | Full Chinese mobile/accessibility Seller workspace | Real domain/DNS |
| Operations | Full local gates and dependency risk disposition | No M4 verifier/runbook/evidence | Add M4 checks and rollback evidence | Deploy/online writes |
