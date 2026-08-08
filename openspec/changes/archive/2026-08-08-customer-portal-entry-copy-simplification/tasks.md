# Tasks: Customer Portal Entry and Copy Simplification

## 0. Baseline and Migration

- [x] 0.1 Inventory login, Buyer, Seller, DTO, cache and browser-test callers on current `origin/main`.
- [x] 0.2 Record `NO_SCHEMA_CHANGE` evidence; if a schema fact is unexpectedly required, stop and create a separate migration-bearing Change.

## 1. Contracts and Read Models

- [x] 1.1 Bind login target to route and remove Persona input from the first-party login contract.
- [x] 1.2 Minimize Buyer profile/refund DTOs so hidden internal fields do not enter the browser without a formal need.
- [x] 1.3 Add or tighten the server-authoritative current-Buyer reservable product projection.

## 2. Web

- [x] 2.1 Apply the exact login copy and field removal for Buyer and Seller routes.
- [x] 2.2 Rename Buyer “任务” to “产品” and keep order materials, reviews and refunds on separate routes.
- [x] 2.3 Remove the frozen Buyer/Seller duplicate titles and internal explanations; use “返款金额” and “北京时间”.

## 3. Tests and Verification

- [x] 3.1 Cover route-bound dual-Persona login, cross-identity cache isolation and absence of a Persona selector.
- [x] 3.2 Cover Buyer product eligibility, empty states, stale capacity recheck and forbidden DTO fields.
- [x] 3.3 Run typecheck, unit/integration tests, full Chromium mobile/desktop/accessibility regression, secrets scan and build.
- [x] 3.4 Run OpenSpec strict and implementation Verify; sync/archive only after controller acceptance.

## 4. Rollback

- [x] 4.1 Prove rollback changes no Customer, order, reservation, review or financial fact.
