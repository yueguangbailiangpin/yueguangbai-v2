# Migration 0069 Impact Inventory and Rebuild Design

Status: **OWNER CONFIRMED 2026-08-14**. This document is the authority for Migration 0069 implementation. The owner confirmed the complete inventory, zero-stock boundary, rebuild order, empty deployment window, and all nine required test categories. Confirmation does not authorize any production, staging, or remote-resource operation.

## 1. Schema 68 Source and Scope

Inventory source: a repository-local ephemeral SQLite database built sequentially from immutable migrations `0001` through `0068`, with `PRAGMA foreign_keys=ON`, followed by `sqlite_schema`, `pragma_foreign_key_list`, `pragma_table_info`, `integrity_check`, and `foreign_key_check` inspection. No production/staging/remote database or business data was read.

This migration retires only Seller Agreement Rate runtime/schema authority. It preserves Seller Principal Rate Policy, Buyer daily rates, Seller service fees, Seller Allocation, Outbox structure, platform-formal-order tables, and all unrelated facts.

## 2. Complete Direct Object Inventory

### 2.1 Legacy tables removed

| Table | Role | Direct inbound FK |
|---|---|---|
| `seller_agreement_rate_versions` | Original JP Seller agreement-rate versions | `formal_order_financial_snapshots.seller_rate_version_id`; `seller_agreement_rate_events.version_id`; `seller_agreement_currency_rate_versions.legacy_rate_id` |
| `seller_agreement_rate_events` | Immutable original agreement-rate event ledger | None |
| `seller_agreement_currency_rate_versions` | Multi-currency compatibility projection | `formal_order_marketplace_money_snapshots.seller_rate_version_id` |

Table-owned implicit primary/unique auto-indexes disappear with these tables. They are not independently recreated.

### 2.2 Legacy explicit indexes removed

- `uq_seller_agreement_rate_pending`
- `uq_seller_agreement_rate_effective`
- `idx_seller_agreement_rate_resolution`
- `idx_seller_agreement_rate_events_version`
- `idx_seller_agreement_currency_rate_current`

### 2.3 Legacy triggers removed

Owned by or synchronizing the legacy tables:

- `trg_seller_agreement_rate_initial_state_guard`
- `trg_seller_agreement_rate_pending_conflict`
- `trg_seller_agreement_rate_effective_conflict`
- `trg_seller_agreement_rate_decision_only`
- `trg_seller_agreement_rate_no_delete`
- `trg_seller_agreement_rate_events_no_update`
- `trg_seller_agreement_rate_events_no_delete`
- `trg_seller_agreement_currency_rate_legacy_insert`
- `trg_seller_agreement_currency_rate_legacy_update`
- `trg_seller_agreement_currency_rate_update_guard`
- `trg_seller_agreement_currency_rate_no_delete`

The cross-table legacy projection trigger `trg_formal_order_marketplace_money_legacy_insert`, owned by `formal_order_financial_snapshots`, is also removed.

### 2.4 Existing tables structurally rebuilt by SQLite DROP COLUMN

`formal_order_financial_snapshots` keeps its primary key, unique `formal_order_id`, Buyer-rate lineage, service-fee lineage, self-pay facts, Buyer principal, Seller principal amount, rounding rule, and timestamps. These obsolete columns and their FK are removed:

- `seller_rate_version_id`
- `seller_rate_version_no`
- `seller_rate_effective_from`
- `seller_rate_confirmed_at`
- `seller_cny_per_jpy_e8`

`formal_order_marketplace_money_snapshots` keeps platform/payment facts, Buyer-rate lineage, currency/exponent/rounding facts, service-fee lineage, Buyer principal, Seller principal amount, indexes, and immutable guards. These obsolete columns and their FK are removed:

- `seller_rate_version_id`
- `seller_rate_version_no`
- `seller_rate_effective_from`
- `seller_rate_confirmed_at`
- `seller_rate_value`
- `seller_rate_scale`

SQLite `ALTER TABLE ... DROP COLUMN` performs the internal table rebuild while keeping the table name continuously resolvable. This is selected over an explicit create/drop/rename because direct child FKs, triggers, and views reference `formal_order_financial_snapshots`; a temporary missing parent name causes SQLite schema reparse failure.

### 2.5 Replaced guards

