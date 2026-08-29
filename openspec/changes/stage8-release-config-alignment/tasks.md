# Tasks: stage8-release-config-alignment

## Migration and contracts (no schema change)

- [x] 1.1 Confirm `NO_SCHEMA_CHANGE`; leave all Migration files and
  `packages/contracts` untouched.
- [x] 1.2 Inventory every active core Wrangler/config sample and replace legacy
  archive switch entries with the four canonical `ARCHIVE_*` string defaults.

## Runtime, preflight and verifier

- [x] 2.1 Keep Cloudflare runtime and cold-archive runtime on the canonical
  `ARCHIVE_*` names and add fail-closed coverage for each missing/non-false field.
- [x] 2.2 Update `preflight-cloudflare-release.mjs` and its tests so every
  canonical switch is required and exactly `"false"`; legacy names cannot satisfy
  the release gate.
- [x] 2.3 Update `preflight-google-drive-cold-archive.mjs` and tests to use the
  same canonical names for shadow-copy activation and reject legacy names.
- [x] 2.4 Update the production Cloudflare release verifier and any active config
  fixture/entrypoint checks to assert the canonical set and no legacy active keys.

## Focused regression tests

- [x] 3.1 Replace file read-intent string-substring security assertion with exact
  allowed DTO keys and negative `url`/permanent URL property assertions.
- [x] 3.2 Make the scheduled-operation concurrent promises immediately observed,
  assert one success plus one `REQUEST_IN_PROGRESS`/409, and run the file repeatedly.
- [x] 3.3 Add template-rendered preflight cases for each missing canonical switch,
  all-false success, old-name-only rejection, and runtime missing-switch refusal.

## Documentation and OpenSpec

- [x] 4.1 Update active release contract, Google Drive activation checklist,
  cold-archive runbook, and active archive/release specs; mark historical legacy
  names as deprecated only where traceability requires them.
- [x] 4.2 Record real local command exits, known pre-existing failures (if any),
  no-remote/no-deploy boundary, and final Git state in the handoff report.

## Acceptance

- [x] 5.1 Run focused config/preflight/runtime tests, both flaky-test files
  repeatedly, and the requested typecheck/test/build/check/database/verifier/
  OpenSpec/diff gates without piping away exit codes.
- [x] 5.2 Leave the worktree clean with only local commits for this Change; do not
  push, deploy, or enter Stage 8.

## Local evidence (2026-08-30)

All requested local gates exited `0`: focused archive/config/runtime and two
regression files (including five repeats each), `npm run typecheck`, `npm test`,
`npm run build`, `npm run check` (260 files / 1815 tests), `db:verify`, migration
guards, API contract, web source boundary, web static build, both OpenSpec strict
validations, and `git diff --check`. No remote resource or deployment command
was run; production remains `NO-GO` pending independent approval/evidence.
