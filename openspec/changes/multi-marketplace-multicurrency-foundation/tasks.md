# Tasks: Multi-Marketplace and Multi-Currency Foundation

## 0. Governance

- [ ] 0.1 Inventory every JP/JPY/Amazon field, CHECK, index, trigger, contract, route and UI dependency.
- [ ] 0.2 Freeze exact Marketplace codes, currency exponents, rounding rules and migration order without opening real US/KR resources.

## 1. Migration

- [ ] 1.1 Allocate the next consecutive Migration only after this Change is the sole Schema writer.
- [ ] 1.2 Add Marketplace registry and migrate Seller Organization/Store/Buyer ownership with row and relationship assertions.
- [ ] 1.3 Migrate money, rate, fee and formal snapshot facts to currency-explicit structures without mutating completed facts.
- [ ] 1.4 Rebuild all affected triggers, views, unique keys and indexes; add fresh/upgrade/rollback-manifest verifiers.

## 2. Contracts and Domain

- [ ] 2.1 Add Marketplace, Currency, Money, Rate and Fee contracts with runtime validation.
- [ ] 2.2 Add platform-neutral identifiers and explicit Marketplace Adapter errors.
- [ ] 2.3 Implement BigInt conversion, exponent and rounding tests for JPY/KRW/USD/CNY.

## 3. API and Authorization

- [ ] 3.1 Remove Seller Organization single-market rejection and keep Store/Organization scope enforcement.
- [ ] 3.2 Add owner-only Buyer Marketplace correction with no-formal-facts guard, idempotency, version and Audit.
- [ ] 3.3 Update order/rate/fee commands and DTOs to lock Marketplace, currency and version snapshots.

## 4. Tests and Acceptance

- [ ] 4.1 Pass JP regression plus anonymous Amazon US and unavailable Coupang KR Adapter tests.
- [ ] 4.2 Pass Buyer single-market, Seller multi-store/multi-market, cross-organization and DTO isolation tests.
- [ ] 4.3 Pass financial replay, rounding, snapshot, correction rejection and Migration integrity tests.
- [ ] 4.4 Run local D1 fresh/upgrade/restore rehearsal, workspace gates, strict OpenSpec validation and formal Verify.

## 5. Rollback and Release

- [ ] 5.1 Produce explicit pre-write rollback and post-new-currency forward-recovery playbooks.
- [ ] 5.2 Keep all remote writes, real site enablement, Integration, main and deployment separately authorized.
