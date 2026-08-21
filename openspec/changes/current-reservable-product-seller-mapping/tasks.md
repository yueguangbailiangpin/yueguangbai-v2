## Local mapping

- [x] Add owner-confirmed availability overlay to the local parser.
- [x] Preserve excluded seller source evidence separately from available offerings.
- [x] Add focused tests for paused, abnormal, Somiso, and B0GRMRV64K rules.
- [x] Record the pending live-refresh boundary.
- [x] Add deterministic JSON staging import plan generation from the live manifest.
- [x] Include product version and legacy reservation runtime field projections.
- [x] Add explicit no-open reasons and conservative task-type documentation.
- [x] Generate one candidate/task per current source row and preserve its order/review fields.
- [x] Emit stable idempotent entity IDs for organizations, stores, offerings, versions, and tasks.
- [x] Parse explicit image/text review allocations and mark unsafe TEXT fallbacks.
- [x] Emit executable-but-unexecuted idempotent D1 SQL with stable imported identities.
- [x] Keep Rakuten SQL data-only and avoid seller channel sequence mutation.

## Remote boundary

- [ ] Tencent Docs refresh (not run in this local-only task).
- [ ] D1 import and Cloudflare deployment (not run in this local-only task).
