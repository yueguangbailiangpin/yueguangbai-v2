## 1. Scope and inventory

- [x] 1.1 Reconfirm local branch, HEAD, worktree, AGENTS, current system state, API conventions, route inventory, active/archived pagination OpenSpec evidence and all cursor consumers.
- [x] 1.2 Keep the family inventory and shared/non-shared compatibility reasons in `design.md`; confirm no migration, route registration, dynamic import or frontend decoder is in scope.

## 2. Shared primitive

- [x] 2.1 Add the foundation base64url byte, legacy binary-string, and UTF-8 JSON primitives with no domain validation leakage.
- [x] 2.2 Add primitive round-trip, Unicode, boundary, malformed/empty/invalid-padding tests.

## 3. Typed codec migration

- [x] 3.1 Migrate UTF-8 JSON cursor codecs while preserving each payload, version/kind, field, filter echo, length, empty and domain error rule.
- [x] 3.2 Migrate the two legacy binary-string JSON families only through the compatibility-preserving binary-string primitive.
- [x] 3.3 Remove only duplicate low-level base64/UTF-8 helper bodies; prove all targeted consumers use the foundation primitive with static import scans and focused tests. Leave raw/internal/frontend cursors unchanged.

## 4. Compatibility and pagination tests

- [x] 4.1 Add fixed pre-change token fixtures for every migrated typed codec and assert decode/encode compatibility.
- [x] 4.2 Cover malformed, empty, unknown-version/kind, illegal-field, wrong-family, filter-echo and tampered token behavior per typed codec.
- [x] 4.3 Run or extend two-page-plus traversal tests for each migrated API family, including stable tie-breakers, filter/organization scope, concealed 404, permission, idempotency and version boundaries where applicable.

## 5. Verification and handoff

- [x] 5.1 Run focused cursor/route tests with direct exit codes.
- [x] 5.2 Run `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, current Change strict validation, all OpenSpec strict validation, and `git diff --check`; do not pipe or mask exits.
- [x] 5.3 Inspect final status/diff, create one normal non-amended commit containing only this Change and its implementation, and verify branch/HEAD/clean worktree. Do not push, deploy, access remote CI/resources, or archive this Change.
