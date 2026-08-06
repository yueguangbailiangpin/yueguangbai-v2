# Tasks: Module 1 Buyer Complete Business Loop

Checked items are evidence-backed against the current implementation. Source implementation, browser acceptance, Formal Verify, OpenSpec sync/archive, and clean Integration are complete at the current HEAD; main advancement remains a separately controlled closeout stage.

## 0. Authority and Planning

- [x] 0.1 Confirm formal baseline, branch, Worktree, clean state, and Ponytail mode off.
- [x] 0.2 Read the required governance, decision, product, architecture, contract, audit, OpenSpec, Web, Buyer API, package, and test configuration sources.
- [x] 0.3 Create Proposal, Design, Tasks, ten Delta Specs, and ten references only in this Change.

## 1. Buyer Frontend Inventory

- [x] 1.1 Record current root/login/password/Buyer route and shell behavior.
- [x] 1.2 Record existing Query/session/error/file/UI/test foundations and exact Web file inventory.

## 2. Buyer API/Contract Inventory

- [x] 2.1 Record all 38 registered Buyer-relevant endpoints and request boundaries.
- [x] 2.2 Record DTO fields, cursor limits, statuses, actions, error/date semantics, baseline 38 versus target 39, real Schema gaps, and the two narrow authorized prerequisites.

## 3. Routing and Navigation

- [x] 3.1 Implement the route map, modular Buyer layout/outlets, and required query-bound new-form deep links with eligibility reread.
- [x] 3.2 Preserve exact root/login semantics and five-item bottom navigation.

## 4. Buyer Registration

- [x] 4.1 Add runtime schemas/API adapter for direct self-registration.
- [x] 4.2 Build accessible feature/verifier/rate/conflict-safe registration UI; after 201 enter `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`, cancel/clear Buyer+Seller, preserve Staff, reread Session, and accept only BUYER.

## 5. Buyer Dashboard

- [x] 5.1 Implement bounded source queries, de-duplication, priority/deadline ordering, and refund preview limited to returned DUE/PARTIALLY_PAID/OVERPAID facts without unread/change claims.
- [x] 5.2 Implement partial-failure panels and 查看全部 without totals.

## 6. Demand List

- [x] 6.1 Implement cursor-paged public demand cards with safe money/date formatting.

## 7. Demand Detail

- [x] 7.1 Implement demand detail and current version retention.
- [x] 7.2 Implement prominent initially-unchecked self-pay acceptance/reset.

## 8. Reservation Creation

- [x] 8.1 Implement exact acceptance body, operation idempotency and conflict handling.

## 9. Reservation List/Detail

- [x] 9.1 Implement cursor-paged reservation history and snapshot/status display.
- [x] 9.2 Implement reservation detail and approved instruction entry.

## 10. Reservation Cancellation

- [x] 10.1 Implement `can_cancel`-driven confirmation, latest version, and precise invalidation.

## 11. Order Instruction

- [x] 11.1 Implement state-first reads and all five instruction statuses.
- [x] 11.2 Implement full ACTIVE content and distinct initial/change deadlines.

## 12. Instruction Images

- [x] 12.1 Add the narrow `FileReadIntentProvider` boundary and four fixed adapters; validate instruction Buyer/current-reservation/main-or-position routes exactly and forbid arbitrary paths.
- [x] 12.2 Keep Wave14A content/header/token/Object-URL behavior; map absent instruction file-ID/replay assertions without fabrication and require restart when token availability is false/null.

## 13. Order Evidence Eligibility

- [x] 13.1 Implement eligible reservation paging and `allowed_actions` authority.

## 14. Order Evidence Upload

- [x] 14.1 Integrate `buyerOrderEvidence` with exactly one image and server-side file verification during Complete; do not send client HEAD.
- [x] 14.2 Block business submit on zero/multiple/unsupported/unverified files.

## 15. Order Evidence Form

