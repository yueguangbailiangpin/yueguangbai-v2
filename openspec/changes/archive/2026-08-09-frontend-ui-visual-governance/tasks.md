# Tasks: Frontend UI Visual Governance and Buyer Pilot

## 0. Governance, Baseline, and Migration

- [x] 0.1 Confirm the sole worktree, branch, clean baseline, `origin/main`, decision register, product rules, relevant OpenSpec, runbook, visual references, and current Git state.
- [x] 0.2 Record `NO_SCHEMA_CHANGE`, no API/DTO/request/permission/session/cache/file change, and no Seller/Staff rendering change.
- [x] 0.3 Record the reproducible Node/npm/lockfile and before-build entry/CSS/Buyer-route raw and gzip inventory.

## 1. Contracts and Domain

- [x] 1.1 Confirm the existing Buyer session and Buyer portal DTOs already contain every pilot fact; add no Contract, Domain, Migration, endpoint, request, or response field.
- [x] 1.2 Freeze forbidden pilot disclosures: customer number, session expiry, internal business time/note/rank/schedule, storage authority, Seller/Staff/internal-finance, and order/review/refund content.

## 2. Visual Governance

- [x] 2.1 Document `tokens.css` as the only token truth and add no new design system, UI framework, external Chinese font, global blur/glass, or runtime dependency.
- [x] 2.2 Record Buyer concise/mobile-first, Seller dense/contextual, and Staff three-column/maximum-efficiency rules without modifying Seller or Staff rendering.

## 3. Buyer Login Pilot

- [x] 3.1 Refine only `/buyer/login` presentation while keeping exact route-bound fields, controller flow, safe errors, request ID, cleanup recovery, loading, and return-path behavior.
- [x] 3.2 Verify steady-state core copy and absence of persona selection, registration, identity handoff, duplicate heading, marketing copy, and hidden internal fields.

## 4. Buyer Home and Product Pilot

- [x] 4.1 Refine the Buyer shell/header/five-item navigation for the frozen responsive matrix without changing route ownership.
- [x] 4.2 Refine `/buyer`, `/buyer/products`, and `/buyer/demands` list hierarchy using only existing server-returned reservable-product facts.
- [x] 4.3 Refine `/buyer/demands/:demandId` grouping while preserving all returned financial facts, initially unchecked acceptance, exact mutation body, version binding, idempotency, invalidation, and conflict recovery.

## 5. Tests and Deterministic Screenshots

- [x] 5.1 Add a contract-valid deterministic Buyer pilot Playwright fixture with fixed locale/timezone/data and no forbidden fields.
- [x] 5.2 Capture before and after login, home/product, and product-detail screenshots at 320/390/768/1440/1600 outside tracked application assets.
- [x] 5.3 Add DOM/browser assertions for exact login core, product-only scope, keyboard focus, 44px targets, 200% reflow, reduced motion, contrast, and no horizontal overflow.
- [x] 5.4 Review every before/after image pair and record per-image hierarchy/copy/wrapping/overflow/focus/disclosure results.

## 6. Performance and Isolation

- [x] 6.1 Rebuild after implementation in the same environment and record entry/CSS/Buyer-route raw and gzip sizes plus delta and 500 kB status.
- [x] 6.2 Prove `/buyer/products` does not preload Buyer order/review/refund or Seller/Staff business chunks and add no runtime dependency.
- [x] 6.3 Verify changed source imports no adjacent workflow module and Seller/Staff page source remains unchanged.

## 7. Verification

- [x] 7.1 Pass target and repository-wide OpenSpec strict validation and implementation consistency review.
- [x] 7.2 Pass focused Web unit/MSW/typecheck/build tests and the Buyer pilot Playwright/screenshot suite.
- [x] 7.3 Pass `test:wave14a:browser`, full `npm run check`, `git diff --check`, Git scope review, and secret scan without weakening tests.
- [x] 7.4 Report real failures, performance before/after, security/permission boundaries, screenshot paths, OpenSpec state, and external-resource state.

## 8. Rollback and Controller Gate

- [x] 8.1 Prove rollback is presentation/test-only and requires no schema/API/data/permission/session/cache/external rollback.
- [x] 8.2 Stop with all changes uncommitted and unpushed for controller review; do not sync/archive, commit, push, open a PR, integrate, or deploy.

## 9. Owner Visual Rework

- [x] 9.1 Restore the mistakenly archived, wholly uncommitted Change to `openspec/changes/frontend-ui-visual-governance` and remove only its verified uncommitted generated top-level spec.
- [x] 9.2 Preserve baseline and iteration-1 screenshots and record that the owner rejected iteration 1 as visually insufficient.
- [x] 9.3 Add a verifiable 390x844 acceptance gate for hierarchy, type scale, whitespace, card prominence, safe next-step guidance, and relaxed navigation against the approved Buyer direction.
- [x] 9.4 Rework only the Buyer home/product entry with existing tokens, returned safe facts, real routes, and no fabricated menu, status, date, ranking, or schedule.
- [x] 9.5 Persist and side-by-side review the deterministic iteration-2 390x844 Buyer home screenshot, then stop for controller visual review without archive, commit, push, PR, integration, deployment, or full-suite execution.

## 10. Final Buyer Pilot Completion

- [x] 10.1 Replace ambiguous progress wording with 当前开放产品 and assert that reservable products are not presented as reserved or ordered state.
- [x] 10.2 Extend the approved scale, whitespace, card, and primary-action hierarchy to Buyer login, open-product list, and product detail without Seller/Staff rendering changes.
- [x] 10.3 Generate and persist final after screenshots at 320/390/768/1440/1600 and review every image for Chinese wrapping, overflow, primary action, navigation, disclosure, and visual hierarchy.
- [x] 10.4 Re-run 200% text, keyboard focus, reduced-motion, contrast, route isolation, identity/session/permission/forced-password/Personal DENY/cache, dependency, production build, and complete repository/browser gates.
- [x] 10.5 Record final evidence and stop active, uncommitted, unpushed, unarchived for controller differential review.
