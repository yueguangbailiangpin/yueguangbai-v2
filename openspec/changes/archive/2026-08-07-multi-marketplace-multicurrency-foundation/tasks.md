# Tasks: Multi-Marketplace and Multi-Currency Foundation

## 0. Governance

- [x] 0.1 Inventory every JP/JPY/Amazon field, CHECK, index, trigger, contract, route and UI dependency.
- [x] 0.2 Freeze exact Marketplace codes, currency exponents, rounding rules and migration order without opening real US/KR resources.

## 1. Migration

- [x] 1.1 Allocate the next consecutive Migration only after this Change is the sole Schema writer.
- [x] 1.2 Add Marketplace registry and migrate Seller Organization/Store/Buyer ownership with row and relationship assertions.
- [x] 1.3 Migrate money, rate, fee and formal snapshot facts to currency-explicit structures without mutating completed facts.
- [x] 1.4 Rebuild all affected triggers, views, unique keys and indexes; add fresh/upgrade/rollback-manifest verifiers.

## 2. Contracts and Domain

- [x] 2.1 Add Marketplace, Currency, Money, Rate and Fee contracts with runtime validation.
- [x] 2.2 Add platform-neutral identifiers and explicit Marketplace Adapter errors.
- [x] 2.3 Implement BigInt conversion, exponent and rounding tests for JPY/KRW/USD/CNY.

## 3. API and Authorization

- [x] 3.1 Remove Seller Organization single-market rejection and keep Store/Organization scope enforcement.
- [x] 3.2 Add owner-only Buyer Marketplace correction with no-formal-facts guard, idempotency, version and Audit.
- [x] 3.3 Update order/rate/fee commands and DTOs to lock Marketplace, currency and version snapshots.

## 4. Tests and Acceptance

- [x] 4.1 Pass JP regression plus anonymous Amazon US and unavailable Coupang KR Adapter tests.
- [x] 4.2 Pass Buyer single-market, Seller multi-store/multi-market, cross-organization and DTO isolation tests.
- [x] 4.3 Pass financial replay, rounding, snapshot, correction rejection and Migration integrity tests.
- [x] 4.4 Run local D1 fresh/upgrade/restore rehearsal, workspace gates, strict OpenSpec validation and formal Verify.

## 5. Rollback and Release

- [x] 5.1 Produce explicit pre-write rollback and post-new-currency forward-recovery playbooks.
- [x] 5.2 Keep all remote writes, real site enablement, Integration, main and deployment separately authorized.