- [x] 15.1 Implement query-bound initial version-zero form and initial/resubmit commands with required valid date-only `amazon_order_date`.
- [x] 15.2 Implement detail facts, distinct date/unknown-history display, safe file metadata/actions, mismatch warning and request IDs.
- [x] 15.3 Implement only the authorized date prerequisite across Contract, Domain, routes, read models, runtime schemas, and Migration 0028 nullable history/new-row guards; add no date index or fake backfill.

## 16. Order Evidence Resubmit/Withdraw

- [x] 16.1 Implement public reason, current-version full resubmit and change deadline.
- [x] 16.2 Implement allowed current-version withdrawal and conflicts.

## 17. Formal Orders

- [x] 17.1 Implement supported filters/cursor list.
- [x] 17.2 Implement immutable detail, distinct `amazon_order_date` snapshot/legacy unknown, business-date/timestamp separation, and decimal-string presentation.

## 18. Review Eligibility

- [x] 18.1 Implement eligible-order paging and required `formal_order_id` query-bound initial entry with refresh/deep-link eligibility reread.

## 19. Review Upload

- [x] 19.1 Integrate `buyerReviewEvidence` while limiting the business command to three verified files.

## 20. Review Form

- [x] 20.1 Implement initial version-zero review type/url/files/note form and command.
- [x] 20.2 Implement list/detail status, due, reason, actions and safe order context.

## 21. Review Resubmit/Withdraw

- [x] 21.1 Implement full current-version resubmit and public reason.
- [x] 21.2 Implement current-version allowed withdrawal.

## 22. Review File Read

- [x] 22.1 Integrate the fixed review/link/version adapter and Wave14A content viewer without DTO path forwarding.
- [x] 22.2 Implement only the authorized order-evidence file DTO fields and dedicated read-intent endpoint with ownership/link/version/audience checks, concealed 404, replay safety, and existing content endpoint.

## 23. Refund List/Detail

- [x] 23.1 Implement read-only cursor list with all four balances/statuses.
- [x] 23.2 Implement detail payment/reversal activity and balance-after history.

## 24. Buyer Me

- [x] 24.1 Implement published profile fields, review-required notice and supported links.
- [x] 24.2 Reuse password and logout controllers with shared Customer cleanup.

## 25. Query/Cache

- [x] 25.1 Freeze Buyer Query key architecture and precise mutation invalidation map.
- [x] 25.2 Implement keys, adapters, freshness, cancellation, paging and non-persistence.

## 26. Errors/Conflict

- [x] 26.1 Implement runtime schemas and safe 401/403/404/409/429/503/contract states.
- [x] 26.2 Implement explicit version comparison/retry without auto mutation retry.

## 27. Mobile UI

- [x] 27.1 Polish 390px primary and 320px minimum layouts with bottom safe area.

## 28. Accessibility

- [x] 28.1 Verify landmarks, labels, focus, targets, status text, live errors and copy behavior.
- [x] 28.2 Verify 200% reflow, reduced motion, images, skeleton stability and keyboard journeys.

## 29. Unit Tests

- [x] 29.1 Add schema, key, priority, dedupe, date-only/timezone formatter, fixed adapter/path, status/action and form-state tests.

## 30. Component Tests

- [x] 30.1 Add normal plus failure/boundary/accessibility coverage, including registration dual-root invalidation, query-bound form refresh, date validation, and historical fallback.

## 31. MSW Tests

- [x] 31.1 Cover exact 38 baseline endpoints plus only the one authorized target endpoint (39 total), request bodies/date fields, headers, envelopes and cache effects.
- [x] 31.2 Cover Session/error/conflict/replay/file-token/retry/disclosure boundaries.

## 32. Playwright

- [x] 32.1 Run complete registration-to-refund Buyer journeys at 390px.
- [x] 32.2 Run 320px, 200%, reduced-motion, keyboard, 401/403/404/409/503, refreshed/direct query deep links, registration mismatch, and strict file-path gates.

## 33. Security Verifier

- [x] 33.1 Add static/runtime checks for identity, fixed adapter paths, date authority, actions, money, files, API 38→39 boundary and forbidden disclosure.

## 34. Build/Typecheck

- [x] 34.1 Pass Web and workspace typecheck/build after implementation.

## 35. Browser Screenshots

