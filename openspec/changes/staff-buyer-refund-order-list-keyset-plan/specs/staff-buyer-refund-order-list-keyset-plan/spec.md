# Staff buyer-refund order-list keyset query-plan specification

## ADDED Requirements

### Requirement: The current Schema 37 failure is reproducible before any rewrite

The Change SHALL use the real Staff formal-order list SQL against Schema 37 and legal
synthetic source chains with target-market shares of exactly 1%, 20%, and 80%. For the
fixed-assigned `buyer_refund` path, the baseline SHALL record the plan parent/detail and
whether SQLite emits a top-level `USE TEMP B-TREE FOR ORDER BY`.

#### Scenario: The fixed-assignment seek baseline exposes the sort remainder

- **WHEN** a `buyer_refund` actor has two scoped canonical markets, an active fixed buyer
  assignment subquery, and a `confirmed_at/id` seek cursor
- **THEN** the test proves the real Schema 37 query uses the prepared market index while
  retaining the observed parent-level sort TEMP-BTREE, without treating nested temporary
  structures as the same claim

### Requirement: Any query rewrite must be result and authorization equivalent

If a rewrite is implemented, it MUST preserve the authoritative SQL visibility fragment,
all existing list filters, responsibility projections, `confirmed_at DESC,id DESC` order,
`LIMIT limit+1`, cursor/filter echo and exact response shape. No fixed assignment or
Marketplace scope may be evaluated only in application code.

#### Scenario: First and subsequent pages are equivalent

- **WHEN** an authorized fixed-assigned `buyer_refund` actor reads the first page and
  follows `next_cursor` through a second page across same-timestamp orders
- **THEN** every item is authorized, ordered by the existing tie-breaker, appears exactly
  once, and the cursor's filter echo remains unchanged

#### Scenario: Assignment misses and Personal DENY remain fail-closed

- **WHEN** the actor has no active assignment for a buyer, or `ORDER_VIEW` is removed by
  Personal DENY
- **THEN** the unassigned buyer is absent and its detail is concealed as 404, while the
  denied list request remains 403

### Requirement: The plan claim is made only from direct SQLite EQP evidence

The acceptance test SHALL distinguish the parent query's `USE TEMP B-TREE FOR ORDER BY`
from nested subquery temporary structures, and SHALL require the new query form to remove
the parent sort for every 1%, 20%, and 80% corpus before claiming a performance fix.

#### Scenario: Safe plan improvement or explicit no-change

- **WHEN** candidate SQL shapes are evaluated against the real route projection
- **THEN** the Change either records a direct, stable parent-sort elimination with full
  equivalence evidence or leaves production SQL unchanged and records `NO-CHANGE` with the
  rejected alternatives and remaining risk

### Requirement: No external or business-contract boundary changes

The Change SHALL not add a Migration/index, change registry/enablement, modify DTO/API/
cursor/role/permission/Marketplace/Seller scope, or touch Buyer/Seller surfaces. All
evidence SHALL be labeled LOCAL and Production SHALL remain `NO-GO`.

#### Scenario: Existing contracts remain intact

- **WHEN** the focused tests and repository guards run
- **THEN** existing Staff permissions, concealed 404, pagination semantics, Buyer/Seller
  DTO isolation and current Schema 37 inventory remain unchanged
