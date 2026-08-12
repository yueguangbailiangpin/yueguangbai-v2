# Post-review completion addendum: admin-legacy-cleanup

## Purpose and historical boundary

Independent Phase 5 review `019ff703-0405-78d3-b1e2-4e251c027939` identified
two P1 evidence gaps in the canonical Admin dashboard tests. This addendum
records the narrow post-archive test/governance repair. It does not rewrite
`references/formal-verify-report.md`: that file remains the truthful
pre-archive Formal Verify snapshot and explicitly states that its final full
repository gate was a later execution step.

The archived Change remains at
`openspec/changes/archive/2026-08-13-admin-legacy-cleanup`. Its
`.openspec.yaml` declares `skip_specs: true`, so semantic delta-spec sync is a
no-op; no delta spec was created or synchronized. No commit, push, pull
request, deployment, D1/R2 operation, production access, or remote write was
performed for this addendum.

## P1 repair

- **P1a — Frozen MSW coverage:** the canonical fixture now supplies
  contract-valid non-empty `daily` and `channel_daily` facts plus non-zero
  identity, attribution, and finance integrity counts. It renders the channel
  fact and exact attribution warning, while preserving the owner boundary
  zero-request assertion and owner-cache removal after a 401. The published
  dashboard and financial DTOs use their existing contract types with
  `satisfies`; the acquisition-daily response remains checked by the
  production component's strict runtime schema rather than a test-invented
  DTO.
- **P1a — three reporting windows:** the test observes actual summary requests
  for `window=TODAY`, `window=WEEK`, and `window=MONTH`, then proves the
  dependent daily ranges `2026-08-04:2026-08-10` and
  `2026-08-01:2026-08-31` plus distinguishable server facts `本周渠道事实` and
  `本月渠道事实`. TODAY renders `今日渠道事实`.
- **P1b — browser evidence:** the canonical route defaults to TODAY with
  non-empty channel/integrity facts, then a real click on `本周` produces the
  distinguishable `本周渠道事实` and records the `WEEK` summary request. It does
  not duplicate all MSW cases.

This changes only the canonical Frozen MSW test, canonical Admin browser test,
this addendum, and its checklist. No production component, API route, backend
read model, runtime contract, migration, or financial behavior was changed to
accommodate the tests.

## Post-review verification

The affected gates were executed on 2026-08-13 before the one final workspace
gate:

- `npm run test:admin-dashboard` — PASS, 6 files / 21 tests.
- `npm run test:admin-dashboard:browser` — PASS, 2/2 Chromium tests. The
  first browser attempt found only a Playwright strict-text selector collision
  between `身份冲突` and the empty-state heading; the selector was made exact,
  then only this failed browser gate was rerun.
- `npm run db:verify` — PASS: schema 65, fresh/sequential inventory match,
  `integrity_check=ok`, and zero foreign-key errors.
- `npm run verify:migration-guards` — PASS: 65 migrations, fresh schema 65,
  65 repeat rejections and 64 wrong-order rejections.
- `npm run verify:admin-dashboard` — PASS: canonical route chain and retained
  backend routes/trend/drilldown/read-model/contracts, with production
  resources touched = 0.
- `npm run verify:openspec:strict` — PASS, 64 passed / 0 failed.
- `git diff --check` — PASS; `git diff --exit-code -- apps/api migrations` —
  exit 0, so the post-review delta has no backend or migration change.

The required one and only final `npm run check` completed with exit 0. Its
complete isolated transcript is
`/private/tmp/ygb-admin-phase5-full.KlV6Nn/npm-run-check.log` (668 lines).
The scan reports `敏感信息扫描通过（1547 个项目文件）`; the full workspace test
run reports 234 files / 1,547 tests passed, and all workspace builds complete.
The isolated temporary runtime paths were
`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `WRANGLER_LOG_PATH` under the same
`/private/tmp/ygb-admin-phase5-full.KlV6Nn` directory.

## Final full-check rerun timeline

This timeline preserves every material full-check result; a targeted pass is
not represented as a full-check pass.

- The first successful full-check log was retained without an independent
  exit-code file, so it is historical evidence only.
- After tightening the `TODAY` assertions, the second full check exited 1 on
  the pre-existing Staff Session 401 cache-clearing auth flake. The subsequent
  independent targeted diagnosis passed 14/14; the related source remained
  zero-diff.
- The immediately preceding full check exited 1 on the pre-existing
  `apps/api/src/staff-mcp/staff-mcp.test.ts` timeout. Its independent diagnosis
  passed 1 test with 14 skipped in 424ms, exit 0; `apps/api` and the Staff MCP
  runtime remained zero-diff against the fixed base.
- This final full check ran once with `pipefail` and `tee` and exited 0. The
  evidence directory is
  `/private/tmp/admin-legacy-cleanup-final-attempt.7392uo`; the atomic exit
  record is
  `/private/tmp/admin-legacy-cleanup-final-attempt.7392uo/exit-code.txt`, and
  the transcript is 668 lines. The full workspace run reports 234 test files
  and 1,547 tests passed; the sensitive scan reports
  `敏感信息扫描通过（1548 个项目文件）`. The post-run status and allowlist
  are unchanged, `git diff --check` passes, and the backend/contracts/
  migrations boundary remains zero-diff.

## Closure state

`tasks.md` is now 10/10 checked only for completed work, including this
post-review P1 closure. The original Formal Verify remains historical rather
than being backfilled with later evidence. The archived Change has no delta
spec to sync and no uncommitted archive operation to perform. It is ready for
independent re-review of P1a/P1b.