- [x] 35.1 Capture deterministic 390px primary journeys and 320px/error/accessibility states for review.

## 36. OpenSpec Validation

- [x] 36.1 Pass target strict OpenSpec validation and exact structure counts (1/1; 10/58/116/24).
- [x] 36.2 Pass repository-wide strict OpenSpec validation and record INFO count (15/15; 33 pre-existing INFO, 0 in this Change).

## 37. Formal Verify

- [x] 37.1 After implementation only, formally map all 58 Requirements / 116 Scenarios to evidence.

## 38. Ponytail

- [ ] 38.1 Keep Ponytail off in planning/implementation; run no review without later explicit controller authorization.

## 39. Integration

- [x] 39.1 After controller freeze, implementation, complete acceptance, Verify and authorized closeout, validate a clean Integration without development.

## 40. Main Advancement

- [ ] 40.1 Advance main only after separately authorized clean Integration; do not deploy from this task.

## Implementation Verification Evidence

### Final Controller Remediation

- [x] R.1 Query keys include complete limit/cursor/filter/entity/version inputs, preserve distinct 8/20/100 caches, and expose eight stable invalidation roots.
- [x] R.2 All eight Buyer list sources use cumulative cursor paging, retain successful pages, retry only a failed later page, and reset the cursor chain on filter changes.
- [x] R.3 All protected Buyer file buttons reuse `FileReadController` through trusted providers, including 429/503 same-token recovery and provider-change/unmount Object URL release.
- [x] R.4 All eight Buyer mutations reuse one idempotent operation controller: ambiguous results retain the exact key/body for explicit retry; changed body, success, and deterministic conflicts rotate authority.
- [x] R.5 Every legal Buyer route has exactly one semantic five-item navigation owner, including formal orders/refunds/change-password under `我的`.
- [x] R.6 Dashboard tasks deduplicate by `businessObjectKey`; each failed source retains its own safe request ID and source-only retry.
- [x] R.7 Instruction Content is requested only for `ACTIVE`; terminal states request zero Content, and image DTOs enforce null main position plus positive, unique, strictly increasing keyword positions and safe paths.
- [x] R.8 PRICE_MISMATCH preserves the signed JPY delta, states its high/low direction, and fails closed when the mismatch flag and delta disagree.
- [x] R.9 Module1 security/formal verifiers resolve either the active ordinary directory or one strictly dated archive, reject coexistence/duplicates/symlinks/missing roots, and exercise all six resolver cases deterministically.
- [x] R.10 Root `npm run check` includes Module1 security and Migration 0028 verification without changing the migration, database schema, backend, Contract, Domain, dependencies, or package-lock graph.
- [x] R.11 Automated evidence: 232 Module1 tests, 405 Web/Wave14A tests, 1001 repository tests, 88 Module1 Playwright tests, and 130 complete Playwright tests.
- [x] R.12 Regenerated and visually reviewed all 20 deterministic screenshots; code artifacts continue to exclude screenshots.
- [ ] R.13 Ponytail, Integration, and Main Advancement remain separately controlled and were not performed.

- [x] V.1 Migration 0028 verification: schema 28, 117 tables, 221 triggers, 10 views; nullable history, strict Gregorian values, mandatory new writes, and formal-source equality.
- [x] V.2 Buyer API verification: frozen baseline 38 to target 39 with exactly the dedicated order-evidence file read-intent endpoint added.
- [x] V.3 Frontend verification: complete query keys, eight cumulative pagers, semantic five-item navigation, business-object dashboard dedupe, formal file/mutation controllers, ACTIVE-only instruction Content, strict image DTOs, signed price mismatch, and precise root invalidation.
- [x] V.4 Automated verification: 232 Module1 tests, 405 Wave14A Web tests, 1001 repository tests, 88 Module1 Playwright tests, 130 complete Playwright tests, workspace gates, and 20 deterministic screenshots.
- [x] V.5 Formal OpenSpec Verify: `COMPLETE=58`, `INCONSISTENT=0`, `MISSING=0`, `PARTIAL=0`, `NOT_VERIFIED=0`, `CRITICAL=0`, `WARNING=0`, `SUGGESTION=0`; `Scenarios=116/116`.

