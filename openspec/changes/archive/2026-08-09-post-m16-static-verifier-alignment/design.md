# Design: Post-M16 Static Verifier Alignment

## Authority

The verifier reads current repository truth in this order: the actual migration directory and migration owner files, then the current lazy route modules, then current production source. Historical archived Change files explain ownership but do not override current authority. `AGENTS.md`, D-024, D-026, D-027, D-028, D-029, and the product rules remain unchanged.

## Stable Assertions

- The Seller label check asserts the exact accessible selector now used by production source.
- Historical M14/M15 verifier paths apply only their owned migration prefixes, assert their own schema version and Migration contents, and reject a missing/renamed/incorrect predecessor. They do not demand that later, independently governed migrations be absent.
- The acquisition verifier requires an authoritative contiguous `0036` migration and accepts later migrations only when the directory remains contiguous and the migration guard validates the full chain.
- Scheduling route checks read `StaffRouteModule.tsx` and `StaffSchedulingRouteModule.tsx`, preserving checks that routes stay lazily isolated from the root application shell.
- The dashboard verifier confirms that it owns no Migration and that `0037_product_reservation_order_scheduling.sql` belongs to the archived M16 scheduling Change; it continues to fail closed if its protected financial, owner, query, or local-D1 assertions fail.

## Safety Boundary

No assertion is deleted, skipped, or converted to a permissive catch. Each affected verifier retains explicit failure for missing authority, non-contiguous migrations, wrong owner, wrong schema prefix, wrong route boundary, and protected security/permission source drift.

## Verification

Run each affected verifier first to reproduce its pre-change failure, then rerun it after the narrow update. Run OpenSpec target/all strict validation, `git diff --check`, dependency-risk and secret scans, migration guards/integrity, and one final `npm run check`. Ponytail is eligible only as a read-only post-validation review and must not change files.
