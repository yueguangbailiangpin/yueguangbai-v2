## Context

See `proposal.md` for motivation. Schema 68 contains two legacy Seller Agreement Rate authorities: the original JP tables and the multi-currency projection. Both are still referenced by the formal-order financial and marketplace-money snapshot schemas. The only live HTTP confirmation path is Staff order-evidence approval, but a second exported confirmation service and test-only marketplace snapshot locker can still create the same class of formal financial facts. The live path resolves both the legacy agreement rate and the newer principal policy, then chooses between them through a default-false environment flag.

The complete Schema 68 table/FK/trigger/view inventory, zero-stock assertion boundary, rebuild/drop order, and confirmation gate are defined in `migration-0069-design.md`. That document must be explicitly confirmed before Migration 0069 implementation continues.

The repository currently has no authorized production or staging read, and this Change is explicitly based on the owner-confirmed empty legacy business stock. Migration 0069 therefore must reject non-empty stock rather than infer a conversion. Existing migrations 0001-0068, historical Decisions, and archived evidence are immutable.

## Goals / Non-Goals

**Goals:**

- Leave one callable formal-order confirmation authority with one Seller principal formula.
- Keep order approval, evidence verification, snapshots, payable, Audit, Outbox, workflow completion, and idempotency in one D1 batch.
- Remove every current runtime/config/Contract/UI/schema dependency on Seller Agreement Rate.
- Make Schema 69 a deterministic forward migration that proves an empty retirement boundary and leaves retained tables structurally guarded.

**Non-Goals:**

- No conversion or import of historical orders, rates, snapshots, payables, reviews, allocations, or files.
- No Seller Allocation or Outbox redesign and no new Staff or Seller permissions.
- No production/staging migration, deployment, resource inspection, or external write.

## Decisions

### 1. The Staff evidence-approval transaction is the only confirmation authority

`approveOrderEvidenceAtomically` remains the command used by the existing Staff route. The duplicate exported `confirmFormalOrder` service and its direct-call fixtures are removed; useful transaction, concurrency, immutability, and permission tests are moved to the canonical approval path. The test-only marketplace money locker and its formal-snapshot Contract are also removed because they provide another way to select and lock a Seller rate outside order approval.

Alternative rejected: keep both services and delegate one to the other. That still leaves two callable authorities with different preconditions, assignment handling, evidence state transitions, idempotency action names, and outbox behavior.

### 2. Principal policy resolution is unconditional and precedes mutation

The canonical command resolves the platform order-date daily base rate and eligible confirmed principal policy before constructing any D1 mutation statement. The compatibility flag and legacy agreement-rate resolution are deleted. The resulting principal snapshot is required, not optional, in the internal confirmation result and Seller Amazon DTO. Missing rate or policy is normalized to the existing stable pricing dependency failure and the acquired idempotency placeholder is marked failed; no successful business, Audit, Outbox, or payable mutation remains.

Alternative rejected: preserve a default-on flag for rollback. A flag retains a second behavior and permits configuration drift between local, staging, and production. Rollback is an application release decision, not a runtime financial formula selector.

### 3. Financial snapshots retain amounts but stop duplicating legacy rate lineage

Migration 0069 rebuilds `formal_order_financial_snapshots` without the five legacy Seller Agreement Rate columns. It retains Buyer-rate, service-fee, self-pay, Buyer principal, Seller principal, rounding, and immutable timing facts. The existing `seller_principal_rate_snapshots` row is the sole Seller-rate lineage and its confirmation guard continues to require exact equality with the financial snapshot Seller principal amount.

`formal_order_marketplace_money_snapshots` is rebuilt without Seller agreement version/value columns. It retains platform/payment, Buyer rate, service fee, Buyer principal, Seller principal, and currency facts. Its source guard validates the Seller principal against the required `seller_principal_rate_snapshots` row. The canonical command inserts financial snapshot, principal snapshot, then marketplace-money snapshot explicitly in that order; the legacy after-insert synchronization trigger is removed.

Alternative rejected: copy principal-policy values into every snapshot table. Duplicating the full principal lineage creates extra consistency surfaces without adding an independent authority.

### 4. Migration 0069 uses an empty-stock fail-closed boundary

