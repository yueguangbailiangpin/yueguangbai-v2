## Context

The Seller actor resolver gives OWNER `read_scope=ORGANIZATION` and gives every non-OWNER member `read_scope=ASSIGNED_STORES` with Store IDs derived only from current active scopes/grants joined to active Stores. Settlement is a deliberate exception to the general active-Store business scope: immutable payables and payments must remain visible to the organization OWNER after a Store is disabled.

## Scope Decision

- OWNER settlement summary and payable reads use the existing organization scope. They include historical payable balances whose formal order belongs to the organization even when its Store is now disabled.
- OWNER payment reads remain organization-scoped because Seller payments and unallocated credit are organization facts without authoritative Store attribution.
- FINANCE settlement summary and payable reads use only the resolver's current assigned active Store IDs. FINANCE receives zero unallocated organization credit and cannot read organization payment resources.
- The Seller page derives explanatory copy from the trusted `/api/seller-portal/me` read scope. Settlement requests do not accept or send the currently selected `store_id`.

## Non-Financial Boundary

This exception is consumed only by Seller settlement summary, payable and OWNER payment read models. It does not alter Seller actor resolution, Store assignment, catalog/product/application, demand, formal-order, review, file audience/read-intent, upload or write authorization. A disabled Store does not become an active or assigned Store because historical settlement remains visible.

## Data, Formula and Migration Boundary

No financial formula, payment/allocation/reversal fact, DTO, database table, view, trigger or Migration changes. The behavior test inserts synthetic immutable historical rows into a fully migrated local D1 database, then exercises the registered HTTP routes and current authorization/read-model chain. Fixture-only bypass of unrelated write-source guards is not production behavior.

## Rejected Alternatives

- Filtering OWNER settlement by current active Store IDs: rejected because it hides unresolved historical obligations when a Store is disabled.
- Giving FINANCE organization-wide history or payments: rejected because FINANCE authority remains current assigned active Stores and payments lack Store attribution.
- Binding settlement to the current UI Store selector: rejected because client selection is presentation state, not authorization.
- Expanding the exception to catalog, order, file or write operations: rejected because preserving debt history is not authority to resume disabled-Store business operations.

## Rollback

Revert the UI copy, focused tests and this active Change. No financial fact, schema object, permission assignment or remote resource requires rollback.
