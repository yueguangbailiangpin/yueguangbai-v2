# staging-access-jwks-public-fetch Evidence

## Task 2.5 — staging deploy of merged SHA 5c72627e (2026-09-01)

Operator: GLM under Owner authorization (PR/merge/staging approved 2026-09-01; production excluded).

| Step | Command | Direct result |
|---|---|---|
| Pre-reset backup | `wrangler d1 export yueguangbai-v2-staging --remote` | backups/staging-pre-reset-full-20260901.sql, 1,814,873 B, SHA-256 1ab70926a04ea04f… |
| Release worktree | `git worktree add …/staging/release-5c72627e 5c72627efa04e968648135e551c63970269f7c80` | HEAD = merge commit of PR #120; web dist built (51 assets) |
| Git-external config | root `wrangler.staging.jsonc` main/assets/migrations_dir → release-5c72627e, `APP_RELEASE_SHA=5c72627efa04e968648135e551c63970269f7c80` | JSON valid; preflight `--environment staging` exit 0, errors [], all required operator fields present, external_calls 0 |
| D1 reset (Owner-approved test-data deletion) | drop-all SQL (899 statements, PRAGMA foreign_keys=OFF; no explicit BEGIN/COMMIT — D1 import rejects them and is atomic by itself) | Executed 899 queries, success |
| Fresh migrations | `wrangler d1 migrations apply … --remote` | all 41 applied; `SELECT schema_version FROM app_schema_state` → **41** |
| Worker deploy | `wrangler deploy --config wrangler.staging.jsonc` | Success, 51/51 assets, Worker yueguangbai-v2-staging @ staging.yueguangbai.net |
| Access isolation proof | `curl /health` → 302 to yueguangbai.cloudflareaccess.com (JWT aud = configured STAFF_ACCESS_AUD) | gate intact; app alive behind Access |
| Owner bootstrap | `node scripts/bootstrap-staging-first-owner.mjs --execute STAGING_FIRST_OWNER … --input first-owner-input.json` | `STAGING_FIRST_OWNER_BOOTSTRAPPED`, role owner, staff_id staging-owner-87d2c74e…, remote_writes 1, production_touched false |

Boundaries: LOCAL+STAGING only; production NOT_VERIFIED/NO_GO unchanged. T9 register (task 2.6) intentionally not claimed by this evidence.
