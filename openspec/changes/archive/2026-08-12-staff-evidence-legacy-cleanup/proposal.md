## Why

Seller Settlement remains a mandatory Staff frontend workflow, but its only implementation and MSW evidence still live in the retired `StaffWorkbench` while the production Staff route renders the Frozen canonical composition. This leaves the canonical route incomplete and blocks truthful retirement of the legacy Staff workbench.

## What Changes

- Move the existing Seller Settlement summary, payable, payment, allocation, reversal and protected-proof workflow into one reusable canonical Staff component.
- Mount that component from the Frozen Staff work-item composition for an authorized Seller Organization context.
- Gate visibility to `owner` or `seller_ops` with `SELLER_SETTLEMENT_VIEW`, gate record/allocation actions with `SELLER_SETTLEMENT_RECORD`, and gate payment reversal with `FINANCIAL_CORRECT`; backend authorization and concealed scope checks remain authoritative.
- Preserve current request paths, bodies, integer CNY facts, principal/service-fee separation, idempotency, expected-version, proof and audit semantics.
- Correct two existing legacy-UI conflicts during takeover: do not expose settlement controls to roles/permissions the backend rejects, and do not offer PDF proof selection when the payment command accepts only JPEG/PNG/WebP.
- Migrate still-valid Staff workbench scenarios and evidence to canonical component/integration tests and verifiers, then remove the duplicate legacy Staff workbench implementation and test.
- Add a new Decision Register entry for the verified takeover and cleanup without rewriting D-024, D-025, D-034, archived Changes or any Migration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `staff-internal-operations-workbench`: make the Frozen production composition the sole Seller Settlement frontend owner and make role/permission visibility and canonical evidence explicit.

## Impact

- Web: canonical Staff workbench composition, one extracted Seller Settlement component, canonical MSW tests, package test targets and the scheduling verifier evidence pointer.
- Governance: one current Decision Register entry and one delta to the existing Staff workbench specification.
- APIs/contracts/data: no route, request, response, financial formula, state machine, authorization service, schema or Migration change.
- Privacy/security: client gating mirrors the current role and effective-permission projection; every request still rechecks Staff status, Personal DENY, Seller Organization/Marketplace scope and proof authorization on the backend.
- Rollback: revert the frontend/evidence/governance diff before release. No financial fact is rewritten or reversed by rollback.
