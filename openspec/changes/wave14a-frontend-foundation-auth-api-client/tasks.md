# Tasks: Wave 14A Frontend Foundation, Routing, Auth and API Client

Planning completion marks only authority/inventory/artifact work. All implementation, browser, Verify, Ponytail, Integration, main, and deployment work remains pending until the controller freezes this Change and separately authorizes the applicable stage.

## 0. Authority and Planning

- [x] 0.1 Read the frozen request, `AGENTS.md`, governance, decisions, product rules, architecture, contracts, audits, OpenSpec, Web source, API registration/routes, Contracts, and workspace configs.
- [x] 0.2 Confirm baseline SHA, target uniqueness, clean worktree, Ponytail off, and sole planning-writer boundary.
- [x] 0.3 Create Proposal, Design, Tasks, seven Delta Specs, and six References inside this Change only.
- [x] 0.4 Run the unchanged-baseline `npm ci` and complete repository regression gate after planning artifacts were written.
- [x] 0.5 Run planning counts, static review, diff checks, and final Change-only Git scope verification.
- [x] 0.6 Complete Controller Review Remediation: remove the non-formal Staff internal-communication route from the frontend inventory, freeze `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`, preserve 42/84, and start no implementation.

## 1. Existing Frontend Inventory

- [x] 1.1 Record the current React/Vite/static CSS/test/config/dependency baseline and customer-visible placeholder debt.

## 2. API and Contract Inventory

- [x] 2.1 Reproduce the 138-route default-app registry and document real Customer/Staff Auth, Buyer/Seller/Staff portal, File, Evidence, and Refund paths/contracts.
- [x] 2.2 Record envelopes, request ID, Cookie/account-type facts, error/status semantics, authority, and deferred file-purpose boundaries without inventing DTOs.

## 3. Dependencies

- [ ] 3.1 After controller freeze, select/install compatible React Router, TanStack Query, Zod, Tailwind, lucide-react, and approved narrow Radix primitives.
- [ ] 3.2 Install Testing Library, user-event, MSW, jsdom, and Playwright with lockfile/license/install-script review.

## 4. Runtime Configuration

- [ ] 4.1 Implement non-secret runtime configuration and origin-relative `/api/*` enforcement.

## 5. Design Tokens

- [x] 5.1 Freeze Quiet Operations, brand/identity/status semantics, typography, shape, shadow, responsive, and prohibited-style rules.
- [ ] 5.2 Implement light CSS custom properties and Tailwind semantic mappings with contrast tests; do not add dark mode.

## 6. App Bootstrap

- [ ] 6.1 Implement StrictMode, root/config validation, Root Error Boundary, Router/Query integration, and safe bootstrap failure.

## 7. Router

- [ ] 7.1 Implement public, login, callback, Buyer, Seller, Staff, guard, return-path, and scoped not-found routes.

## 8. Root Entry

- [ ] 8.1 Implement the `月光白` root with Buyer/Seller entries only and direct Staff-login accessibility.

## 9. Buyer Shell

- [ ] 9.1 Implement the mobile-first Buyer shell and fixed 首页、任务、订单资料、评论、我的 navigation without business pages.

## 10. Seller Shell

- [ ] 10.1 Implement the medium-density Seller shell, list context, right detail drawer, focus restoration, and small-screen fallback without business pages.

## 11. Staff Shell

- [ ] 11.1 Implement the queue/detail/action workbench, semantic separations, context preservation, and narrow fallback without business pages.

## 12. API Envelope

- [ ] 12.1 Implement credentialed fetch transport, success/error envelope parsing, request ID, AbortSignal, and endpoint Zod validation.

## 13. API Errors

- [ ] 13.1 Implement safe normalized errors, status/code categories, safe detail allowlists, Retry-After, and request-ID presentation.

## 14. Query Client

- [ ] 14.1 Implement identity-rooted query keys, finite GET retry, zero default mutation retry, cancellation, stale/gc policy, and no persistence.

## 15. Idempotency

- [ ] 15.1 Implement in-memory logical-operation keys, identical-body safe retry, release lifecycle, and latest-DTO expected_version handling.

## 16. Staff Auth

- [ ] 16.1 Implement login/start, safe Provider redirect, callback return, Session read, logout/logout-all boundaries, and Fake Provider validation.

## 17. Buyer Auth

- [ ] 17.1 Implement Buyer Customer Auth login/session/account-type/password-change states without a full registration business page.

## 18. Seller Auth

- [ ] 18.1 Implement Seller Customer Auth login/session/account-type/password-change states without client role selection.

## 19. Session Cache Isolation

- [ ] 19.1 Implement three separate state machines plus Customer shared-transport invalidation: Customer login/mismatch/logout/401 clears Buyer+Seller, Staff 401 clears Staff only, and 403/404 changes no Session.

## 20. File Transfer Client

