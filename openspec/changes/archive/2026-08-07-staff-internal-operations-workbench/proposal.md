# Change Proposal: Staff Internal Operations Workbench

## Why

The baseline has a trusted Staff session and mature permission, assignment, order-evidence, review, Buyer-refund, Seller-settlement and protected-file services, but the Staff web route is still a static shell. Operators cannot complete the real queue → detail → controlled action loop from the production React application. Existing Staff frontend code also lacks strict runtime DTO validation, stable work-item cursor traversal and a safe review-file projection.

## What Changes

- Replace the static Staff shell with a Chinese internal operations workbench driven only by authoritative Staff APIs.
- Add strict Staff runtime schemas, Staff-rooted query keys, bounded cursor queues, partial-failure recovery and request-ID reporting.
- Orchestrate existing controlled commands for order evidence, review decisions, Buyer invitation/recovery, Buyer refunds and Seller principal/service-fee settlement without duplicating domain services.
- Add only the read-contract prerequisites needed by the workbench: stable cursor traversal for work items and safe file-version metadata for dynamically authorized review evidence reads.
- Preserve current server-side permission, Personal DENY, scope, concealed-404, idempotency, expected-version, audit and file-audience enforcement.

## Scope

- All ACTIVE Staff may enter the protected shell; route and action availability remain server-authoritative.
- Queue filters cover status and work type using stable opaque cursors. A selected work item resolves its existing domain detail when a supported authority route exists and otherwise truthfully shows the authoritative work-item metadata with no invented action.
- Order evidence and review details expose customer-visible and internal content separately and invoke existing approve/request-changes/reject commands.
- Buyer refund details preserve CNY-fen integer strings, payment/reversal history and existing proof lifecycle. Seller settlement views keep principal and service fee independent in summary, payable, payment, action and proof displays.
- Buyer invitation issue/read/revoke and password recovery reuse M3 security contracts. The UI never asks Staff to choose or view a Customer password and never stores one-time links or tokens in persistent browser state.
- Protected images continue through purpose-bound, audience-bound, dynamically authorized short read intents; no R2 key, arbitrary file URL or permanent token is exposed.
- Marketplace context is derived from returned facts: Amazon JP and Amazon US are active capabilities, while Korea remains explicitly disabled/unavailable.

## Non-Goals

- No new financial, review, order, assignment or customer-identity state machine.
- No direct Buyer registration, real payment/bank integration, external notification, private-WeChat automation or use of chat as a database.
- No Feishu POC, task-summary sync, Google Drive archive, scheduled job, monitor, MCP/Agent, production deploy, domain, real credential or production database operation.
- No Staff identity redesign in this Change. The workbench consumes the existing independent internal Staff Session and does not use Buyer/Seller Customer authority or client-supplied Feishu identity.
- No speculative Migration. Schema 0030 already contains the required authoritative facts; the two read-contract additions are projections over existing columns.
- No Korea workflow or invented Coupang validation.

## Security, Privacy and Financial Impact

Every request uses the Staff identity transport. The backend recomputes ACTIVE status, roles, permissions, Personal DENY, leader packages and data scope. Missing action permission may return 403; an existing but out-of-scope resource returns 404. DTO schemas are strict and reject secret/storage fields. Buyer payments may be JPY/USD/KRW minor-unit strings; Buyer refunds, Seller principal and Seller service fee remain CNY-fen strings and are never converted through floating point. Principal and service fee remain separate facts.

## Migration and Rollback

No Migration is required: work-item cursor fields derive from existing `(created_at,id)` ordering and review file version already exists on `file_objects`. Rollback is a Web/API artifact rollback that removes additive read fields/cursor support while leaving all D1 business, audit, idempotency and financial facts untouched. Once a deployed client depends on additive response fields, prefer a forward compatibility repair rather than removing them.

## Acceptance

The Change must pass target and repository strict OpenSpec validation before implementation, then full repository checks, empty/upgrade D1 validation, Staff permission/scope/404 tests, DTO leak tests, replay/version/financial/file tests, complete Playwright, deterministic desktop/narrow screenshots, Formal Verify, secrets scan and the documented React Router dependency baseline. Ponytail remains off. Delivery stops at a PR because author self-review is not independent approval.
