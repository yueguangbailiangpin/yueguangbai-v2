## 1. Scope and contracts

- [x] 1.1 Confirm the six canonical Buyer task API contracts, routes, read models, cursor semantics, D-033, and Module 1 verifier boundary.
- [x] 1.2 Confirm no migration, API contract, authorization, database, R2, or production-resource change is required.

## 2. Web implementation

- [x] 2.1 Add a shared, cancellation-aware sequential cursor collector with repeated-cursor, duplicate-resource, and hard-cap protection.
- [x] 2.2 Wire all six Buyer task sources to consume complete cursor chains before existing classification.
- [x] 2.3 Prevent an incomplete source set from rendering a numeric actionable total while retaining current actionable/system-processing semantics.

## 3. Tests and verification

- [x] 3.1 Add focused Web coverage for later-page tasks, empty continued pages, duplicate resources, cyclic cursors, all six cursor parameters, and cancellation.
- [x] 3.2 Run focused Web/Vitest, Module 1 verifier, API/Web typechecks, OpenSpec strict validation, diff checks, and the repository check once.
- [x] 3.3 Run the local Buyer E2E suite (89 Chromium tests) without changing production resources.
