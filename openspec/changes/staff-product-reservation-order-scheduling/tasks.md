# Tasks: Staff Product Reservation Order Scheduling

## 0. Baseline and Serialization

- [ ] 0.1 Re-read current product-version, demand, reservation, order-evidence, formal-order, Staff permission and Scope contracts.
- [ ] 0.2 Assert `origin/main`, current schema and all active Migration Changes; wait for the current Migration writer and reserve only the then-next number.
- [ ] 0.3 Freeze legacy-demand handling and prove no schedule is fabricated for unconfigured rows.

## 1. Migration

- [ ] 1.1 Add product-version cadence defaults and immutable/versioned demand schedule facts with strict positive-integer, date, version and actor constraints.
- [ ] 1.2 Preserve all legacy products, product versions, demands, reservations, events and order facts; add required indexes and row-count assertions.
- [ ] 1.3 Verify fresh install, prior→next upgrade, wrong order, repeat, partial DDL, backup restore and forward recovery.

## 2. Contracts and Domain

- [ ] 2.1 Define exact Staff product list/detail, schedule preview/confirm and reservation-ranking DTOs with cursor bounds, `data_as_of` and `Asia/Shanghai` date semantics.
- [ ] 2.2 Implement and unit-test the pure rank/date formula for 1-day/1-order, 1-day/2-order, 2-day/1-order, tie IDs, invalid exits and boundary dates.
- [ ] 2.3 Extend product-version normalization and demand publication validation without accepting client-authoritative rank or planned date.
- [ ] 2.4 Validate the last theoretical target slot against order deadline and preserve actual order/evidence facts independently.

## 3. API and Authorization

- [ ] 3.1 Add bounded Staff product list/detail and product-demand reservation schedule reads using existing indexes.
- [ ] 3.2 Extend product version creation for default cadence and add demand schedule preview/confirm with expected_version, preview hash, Idempotency-Key, Audit and Outbox.
- [ ] 3.3 Enforce owner/seller_ops edit, pre_sales scoped read, buyer_refund denial, Personal DENY, Seller Organization/Store Scope and Buyer identity field projection.
- [ ] 3.4 Prove Buyer/Seller APIs expose no queue rank, other-Buyer fact, internal planned date or Staff data.

## 4. Staff Web

- [ ] 4.1 Add permission-aware, bookmarkable Chinese product library, product detail and reservation detail routes.
- [ ] 4.2 Add cadence/default and first-order-date forms with readable summaries, exact validation, server preview and explicit affected-date confirmation.
- [ ] 4.3 Display total quota, effective reservation count, stable rank, reservation time, planned date and status across desktop/mobile, including loading/empty/error/conflict states.

## 5. Tests and Verification

- [ ] 5.1 Cover queue ordering, same-millisecond tie, reopen, reject/cancel/expire compaction, schedule changes, idempotent replay, stale version and preview mismatch.
- [ ] 5.2 Cover all calendar days across weekends, public-holiday dates, month/year/leap-day boundaries and Beijing/UTC crossings without a holiday service.
- [ ] 5.3 Cover owner/seller_ops/pre_sales/buyer_refund, Scope, Personal DENY, direct-call denial and Buyer/Seller DTO privacy.
- [ ] 5.4 Run full D1, authorization, reservation, order, finance, browser, accessibility, secrets, typecheck, build and rollback gates.
- [ ] 5.5 Run OpenSpec strict and implementation Verify; sync/archive only after controller acceptance.

## 6. Rollback

- [ ] 6.1 Rehearse Web/API rollback and database restore/forward recovery without deleting schedule versions, reservation order, actual orders or audit evidence.
