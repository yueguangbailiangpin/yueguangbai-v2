## Migration

- [x] M1. Confirm no schema or Migration change is required and preserve every
  existing Migration byte.
- [x] M2. Confirm no D1, R2, production, deployment or other remote operation
  is in scope.

## Canonical evidence and alias retirement

- [x] E1. Confirm the canonical composition is `StaffRouteModule →
  AcquisitionCoreWorkbench → AcquisitionCoreWorkbenchV4` and enumerate every
  non-archived legacy-alias consumer.
- [x] E2. Move the valid role-closure and Owner view MSW scenarios to a V4
  canonical test without restoring obsolete request semantics.
- [x] E3. Keep canonical route/browser evidence and reduce the browser request
  assertion to behavior-relevant fields.
- [x] E4. Delete only the zero-consumer Acquisition alias and its legacy test;
  leave all other Staff/Admin/Buyer legacy surfaces untouched.

## Verifier and governance

- [x] V1. Make the Acquisition verifier check current route-to-V4 composition,
  contract/behavior evidence, required source-security invariants and legacy
  alias absence.
- [x] V2. Add D-038 recording the evidence migration and retirement while
  preserving D-026 and referring to D-035 for current channel semantics.
- [x] V3. Run targeted canonical frontend/API/security tests, module check,
  verifier, workspace typecheck/build and target/all strict OpenSpec validation.
- [x] V4. Complete Formal Verify against this Change's proposal, design and
  tasks before the governed sync/archive transition; post-archive diff,
  migration and full-check evidence remains an external final gate.
