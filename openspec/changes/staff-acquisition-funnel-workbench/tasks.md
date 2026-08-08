# Tasks: Staff Acquisition Funnel Workbench

## 0. Dependency and Decisions

- [ ] 0.1 Wait for four-role consolidation to reach `origin/main`; assert the new schema and reserve only the then-next Migration.
- [x] 0.2 Freeze owner-confirmed definitions for consultation de-duplication, no-reservation 未参加, Seller cooperation, Buyer-origin profit attribution and 12-month unconverted-lead retention.
- [ ] 0.3 Inventory Customer WeChat normalization, invitation, Seller activation, reservation, formal-order and finance facts used for linking.

## 1. Migration

- [ ] 1.1 Add channel, Staff-channel effective assignment, daily consultation, lead, link, follow-up/retention and event tables with strict constraints/indexes.
- [ ] 1.2 Add permissions and role defaults for owner, pre_sales and seller_ops; explicitly exclude buyer_refund.
- [ ] 1.3 Add safe upgrade, no-partial-DDL assertions, backup/restore and forward-recovery evidence.

## 2. Contracts and Domain

- [ ] 2.1 Define exact commands/DTOs, Beijing business dates, cursor pagination, masked identity fields and stable error codes.
- [ ] 2.2 Implement server-side channel resolution, per-type active-lead uniqueness, duplicate detection, versioned correction and immutable origin attribution.
- [ ] 2.3 Implement idempotent automatic links to registration, reservations, formal orders, Seller cooperation and finance read models.
- [ ] 2.4 Implement the 12-month unconverted-lead anonymization Job with exemptions, audit and retry-safe boundaries.

## 3. API and Web

- [ ] 3.1 Add owner channel/daily-count administration and scoped Buyer/Seller lead APIs.
- [ ] 3.2 Add integrated workbench navigation and stable `/staff/acquisition` route without accepting client authority fields.
- [ ] 3.3 Provide Chinese mobile/desktop forms, validation, empty/error states and correction history.

## 4. Tests and Verification

- [ ] 4.1 Cover role/scope/DENY, missing/conflicting channel config, duplicate WeChat, cross-day conversion and Beijing boundaries.
- [ ] 4.2 Cover idempotency, version conflicts, corrections, auto-linking, no double profit attribution, privacy projection and retention anonymization/exemptions.
- [ ] 4.3 Run full D1, auth, finance, browser, secrets, typecheck, build and rollback gates.
- [ ] 4.4 Run OpenSpec strict and implementation Verify; sync/archive only after controller acceptance.
