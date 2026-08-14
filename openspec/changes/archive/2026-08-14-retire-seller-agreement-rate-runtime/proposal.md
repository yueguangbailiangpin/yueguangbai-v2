# Retire Seller Agreement Rate Runtime

## Why

The accepted Seller Principal Rate Policy defines platform order-date daily base rate plus the confirmed principal policy as the formal-order principal authority, but the current runtime still defaults that authority off and falls back to the legacy Seller Agreement Rate path. Keeping both paths makes staging behavior configuration-dependent and leaves legacy agreement-rate schema, DTO, and UI facts alive as a second financial authority. Before staging, the repository needs one fail-closed formal-order confirmation path and a forward-only schema retirement while the legacy stock is confirmed empty.

## What Changes

- **BREAKING** Make `approveOrderEvidenceAtomically` the only formal-order confirmation authority and remove the unused parallel `confirmFormalOrder` implementation.
- **BREAKING** Always resolve Seller principal from the platform order-date daily base rate and the confirmed Seller Principal Rate Policy; missing prerequisites reject confirmation without partial order, financial, audit, idempotency, or outbox writes.
- **BREAKING** Remove the `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED` compatibility flag and every legacy Seller Agreement Rate fallback, write, read model, API Contract field, Seller UI field, fixture, verifier allowance, and runtime consumer.
- Add Decision D-045 to supersede only D-031's default-off/fallback compatibility clause while preserving D-031's principal-rate formula and all historical Decisions unchanged.
- Add forward-only Migration 0069 from Schema 68 to 69. It must assert that legacy agreement-rate stock and dependent legacy snapshots are empty, rebuild current tables without obsolete agreement-rate dependencies, drop the final legacy tables/triggers/indexes, and atomically advance the schema version with `changes() = 1`.
- Update current specifications and repository-local readiness/recovery governance to Schema 69, with fresh, sequential, wrong-order, repeat, dirty-stock rollback, integrity, and foreign-key evidence.
- Complete focused and full tests, Formal Verify, spec sync, and archive before opening a Draft PR for fixed-SHA review.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `marketplace-money-foundation`: Replace legacy Seller Agreement Rate authority and snapshots with the single Seller Principal Rate Policy authority and fail-closed confirmation semantics.
- `seller-complete-business-loop`: Remove legacy agreement-rate DTO/UI visibility and require Seller financial reads to expose only immutable principal-policy and service-fee facts.
- `production-backup-recovery`: Advance the repository-local migration, recovery, and readiness contract from Schema 68 to Schema 69.

## Impact

- Affects formal-order confirmation services, pricing/runtime helpers, Seller order read models and Contracts, Seller UI, configuration templates, local verification scripts, tests, and D1 schema.
- Migration 0069 deliberately refuses to guess, convert, delete, or import non-empty legacy business facts. Any non-empty stock blocks the migration and requires a separately authorized reconciliation decision.
- Existing migrations 0001-0068, historical Decisions, and archived OpenSpec evidence remain byte-for-byte unchanged.
- Seller Allocation, Outbox redesign, historical order import, production/staging deployment, remote D1/R2, secrets, DNS, Access, and real business data are out of scope.

## Migration and Rollback

Migration 0069 runs only from Schema 68. Before destructive DDL it asserts zero legacy agreement-rate definitions, events, snapshots, and dependent references. It then rebuilds affected current tables and constraints, proves the retained-table empty boundary, drops obsolete legacy objects, and advances `app_schema_state` from 68 to 69 exactly once. Wrong-order, repeat, or dirty-stock execution must fail transactionally with Schema 68 and every pre-migration object and row unchanged.

Before deployment, rollback is an application revert while retaining empty Schema 69. After Schema 69 begins carrying new formal-order facts, down-migration is forbidden; recovery is forward repair or restoration from an isolated verified backup. This Change does not run the migration against any remote environment.

## Risks and Privacy

Removing the compatibility path can turn previously silent fallback behavior into explicit confirmation failures; that is intentional because guessing a principal rate is a financial-integrity failure. Tests must prove zero partial mutation when daily rate or confirmed policy is absent. Seller responses must not expose internal rate-source identifiers, raw policy events, provider payloads, or infrastructure keys. All verification uses repository-local fixtures and ephemeral databases only.
