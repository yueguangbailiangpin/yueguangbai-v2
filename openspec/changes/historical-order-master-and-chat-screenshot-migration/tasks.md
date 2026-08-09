# Tasks: Historical Order Master and Chat Screenshot Migration

## 0. Baseline and scope

- [x] 0.1 Verify the main worktree status before any worktree creation; preserve its pre-existing untracked files.
- [x] 0.2 Fetch and re-verify `origin/main=904c154b66d4acad099c89c0e3719c67837975fe`.
- [x] 0.3 Recompute the workbook SHA-256 and reconcile the prior read-only JSON/Markdown evidence instead of copying it blindly.
- [x] 0.4 Establish that this Change performs no production import, Migration, deployment or external write.

## 1. Reproducible manifest

- [x] 1.1 Add the SHA/header-guarded `数据母表` read-only generator.
- [x] 1.2 Emit all 16,304 source rows with stable row/order/order-line keys, raw text provenance and isolation reasons.
- [x] 1.3 Preserve valid order-line facts, unique order counts, conflicting duplicates and exact-duplicate quarantine.
- [x] 1.4 Add source-hash/row-key, checkpoint, replay and rollback requirements for any future importer without implementing one.
- [x] 1.5 Classify marketplace-aware Amazon/Rakuten/TikTok order identities and explicit Amazon missing-separator normalization; retain raw values and reject the 17-digit pure-numeric outlier.
- [x] 1.6 Remove the unused Amazon-only `build_manifest_legacy`; keep one authoritative full-volume generator and one manifest schema.
- [x] 1.7 Keep `order_number_key` for recognized orders and emit `duplicate_group_key` only when group size is greater than one.

## 2. Refund, product and seller boundaries

- [x] 2.1 Implement frozen dual-sided refund/lifecycle rules and order-number overrides.
- [x] 2.2 Reconcile latest origin/main current-product mapping evidence to the 49/31/1/1466 historical categories.
- [x] 2.3 Keep current mapping as candidate evidence only and reject unproven store or cross-Seller bindings.
- [x] 2.4 Preserve historical principal amounts/status provenance and explicitly defer the independent historical financial storage decision.
- [x] 2.5 Apply the 51-row `催评` owner rule and the ten-row TikTok owner-confirmed product/store/Seller Organization mapping without promoting TikTok to production registry support.
- [x] 2.6 Apply stable unsupported-registry blockers to Rakuten and TikTok order, product-schema and H-image projections, with full-manifest fail-closed invariants.

## 3. Screenshot boundary

- [x] 3.1 Count H/K Drawing anchors without opening media bytes.
- [x] 3.2 Plan H-column `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` associations only after future formal-order and Seller scope checks.
- [x] 3.3 Mark K-column arrival images `IGNORE_DO_NOT_MODEL_DO_NOT_IMPORT`.
- [x] 3.4 Document the separately approved future R2 S3-compatible importer plan, configurable 8–16 initial worker suggestion, object verification, checkpoint/retry/compensation and no permanent URL policy.

## 4. Tests and gates

- [x] 4.1 Run negative tests for blank-date boundaries, `催评`, platform shapes, missing-separator normalization, TikTok override, Rakuten/TikTok registry blockers, unique/repeated duplicate keys, exact duplicates and multi-seller rejection.
- [x] 4.2 Run the full source dry-run and verify row/order/product/refund/image conservation under the latest blank-status date cutoff and marketplace rules.
- [x] 4.3 Run strict OpenSpec validation: 55/55 items passed.
- [x] 4.4 Focused repository TypeScript tests/typecheck are not applicable: this Change adds only a local Python generator and OpenSpec evidence; the negative test entry point passed.

## 5. Control handoff

- [x] 5.1 Record actual diff, manifest hash/path, all conservation counts, zero external writes, marketplace/schema decision, migration decision and unresolved quarantine categories in the handoff report.
- [x] 5.2 Stop at `待总控复核`; do not commit, push, create PR, merge, deploy or execute production Migration.

## Gate evidence

- [x] Source SHA recheck: `c7d0ae7a7169337ed8929f59e7cb78beac4e57be098a5f086970446e6269b937`.
- [x] Full dry-run: 16,304 records; manifest SHA `a9eb168fba97bd1ae53fbcb200d5091398510b3edeebff928bb66658bf6ede87`.
- [x] Current conservation: 16,304 = 14,902 candidates + 1,402 quarantined; H images 1,910 = 1,786 deferred + 124 isolated; K images 1,412 ignored.
- [x] Marketplace-aware order reconciliation: 16,038 valid order rows; 15,419 unique platform orders; Amazon 15,551 rows/14,933 unique, Rakuten 477/476, TikTok 10/10; 584 duplicate groups, 11 exact / 573 conflicting; 44 missing-separator Amazon candidates retain `NORMALIZED_MISSING_SEPARATOR`; one pure numeric 17-digit outlier remains unrecognized.
- [x] Product reconciliation: 15,051 valid product rows and 1,596 unique keys; Amazon 1,545, Rakuten 50, TikTok 1 local owner-confirmed candidate; current categories 49/1,778, 31/264, 1/5, no-current-match 1,514/12,994, and TikTok owner-confirmed 1/10.
- [x] Negative tests: PASS, including structured source-drift entry failure, both local-only registry blockers and unique/repeated duplicate-key semantics; external writes 0. Strict OpenSpec: 55/55 PASS.
- [x] Formal repository dry-run entry: `npm run dry-run:historical-order-migration` PASS under standard Python 3 with no third-party dependency; manifest hash `a9eb168f…ede87`.
- [x] Blank-status cutoff: 364 date-valid blanks use `OWNER_RULE_DATE_CUTOFF`; 65 date-invalid/missing rows retain `OWNER_RULE_DATE_CUTOFF_UNRESOLVED_DATE` and remain isolated by date reason.
- [x] Original 28-row invalid-order/chat review rechecked from source: 26 now classify as owner-confirmed Rakuten order shapes and 2 as recognized marketplace-aware Amazon candidates; none remains isolated merely for Amazon-only shape failure. The remaining current unrecognized-order/chat review is 91 rows with no authoritative order-platform conclusion.
- [x] Refund reconciliation: all 16,304 rows are `MAPPED`; 51 `催评` rows use both-side `PENDING`/`OWNER_RULE`; blank-date cutoff remains 364 date-valid `OWNER_RULE_DATE_CUTOFF` rows and 65 date-unresolved rows isolated by date.
- [x] Marketplace registry boundary: production registry remains `AMAZON_JP`, `AMAZON_US`, `COUPANG_KR`; Rakuten/TikTok are local canonical candidates only, no Migration/import/deployment executed.
- [x] Full-manifest registry assertions: Rakuten 477 rows/52 H-image rows and TikTok 10 rows/10 H-image rows have zero order-blocker, product-schema or chat-blocker mismatches and zero production-eligible rows.
- [x] Full-manifest duplicate-key assertions: 14,835 unique recognized-order rows have null `duplicate_group_key`; all 1,203 repeated-order rows have a non-null group key.
