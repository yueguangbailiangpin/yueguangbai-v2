## Migration

- [x] Confirm `origin/main`, main worktree cleanliness, archived PR #42 Change, and Migration 0040 state.
- [x] Decide and document that this Change requires no new migration and performs no migration execution.

## Local parser and mapping

- [x] Add strict current-worksheet and historical-row normalization with stable exception codes.
- [x] Add explicit folder/channel alias routing and the nine owner-confirmed seller mappings.
- [x] Add `(marketplace_code, platform_product_identifier)` standard-product deduplication with preserved seller offerings and conflict reporting.
- [x] Exclude `自发货-店铺评论` and keep unresolved historical rows quarantined.

## Preview and evidence

- [x] Add deterministic manifest hashing, stable ordering, full 114-row local manifest, local dry-run output, and the live read-only preview report.
- [x] Include external calls, Tencent Docs writes, D1/R2 writes, account creation, invitations, and deployment as explicit zero/NOT_RUN evidence.

## Tests and gates

- [x] Test whitelist-only behavior, marketplace-aware identifiers, duplicate products, same-product multi-seller preservation, folder-bounded identity, explicit owner mappings, no-history confirmations, quarantine, and repeat-preview stability.
- [x] Add full-manifest drift guards for the frozen hash, 51/37 mapped-versus-unresolved product partition, 52 unique `(productKey, organizationKey)` offerings, exact five current quarantine rows, exact inventory status/folder counts, 158 unread files, and mapped Rakuten `R-1`/`S-1`.
- [x] Run targeted tests, full tests, typecheck, OpenSpec strict validation, build, and security scan after the 114/109/88 implementation update.
- [x] Record actual failures/skips and provide the worktree for total-control review; do not commit, push, PR, merge, deploy, or touch production.

## Gate evidence

- [x] Targeted mapping tests: 7/7 passed after the marketplace-aware update.
- [x] Full repository tests: 215 files / 1380 tests passed.
- [x] Full workspace typecheck: passed.
- [x] OpenSpec strict validation: 52/52 items passed.
- [x] Local workspace build: passed; API Wrangler was `--dry-run` only.
- [x] Security scan: 1572 project files passed.
- [x] Production migrations, external preflights, Cloudflare resource actions, Tencent Docs writes, and deployment: intentionally not run.
