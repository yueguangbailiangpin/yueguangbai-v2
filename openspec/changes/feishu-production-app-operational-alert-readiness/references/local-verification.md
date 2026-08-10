# Local Verification Evidence

## Baseline and Isolation

- baseline: `origin/main` at `513b9402faeb5da3a452315ad08f32cfec778e5d`
- branch: `feature/feishu-production-app-operational-alert-readiness`
- dedicated worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/feishu-production-app-operational-alert-readiness`
- main-worktree protected untracked directories: observed and untouched
- remote/provider/deployment/production data/Secret writes: `0`

## Real Results

| Command or gate | Result | Evidence |
| --- | --- | --- |
| initial API typecheck and targeted test attempt before dependency installation | FAIL | local worktree had no installed dependencies; `tsc`/Vitest were unavailable; no source or external state changed |
| `npm ci --cache /tmp/ygb-v2-feishu-alert-npm-cache` | PASS | 225 packages installed locally; manifests unchanged; audit reported 0 vulnerabilities |
| first targeted alert/preflight run | FAIL | 57/58 tests passed; one preflight key-name regex incorrectly treated the legitimate OAuth token endpoint variable as a managed token value; regex narrowed and regression retained |
| final targeted typecheck plus six-file regression | PASS | 6 files, 58 tests |
| `npm run check:feishu-production-app` | PASS | combined preflight `LOCAL_NO_GO`; 7 files, 60 tests; API and Contract typechecks PASS; calls/deployments/mutations all 0 |
| `npm run check:feishu-workbench` | PASS | existing verifier and zero-network dry-run PASS; 3 files/24 tests plus 6 activation-preflight tests; API and Contract typechecks PASS |
| `npm run check:staff-auth-production` | PASS | route guard and preflight PASS; 4 files, 31 tests; API and Contract typechecks PASS |
| `node scripts/verify-production-cloudflare-web-r2-release-configuration.mjs` | PASS | templates remain default-off and operator-blocked; `NO_SCHEMA_CHANGE`; production `NO_GO` |
| `npm run verify:openspec:strict` | PASS | 58 specs/changes passed, 0 failed |
| `npx openspec validate feishu-production-app-operational-alert-readiness --strict --no-interactive` | PASS | active Change valid |
| `npm audit --audit-level=high` | PASS | 0 vulnerabilities |
| `npm run check` | PASS | secret scan 1,635 project files; all workspaces typecheck; Migration 0001–0043; 227 test files/1,490 tests; API dry-run build and Web build PASS |
| browser/visual test | SKIP | no Web presentation, route or interaction changed |
| real Feishu OAuth/Task/callback/message and Cloudflare release acceptance | SKIP | explicitly prohibited; no account login, Provider call, deployment, Secret read/write or production resource mutation |

## Migration Decision

`NO_SCHEMA_CHANGE`. The implementation reuses 0031 alert state/signals, 0033 Workbench mirrors/receipts and 0034 Feishu dead-letter categories. No 0044 file was created and historical migrations were not edited.

## Production Status

`LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`. Remaining blockers are current real-app scopes, callback/redirect registration, application availability, bot/private-group membership, version publication/admin approval, Provider send/receive evidence, an independent non-Feishu primary alert receiver, and owner-approved activation/rollback evidence.
