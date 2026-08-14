## Purpose

Provide a Buyer-safe, server-authorized refund reminder path that records the request once, limits repeated prompting, and preserves financial and privacy boundaries.

## ADDED Requirements

### Requirement: Buyer can request a bounded reminder for an owned pending refund

The system SHALL expose `POST /api/buyer-portal/refunds/:id/remind` only behind the trusted Customer Session and current Buyer portal context. It SHALL require an `Idempotency-Key`, derive ownership from that context, and permit only an owned refund whose current status is `DUE` or `PARTIALLY_PAID`. It SHALL create one immutable reminder associated with the refund obligation, Buyer, UTC timestamp, and idempotency key, plus one immutable Audit event. Foreign and missing refund ids SHALL use the existing concealed not-found response.

#### Scenario: Owned due refund is reminded

- **WHEN** an ACTIVE, CLEAR Buyer requests a reminder for their DUE refund with a valid idempotency key
- **THEN** the response returns the obligation id, reminder count, last reminder time, next eligible time, and `replayed=false`, and one reminder plus one Audit fact exist

#### Scenario: Another Buyer probes a refund id

- **WHEN** a Buyer requests a reminder for another Buyer's refund id
- **THEN** the response is the same not-found class used for a missing refund and no reminder or Audit fact is written

### Requirement: Reminder requests are idempotent and rate limited without partial business mutation

The same Buyer, target, request shape, and idempotency key SHALL replay the committed reminder result. A different reminder request for the same refund inside 24 hours of the last committed reminder SHALL fail closed with rate limited. A rate-limited or failed command SHALL NOT leave an additional reminder, Audit event, or completed idempotency business response.

#### Scenario: Client retries a successful reminder

- **WHEN** the Buyer repeats the same reminder command with the same idempotency key
- **THEN** the system returns the original reminder result with `replayed=true` and does not create a second reminder or Audit fact

#### Scenario: Buyer tries a new key inside the rate window

- **WHEN** the Buyer sends a different idempotency key before 24 hours have elapsed for the same refund
- **THEN** the system returns rate limited and the immutable reminder and Audit counts remain unchanged

### Requirement: Buyer and Staff receive bounded reminder projections

Buyer refund detail SHALL show a reminder control only for `DUE` and `PARTIALLY_PAID`; after a reminder it SHALL show the Buyer-safe already-reminded state and respect the server-projected next eligible time. `PAID` and `OVERPAID` details SHALL not show the control. Staff refund detail SHALL display only reminder count and last reminder time, preserving existing result order and without adding a Staff task or action. Seller responses SHALL not gain reminder data.

#### Scenario: Paid refund detail is rendered

- **WHEN** a Buyer opens a PAID refund detail
- **THEN** no reminder control is present

#### Scenario: Staff opens a reminded refund

- **WHEN** authorized Staff reads a refund that has reminders
- **THEN** the existing detail displays reminder count and last reminder time without a reminder action or changed queue ordering
