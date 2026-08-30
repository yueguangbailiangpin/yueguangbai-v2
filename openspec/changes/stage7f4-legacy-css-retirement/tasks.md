# Tasks: stage7f4-legacy-css-retirement

## 1. Migration

- [x] 1.1 Confirm and record `NO_SCHEMA_CHANGE`, `NO_D1_MIGRATION`, `NO_REMOTE_RESOURCE`,
  `NO_DEPLOYMENT`, and `NO_PRODUCTION_WRITE` for the final worktree.
- [x] 1.2 Preserve the current `tokens.css` values, local Material Symbols Rounded assets,
  portal routes, and existing Buyer/Seller/Staff visual layer order while replacing only
  the retired CSS entry imports.
- [x] 1.3 Record the final retain/migrate/delete selector evidence table, including dynamic
  class families and any explicit unresolved compatibility dependency.

## 2. Contracts

- [x] 2.1 Confirm no API, DTO, schema/envelope, cursor, permission, or file-contract source
  changed; existing Buyer/Seller DTO isolation tests remain the contract boundary.
- [x] 2.2 Confirm Seller `ORDER_COMMUNICATION_SCREENSHOT` rendering and the four Staff
  permission paths are untouched by the CSS-only Change.

## 3. Domain and API

- [x] 3.1 Do not modify domain, API, database, migration, Cloudflare, Drive, queue, or
  production resources; verify the final diff contains none of these scopes.

## 4. Tests

- [x] 4.1 Add and run the CSS ownership/source/static guard for retired imports, dynamic
  exceptions, dead selector branches, exact duplicates, local assets, and no inline style.
- [x] 4.2 Run focused Buyer/Seller/Staff component and route tests covering shell, form/list/
  detail, drawer/modal, loading/empty/error, focus, reduced-motion, and protected-image
  presentation where those tests exist.
- [ ] 4.3 Run local Playwright/screenshot harness against the built app for Buyer, Seller,
  and Staff desktop and 390px mobile evidence; review generated images individually and
  record fixture/authentication gaps rather than claiming static equivalence.
- [x] 4.4 Run `npm run typecheck`, `npm run build`, `npm test`, `npm run check`, and
  `git diff --check` with direct command exits captured from the final worktree.

## 5. Verifier

- [x] 5.1 Run current Change strict validation and `openspec validate --all --strict`.
- [x] 5.2 Re-run CSS/source/static boundary guards, Material Symbols/local-asset/no-Lucene/no-
  retired-entry guards, and existing API-contract/source-boundary/static-build guards.
- [ ] 5.3 Inspect final `git diff --stat`, `git status --short --branch`, branch/HEAD, and
  commit scope; create one normal local commit containing only this Change and its CSS/
  guard/test evidence. Do not push, deploy, or archive the Change.
