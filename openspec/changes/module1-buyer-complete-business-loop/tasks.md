# Tasks: Module 1 Buyer Complete Business Loop

Checked items in this planning round are evidence-backed planning artifacts only. All source implementation, browser acceptance, Formal Verify, review, Integration, and main work remains pending.

## 0. Authority and Planning

- [x] 0.1 Confirm formal baseline, branch, Worktree, clean state, and Ponytail mode off.
- [x] 0.2 Read the required governance, decision, product, architecture, contract, audit, OpenSpec, Web, Buyer API, package, and test configuration sources.
- [x] 0.3 Create Proposal, Design, Tasks, ten Delta Specs, and ten references only in this Change.

## 1. Buyer Frontend Inventory

- [x] 1.1 Record current root/login/password/Buyer route and shell behavior.
- [x] 1.2 Record existing Query/session/error/file/UI/test foundations and exact Web file inventory.

## 2. Buyer API/Contract Inventory

- [x] 2.1 Record all 38 registered Buyer-relevant endpoints and request boundaries.
- [x] 2.2 Record DTO fields, cursor limits, statuses, actions, error semantics, financial types, and API gaps.

## 3. Routing and Navigation

- [ ] 3.1 Implement the route map and modular Buyer layout/outlets.
- [ ] 3.2 Preserve exact root/login semantics and five-item bottom navigation.

## 4. Buyer Registration

- [ ] 4.1 Add runtime schemas/API adapter for direct self-registration.
- [ ] 4.2 Build accessible feature/verifier/rate/conflict-safe registration UI and Session handoff.

## 5. Buyer Dashboard

- [ ] 5.1 Implement bounded source queries, de-duplication, priority and deadline ordering.
- [ ] 5.2 Implement partial-failure panels and 查看全部 without totals.

## 6. Demand List

- [ ] 6.1 Implement cursor-paged public demand cards with safe money/date formatting.

## 7. Demand Detail

- [ ] 7.1 Implement demand detail and current version retention.
- [ ] 7.2 Implement prominent initially-unchecked self-pay acceptance/reset.

## 8. Reservation Creation

- [ ] 8.1 Implement exact acceptance body, operation idempotency and conflict handling.

## 9. Reservation List/Detail

- [ ] 9.1 Implement cursor-paged reservation history and snapshot/status display.
- [ ] 9.2 Implement reservation detail and approved instruction entry.

## 10. Reservation Cancellation

- [ ] 10.1 Implement `can_cancel`-driven confirmation, latest version, and precise invalidation.

## 11. Order Instruction

- [ ] 11.1 Implement state-first reads and all five instruction statuses.
- [ ] 11.2 Implement full ACTIVE content and distinct initial/change deadlines.

## 12. Instruction Images

- [ ] 12.1 Integrate returned main/ordered keyword read-intent paths with File Read Controller.
- [ ] 12.2 Verify memory-only tokens, bounded bytes, Object URL cleanup and denied/expired states.

## 13. Order Evidence Eligibility

- [ ] 13.1 Implement eligible reservation paging and `allowed_actions` authority.

## 14. Order Evidence Upload

- [ ] 14.1 Integrate `buyerOrderEvidence` with exactly one verified image.
- [ ] 14.2 Block business submit on zero/multiple/unsupported/unverified files.

## 15. Order Evidence Form

- [ ] 15.1 Implement initial version-zero form and command.
- [ ] 15.2 Implement detail facts, safe file metadata, mismatch warning and request IDs.

## 16. Order Evidence Resubmit/Withdraw

- [ ] 16.1 Implement public reason, current-version full resubmit and change deadline.
- [ ] 16.2 Implement allowed current-version withdrawal and conflicts.

## 17. Formal Orders

- [ ] 17.1 Implement supported filters/cursor list.
- [ ] 17.2 Implement immutable detail and decimal-string snapshot presentation.

## 18. Review Eligibility

- [ ] 18.1 Implement eligible-order paging and action-driven initial/resubmit entry.

## 19. Review Upload

- [ ] 19.1 Integrate `buyerReviewEvidence` while limiting the business command to three verified files.

## 20. Review Form

