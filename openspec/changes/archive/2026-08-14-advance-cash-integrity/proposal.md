# Change: Advance Cash Integrity

## Why

Advance-principal reversals currently perform an application read, aggregate check and later insert without a database aggregate guard. Two distinct commands can therefore validate the same remaining amount and append immutable reversals whose total exceeds the original payment. The internal-finance cash view also predates the advance ledger, so it omits real advance payments and reversals while the canonical Admin financial projection includes them.

## What Changes

- Add forward-only Migration 0066 with a database aggregate guard that rejects cumulative advance reversals above the original payment.
- Refuse Migration 0066 when an existing immutable advance ledger is already over-reversed, requiring explicit investigation rather than silently blessing corrupt history.
- Rebuild the internal-finance cash movement view to include advance payments and reversals at their actual occurrence time.
- Exclude refund-ledger payment/reversal mirrors produced by advance settlement so one real payment is never counted twice.
- Expose advance outflow and reversal totals explicitly in the internal-finance cash-flow contract and export while preserving existing refund fields.
- Reject future `paid_at` values for manual Buyer refund and advance payments before claiming idempotency.

## Non-goals

- No modification of historical migrations 0001-0065 and no deletion or rewrite of immutable financial facts.
- No production deployment, remote D1/R2 write, data import, Secret, DNS, Cloudflare Access or scheduler mutation.
- No change to advance settlement, Buyer refund obligation, Seller settlement, profit formulas, roles or permissions.
- No arbitrary financial-adjustment limit or Seller portal product decision.

## Migration Decision

`FORWARD_MIGRATION_REQUIRED`. Migration 0066 installs one aggregate reversal trigger, rebuilds the existing cash movement view and advances `app_schema_state` from 65 to 66. It changes no table columns and rewrites no business rows.

## Rollback

Before remote application, revert this branch as one unit. After 0066 is applied, do not delete or edit the migration; rollback is a new forward migration or release rollback that preserves the stronger guard and immutable facts. Any pre-existing over-reversal blocks migration and requires explicit investigation and compensation before retry.