- `trg_formal_order_financial_snapshot_guard`: replaced in place. New version validates formal order identity/timing, Buyer daily rate, and Seller service fee; it contains no Seller Agreement Rate lookup.
- `trg_formal_order_marketplace_money_source_guard`: replaced in place. New version validates formal order identity, Buyer/Store/Marketplace scope, Buyer daily rate, Seller service fee, and an exact `seller_principal_rate_snapshots` row for order/date/payment/currency/rounding/Seller principal/created time.

### 2.6 Preserved direct dependencies

These objects reference an affected table but do not reference removed columns. They must remain present and semantically unchanged:

| Object | Type | Dependency |
|---|---|---|
| `review_events.formal_order_financial_snapshot_id` | FK | `formal_order_financial_snapshots.id` |
| `seller_payables.financial_snapshot_id` | FK | `formal_order_financial_snapshots.id` |
| `trg_review_event_identity_guard` | Trigger | Buyer refund/service-fee event amount matches financial snapshot |
| `trg_seller_payable_source_guard` | Trigger | Principal/service-fee payable amount matches financial snapshot |
| `trg_seller_principal_rate_snapshot_confirmation_guard` | Trigger | Principal-policy snapshot amount matches financial snapshot |
| `trg_advance_principal_full_payment_amount_guard` | Trigger | Advance payment equals Buyer principal snapshot |
| `trg_formal_order_financial_self_pay_guard` | Trigger | Self-pay facts match order evidence |
| `trg_formal_order_financial_snapshots_no_update` | Trigger | Financial snapshot immutability |
| `trg_formal_order_financial_snapshots_no_delete` | Trigger | Financial snapshot immutability |
| `trg_buyer_marketplace_assignment_fact_guard` | Trigger | Generic marketplace snapshot blocks marketplace correction |
| `trg_formal_order_marketplace_money_no_update` | Trigger | Generic snapshot immutability |
| `trg_formal_order_marketplace_money_no_delete` | Trigger | Generic snapshot immutability |
| `idx_formal_order_marketplace_money_buyer` | Index | Buyer/date/order query path |
| `idx_formal_order_marketplace_money_seller` | Index | Seller/Store/date/order query path |
| `internal_order_finance_positions` | View | Direct financial snapshot consumer |
| `internal_finance_exceptions` | View | Transitive consumer of `internal_order_finance_positions` |

The migration test must compare the pre/post `sqlite_schema.sql` text for every preserved trigger, index, FK-owning table, and view above except the two intentionally replaced guards.

## 3. Zero-Stock Preconditions

All checks run before the first DDL statement. Any failed check aborts the enclosing transaction with Schema 68 and the complete schema/data snapshot unchanged.

### 3.1 Schema and database health

- `app_schema_state.singleton_id=1 AND schema_version=68`
- `pragma_integrity_check` returns exactly `ok`
- `pragma_foreign_key_check` returns zero rows

### 3.2 Legacy agreement-rate facts

Exact zero rows are required in:

- `seller_agreement_rate_versions`
- `seller_agreement_rate_events`
- `seller_agreement_currency_rate_versions`

Legacy command residue is also forbidden:

- `audit_events.aggregate_type` in `SELLER_AGREEMENT_RATE`, `SELLER_AGREEMENT_CURRENCY_RATE`
- `integration_outbox.aggregate_type` or `event_type` for either legacy authority
- `command_idempotency_records.action` for submit/confirm/reject legacy agreement-rate commands

These assertions prevent dropping legacy tables while immutable Audit, Outbox, or idempotency evidence claims the legacy command actually ran.

### 3.3 Formal-order stock carrying legacy FK lineage

Exact zero rows are required in:

- `formal_orders`
- `formal_order_financial_snapshots`
- `formal_order_marketplace_money_snapshots`
- `seller_principal_rate_snapshots`

For explicit corruption detection rather than relying only on foreign keys, exact zero rows are also required in the direct formal-order dependent ledgers:

- `formal_order_events`
- `review_cases`
- `review_events`
- `seller_payables`
- `buyer_refund_obligations`
- `buyer_advance_principal_entries`
- `order_archive_closures`

Rows in `seller_principal_rate_policy_versions/events`, Buyer daily-rate tables, Seller service-fee tables, pending order evidence, provisional order-number claims, Seller payments without allocations, and `platform_formal_orders` do not carry the retired FK and are preserved; they do not block 0069 solely by existing.

## 4. Exact Rebuild and Drop Order