- [ ] 20.1 Implement purpose-bound intent/upload/complete/VERIFIED/read flows, memory-only tokens, progress, cancel, expiry/replay restart, and compensation state.
- [ ] 20.2 Prove no object key/permanent URL/generic Link/Grant/deferred internal-communication upload capability exists.

## 21. Shared UI Primitives

- [ ] 21.1 Implement the frozen shell/navigation/input/content/data/overlay/feedback/state primitive inventory with semantic tokens.

## 22. Accessibility

- [ ] 22.1 Implement semantic HTML, keyboard/focus/overlay behavior, labels/errors, non-color states, live announcements, alt/table semantics, 320px/200%, targets, and reduced motion.

## 23. Unit Tests

- [ ] 23.1 Add Vitest coverage for configuration, routing, keys, envelopes, errors, retry, idempotency, Session, and file state policies.

## 24. Component Tests

- [ ] 24.1 Add Testing Library/user-event/jsdom coverage for routes, shells, forms, focus, overlays, responsive semantics, and all system states.

## 25. MSW Tests

- [ ] 25.1 Add real `/api/*` mock coverage for credentials, envelopes, identity, statuses, retry/cancel, versions, idempotency, file transfer, Customer two-root invalidation, Staff-only invalidation, mismatch non-navigation, and phantom internal-communication route rejection.

## 26. Playwright Smoke

- [ ] 26.1 Add and run minimal production-build smoke for root/login/guards/shells/keyboard/320px/403/404/503 without business acceptance claims.

## 27. Security Verifiers

- [ ] 27.1 Add gates for no `/api/v2`, hard-coded production host, secret/Cookie/client authority, persisted sensitive cache, raw error leakage, object key, permanent URL, or generic File Link/Grant.

## 28. Build and Typecheck

- [ ] 28.1 Run Web and workspace typecheck/build and record exact results.

## 29. Browser Validation

- [ ] 29.1 Run local browser smoke and accessibility/responsive checks; leave real business, Feishu, R2, mainland network, and production validation deferred.

## 30. OpenSpec Validation

- [x] 30.1 Run target and repository-wide strict OpenSpec validation and record passed/failed/INFO counts.

## 31. OpenSpec Verify

- [ ] 31.1 After implementation and all gates, run formal OpenSpec Verify against all 42 Requirements and 84 Scenarios.

## 32. Ponytail Read-only Review

- [ ] 32.1 Keep Ponytail off during planning/implementation; only after full acceptance and separate authorization may a read-only review run.

## 33. Integration

- [ ] 33.1 Create/validate Integration only after controller acceptance, Verify, and authorized governance completion; do not develop there.

## 34. Main Advancement

- [ ] 34.1 Advance `main` only through the authorized clean Integration process with ordinary non-force fast-forward; do not deploy.

## Planning Validation Evidence

- OpenSpec target strict: 1 passed / 0 failed / 0 INFO.
- OpenSpec all strict: 8 passed / 0 failed / 27 INFO. All 27 INFO belong to pre-existing Wave 13 main Specs or the pre-Wave 13 audit Change; this Wave 14A Change has 0 issues.
- Planning counts: 7 Capabilities / 42 Requirements / 84 Scenarios / 17 files.
- `npm ci`: passed; 94 packages added, 101 audited, 0 vulnerabilities. The existing npm allow-scripts warning listed three unapproved install scripts and did not fail installation.
- `npm run check`: passed; security scan, workspace typecheck, 27 migrations/schema 27, migration guards, Wave 11, Wave 12, Wave 13, 111 test files / 580 tests / 0 failed, API Wrangler dry-run, Web Vite build, and all workspace builds passed.
- Planning did not run browser business flows, OpenSpec Verify, Ponytail, Integration, PR, deployment, real Feishu, production R2, production data, or `main` advancement.

## CONTROLLER_FREEZE

- Planning frozen at `4200c5aa8dbb9d21a7566cfe24a228768002edca` with 7 Capabilities / 42 Requirements / 84 Scenarios.
- Quiet Operations, the Customer shared-transport invalidation policy, and the real route map are frozen.
- Local Codex is the sole source writer; Backend, Contracts, and Migrations are prohibited changes.
- Browser validation, full gates, and formal OpenSpec Verify are required after implementation.
- Ponytail remains OFF pending independent authorization.

## Controller Dedicated-Link Amendment

- [x] Amend root to a dedicated-link notice, retain direct login routes, fail closed on Customer mismatch with logout plus two-root cleanup, and align Session adapters with real `{ session: ... }` data.

## CONTINUATION_A3_EVIDENCE

- Staff ordinary logout and logout-all use the single credentialed Transport; logout-all holds one in-memory Idempotency-Key per confirmed logical operation.
- Staff cleanup uses only the Staff query root; Customer roots are not touched by these actions.
- Logout-all is protected by a labeled modal confirmation with Escape, focus cycling, and focus restoration.
- MSW remains deferred to A4. File Transfer, remaining primitives, formal browser acceptance, and OpenSpec Verify remain pending.
