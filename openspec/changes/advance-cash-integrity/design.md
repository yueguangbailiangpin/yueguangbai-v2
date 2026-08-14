# Design: Advance Cash Integrity

## Reversal transaction boundary

D1/SQLite serializes writes, but the existing route aggregate check runs before the insert batch and is not itself authoritative. Migration 0066 adds a `BEFORE INSERT` trigger on advance `REVERSAL` entries. At the serialized write boundary the trigger compares the new amount with the original payment less all committed reversals and aborts when the new cumulative total would exceed the payment. The existing source-identity trigger continues to enforce same-order and same-buyer provenance.

Migration 0066 first asserts that no existing payment is already over-reversed. It does not repair, delete or rewrite immutable ledger rows. A failed assertion rolls the entire migration back at Schema 65.

## Cash movement authority

The internal-finance cash view remains the single reporting source for the Staff finance cash-flow endpoint. It gains `BUYER_ADVANCE_PAYMENT` and `BUYER_ADVANCE_REVERSAL` movements joined through the formal order to the Seller Organization. The occurrence time and China business date come from the immutable advance entry.

Advance settlement creates a Buyer refund payment entry to express obligation satisfaction. That entry is an accounting mirror of cash already paid and is excluded from the cash view. A reversal whose original refund payment is such a mirror is excluded for the same reason. Ordinary Buyer refund payments and reversals remain unchanged.

The cash-flow DTO and CSV export preserve separate normal-refund totals and add explicit advance outflow/reversal totals. Net cash equals Seller payments minus Seller reversals minus normal Buyer refund payments plus normal refund reversals minus advance payments plus advance reversals.

## Timestamp boundary

Manual Buyer refund and advance payment commands compare normalized `paid_at` with one server-side command `now`. A future timestamp fails validation before idempotency acquisition or any business/file/audit write. Existing historical timestamps and reversal occurrence semantics are unchanged.

## Verification

Behavior tests execute Migration 0066 against SQLite, prove the database rejects a second stale-style reversal that exceeds the remaining payment, prove a pre-corrupt ledger blocks migration, and verify real movements are counted exactly once. Service tests prove future payment timestamps leave no idempotency fact. Migration continuity, wrong-order/repeat guards, full typecheck, tests, build and strict OpenSpec validation remain required.
