# Tasks: Seller Complete Business Loop

## 1. Migration

- [x] 1.1 Audit schema 0029/0030 and record why no Migration is required.
- [x] 1.2 Run empty/upgrade local D1 chain, foreign-key checks and rollback runbook verification.

## 2. Contracts

- [x] 2.1 Add generic Marketplace/currency/order/rate compatibility fields to Seller-safe contracts.
- [x] 2.2 Add independent four-component business-completion contract and strict runtime schemas.
- [x] 2.3 Preserve JP fields and Buyer/Staff endpoint compatibility.

## 3. Domain and Services

- [x] 3.1 Implement pure completion-state aggregation without floating point.
- [x] 3.2 Extend Seller read projections for generic snapshots, organization/store isolation and completion truth.
- [x] 3.3 Preserve existing idempotent/versioned Seller mutations and immutable finance facts.

## 4. API

- [x] 4.1 Extend Seller formal-order responses and consume existing `me`, Store and settlement responses without exposing forbidden fields.
- [x] 4.2 Confirm existing proofs are Staff-only, dynamically authorized and intentionally absent from Seller DTOs.
- [x] 4.3 Verify concealed 404, cross-Persona rejection and no Seller write routes for rate/finance/completion.

## 5. Web

- [x] 5.1 Build Seller runtime schemas, API client and persona/store-scoped Query keys.
- [x] 5.2 Build organization/store/Marketplace context and Chinese dashboard.
- [x] 5.3 Build product/demand, formal-order/review and settlement pages over existing APIs.
- [x] 5.4 Preserve Staff-only proof viewing; build account/password and truthful Seller state/progress displays.
- [x] 5.5 Complete mobile, Beijing-time and accessibility behavior.

## 6. Tests

- [x] 6.1 Cover completion truth table, CNY precision, rate snapshot immutability and JP compatibility.
- [x] 6.2 Cover organization/store isolation, cross-Persona denial, DTO privacy and file audiences.
- [x] 6.3 Preserve and run idempotent replay/conflict, version conflict, partial failure and runtime contract tests.
- [x] 6.4 Run full repository, D1, browser and deterministic visual regression suites.

## 7. Verification and Rollback

- [x] 7.1 Run strict target/all OpenSpec, Formal Verify, secrets scan and dependency baseline verification.
- [x] 7.2 Record rollback/runbook evidence and confirm no production auto-deploy workflow is present.
- [x] 7.3 Sync/archive only after implementation consistency is complete; keep Ponytail off.

## 8. Delivery

- [ ] 8.1 Commit a clean Feature tree, push without force and create PR.
- [ ] 8.2 Advance Integration/main only if separately required governance conditions are demonstrably green.
- [ ] 8.3 Report the exact M5 `origin/main` baseline and remaining risks.
