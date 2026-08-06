# Tasks: API Contract Baseline Alignment

## 0. Inventory

- [ ] 0.1 Enumerate actual default-app routes, Contract path constants and frontend adapters.
- [ ] 0.2 Classify every list as cursor, intentional page or bounded non-paginated.

## 1. Documentation and Verification

- [ ] 1.1 Update API conventions, route inventory and examples to `/api/*` and real pagination facts.
- [ ] 1.2 Add a verifier that detects undocumented routes, nonexistent aliases and pagination drift.
- [ ] 1.3 Document independent MCP tool versioning and future external HTTP versioning boundary.

## 2. Migration and Tests

- [ ] 2.1 Assert no Migration, route registration, business Contract or package dependency changed.
- [ ] 2.2 Run route count, runtime schema, frontend adapter, internal link and full regression tests.
- [ ] 2.3 Run strict OpenSpec validation and formal Verify with zero behavior-change claims.

## 3. Rollback

- [ ] 3.1 Verify a documentation-only Git revert restores the prior text without touching runtime code.