- [ ] 20.1 Implement initial version-zero review type/url/files/note form and command.
- [ ] 20.2 Implement list/detail status, due, reason, actions and safe order context.

## 21. Review Resubmit/Withdraw

- [ ] 21.1 Implement full current-version resubmit and public reason.
- [ ] 21.2 Implement current-version allowed withdrawal.

## 22. Review File Read

- [ ] 22.1 Integrate specialized review/link/version read intent and Wave14A content viewer.

## 23. Refund List/Detail

- [ ] 23.1 Implement read-only cursor list with all four balances/statuses.
- [ ] 23.2 Implement detail payment/reversal activity and balance-after history.

## 24. Buyer Me

- [ ] 24.1 Implement published profile fields, review-required notice and supported links.
- [ ] 24.2 Reuse password and logout controllers with shared Customer cleanup.

## 25. Query/Cache

- [x] 25.1 Freeze Buyer Query key architecture and precise mutation invalidation map.
- [ ] 25.2 Implement keys, adapters, freshness, cancellation, paging and non-persistence.

## 26. Errors/Conflict

- [ ] 26.1 Implement runtime schemas and safe 401/403/404/409/429/503/contract states.
- [ ] 26.2 Implement explicit version comparison/retry without auto mutation retry.

## 27. Mobile UI

- [ ] 27.1 Polish 390px primary and 320px minimum layouts with bottom safe area.

## 28. Accessibility

- [ ] 28.1 Verify landmarks, labels, focus, targets, status text, live errors and copy behavior.
- [ ] 28.2 Verify 200% reflow, reduced motion, images, skeleton stability and keyboard journeys.

## 29. Unit Tests

- [ ] 29.1 Add schema, key, priority, dedupe, formatter, status/action and form-state tests.

## 30. Component Tests

- [ ] 30.1 Add normal plus failure/boundary/accessibility coverage for every major page/form.

## 31. MSW Tests

- [ ] 31.1 Cover all exact Buyer endpoints, request bodies, headers, envelopes and cache effects.
- [ ] 31.2 Cover Session/error/conflict/replay/file-token/retry/disclosure boundaries.

## 32. Playwright

- [ ] 32.1 Run complete registration-to-refund Buyer journeys at 390px.
- [ ] 32.2 Run 320px, 200%, reduced-motion, keyboard, 401/403/404/409/503 and deep-link gates.

## 33. Security Verifier

- [ ] 33.1 Add static/runtime checks for identity, paths, authority, actions, money, files and forbidden disclosure.

## 34. Build/Typecheck

- [ ] 34.1 Pass Web and workspace typecheck/build after implementation.

## 35. Browser Screenshots

- [ ] 35.1 Capture deterministic 390px primary journeys and 320px/error/accessibility states for review.

## 36. OpenSpec Validation

- [x] 36.1 Pass target strict OpenSpec validation and exact structure counts (1/1; 10/58/116/24).
- [x] 36.2 Pass repository-wide strict OpenSpec validation and record INFO count (15/15; 33 pre-existing INFO, 0 in this Change).

## 37. Formal Verify

- [ ] 37.1 After implementation only, formally map all 58 Requirements / 116 Scenarios to evidence.

## 38. Ponytail

- [ ] 38.1 Keep Ponytail off in planning/implementation; run no review without later explicit controller authorization.

## 39. Integration

- [ ] 39.1 After controller freeze, implementation, complete acceptance, Verify and authorized closeout, validate a clean Integration without development.

## 40. Main Advancement

- [ ] 40.1 Advance main only after separately authorized clean Integration; do not deploy from this task.

## Planning Validation Evidence

- [x] P.1 Complete route, DTO/status, dashboard, form, file, security, visual, and acceptance references.
- [x] P.2 Complete Proposal, Design, ten Specs, and this Tasks plan.
- [x] P.3 Run isolated `npm ci` and the formal baseline regression (128 files / 909 tests, Wave14A 18 / 330, Playwright 42).
- [x] P.4 Run strict OpenSpec target/all validation and exact counts.
- [ ] P.5 Confirm Git diff is only this Change and Worktree is clean after commit/push.
