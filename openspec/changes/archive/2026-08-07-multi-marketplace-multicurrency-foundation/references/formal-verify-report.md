# Formal Verify: multi-marketplace-multicurrency-foundation

Verified on 2026-08-07 Asia/Shanghai against the `spec-driven` proposal, design, tasks and delta spec returned by `openspec instructions apply`.

## Scorecard

| Dimension | Result |
| --- | --- |
| Completeness | PASS — 18/18 tasks, 5/5 requirements |
| Correctness | PASS — 5/5 requirements and 10/10 scenarios have implementation and test evidence |
| Coherence | PASS — registry, adapter, immutable fact, authorization and compatibility decisions follow the design |
| Findings | 0 critical, 0 warning, 0 suggestion |

## Requirement and scenario evidence

1. Marketplace registry is the stable platform boundary.
   - Migration 0029 defines currencies and the three stable Marketplace rows at `migrations/0029_multi_marketplace_multicurrency_foundation.sql:13` and `:30`; Korea is disabled/unavailable.
   - Runtime registry and Amazon JP/US Adapter normalization are covered by `apps/api/src/marketplaces/marketplace-foundation.test.ts:30` and `packages/domain/src/marketplace/adapter.test.ts:8`; Coupang fail-closed is covered at `adapter.test.ts:21`.
2. Seller Organization is global and Store owns Marketplace.
   - The canonical Store ownership table is defined at Migration 0029 line 105; Store creation resolves the registry and enforces Organization+Store scope in `apps/api/src/catalog/create-store.ts:68-303`.
   - One Organization with JP and US Stores is covered at `marketplace-foundation.test.ts:47`; existing Seller DTO/Organization isolation remains in the full repository suite.
3. Buyer has one immutable operational Marketplace.
   - The one-row-per-Buyer assignment and database formal-fact guard are defined at Migration 0029 lines 78 and 167.
   - `correct-buyer-marketplace.ts:64-252` requires both owner and the high-risk permission, validates target Marketplace, uses idempotency/versioning, checks every formal fact family, and appends correction plus audit events.
   - Fact-free correction, replay, ordinary Staff rejection, absent Buyer route, Reservation rejection, canonical financial-snapshot rejection and direct SQL fact-guard rejection are covered at `marketplace-foundation.test.ts:73-337`.
4. Money and rate facts are currency explicit.
   - Contracts and runtime validation are in `packages/contracts/src/marketplace-money.ts`; BigInt conversion and frozen exponents/rounding are in `packages/domain/src/money/currency.ts` with JPY, USD, half-up, mismatch and bound tests at `currency.test.ts:22-44`.
   - The canonical immutable formal snapshot and its source guard are defined at Migration 0029 lines 607 and 724. `lock-money-snapshot.ts:54-339` validates Buyer/Store/Marketplace/currency/rate/fee sources, calculates with BigInt and locks version/value snapshots.
   - The USD order snapshot, idempotent replay, exact principals and immutable snapshot scenario is covered at `marketplace-foundation.test.ts:201-337`.
5. Rate and fee current keys follow approved business dimensions.
   - Buyer daily, Seller Organization+currency agreement, and Organization+Marketplace+Review Type fee lineages are defined at Migration 0029 lines 183, 302 and 420 with lifecycle checks and immutable-history triggers.
   - Submit/owner-confirm commands are implemented in `currency-rate-foundation.ts:63-116` and `marketplace-service-fee.ts:51-155`.
   - The USD test proves owner confirmation, shared Seller Organization rate lineage, versioned later-rate creation, and that the completed formal snapshot retains the earlier rate ID and value.

## Design and compatibility evidence

- Legacy `JP`, `final_paid_jpy` and `cny_per_jpy_e8` remain compatibility projections; Migration 0029 backfills exact values and mirrors later JP facts without rewriting historical rows.
- No `REAL`/`FLOAT`, `parseFloat` or `toFixed` is used by the new financial paths. The local verifier creates schema 28 data, records row hashes, upgrades, checks exact backfill, restores the pre-write backup, writes a USD fact and verifies forward recovery.
- Customer UI is unchanged: US/KR customer workflows remain unopened and existing Chinese JP/JPY/CNY presentation remains the compatibility surface. No visible layout change required a new visual baseline; the existing Wave 14A 405-test frontend gate and production build passed.
- Remote D1/R2, deployment, domain, Feishu, Drive and MCP operations were not performed.

## Gate evidence

- `npm run check`: PASS, including secrets scan, typecheck, D1 verification, migration guards, dedicated marketplace-money verifier, Wave 11-14A, 1023/1023 repository tests, Worker dry-run and all workspace builds.
- OpenSpec target strict: PASS.
- OpenSpec all strict: 32/32 PASS.
- npm audit baseline: exactly 2 pre-existing high findings (`react-router`, `react-router-dom`); package dependencies and lockfile are unchanged.

Final assessment: all checks passed; the change is ready for spec sync and archive.
