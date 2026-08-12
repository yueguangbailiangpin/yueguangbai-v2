# Post-review governance addendum: acquisition-alias-cleanup

## Purpose and scope

This addendum records the narrow post-archive governance correction requested
after independent review `019ff6db-110c-7362-b93f-fb95c9c71195`. It does not
rewrite the contemporaneous `formal-verify-report.md`, make a runtime claim,
or replace a test result. The permitted source scope is verifier/test-gate
governance and archive evidence only; API, runtime, contract, migration, D1,
production and remote state remain outside scope.

## Formal Verify correction

The original Formal Verify report's initial `8/9` and its statement that V3
included Formal Verify were bookkeeping errors. `tasks.md` contains ten tasks:
M1–M2, E1–E4 and V1–V4. V3 is the pre-Formal-Verify local-validation task;
V4, not V3, is the Formal Verify task. The task checklist's current closure is
therefore **10/10**, subject to this addendum's separately recorded post-fix
gates. The historical report remains preserved as a time-point artifact rather
than being silently altered.

`.openspec.yaml` declares `skip_specs: true`. The archived change has no delta
spec output, so the governed sync assessment is **no-op: no delta specs to
sync**, not an omitted spec synchronization.

## Post-fix verifier governance

The verifier now reports two independent results:

- **STRUCTURAL PASS** comes only from migration execution plus AST/file-system
  checks for the StaffRouteModule → Core → V4 composition, published
  acquisition-contract exports, and retirement of the two legacy alias paths.
- **BEHAVIOR TEST PASS** is produced by executing `npm run
  test:staff-acquisition`; it is not inferred from test names, comments, or
  runtime source snippets. That suite includes the D1/API acquisition tests
  exercising ACTIVE, audience/type, marketplace/site, Staff scope and Prospect
  mismatch rejection; immutable origin, append-only audit corrections,
  deduplication and idempotency; plus the canonical Staff UI and API-contract
  tests.

`check:staff-acquisition` calls the verifier and no longer invokes the same
behavior suite a second time. The behavior script is checked before execution
to reject an accidental verifier/check recursion.

## Evidence time boundary and results

The pre-fix Formal Verify report correctly stated that a later `npm run check`
was not yet represented there. It must not be read as proof that the full
workspace check ran at the time of that report. The implementation-phase full
gate was `npm run check` **PASS** on 2026-08-12; its retained final local
Wrangler dry-run log is `/private/tmp/ygb-full-check-wrangler.log` (last
modified 2026-08-12 21:21:58 +0800). The full terminal transcript was not made
an archive artifact, so this addendum preserves the distinction instead of
pretending that the original Formal Verify report contained it. The full check
is deliberately not rerun for this governance-only repair.

Post-fix governance verification ran at 2026-08-13T00:52:21+08:00 through
2026-08-13T00:53:24+08:00 on branch `chore/acquisition-alias-cleanup`, with
`HEAD`, `origin/main`, and the approved base all
`b819456bc897e70fd66d053f899c4aa1b2dcd4eb`. The worktree was intentionally
dirty with the Phase4 alias-retirement files plus this verifier/governance
repair; no commit was created. Results were:

- `node scripts/verify-staff-acquisition-funnel.mjs` — PASS: structural PASS;
  behavior PASS, 7 test files / 30 tests.
- `npm run check:staff-acquisition` — PASS, including D1 migration verification
  (schema 65), migration guards, the single verifier-owned behavior run,
  maintenance dry run, API/contracts/web typechecks, web build and browser test.
- `openspec validate --all --strict` — PASS: 64 passed, 0 failed.
- `git diff --check` — PASS; `git diff --exit-code -- migrations` — PASS
  (exit 0; no migration diff).

Post-fix Formal Verify therefore closes **10/10 tasks**, with no critical,
warning, or suggestion from this governance-only review. It verifies artifact
completeness, preservation of the declared no-runtime scope, and the corrected
test-gate model; it does not replace the original report's historical
time-point claims.

## Archive state

The change is already physically present under
`openspec/changes/archive/2026-08-13-acquisition-alias-cleanup/`. No archive,
sync, commit, push, pull request, deployment, D1/R2 operation or production
data action is performed by this addendum.
