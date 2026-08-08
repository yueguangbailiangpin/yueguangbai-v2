# Tasks: Frontend Route Code Splitting Performance

## 0. Dependencies and Migration

- [ ] 0.1 Wait until M11–M16 are accepted, archived and present on current `origin/main`; then create a separate implementation task and worktree.
- [ ] 0.2 Re-run the production build on that exact baseline and record Node/npm versions, lockfile SHA, raw/gzip chunk sizes and current warnings.
- [ ] 0.3 Confirm `NO_SCHEMA_CHANGE`, no API/business-contract change and no production deployment requirement.

## 1. Contracts and Design

- [ ] 1.1 Inventory the actual import graph and identify the minimum shared startup layer plus Buyer, Seller and Staff route boundaries.
- [ ] 1.2 Freeze Chinese loading/error/retry behavior and the security order for session, forced-password, permission and cache invalidation boundaries.
- [ ] 1.3 Define representative cold-start and deep-link paths, fixed measurement conditions, three-run median method and bundle budgets.

## 2. Implementation

- [ ] 2.1 Split Buyer, Seller and Staff shells into independent dynamic imports without changing visible business behavior.
- [ ] 2.2 Split measured heavy pages within each identity and keep genuinely shared transport/contracts/UI in safe shared chunks.
- [ ] 2.3 Add accessible Chinese loading and recoverable chunk-failure states without infinite reload or protected-content flash.

## 3. Tests and Performance Verification

- [ ] 3.1 Test direct deep links, refresh, login/logout, forced password, 401/403, Personal DENY and Buyer/Seller/Staff cache isolation across lazy boundaries.
- [ ] 3.2 Run full web unit/MSW/browser/accessibility tests, typecheck, production build, secrets scan and dependency audit.
- [ ] 3.3 Record before/after raw and gzip chunk inventory plus Buyer, Seller and Staff cold-start transfer and visible/interactive three-run medians.
- [ ] 3.4 Prove the initial entry is below the default 500 kB budget; explain and resolve every remaining oversized chunk or mark Production GO blocked.
- [ ] 3.5 Run OpenSpec Strict and Implementation Verify; archive only after controller acceptance.

## 4. Rollback

- [ ] 4.1 Prove reverting the lazy route boundaries restores the prior static entry without changing API, database, permissions or business facts.