Before any drop or rebuild, 0069 asserts Schema 68 and zero rows in all legacy agreement-rate versions/events, both agreement-currency projections, formal orders, both dependent formal snapshot tables, and principal snapshots. Requiring zero formal orders is intentionally stricter than trying to distinguish convertible rows: every existing Schema 68 formal snapshot carries a legacy Seller Agreement Rate FK, and this Change has no authority to rewrite it.

Because the empty-stock boundary is proven before DDL, the migration uses SQLite `ALTER TABLE ... DROP COLUMN` to perform each internal retained-table rebuild while keeping cross-table FK, trigger, and view names continuously resolvable. It drops and recreates only the two source guards that reference retired columns, proves retained columns/FKs and preserved object SQL, then drops legacy agreement-rate projection/events/version tables in dependency order. It asserts required new objects exist, forbidden old objects do not exist, retained object counts remain zero, and finally performs the guarded 68-to-69 schema update with `changes() = 1`. The complete approved inventory and order are authoritative in `migration-0069-design.md`.

Wrong-order, repeat, and dirty-stock tests execute the migration inside a transaction and compare complete schema/data snapshots after failure. Fresh-chain and Schema-68 sequential tests run `integrity_check` and `foreign_key_check` after success.

Alternative rejected: silently delete legacy rate rows because current environments are believed empty. Belief is not a database invariant; explicit assertions are the only safe destructive boundary.

### 5. Current governance advances while history stays immutable

D-045 is appended and supersedes only D-031's compatibility-flag, fallback, and retained-legacy-projection clause. Current OpenSpec capabilities are updated through delta specs and later synced/archived. Runtime readiness, recovery attestation, staging bootstrap schema guard, release preflight, current runbooks/contracts, and current tests advance to Schema 69. Historical Decisions, migrations 0001-0068, archived Changes, and dated evidence/freeze documents remain untouched.

### 6. Permission, privacy, idempotency, Audit, Outbox, files, and pagination do not expand

The existing Staff authorization, assignment, Personal DENY, organization/store scope, and Seller DTO boundaries remain. Seller receives principal calculation facts needed to explain its own amount but no Staff identity, internal policy event, provider payload, object key, or permanent file URL. The canonical transaction retains its idempotency request hash, immutable Audit and domain events, two outbox events, payable creation, evidence consumption, and transaction-final assertions. Seller list/detail pagination and file read authorization are unchanged except for removal of the legacy DTO field.

## Risks / Trade-offs

- [Existing non-empty formal or agreement-rate facts block Schema 69] → Migration aborts transactionally and requires a separately authorized reconciliation/import Change; no guessing or deletion is allowed.
- [Removing the flag makes missing principal configuration immediately visible] → focused tests prove stable failure and zero partial mutation; staging setup must create the required confirmed base rate and policy before order confirmation testing.
- [Rebuilding parent snapshot tables can disturb foreign keys] → the empty formal-order boundary is asserted first, replacement schemas preserve retained primary keys, and full-chain foreign-key checks run after migration.
- [Deleting duplicate services can erase useful regression coverage] → tests are migrated by invariant to the canonical approval path before the old files are removed; test count alone is not used as evidence.
- [Current governance references may remain stale] → repository verifiers scan the migration tail, runtime target schema, recovery target, and active release documents for Schema 69 anchors.

## Migration Plan

1. Append D-045 and land the OpenSpec deltas before implementation claims.
2. Add Migration 0069 and its focused fresh/sequential/wrong-order/repeat/dirty-stock/no-partial-change tests.
3. Make principal policy resolution mandatory in canonical order approval, add explicit marketplace snapshot insertion, and strengthen final transaction assertions.
4. Remove the flag, legacy pricing modules/exports, duplicate confirmation/snapshot-lock services, and migrate tests to the canonical path.
5. Remove legacy Seller Contract/runtime/UI fields and update Seller route, UI, and browser evidence.
6. Advance current Schema 69 readiness, recovery, release, and migration verifiers; run focused tests, database verification, full test/build/check, and strict OpenSpec validation.
7. Run Formal Verify, sync the deltas, archive the Change, commit the governance completion separately if required, push only the feature branch, and open a Draft PR.

Rollback before any remote migration is a normal code revert. If Schema 69 is later applied to an empty environment, compatible application rollback may retain Schema 69. Once new formal-order facts exist, down-migration is forbidden; only a forward repair or isolated verified restore is valid.
