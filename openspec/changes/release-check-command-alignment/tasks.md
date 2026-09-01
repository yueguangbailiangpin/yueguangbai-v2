# Tasks: release-check-command-alignment

## Migration

- [x] 1.1 Confirm `NO_SCHEMA_CHANGE`; do not add, modify, or execute a
  migration.

## Contracts and governance

- [x] 2.1 Replace the four retired release names with the current manifest
  authorities and preserve release ordering/provenance semantics.
- [x] 2.2 Update current Drive and production-readiness runbook command
  references without rewriting historical acceptance records.

## Tests and verifier

- [x] 3.1 Keep the failing manifest guard, make it report all missing scripts,
  and add runtime fail-closed protection.
- [x] 3.2 Verify browser environment isolation follows `test:browser` and no
  retired name remains in the current aggregate.
- [x] 3.3 Audit every non-audit release subcommand for LOCAL/loopback-only
  behavior and preserve Production NO-GO.
- [x] 3.4 Run the guard, `npm run release:check`, `npm run check`, targeted
  Production Gate checks, OpenSpec strict validation, and `git diff --check`
  with direct exit codes.

## Delivery

- [x] 4.1 Inspect final diff scope and create one normal local commit only
  after all in-scope checks pass; do not push, deploy, sync, archive, amend,
  or rewrite history.
