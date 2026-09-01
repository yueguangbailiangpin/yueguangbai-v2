# Local acceptance and rollback evidence

This Change is local implementation evidence only. It does not activate production.

## Baseline

- Repository: `/Users/yueguangbai/Projects/yueguangbai-v2`
- Isolated worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/seller-principal-rate-policy`
- Verified `origin/main`: `6c233e26e043c23d64fab58e9b7e9792e580de48`
- Main worktree was dirty with user-owned untracked `packages/*` directories; those files were preserved and not edited.
- Current migration tail at baseline: `0040_seller_partner_master_data_import.sql`; this Change adds `0041_seller_principal_rate_policy.sql`.

## Formula and sample

`final_rate = authoritative_daily_rate(order_date) + absolute_markup`.

For 10,000 JPY, `0.051 + 0.004 = 0.055`, and `10,000 × 0.055 = 550 CNY = 55,000 fen`. The encoded values are `5,100,000 + 400,000 = 5,500,000` at scale `100,000,000`. Rounding is integer `HALF_UP`.

## Rollback

The migration is additive and has no safe down migration. To stop the feature, disable/revert the application code to the 0040-compatible implementation while leaving 0041 tables and immutable facts in place. Do not delete policy or snapshot rows, and do not recalculate old payables. A financial correction follows the existing correction/reversal flow. Production rollback and migration execution are outside this local Change.

## Production cutover order (runbook only; not executed)

1. In an approved window, re-read the candidate SHA, live migration ledger, backup/restore evidence, and current Staff authorization facts. Do not infer live schema from this worktree.
2. Apply Migration 0041 and verify its transaction assertions, schema version 41, policy/event immutability, pending/effective uniqueness, snapshot cross-source guards, and the HALF_UP amount guard.
3. Deploy the compatible Worker with `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED=false` (the local Wrangler configuration defaults to false). In this phase the Staff workbench is usable while confirmation remains on the 0040-compatible seller-agreement calculation; no new 0041 strategy is required for the compatibility path.
4. Through the Staff workbench, use a real Owner session (the current four-role resolver gives Owner `GLOBAL`) to submit the default JPY→CNY policy (the initial local sample is absolute `+0.004`) with an explicit future effective timestamp, then have an Owner with `FINANCIAL_CORRECT` confirm it and record the decision/audit request IDs. Seller Ops may submit only an override for an assigned organization; Owner may submit an override only within its GLOBAL scope.
5. Read the confirmed default and resolve a known order-date daily rate in a dry-run/staging verification. Confirm the policy effective boundary is before the intended smoke order and that the exact Amazon order date has a confirmed daily rate. Keep the switch false if either prerequisite is absent.
6. Under a separate production authorization, set `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED=true`, then perform controlled confirmation smoke checks. When true, both confirmation paths require the exact-date strategy and return `SELLER_PRINCIPAL_RATE_NOT_FOUND` without financial facts if it is absent; they never use the nearest date or a legacy agreement fallback.

This sequence is evidence and procedure only. No production D1/R2 operation, policy write, migration, deployment, switch change, or external resource write was performed by this Change.

## External write evidence

`REMOTE_WRITES=no`

`CLOUDFLARE_RESOURCES_TOUCHED=no`

`D1/R2/DOMAIN/DNS/FEISHU/DRIVE/TENCENT_DOCS/MCP/REAL_SECRETS/PRODUCTION_DATA=not touched`

## Final local acceptance

- `npm test`: PASS, 221 test files / 1,431 tests.
- `npm run typecheck`: PASS for all workspaces; `npm run build`: PASS with local Wrangler dry-run and web build.
- `npm run security:scan`: PASS, 1,597 project files scanned.
- `npm run db:verify`: PASS, schema 41, 180 tables, 330 triggers, integrity `ok`, foreign-key errors 0.
- `npm run verify:migration-guards`: PASS, sequential 0001 -> 0041, wrong-order/repeat/no-partial-DDL rejected.
- `npm run verify:openspec:strict`: PASS, 54/54 items.
- Direct SQL/HTTP/UI coverage: PASS for 0041 policy/event state guards, pending/effective uniqueness, concurrent submission, snapshot cross-date/cross-organization/incorrect-amount rejection, no-store/error boundary, trusted Staff data-scope assigned/cross-org/GLOBAL/Personal DENY flows, Owner global/default and organization submit flows, Seller Ops assigned override/explicit-zero flow, and Owner decision flows.
- Two-stage enforcement coverage: PASS for default-off compatibility confirmation with no strategy, enabled fail-closed confirmation with no strategy, enabled confirmation with an existing strategy, and local Wrangler binding `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED=false`.
- Production-readiness formal, final-go-local, Cloudflare release, Staff MCP production transport, Drive archive and web static build verifiers: PASS as local-only / `NO_GO` evidence; reported external calls/writes remained 0 where applicable.
- Production-readiness, final-go-local, and Cloudflare release verifiers: PASS as local-only / `NO_GO` evidence.
- `npm run verify:api-contract`: intentionally not applicable to this Change; its dedicated verifier rejects any runtime/schema change outside the separate API-contract-baseline Change and returned that scope failure. The route inventory tests themselves were updated and passed at 195 endpoints.

The full repository test run was repeated after the Migration 0041 compatibility fixtures and schema-count assertions were updated and passed without failures. No production or remote migration was executed.
