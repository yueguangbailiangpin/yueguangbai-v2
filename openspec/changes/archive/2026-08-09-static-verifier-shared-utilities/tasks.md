## 1. Inventory and Dependency Proof

- [x] 1.1 Record verifier count/lines, duplicated assert/read helpers, exact-marker files, package-command references, and OpenSpec/acceptance references.
- [x] 1.2 Identify historical verifiers with no current package command and classify their archived reproduction dependencies.
- [x] 1.3 Retain every unproven historical verifier; create no deletion in this Change.

## 2. Shared Utility

- [x] 2.1 Add standard-library read, assert, marker, and exactly-one active/archive helpers.
- [x] 2.2 Add deterministic tests for active, archived, missing, duplicate, coexistence, invalid archive name, symlink, and missing evidence cases.
- [x] 2.3 Adopt the helper in release/Staff MCP verifiers and only mechanically identical low-risk callers.
- [x] 2.4 Preserve every caller-specific security, migration, permission, and exact-marker assertion.

## 3. Validation and Evidence

- [x] 3.1 Run all changed verifiers and focused utility tests.
- [x] 3.2 Recount scripts, lines, duplicate helpers, and marker files and record the bounded reduction.
- [x] 3.3 Run strict OpenSpec, migration, dependency, secret, repository, and release gates.
- [x] 3.4 Confirm no historical verifier deletion, dependency addition, production runtime change, or external write.
