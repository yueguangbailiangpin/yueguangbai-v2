# Tasks: Seller Portal Self-Service Submissions

## 0. Baseline and Migration

- [ ] 0.1 Inventory Seller Portal POST/withdraw contracts, roles, stores, products, files and error maps.
- [ ] 0.2 Prove `NO_SCHEMA_CHANGE`; stop for a separate Change if a required fact is missing.

## 1. Contracts and Adapters

- [ ] 1.1 Add exact runtime schemas and first-party adapters for existing product-application and demand-batch mutations.
- [ ] 1.2 Reuse frozen idempotency authority, request hashing, version/state conflict and query invalidation behavior.

## 2. Web

- [ ] 2.1 Add permission-aware Seller navigation and stable routes for product application and demand submission.
- [ ] 2.2 Implement Chinese, accessible forms with verified file upload and Store/Product scoping.
- [ ] 2.3 Implement validation, partial upload recovery, ambiguous retry and success-detail navigation.

## 3. Tests and Verification

- [ ] 3.1 Test OWNER/OPERATIONS success and FINANCE/VIEWER/cross-Store denial.
- [ ] 3.2 Test exact payloads, idempotent replay, changed-body new key, stale version/state, file failure and duplicate submission.
- [ ] 3.3 Run typecheck, unit/API/browser tests, full regression, secrets scan and build.
- [ ] 3.4 Run OpenSpec strict and implementation Verify; sync/archive only after controller acceptance.

## 4. Rollback

- [ ] 4.1 Prove Web rollback preserves every committed application, demand, file, audit and outbox fact.
