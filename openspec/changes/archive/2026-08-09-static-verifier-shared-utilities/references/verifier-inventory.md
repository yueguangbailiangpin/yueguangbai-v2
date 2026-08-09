# Static Verifier Inventory and Retention Evidence

Date: 2026-08-09 (Asia/Shanghai)

## Bounded inventory

The baseline inventory contained 59 `scripts/verify*.mjs` files and 9,452 lines. Manual helper classification found 24 files carrying repeated read/assert/marker mechanics; 48 files used direct exact-source `.includes(...)` markers. After the bounded extraction there are still 59 verifier files, now 9,340 lines. Five repeated helper copies were removed in favor of `verifier-utils.mjs` (24 → 19), 11 current verifier files now import the shared utility, and direct exact-marker files reduced 48 → 46 because markers moved behind the same fail-closed shared assertion. No marker requirement or caller-specific security assertion was removed.

The common Change resolver rejects missing evidence, more than one dated archive, active/archive coexistence, symlink directories, invalid Change names, missing/symlink evidence files, and paths escaping the Change. Nine deterministic tests cover these cases plus successful active/archive resolution. Existing exact requirements, scenarios, Migration, permission and transport assertions remain in their callers.

## Files without a current package command

Package scripts and current gate traversal do not directly name the following 19 historical verifiers (3,955 lines). Absence from `package.json` alone is not deletion proof: each file entered Git with the archived implementation wave and remains useful for reproducing that wave's acceptance/security evidence.

| Verifier | First evidence commit | Classification |
| --- | --- | --- |
| `verify-phase3c-files.mjs` | `07ab295` (2026-07-31) | Phase 3C file architecture reproduction |
| `verify-phase3c2-file-audiences.mjs` | `a24760b` | Phase 3C2 audience/isolation reproduction |
| `verify-phase3d-order-evidence.mjs` | `504fe44` | Phase 3D order-evidence reproduction |
| `verify-phase3e-pricing.mjs` | `07ab295` | Phase 3E pricing/Migration reproduction |
| `verify-phase3e2-product-ordering-profiles.mjs` | `ca88a45` | Phase 3E2 product/order profile reproduction |
| `verify-phase3e2-security-scan.mjs` | `ca88a45` | Phase 3E2 security reproduction |
| `verify-phase3f-formal-orders.mjs` | `ffabb58` | Phase 3F formal-order reproduction |
| `verify-phase3g-buyer-dto.mjs` | `a442b66` | Phase 3G Buyer DTO reproduction |
| `verify-phase3g-migration.mjs` | `a442b66` | Phase 3G Migration reproduction |
| `verify-phase3g-order-instructions.mjs` | `a442b66` | Phase 3G instruction reproduction |
| `verify-phase3g-security-scan.mjs` | `a442b66` | Phase 3G security reproduction |
| `verify-phase3g-seller-isolation.mjs` | `a442b66` | Phase 3G Seller isolation reproduction |
| `verify-phase3h-migration.mjs` | `98afc58` | Phase 3H Migration reproduction |
| `verify-phase3h-security-scan.mjs` | `cacde73` | Phase 3H security reproduction |
| `verify-phase3h-staff-assignment.mjs` | `cacde73` | Phase 3H Staff assignment reproduction |
| `verify-phase4a-http-auth.mjs` | `07ab295` | Phase 4A HTTP auth reproduction |
| `verify-phase4a2-buyer-self-registration.mjs` | `eae7b12` | Phase 4A2 registration reproduction |
| `verify-phase5a-reviews.mjs` | `d3d2b5d` | Phase 5A review reproduction |
| `verify-phase5b-buyer-refunds.mjs` | `d3d2b5d` | Phase 5B refund reproduction |

## Retention decision

All 19 files are retained. Proving safe deletion would require a separate OpenSpec Change mapping every archived task/acceptance reference to a replacement command and demonstrating historical reproduction after removal. This Change does not meet or attempt that stronger proof, so deletion fails closed. No dependency was added and no production runtime code was changed by the utility extraction.