1. Enable and defer foreign-key enforcement for the transaction.
2. Assert Schema 68, integrity/FK health, every zero-stock condition, and the complete expected pre-migration object inventory.
3. Record repository-test snapshots of preserved object SQL and complete schema/data state; production SQL itself does not write temporary evidence tables.
4. Drop `trg_formal_order_financial_snapshot_guard` because it references the five obsolete financial columns.
5. Drop `trg_formal_order_marketplace_money_legacy_insert` because it copies legacy Seller Agreement Rate fields into the generic snapshot.
6. Apply five `ALTER TABLE formal_order_financial_snapshots DROP COLUMN ...` operations in FK-lineage-first order: version ID, version number, effective time, confirmation time, value.
7. Assert the financial table row count remains zero, all retained columns/FKs are present, all five forbidden columns are absent, and the two child FKs from `review_events` and `seller_payables` still target the same table/column.
8. Recreate `trg_formal_order_financial_snapshot_guard` without legacy Seller-rate resolution; leave every other financial trigger/view untouched.
9. Drop `trg_formal_order_marketplace_money_source_guard` because it references the six obsolete generic Seller-rate columns.
10. Apply six `ALTER TABLE formal_order_marketplace_money_snapshots DROP COLUMN ...` operations in FK-lineage-first order: version ID, version number, effective time, confirmation time, value, scale.
11. Assert the generic table row count remains zero, retained columns/FKs/indexes/immutability triggers remain, and all six forbidden columns are absent.
12. Recreate `trg_formal_order_marketplace_money_source_guard` against the single `seller_principal_rate_snapshots` authority.
13. Drop the two cross-table sync triggers `trg_seller_agreement_currency_rate_legacy_insert` and `trg_seller_agreement_currency_rate_legacy_update` before removing their target table.
14. Drop `seller_agreement_currency_rate_versions` first; its table-owned indexes and immutability triggers disappear with it.
15. Drop `seller_agreement_rate_events` second; its FK child and table-owned objects disappear with it.
16. Drop `seller_agreement_rate_versions` last; no remaining FK, trigger, view, or table may reference it.
17. Assert all three tables, eleven legacy triggers, five explicit indexes, implicit old FK columns, and the legacy financial-to-generic sync trigger are absent.
18. Assert both replacement guards and every preserved direct dependency in section 2.6 are present; run `integrity_check` and `foreign_key_check` again.
19. Update `app_schema_state` from 68 to 69 with `WHERE singleton_id=1 AND schema_version=68`, then assert `changes()=1`.

## 5. Canonical Runtime Insert Order After Schema 69

The sole Staff evidence-approval D1 batch must insert in this order:

1. `formal_orders`
2. `formal_order_financial_snapshots` with Buyer/service-fee/principal amounts only
3. `seller_principal_rate_snapshots` with the sole Seller-rate lineage
4. `formal_order_marketplace_money_snapshots`, whose new guard requires step 3
5. Seller principal payable and the existing immutable events/Audit/Outbox/idempotency/final assertions

The final transaction assertion must require all three snapshot rows and exact Seller principal equality. Missing daily base rate or confirmed policy fails before the batch is constructed.

## 6. Required Migration Tests Before Implementation Acceptance

- Fresh `0001 -> 0069`: Schema 69, exact inventory, integrity `ok`, FK check zero.
- Sequential `Schema 68 -> 0069`: same result.
- Wrong order from Schema 67: reject; full schema/data snapshot unchanged.
- Repeat on Schema 69: reject; full schema/data snapshot unchanged.
- Dirty legacy rate definition/event/projection: reject; unchanged.
- Dirty legacy Audit/Outbox/idempotency residue: reject each category; unchanged.
- Dirty complete Schema 68 formal-order chain with financial/generic/principal/payable facts: reject; unchanged.
- Preserved-object proof: exact pre/post SQL equality for section 2.6 objects except the two replaced guards.
- Replacement-guard behavior: mismatched Buyer rate, fee, principal snapshot, amount, date, currency, or timestamp rejects; exact canonical insert succeeds.
- Historical immutability: migrations 0001-0068 byte comparison remains unchanged.

## 7. Confirmation Gate

No further Migration 0069, runtime, Contract, UI, verifier, Formal Verify, sync/archive, commit, push, or PR work proceeds until the owner confirms this inventory, zero-stock boundary, and rebuild order. Confirmation does not authorize production/staging/remote D1/R2 operations.
