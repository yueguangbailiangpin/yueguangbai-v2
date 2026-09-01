# Consumer evidence

## Fixed pre-change identity

- Branch: `feature/staging-workflow-rate-ux`
- Pre-change HEAD: `8e88744a2a1fe55f9823fec2e312d9673c87c148`
- Worktree: clean
- Ahead/behind: `origin/... ... HEAD = 0 87`
- Candidate SHA-256 before deletion:
  - `apps/api/src/customers/allocate-buyer-number.ts`: `9139817749a7b294a89508e0908a96adc9bf6bfa12f3f274e8f9ed142b710c14`
  - `apps/api/src/pricing/index.ts`: `e333f206c30dcbd31ef4702db1c198f734dbfa0002e38416b459a03a65e4b3c8`

## Candidate 1: `allocate-buyer-number.ts`

- `git ls-files` contains exactly one file with this basename.
- Tracked `git grep` found no path reference and only two symbol occurrences: the candidate's own export and a test comment stating that the command no longer exists. No test imports or calls the command.
- Hidden-worktree exact scans found no path reference, dynamic import string, script/config path, barrel export, or runtime registration.
- AST parsing of 977 tracked JS/TS code files resolved zero `import`, `export`, dynamic `import()` or `require()` edges to this candidate.
- The current canonical path is independent: `apps/api/src/customers/create-buyer.ts` imports `./buyer-number-allocation`, calls `planBuyerNumberAllocation`, and writes the buyer number in the creation batch. `apps/api/src/customer-security/invited-registration.ts` requires an existing bound buyer number and does not allocate one.
- Migration 0027 drops `buyer_preorder_number_allocations`; the old candidate's preorder-promotion query therefore cannot be a current database compatibility path. D-056/6.6E records profile-creation allocation and invitation binding as the current contract.
- No `scripts/`, `tools/`, package script, Wrangler entry, local preview entry, or other configuration references this candidate.

## Candidate 2: `pricing/index.ts`

- `git ls-files` contains exactly one file with this basename.
- Tracked and hidden-worktree scans found no import, export, dynamic import, require, package export, script, config, or runtime-entry reference to `apps/api/src/pricing/index.ts` or the `apps/api/src/pricing` directory.
- AST parsing of 977 tracked JS/TS code files resolved zero module edges to this barrel.
- The barrel is side-effect-free and only re-exports five modules. Existing consumers use deep paths:
  - `apps/api/src/index.ts` → `pricing/routes`, `pricing/seller-service-fee-routes`, `pricing/rate-center-routes`;
  - `apps/api/src/order-evidence/approve-order-evidence.ts` → `buyer-daily-exchange-rates`, `seller-principal-rate-policy`, `seller-service-fees`;
  - pricing route files/tests → their corresponding leaf modules and `pricing-shared`;
  - `scripts/verify-marketplace-registry.mjs` → explicit leaf source paths.
- The five barrel exports remain independently covered by these direct consumers; deleting the barrel changes no import specifier.

## Required post-change assertions

- The two candidate paths are absent.
- No active code, tests, scripts, tools, package/config files, dynamic loaders, or barrel/export chains mention either candidate path.
- Canonical buyer numbering and every pricing leaf deep-path import remain present.
- Only the two candidate source files plus this independent OpenSpec Change are changed.
- LOCAL evidence may be reported; STAGING, REMOTE CI, and PRODUCTION remain unvisited. Production remains `NO-GO`.

## Verification results before commit

All commands below ran directly in this checkout and exited 0: focused source/path scans; AST import/export/dynamic-loader scan; `npm run typecheck`; `npm test` (264 files / 1870 tests); `npm run build`; `npm run verify:api-contract` (4 tests); `npm run verify:web-source-boundaries`; `openspec validate remove-verified-api-orphans --strict`; `openspec validate --all --strict` (77/77, also reached by `npm run check`); `npm run check`; and `git diff --check`.

`npm run check` also passed CSS duplicate/ownership, secret/dependency lifecycle, node safety, final-production-go, D1/migration guards, capacity suites, DTO/permission/file boundaries, the repeated full test/build chain, and web static-build verification. Its staging and production preflights returned `BLOCKED_NEEDS_OPERATOR_INPUT` with `external_calls=0`, `deployments=0`, and `resource_mutations=0`; this is local readiness evidence only, not staging/production acceptance.
