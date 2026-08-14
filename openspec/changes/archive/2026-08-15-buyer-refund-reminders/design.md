## Context

See `proposal.md`. Existing Buyer refund details are session-scoped reads. Payment and reversal facts already use append-only ledgers; a reminder is a separate Buyer request fact and is not a payment, a Staff task, or an external delivery.

## Goals / Non-Goals

**Goals:**

- Keep reminder ownership, eligibility, rate limiting, idempotency, immutable Audit, and response projection server-derived.
- Preserve Buyer concealment and expose only a count and last timestamp to Staff.

**Non-Goals:**

- No payment mutation, expected-version change, Staff workflow creation, queue ordering, Outbox, Seller projection, historical import, or external notification.

## Decisions

- `buyer_refund_reminders` is an append-only table keyed by opaque id and stores the obligation, Buyer, UTC reminder timestamp, and idempotency key. A foreign-key/source trigger proves the Buyer owns the obligation; immutable triggers prohibit rewrites and deletion. The obligation-time index supports the 24-hour lookup and Staff aggregation.
- The command first resolves trusted Buyer context and the owned ledger. Missing, foreign, PAID, and OVERPAID targets return the existing concealed not-found response. Only DUE and PARTIALLY_PAID are eligible.
- The command uses the existing `command_idempotency_records` protocol. In one D1 batch it conditionally inserts only if no reminder for the obligation falls in the preceding 24 hours, asserts `changes()=1`, writes Audit, and commits the replay response. A zero-change assertion rolls the entire batch back and maps to rate limited; therefore no second reminder or Audit survives a limited request.
- Buyer detail calculates the safe reminder projection from the immutable table. Staff uses correlated aggregates in the existing read order, so it gains count/last time without changing query sort or generating a task.

## Risks / Trade-offs

- [D1 batch failure after the idempotency claim] → mark the claim failed; retry uses the normal claim protocol and no reminder mutation survives the failed batch.
- [Concurrent different keys] → the conditional insert plus `changes()=1` means exactly one command can commit within the window; the other rolls back as rate limited.
- [A stale Buyer page offers the action after payment] → the server rechecks the live ledger state; the UI is convenience only.
- [Schema rollback] → Migration 0070 is forward-only. Disable route exposure by reverting application code; retain immutable reminder/Audit facts. Do not delete facts or apply remote SQL in this Change.
