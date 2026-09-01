# Tasks: seller-settlement-read-boundary

## Tests first

- [x] Add request-level payment list/detail role tests for OWNER, OPERATIONS,
  FINANCE, and VIEWER; assert OWNER/FINANCE 200 and OPERATIONS/VIEWER
  concealed 404 without sensitive fields.
- [x] Add real two-page HTTP cursor tests for payables and payments, including
  stable ordering, no duplicates, no omissions, continuation token, and
  malformed cursor behavior.
- [x] Add payment organization-isolation tests for foreign list/detail and
  concealed 404 detail behavior.
- [x] Add Buyer request-level tests for Seller batch list/detail returning 404
  with no batch data.
- [x] Preserve and re-run the existing four-role Seller batch, disabled
  membership, DRAFT/CANCELLED, and summary/payables regression coverage.

## API/domain

- [x] Reuse `canReadSellerSettlementFinancials` for Seller payment list/detail
  without changing the domain capability matrix.
- [x] Convert authenticated non-Seller account access to concealed 404 only at
  Seller batch list/detail routes.
- [x] Keep organization predicates, store history behavior, DTO projections,
  cursor tokens, list limits, and batch state machine unchanged.

## Documentation

- [x] Record the confirmed seven-endpoint matrix and Buyer batch 404 in this
  Change's proposal/design/spec.
- [x] Synchronize `docs/contracts/V2_PERMISSION_MATRIX.md` with the current
  Seller settlement matrix and safe batch exception.
- [x] Synchronize `docs/migration/V2_STAGE75_OPERATIONAL_COMPLETENESS_HANDOFF.md`
  and the relevant Stage 7.5 OpenSpec historical correction text.
- [x] Synchronize `docs/CURRENT_SYSTEM_STATE.md` with the current endpoint-level
  matrix and local-only release boundary.
- [x] Keep D-056's broad Seller organization visibility language as history and
  explicitly document the later endpoint-specific financial read boundary.

## Verification and delivery

- [x] Run focused API and frontend tests with direct exit codes.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run check`,
  `npm run db:verify`, migration guards, API contract, web source/static
  boundary checks, and `git diff --check`.
- [x] Run strict validation for this Change and `openspec validate --all
  --strict`.
- [x] Confirm the diff contains only this Change's code, tests, and necessary
  documentation, then create one normal local commit without amend.