### Formal Requirement and Scenario Mapping

Requirement and Scenario ranges follow their order in each named delta Spec. The formal verifier checks the exact headings, two Scenarios per Requirement, evidence-file existence, and aggregate counts.

| Capability | Requirement coverage | Scenario coverage | Primary evidence |
|---|---:|---:|---|
| buyer-demand-reservation | R01–R08 COMPLETE | S01–S16 COMPLETE | Demand/reservation pages, API adapters, browser acceptance |
| buyer-formal-orders | R01–R04 COMPLETE | S01–S08 COMPLETE | Migration 0028, formal read model, immutable detail, migration tests |
| buyer-mobile-accessibility | R01–R05 COMPLETE | S01–S10 COMPLETE | Mobile CSS, UI primitives, 390/320/200%/motion/keyboard acceptance |
| buyer-order-evidence | R01–R08 COMPLETE | S01–S16 COMPLETE | Contract/domain/API date chain, exact-one upload, read intent and tests |
| buyer-order-instruction | R01–R05 COMPLETE | S01–S10 COMPLETE | State-first API, five UI states, fixed image provider, path rejection |
| buyer-refund-status | R01–R04 COMPLETE | S01–S08 COMPLETE | Read-only DTO/API/UI, payment/reversal/OVERPAID acceptance |
| buyer-registration-profile | R01–R05 COMPLETE | S01–S10 COMPLETE | Registration controller, dual-root MSW tests, mismatch acceptance |
| buyer-review-workflow | R01–R08 COMPLETE | S01–S16 COMPLETE | Review API/UI, 1–3 files, read provider, command acceptance |
| buyer-routing-dashboard | R01–R06 COMPLETE | S01–S12 COMPLETE | Route tree, five-item layout, task priority and partial-failure tests |
| buyer-testing-quality | R01–R05 COMPLETE | S01–S10 COMPLETE | Module scripts, security/migration/formal verifiers, browser suite/screenshots |

## Planning Validation Evidence

- [x] P.1 Complete corrected route, DTO/status/date, dashboard, form, file-adapter, registration-security, visual, and acceptance references.
- [x] P.2 Complete Proposal, Design, ten Specs, and this Tasks plan.
- [x] P.3 Run isolated `npm ci` and the formal baseline regression (128 files / 909 tests, Wave14A 18 / 330, Playwright 42).
- [x] P.4 Run strict OpenSpec target/all validation and exact counts.
- [x] P.5 Confirm staged/committed Git scope is only this Change; final post-push clean state is reported separately.

## INTEGRATION_VALIDATION_EVIDENCE

- Integration started from remote `main` `f8b160d8fd5f2c16509ca8ffddcd7a60c754135c` and introduced Feature closeout `4c8609fe7ccc4ea3b471174ed8b962a577ed1d67` by `git merge --ff-only`; before this evidence record, the Integration tree was byte-identical to the Feature tree.
- Isolated-cache `npm ci` completed without changing the lockfile. The existing audit reported two high-severity dependency findings; no automatic dependency mutation was attempted during Integration.
- Repository `npm run check` passed: 140 test files / 1001 tests / 0 failed, all workspace typechecks/builds, schema 28 with 117 tables / 221 triggers / 10 views / 0 foreign-key errors, Module 1 security and Migration 0028 verification, and API Wrangler dry-run.
- Complete browser validation passed 130/130, including all 88 Module 1 scenarios and 20 deterministic temporary screenshots. Repository-wide OpenSpec strict passed 24/24; Formal Verify remained `COMPLETE=58`, `Scenarios=116/116`, with zero inconsistent, missing, partial, unverified, critical, warning, or suggestion findings.
- Secrets scan passed. Integration changed no business source, Contract, Domain, Migration, dependency manifest, lockfile, or deployment configuration; only this archived governance evidence changed after validation.
- No production deployment, external credential creation, online database operation, force push, squash, rebase, or main advancement occurred in this Integration stage.
