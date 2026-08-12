## Evidence migration

- [x] E1. Inventory the retired Dashboard files, verifier dependencies, canonical Buyer route/navigation/task evidence, and scoped CSS consumers.
- [x] E2. Add focused canonical Buyer task classification behavior coverage without importing retired ranking, deadline, deduplication, or Dashboard semantics.
- [x] E3. Update the Module 1 formal verifier mapping for `buyer-routing-dashboard` to canonical route, navigation, task behavior, and browser evidence.
- [x] E4. Add a narrow successor decision that retires D-033's then-current retained-file status without rewriting D-033.

## Legacy cleanup

- [x] L1. Delete only the retired Buyer Dashboard page, helper, test, and CSS proven to be Dashboard-only.
- [x] L2. Re-search the repository for dangling Buyer Dashboard imports, verifier references, source markers, test dependencies, and inaccurate active-document references.

## Validation and closure

- [x] V1. Run targeted Buyer task, route, and navigation tests; the Module 1 formal verifier; and the Module 1 Buyer check.
- [x] V2. Run strict OpenSpec validation, diff validation, migration-scope validation, and then the full repository check.
- [x] V3. Formal Verify confirms the implemented cleanup matches this Change; sync assessment confirms that this `skip_specs` cleanup has no delta specs to merge, so archive is permitted after V1 and V2.
