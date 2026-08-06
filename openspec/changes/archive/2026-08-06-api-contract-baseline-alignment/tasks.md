# Tasks: API Contract Baseline Alignment

## 0. Inventory

- [x] 0.1 Enumerate actual default-app routes, Contract path constants and frontend adapters.
- [x] 0.2 Classify every list as cursor, intentional page or bounded non-paginated.

## 1. Documentation and Verification

- [x] 1.1 Update API conventions, route inventory and examples to `/api/*` and real pagination facts.
- [x] 1.2 Add a verifier that detects undocumented routes, nonexistent aliases and pagination drift.
- [x] 1.3 Document independent MCP tool versioning and future external HTTP versioning boundary.

## 2. Migration and Tests

- [x] 2.1 Assert no Migration, route registration, business Contract or package dependency changed.
- [x] 2.2 Run route count, runtime schema, frontend adapter, internal link and full regression tests.
- [x] 2.3 Run strict OpenSpec validation and formal Verify with zero behavior-change claims.

## 3. Rollback

- [x] 3.1 Verify a documentation-only Git revert restores the prior text without touching runtime code.

## Evidence

- `npm run verify:api-contract` passed: 139 runtime routes, exact inventory, shared HTTP path constants, production frontend adapter paths, `/api/*` documentation and cursor semantics.
- `scripts/verify-api-contract-baseline.mjs` passed with no migrations, route registration, business Contract source, frontend adapter source or dependency changes.
- No runtime route, DTO, permission, state machine, financial calculation, database schema or Migration was changed by this Change.
