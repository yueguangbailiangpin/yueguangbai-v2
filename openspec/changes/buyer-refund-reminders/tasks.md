## 1. Scope and migration

- [x] 1.1 Confirm current Buyer session, concealment, refund status, Audit, idempotency, Staff projection, and no-Outbox boundaries.
- [x] 1.2 Add forward-only Migration 0070 with Schema 69 predecessor assertion, immutable reminder table, source and immutable triggers, index, and Schema 70 assertion.
- [x] 1.3 Update local migration guards/inventory and add real non-empty Schema 69→70 success preservation plus wrong-order, repeat, and explicitly non-empty partial-0070 dirty-stock full schema/data snapshot evidence with integrity/FK checks.

## 2. Contracts and command

- [x] 2.1 Add Buyer and Staff-safe reminder DTO fields without Seller projection changes.
- [x] 2.2 Implement the session-derived owned DUE/PARTIALLY_PAID reminder command with idempotency, a final batch-bound owned-status plus 24-hour conditional insert, `changes()=1`, Audit, exact 409 idempotency conflict semantics, and fail-closed rate-limit behavior.
- [x] 2.3 Register only `POST /api/buyer-portal/refunds/:id/remind` under existing Buyer session/error concealment conventions.

## 3. Presentation

- [x] 3.1 Add Buyer detail reminder control and already-reminded state; hide it for PAID/OVERPAID.
- [x] 3.2 Add Staff count/last-time facts without task creation, mutation, sorting, or queue changes.

## 4. Evidence and verification

- [x] 4.1 Add real local-D1 coverage for ownership concealment, replay, rate-limit rollback, same-key in-progress/different-target conflict 409s, a batch-window Staff-payment race, immutable Audit, and migration guards.
- [x] 4.2 Add focused rendered Buyer DUE/PAID and Staff bounded-display coverage; preserve Buyer/Seller projection isolation.
- [x] 4.3 Run focused Vitest, Domain/Contracts/API/Web typechecks, migration tests, strict OpenSpec validation, and `git diff --check`.
- [x] 4.4 Record local test evidence in `test-evidence.md`; do not sync/archive or create Formal Verify in this Change.
