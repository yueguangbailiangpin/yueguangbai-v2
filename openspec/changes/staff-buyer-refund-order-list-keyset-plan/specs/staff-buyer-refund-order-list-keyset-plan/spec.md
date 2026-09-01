# Staff buyer-refund order-list keyset query-plan specification

## ADDED Requirements

### Requirement: The Change SHALL record an explicit NO-CHANGE plan decision

The Change SHALL reject an unconditional `INDEXED BY idx_formal_orders_confirmed_id`
hint for the multi-Marketplace `buyer_refund` list. Production SHALL retain the
planner-autonomous formal-order list SQL and SHALL NOT claim that the parent sort or
the nested responsibility sorts are solved.

#### Scenario: Direct EQP distinguishes the retained boundary

- **WHEN** a Schema 37 `buyer_refund` actor has two canonical Marketplace scopes, a fixed
  assignment subquery and a `confirmed_at/id` seek cursor
- **THEN** the default plan records the Marketplace-leading index and the parent
  `USE TEMP B-TREE FOR ORDER BY`, while nested temporary structures remain separately
  classified; the production SQL contains no forced global-index branch

### Requirement: Failure-first cost evidence SHALL be deterministic and scope-aware

The acceptance test SHALL use legal Schema 37 source chains with many rows from an
irrelevant registered Marketplace and exact scoped shares of 1%, 20% and 80%. It SHALL
evaluate first, deep and tail pages using direct EQP plus a deterministic keyset candidate
probe, not wall-clock timing. The probe SHALL distinguish candidate rows before
Marketplace/fixed-assignment authorization from returned rows.

#### Scenario: The global hint is rejected by candidate evidence

- **WHEN** the test compares the existing Marketplace index candidate with the test-only
  global-index hint across all three selectivities and page positions
- **THEN** the global candidate includes out-of-scope rows and cannot be promoted to an
  unconditional production hint; the result is recorded as `NO-CHANGE`

### Requirement: Existing list authorization and pagination SHALL remain unchanged

Any evidence-only or compatibility edit MUST preserve the authoritative SQL visibility
fragment, fixed buyer assignment, Marketplace/Seller Organization scope, Personal DENY,
concealed 404, all list filters, `confirmed_at DESC,id DESC`, `LIMIT limit+1`, cursor/filter
echo, exact DTO and cursor wire format. Fixed assignment and scope MUST NOT move to
application-layer filtering.

#### Scenario: Pages and tie-breaker remain equivalent

- **WHEN** an authorized fixed-assigned `buyer_refund` actor reads the first page and follows
  `next_cursor` across same-timestamp orders
- **THEN** every visible item is authorized, ordered exactly once by the existing ID
  tie-breaker, and the cursor filter echo remains unchanged

#### Scenario: Assignment miss and Personal DENY remain fail-closed

- **WHEN** the actor has no active assignment for a buyer, or `ORDER_VIEW` is removed by
  Personal DENY
- **THEN** the unassigned buyer is absent, its detail is concealed as 404, and the denied
  list request is 403

### Requirement: No external, migration or surface contract SHALL change

The Change SHALL not add or modify a migration/index, registry/enablement, D1 schema, DTO,
API path, cursor wire, role/permission matrix, Buyer surface or Seller surface. Evidence
SHALL be labeled LOCAL and `PRODUCTION_STATUS=NO-GO`.

#### Scenario: Repository boundaries remain intact

- **WHEN** the focused tests and repository guards run
- **THEN** Staff permission behavior, Buyer/Seller DTO isolation, concealed 404, pagination
  semantics and the Schema 37 inventory remain unchanged
