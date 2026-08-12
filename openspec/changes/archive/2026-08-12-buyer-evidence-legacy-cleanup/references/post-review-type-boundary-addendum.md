# Post-review addendum: Buyer task classification type boundary

## Finding after archive

After the Change was archived, an independent Phase 2 review identified one P2 finding in `apps/web/src/buyer/tasks/task-classification.ts`: `BuyerTaskSources` restated the task inputs with `string` for reservation, evidence, review, and refund statuses, allowed actions, and review types.

The archived `formal-verify-report.md` remains accurate evidence of the pre-fix verification point in time. This addendum records the later finding and repair; it neither removes nor rewrites that historical conclusion.

## Root cause and minimal repair

`BuyerTaskSources` was a hand-written presentation shape rather than a type derived from the six Buyer API list response items. The widening discarded the finite unions enforced by the Buyer runtime Zod schemas, so typos in the classified statuses, actions, or review types could evade TypeScript checking.

The repair derives each source fragment from its corresponding `buyerApi` list item with `Pick` and nested `Pick`. The classifier therefore retains the existing runtime-contract unions while accepting only the fields it reads. The task-classification fixtures now use `satisfies BuyerTaskSources`, so the test data is checked against the same boundary.

No runtime classifier branch, order, filter, copy, href, actionable count, API/runtime/schema, migration, manual-review behavior, or product decision changed. In particular, the existing `APPROVED` plus `UNPUBLISHED` UX seam was not changed. D-033 and D-036 are unchanged.

## Post-fix verification

- `npm exec vitest run apps/web/src/buyer/tasks/task-classification.test.ts apps/web/src/buyer/routes/BuyerLayout.test.ts`: PASS, 2 files and 14 tests.
- `npm run check:module1:buyer`: PASS, including 49 files / 263 Buyer-scope tests, web typecheck, and web production build.
- `node scripts/verify-module1-buyer-formal.mjs`: PASS; COMPLETE=58, Scenarios=116/116, no inconsistent, missing, partial, or unverified findings.
- `openspec validate --all --strict`: PASS, 64 items and 0 failures.
- `git diff --check`: PASS.
- Migration diff and untracked migration scope: zero.
