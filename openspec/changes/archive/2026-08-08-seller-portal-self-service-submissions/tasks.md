# Tasks: Seller Portal Self-Service Submissions

## 0. Baseline and Migration

- [x] 0.1 Inventory Seller Portal POST/withdraw contracts, roles, stores, products, files and error maps.
- [x] 0.2 Prove `NO_SCHEMA_CHANGE`; existing file link and audience tables cover the approved contract.

## 1. Contracts and Adapters

- [x] 1.1 Add exact runtime schemas and first-party adapters for existing product-application and demand-batch mutations.
- [x] 1.2 Reuse frozen idempotency authority, request hashing, version/state conflict and query invalidation behavior.

## 2. Web

- [x] 2.1 Add permission-aware Seller navigation and stable routes for product application and demand submission.
- [x] 2.2 Implement Chinese, accessible forms with verified file upload and Store/Product scoping.
- [x] 2.3 Implement validation, partial upload recovery, ambiguous retry and success-detail navigation.

## 3. Tests and Verification

- [x] 3.1 Test OWNER/OPERATIONS success and FINANCE/VIEWER/cross-Store denial.
- [x] 3.2 Test exact payloads, idempotent replay, changed-body new key, stale version/state, file failure and duplicate submission.
- [x] 3.3 Run typecheck, unit/API/browser tests, full regression, secrets scan and build.
- [x] 3.4 Run OpenSpec strict and implementation Verify; sync/archive only after controller acceptance.

## 4. Rollback

- [x] 4.1 Prove Web rollback preserves every committed application, demand, file, audit and outbox fact.
