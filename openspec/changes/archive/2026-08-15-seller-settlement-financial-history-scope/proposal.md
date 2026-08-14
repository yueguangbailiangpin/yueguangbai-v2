## Why

Seller settlement payables remain financial obligations after a Store is disabled. Applying the general active-Store visibility rule to OWNER settlement would make historical unpaid principal or service fees disappear from the organization ledger view even though the immutable financial facts still exist.

The current settlement read model already preserves organization-wide history for OWNER and filters FINANCE by current assigned active Stores. The product boundary needs an explicit, testable contract and unambiguous Seller UI copy so later cleanup does not "fix" the financial exception away.

## What Changes

- Define OWNER settlement summary, payables and payments as organization-wide financial history, including historical settlement facts from disabled Stores.
- Keep FINANCE summary and payables limited to current assigned active Stores; organization-level payments remain unavailable because they have no authoritative Store allocation.
- State that the financial-history exception does not grant catalog, order, file or write access to a disabled Store and does not make the current Store selector authoritative for settlement.
- Add real migrated-D1 HTTP behavior coverage and clarify the OWNER Seller-page scope copy.

## Capabilities

### New Capabilities

- `seller-settlement-financial-history-scope`: Seller settlement history preservation and role/scope boundaries.

### Modified Capabilities

- None.

## Impact

- Affects Seller settlement UI copy, focused Web tests, Seller Portal settlement HTTP behavior tests and this active OpenSpec Change.
- Uses the existing API DTOs, authorization resolver, settlement formulas and read model without changing financial facts or calculations.
- Requires no Migration, production data operation, remote resource change or deployment.
