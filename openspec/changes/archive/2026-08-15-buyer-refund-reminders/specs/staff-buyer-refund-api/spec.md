## ADDED Requirements

### Requirement: Staff refund detail exposes bounded reminder observability

The scoped Staff Buyer Refund list/detail projection SHALL include only each obligation's immutable reminder count and last reminder timestamp. It SHALL preserve existing pagination and ordering, SHALL NOT create or reorder a Staff work item, and SHALL NOT expose Buyer idempotency keys, request ids, Audit metadata, external-delivery state, or Seller-visible reminder data.

#### Scenario: Staff reads a refund with reminders

- **WHEN** authorized Staff reads a visible Buyer Refund obligation with two committed Buyer reminders
- **THEN** the detail reports count two and the latest reminder timestamp while existing payment, reversal, scope, and ordering behavior remains unchanged
