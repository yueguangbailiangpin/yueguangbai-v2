# Tasks: Frontend Runtime Loading Performance V2

## 0. Scope and Baseline

- [x] 0.1 Create an isolated Feature worktree from current `origin/main` and confirm this task is the sole source writer.
- [x] 0.2 Record Node/npm/lockfile SHA and current production bundle sizes.
- [x] 0.3 Confirm `NO_SCHEMA_CHANGE`, no API/Contract/Domain/permission change and no production/external write.

## 1. Local Production Preview

- [x] 1.1 Add a repository-owned local production preview using built hashed assets, same-origin anonymous in-memory API fixtures and process-lifetime test accounts.
- [x] 1.2 Keep the preview fail-local: no real network, Cloudflare, D1/R2, domain, Secret or production data dependency.
- [x] 1.3 Document/test the buyer, seller and staff entry URLs and clean shutdown behavior.

## 2. Runtime Loading

- [x] 2.1 Split the Buyer instruction/file-read page from the default Buyer portal based on measured dependency evidence.
- [x] 2.2 Split Seller product/demand submission pages from the default Seller portal and retain Chinese loading/failure/retry behavior.
- [x] 2.3 Preserve session, forced-password, cross-identity cleanup, cache isolation, permissions and file Audience behavior.

## 3. Verification

- [x] 3.1 Add focused tests for Buyer instruction and Seller submission on-demand loading.
- [x] 3.2 Record before/after bundle inventory and three-run cold Buyer/Seller measurements using production output.
- [x] 3.3 Run Web unit/MSW/typecheck/build/browser/accessibility gates, OpenSpec strict validation, dependency audit and full `npm run check` once after implementation.
- [x] 3.4 Run Implementation Verify, then a read-only Ponytail review; any accepted fix must be reverified before archive.

## 4. Rollback and Integration

- [x] 4.1 Verify source-only rollback and confirm no Migration, production deployment or external write.
- [x] 4.2 After controller acceptance, sync/archive the verified Change. Ordinary Feature → Integration → main remains a separate remote-authorized integration action.
