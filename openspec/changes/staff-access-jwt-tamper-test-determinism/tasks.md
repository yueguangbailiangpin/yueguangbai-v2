# Tasks: staff-access-jwt-tamper-test-determinism

## Migration

- [x] 1.1 Confirm `NO_SCHEMA_CHANGE`; do not add, modify, or execute a
  migration.

## Tests

- [x] 2.1 Add a deterministic regression that demonstrates the old fixed `aa`
  replacement is a no-op when the signature already ends in `aa`.
- [x] 2.2 Replace the inline fixed-suffix mutation with a test-local helper that
  flips a decoded signature byte and preserves legal JWT formatting.
- [x] 2.3 Keep the existing bad-signature verifier assertion and ensure it uses
  the deterministic helper without changing production JWT verification.

## Verification

- [x] 3.1 Run the focused Staff Cloudflare Access test repeatedly and record
  direct exits, including the repair-before failure and repair-after passes.
- [x] 3.2 Run `npm run check`, relevant security/auth guards, strict OpenSpec,
  and `git diff --check`; run `release:check` only as a local diagnostic if
  useful and report its pre-existing browser-gate exit accurately.

## Delivery

- [ ] 4.1 Inspect the final diff, preserve the unrelated
  `release-check-command-alignment` 6/8 task state, and create one normal local
  commit only after in-scope checks pass; do not push, deploy, sync, or archive.
