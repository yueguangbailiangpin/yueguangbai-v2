# Final repository stabilization audit

Audit date: 2026-08-11
Baseline: `feature/frozen-portals-staff-acquisition-core` at `8cb39ed870df1fc5c6874dd4e5b86e12e22c39d2`
Local cleanup branch: `chore/final-stabilization-cleanup`

## Before and after

| Boundary | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Code files under `apps`, `packages`, `scripts`, `migrations`, `tools` | 1,016 / 197,528 lines | 996 / 192,597 lines | -20 files / -4,931 lines |
| Non-test runtime source under API/Web `src` | 511 / 96,387 lines | 499 / 94,713 lines | -12 files / -1,674 lines |
| `scripts/verify-*.mjs` | 60 / 9,788 lines | 42 / 4,748 lines | -18 files / -5,040 lines |
| Core Worker upload | 2,200.55 KiB / gzip 395.40 KiB | 2,093.93 KiB / gzip 371.45 KiB | -106.62 KiB / gzip -23.95 KiB |
| Core App routes | 236 | 234 | -2 Staff MCP routes |
| OpenSpec | 645 files / 23,499,528 bytes | 402 files / 2,921,070 bytes | -243 files / -20,578,458 bytes |
| Archived visual evidence | 258 images / 21,697,910 bytes | 10 images / 1,103,987 bytes | -248 duplicate images |
| Competing root handoff/bootstrap authorities | 5 | 0 | -5 |
| Schema tables / indexes / triggers / views | 222 / 643 / 423 / 12 | 214 / 612 / 406 / 12 | -8 / -31 / -17 / 0 |
| Registered worktrees | 118 | 5 | -113 clean checkouts |
| Local branches | 121 | 34 | -87 merged refs |
| Legacy top-level delivery artifacts | 87 / 31 MiB | 0 in `~/Projects` | moved to recoverable Trash |

Line counts include TypeScript, JavaScript, SQL, Python, CSS and HTML. Runtime counts exclude `.test.*` and `.spec.*` files. Moves into `tools/` preserve useful offline import code and therefore do not fake a deletion win.

## Production composition

The final Wrangler metafile contains 421 inputs:

- Staff MCP inputs: 0; Feishu-named inputs: 0
- marketplace adapter inputs: 0
- offline import tool inputs: 0
- Google Drive cold-archive inputs: 9 / 77,974 source bytes

Staff MCP source and isolated tests remain in the repository but no longer enter the core Worker, route table or release templates. Google Drive cold archive remains in the core composition because current file recovery and scheduler code share that path; all four write/read activation flags remain required `false`. This audit does not claim those retained sources were deleted.

## Schema 65

Migration `0065_retire_feishu_artifacts.sql` is forward-only; migrations 0001–0064 remain byte-identical. It refuses to run unless every affected legacy and shared operational table is empty, then removes the unused Feishu/login/binding objects and rebuilds shared scheduler/alert tables without retired Feishu values. A non-empty negative test proves transaction rollback leaves Schema 64 unchanged.

Final schema inventory SHA-256: `88b93ce12164731809e235c94ff3e97f24b9db27e2756992292bfda627bbd199`. Fresh and sequential 0001→0065 inventories match; integrity is `ok`; foreign-key errors are zero.

## Verification record

- OpenSpec strict: 64 passed, 0 failed
- secret scan: 1,547 files, PASS
- dependency risk: 0 vulnerabilities
- migration guards: 65 repeat cases and 64 wrong-order cases rejected; 129 failed snapshots unchanged
- first full `npm run check`: FAIL at the all-repository test stage, 1,528 passed / 6 failed; the failures exposed stale route, scheduler and Schema count assertions plus one accidentally changed historical version expectation
- focused remediation: 29 passed / 0 failed
- final full `npm run check`: PASS; 232 test files / 1,534 tests, all workspace typechecks, database checks and builds passed
- Playwright: 186 passed / 1 explicitly skipped manual screenshot checkpoint / 0 failed
- final Worker dry-run: PASS; no deployment
- `git diff --check`: PASS

No production database, D1, R2, Worker, secret, Provider, Feishu, Drive or GitHub remote was read or mutated. No commit, push, PR, merge or deploy occurred.

## Preserved risks

- Thirty non-merged local branches still contain commits not reachable from the named final product ref. Their worktrees were removed, but deleting those branch refs without content review would be data loss rather than cleanup.
- `origin/*` refs were not changed because local repository cleanup does not authorize remote branch deletion.
- The main checkout and `controlled-production-data-import` worktree retain user-owned uncommitted paths and were not touched.
- Local proof does not establish production readiness or real Cloudflare/D1/R2/Provider acceptance.
