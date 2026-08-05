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

- [x] 3.1 After controller freeze, select/install compatible React Router, TanStack Query, Zod, Tailwind, lucide-react, and approved narrow Radix primitives.
- [x] 3.2 Install Testing Library, user-event, MSW, jsdom, and Playwright with lockfile/license/install-script review.

## 4. Runtime Configuration

- [x] 4.1 Implement non-secret runtime configuration and origin-relative `/api/*` enforcement.

## 5. Design Tokens

- [x] 5.1 Freeze Quiet Operations, brand/identity/status semantics, typography, shape, shadow, responsive, and prohibited-style rules.
- [x] 5.2 Implement light CSS custom properties and Tailwind semantic mappings with contrast tests; do not add dark mode.

## 6. App Bootstrap

- [x] 6.1 Implement StrictMode, root/config validation, Root Error Boundary, Router/Query integration, and safe bootstrap failure.

## 7. Router

- [x] 7.1 Implement public, login, callback, Buyer, Seller, Staff, guard, return-path, and scoped not-found routes.

## 8. Root Entry

- [x] 8.1 Implement the `月光白` dedicated-link notice with no identity controls while retaining direct Buyer, Seller, and Staff login routes.

## 9. Buyer Shell

- [x] 9.1 Implement the mobile-first Buyer shell and fixed 首页、任务、订单资料、评论、我的 navigation without business pages.

## 10. Seller Shell

- [x] 10.1 Implement the medium-density Seller shell, list context, right detail drawer, focus restoration, and small-screen fallback without business pages.

## 11. Staff Shell

- [x] 11.1 Implement the queue/detail/action workbench, semantic separations, context preservation, and narrow fallback without business pages.

## 12. API Envelope

- [x] 12.1 Implement credentialed fetch transport, success/error envelope parsing, request ID, AbortSignal, and endpoint Zod validation.

## 13. API Errors

- [x] 13.1 Implement safe normalized errors, status/code categories, safe detail allowlists, Retry-After, and request-ID presentation.

## 14. Query Client

- [x] 14.1 Implement identity-rooted query keys, finite GET retry, zero default mutation retry, cancellation, stale/gc policy, and no persistence.

## 15. Idempotency

- [x] 15.1 Implement in-memory logical-operation keys, identical-body safe retry, release lifecycle, and latest-DTO expected_version handling.

## 16. Staff Auth

- [x] 16.1 Implement login/start, safe Provider redirect, callback return, Session read, logout/logout-all boundaries, and local Provider validation.

## 17. Buyer Auth

- [x] 17.1 Implement Buyer Customer Auth login/session/account-type/password-change states without a full registration business page.

## 18. Seller Auth

- [x] 18.1 Implement Seller Customer Auth login/session/account-type/password-change states without client role selection.

## 19. Session Cache Isolation

- [x] 19.1 Implement three separate state machines plus Customer shared-transport invalidation: Customer login/mismatch/logout/401 clears Buyer+Seller, Staff 401 clears Staff only, and 403/404 changes no Session.

## 20. File Transfer Client

- [x] 20.1 Implement purpose-bound intent/upload/complete/VERIFIED/read flows, memory-only tokens, progress, cancel, expiry/replay restart, and compensation state.
- [x] 20.2 Prove no object key/permanent URL/generic Link/Grant/deferred internal-communication upload capability exists.

## 21. Shared UI Primitives

- [x] 21.1 Implement the frozen shell/navigation/input/content/data/overlay/feedback/state primitive inventory with semantic tokens.

## 22. Accessibility

- [x] 22.1 Implement semantic HTML, keyboard/focus/overlay behavior, labels/errors, non-color states, live announcements, alt/table semantics, 320px/200%, targets, and reduced motion.

## 23. Unit Tests

- [x] 23.1 Add Vitest coverage for configuration, routing, keys, envelopes, errors, retry, idempotency, Session, and the scoped file state policy already present in Wave 14A.

## 24. Component Tests

- [x] 24.1 Add Testing Library/user-event/jsdom coverage for routes, shells, forms, focus, overlays, responsive semantics, and all system states.

## 25. MSW Tests

- [x] 25.1 Add real `/api/*` MSW coverage for credentials, envelopes, identity, statuses, retry/cancel, idempotency, Customer two-root invalidation, Staff-only invalidation, mismatch non-navigation, and phantom internal-communication route rejection.
- [x] 25.2 Add File Transfer MSW coverage only after the separately authorized File Transfer implementation.

## 26. Playwright Smoke

- [x] 26.1 Add and run minimal production-build smoke for root/login/guards/shells/keyboard/320px/403/404/503 without business acceptance claims.

## 27. Security Verifiers

- [x] 27.1 Add gates for no `/api/v2`, hard-coded production host, secret/Cookie/client authority, persisted sensitive cache, raw error leakage, object key, permanent URL, or generic File Link/Grant.

## 28. Build and Typecheck

- [x] 28.1 Run Web and workspace typecheck/build and record exact results.

## 29. Browser Validation

- [x] 29.1 Run local browser smoke and accessibility/responsive checks; leave real business, Feishu, R2, mainland network, and production validation deferred.

## 30. OpenSpec Validation

- [x] 30.1 Run target and repository-wide strict OpenSpec validation and record passed/failed/INFO counts.

## 31. OpenSpec Verify

- [x] 31.1 After implementation and all gates, run formal OpenSpec Verify against all 42 Requirements and 84 Scenarios.

## 32. Ponytail Read-only Review

- [x] 32.1 Keep Ponytail off during planning/implementation; only after full acceptance and separate authorization may a read-only review run.

## 33. Integration

- [x] 33.1 Create/validate Integration only after controller acceptance, Verify, and authorized governance completion; do not develop there.

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

## A3R2_VALIDATION_EVIDENCE

- Customer login and protected-route Session account-type mismatches now use one fail-closed cleanup coordinator: cancel Buyer and Seller requests, remove both Customer query roots, then call `POST /api/customer-auth/logout` without touching Staff state or offering cross-identity navigation.
- The mismatch coordinator has explicit `IDLE`, `CLEANING`, `CLEANED`, and `FAILED` states. An in-flight Promise lock prevents duplicate logout during React rerenders; only the accessible explicit retry action starts a new cleanup attempt after failure.
- Logout failure keeps every Customer Shell blocked, keeps both Customer roots empty, presents only the safe cleanup-failure message and request ID, and exposes a `重新清理` action.
- Customer password changes now use an in-memory operation lifecycle with `IDLE`, `EDITING`, `SUBMITTING`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`, `SUCCESS`, and `CANCELED` states plus an operation-held Idempotency-Key, non-secret edit-revision fingerprint, safe error, and request ID.
- The first valid submit creates one Key. An unchanged-body explicit retry after network, rate-limit, dependency, or `REQUEST_IN_PROGRESS` failure reuses it. Editing either password field or canceling releases it, and the next submit creates a new Key. React rerenders preserve the active operation and Key.
- Password success clears both Customer roots and rereads the formal Customer Session. Only an identity-matched Session with `password_change_required=false` enters the matching Shell. Response or reread identity mismatch invokes the same logout coordinator; 401 clears Customer only; `IDEMPOTENCY_CONFLICT` ends the old operation; `REQUEST_IN_PROGRESS` remains non-concurrent and explicitly retryable.
- Three Controller → QueryClient → Component → Customer API Adapter Stub test files create real QueryClient instances, seed Buyer, Seller, and Staff caches, and assert final cache contents. They cover login mismatch, Session mismatch and loop prevention, logout failure and accessible retry, password Key reuse/release, rerender, Session reread, mismatch, 401, conflict, in-progress, and password-change-required boundaries.
- Validation passed: Web typecheck; Wave 14A security verifier; 6 Wave 14A test files / 27 tests / 0 failed; Web production build; 4 Playwright smoke tests / 0 failed; repository `npm run check` with 116 test files / 606 tests / 0 failed; target strict OpenSpec 1/1 and all strict OpenSpec 8/8.
- Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files. Database verification remains 27 migrations / schema 27 / 117 tables / 221 triggers / 10 views, with no `0028`.
- Backend, Contracts, Migrations, and `package-lock.json` were not modified. Formal MSW matrix, File Transfer, remaining UI primitives, visual refinement, and formal OpenSpec Verify remain unstarted.

## A3R3_VALIDATION_EVIDENCE

- `/buyer/change-password` and `/seller/change-password` now use an independent `CustomerPasswordRouteBoundary` instead of a naked page or the protected-shell guard. The boundary has explicit `LOADING`, `ALLOWED`, `UNAUTHENTICATED`, `MISMATCH_CLEANING`, `MISMATCH_CLEANUP_FAILED`, and `DEPENDENCY_ERROR` outcomes.
- A valid matching Customer Session may enter the password form whether `password_change_required` is true or false, preserving both forced and voluntary password change supported by the backend. The boundary does not redirect a matching Session to its own route.
- A Customer Session 401 hides the form, clears Buyer and Seller roots, preserves Staff, and returns only to the same-domain login. Account-type mismatch hides the form, reuses the A3R2 Customer logout coordinator, clears both Customer roots, exposes no opposite-identity link, and never enters either Shell.
- Mismatch logout failure remains fail closed with a safe request ID and accessible `重新清理` action. Network/503/contract Session failure remains a retryable dependency state and is not misclassified as logout.
- The Wave 14A root/spec/reference semantics now consistently require only `月光白` plus `请使用工作人员发送的专属链接登录。`, while `/buyer/login`, `/seller/login`, and `/staff/login` remain directly reachable. Obsolete cross-identity handoff/correct-entry wording is prohibited by the security verifier.
- A new Controller → QueryClient → Component → Customer API Adapter Stub test file adds 10 route scenarios covering Buyer/Seller 401, matching Buyer/Seller Sessions, both password-change-required values, both mismatch directions, cleanup failure/retry, dependency retry, cache isolation, and rerender logout locking. The existing Root component test continues to prove no identity link is rendered.
- Validation passed: Web typecheck; Wave 14A security verifier; 7 Wave 14A test files / 37 tests / 0 failed; Web production build; 4 Playwright smoke tests / 0 failed; repository `npm run check` with 117 test files / 616 tests / 0 failed; target strict OpenSpec 1/1 and all strict OpenSpec 8/8.
- Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files. Backend, Contracts, Migrations, and `package-lock.json` remain unchanged. Formal MSW matrix, File Transfer, remaining UI primitives, formal browser acceptance, and formal OpenSpec Verify remain unstarted.

## A4_MSW_VALIDATION_EVIDENCE

- A single formal MSW infrastructure now separates `server.ts`, `handlers.ts`, `fixtures.ts`, `lifecycle.ts`, and `render.tsx`. It uses `setupServer`, `http`, and `HttpResponse`; every MSW test imports the shared lifecycle with `onUnhandledRequest: 'error'`, per-test handler reset, and final server close.
- Six MSW test files add 72 real network scenarios. They traverse production Controllers or test components through the real Customer/Staff adapters and `apiRequest` to `fetch`, MSW, strict Envelope parsing, and endpoint Zod schemas. No formal MSW evidence stubs `global.fetch` or mocks Hook results.
- The Transport matrix covers GET/POST/PUT/PATCH/DELETE with `credentials: 'include'`, JSON and Content-Type, custom `Idempotency-Key`, success data/request ID, malformed top-level and business data, strict failure envelopes, 401/403/404/409/422/429/503 classification, AbortSignal cancellation, network failure, invalid paths, and finite retry. Unknown JavaScript exceptions now fail closed instead of retrying.
- `safeDetails` now uses an error-code-specific primitive allowlist for approved `field`, `reason`, version, and retry fields. Tests inject stack, SQL, query, Cookie, token, Authorization, object key, signed URL, Provider response, and nested exception data and prove none is retained or rendered.
- Customer MSW coverage proves Buyer/Seller login and password-required states, both mismatch directions, real logout and explicit retry after 503, Customer Session 401/503 and flat-envelope rejection, Buyer/Seller password changes, one-key safe retry, new key after edit, 401 cleanup, idempotency conflict/in-progress behavior, Session reread, and reread mismatch logout.
- Customer race coverage seeds `['buyer','session']`, `['buyer','fixture']`, `['seller','session']`, `['seller','fixture']`, `['staff','session']`, and `['staff','fixture']`. Customer 401 awaits two-root cleanup before login navigation; mismatch cancels a live MSW Session request; settled cleanup performs final removal so an active Observer cannot recreate an empty or stale Customer key; extra event-loop turns do not refill either root; Staff remains intact.
- Staff MSW coverage proves the exact login/start body, strict Provider Origin, real nested Session, flat-envelope rejection, Staff-only 401 cleanup, 503 dependency state, ordinary logout success/401/503 semantics, logout-all `{}` body, Idempotency-Key reuse/new-operation lifecycle, parsed `session_version`, conflict/in-progress/concurrent-submit behavior, and no automatic 429/503 retry. Buyer and Seller cache state remains unchanged.
- Real protected-route tests use `/api/buyer-portal/me` and `/api/staff/me/assignments` to prove 403/404 preserve every Session, do not navigate to login, expose only the safe request ID, and never render raw details. The phantom `POST /api/staff/order-evidence/:id/internal-communication-files` has no production call or handler and fails as an unhandled MSW request.
- Final validation: Wave 14A 13 test files / 109 tests / 0 failed; Playwright 4 passed / 0 failed; repository 123 test files / 688 tests / 0 failed; Web and workspace typecheck/build passed; the Wave 14A security verifier passed.
- Strict OpenSpec target validation passed 1/1 with 0 issues. Strict repository-wide validation passed 8/8 with 0 failures and the same 27 pre-existing INFO notices. Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files.
- Database and route invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views / 138 active routes, with no `0028`. Backend, Contracts, Migrations, and `package-lock.json` remain unchanged.
- File Transfer implementation/MSW, remaining UI primitives, final visual refinement, full browser acceptance, formal OpenSpec Verify, Ponytail, Integration, `main`, deployment, and Wave 14B remain pending and were not started.

## A4R_SESSION_AND_401_EVIDENCE

- Buyer, Seller, Customer password-route, and Staff protected boundaries now require a network result completed after the current mount. Cached Session DTOs remain internal Query data and cannot authorize a Shell or password form while the fresh request is pending.
- Fresh matching Session success authorizes only the matching identity. Fresh Customer account-type mismatch remains fail closed through the existing logout coordinator. Fresh 503, network, and contract failures render dependency state without exposing cached protected content.
- Customer Session 401 enters an explicit clearing state, awaits cancellation and removal of both Buyer and Seller roots, preserves Staff, and only then permits same-domain login navigation. Staff Session 401 analogously clears only Staff and preserves both Customer roots. Cleanup rejection remains a dependency failure and cannot claim unauthenticated success.
- `identityApiRequest` is a narrow identity-aware boundary over the single `apiRequest` Transport. It accepts an explicit Buyer, Seller, or Staff identity plus the active QueryClient and original request; a validated 401 awaits the correct identity cleanup and rethrows the same normalized error.
- Minimal real protected adapters cover `GET /api/buyer-portal/me`, `GET /api/seller-portal/me`, and `GET /api/staff/me/assignments`. Session endpoints retain their controller-owned 401 handling so cleanup is not duplicated.
- Formal MSW evidence seeds Session and fixture keys for all three identities. Delayed fresh Session tests prove no Buyer, Seller, Staff, or password-route protected content flashes. Customer and Staff 401 ordering tests prove login/unauthenticated state is observed only after matching roots are empty and one corresponding cancellation sequence ran.
- Protected-resource MSW tests prove Buyer, Seller, and Staff 401 cleanup and delayed rejection ordering through the real identity-aware adapters. The 403/404 matrix preserves all roots and safe request IDs. The 409/422/429/503, network, cancellation, and malformed-response matrix preserves every identity cache.
- The Wave 14A security verifier structurally checks all three fresh gates, 401 clearing order and failure state, delayed race evidence, the single Transport call, all three protected paths, non-401 preservation, absence of global AuthContext/event invalidation, and rejection of protected business adapters that bypass `identityApiRequest`.
- Final validation passed: Wave 14A 13 test files / 142 tests / 0 failed; Playwright 4 passed / 0 failed; repository 123 test files / 721 tests / 0 failed; Web and workspace typecheck/build passed; Wave 14A and repository security/regression checks passed.
- Strict OpenSpec target validation passed 1/1 and strict repository-wide validation passed 8/8. Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files.
- Database invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views, with no `0028`. Backend, Contracts, Migrations, package manifests, and lockfiles remain unchanged.
- File Transfer, remaining UI/visual work, formal OpenSpec Verify, Ponytail, PR, Integration, `main`, deployment, Push, and Wave 14B remain pending and were not started.

## A4R2_MOUNTED_401_EVIDENCE

- The first real Buyer mounted-boundary MSW test failed before implementation: while the protected 401 had already entered Customer cancellation, the Buyer Shell and private content remained rendered. Query-cache emptiness alone was therefore rejected as Session-transition evidence.
- A QueryClient-scoped Session invalidation coordinator now uses one WeakMap with independent Customer and Staff channels. Each channel exposes `STABLE`, `CLEARING`, `INVALIDATED`, and fail-closed `FAILED` state through `useSyncExternalStore`; it carries no user identity, role, permission, account type, or client authority.
- `identityApiRequest` captures the current channel generation before every protected request. A validated 401 synchronously enters `CLEARING`, reuses one in-flight cleanup Promise for duplicate 401 responses in the same generation, awaits matching root cleanup, and only then enters `INVALIDATED` while rethrowing the original normalized error.
- Every matching Fresh Customer or Staff Session establishes a new generation. A protected request may invalidate only the generation it captured. Tests start delayed Customer and Staff protected requests, establish newer matching Fresh Session generations, then release the old 401 and prove the newer Shell, Session, and fixture caches remain intact without relying on abort success.
- Buyer mounted-chain evidence uses the real Customer Session adapter, `CustomerSessionBoundary target="buyer"`, Router, visible Buyer Shell/private content, `protectedResourcesApi.readBuyerMe`, `identityApiRequest`, real QueryClient, and MSW. Protected 401 immediately hides the Shell; Buyer and Seller cleanup completes before `/buyer/login`; Staff remains unchanged.
- Seller mounted-chain evidence uses the real Seller Session boundary and `GET /api/seller-portal/me`. Protected 401 immediately hides Seller content, clears both Customer roots before `/seller/login`, preserves Staff, exposes no Buyer entry, and runs no duplicate Customer invalidation.
- Staff protection now uses the independently exported and directly testable `StaffSessionBoundary`. Its mounted-chain test verifies a real Staff Session and visible Shell before `GET /api/staff/me/assignments`; protected 401 immediately hides private content, waits for Staff-only cleanup before `/staff/login`, and preserves every Buyer and Seller Session/fixture key.
- Customer and Staff concurrent-401 tests send two real protected requests in one Session generation and prove they share one cancellation sequence. Customer performs exactly the Buyer/Seller pair; Staff performs exactly one Staff cancellation.
- Mounted Buyer, Seller, and Staff 403/404 tests preserve the visible Shell and private content, keep every identity cache unchanged, remain on the protected route, and render only the safe request ID without raw token, object key, or internal reason details.
- Customer and Staff cancellation-failure tests prove the Shell remains hidden, no login or other identity is entered, matching roots remain empty, a safe request ID and explicit `重新清理` action are shown, and only user retry can complete invalidation and enter the same-domain login.
- The security verifier structurally requires the independent Staff boundary, WeakMap and `useSyncExternalStore` coordinator, synchronous clearing order, generation guard, duplicate-Promise reuse, real mounted Router/Boundary/Shell tests, cleanup-before-login assertions, Customer/Staff isolation, stale-401 evidence, mounted 403/404 retention, and absence of storage/window-event invalidation or protected-adapter bypass.
- Final validation passed: Wave 14A 14 test files / 157 tests / 0 failed; Playwright 4 passed / 0 failed; repository 124 test files / 736 tests / 0 failed; Web and workspace typecheck/build, security scans, Wave checks, and Wrangler dry-run passed.
- Strict JSON OpenSpec validation passed target 1/1 and repository-wide 8/8 with 0 failures. Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files.
- Database invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views, with no `0028`. Backend, Contracts, Migrations, package manifests, and lockfiles remain unchanged.
- File Transfer, remaining UI primitives and visual refinement, final browser acceptance, formal OpenSpec Verify, Ponytail, PR, Integration, `main`, deployment, Push, and Wave 14B remain pending and were not started.

## A5A_FILE_UPLOAD_EVIDENCE

- `apps/web` now declares exact direct dependency `@ygb/contracts: 0.1.0`; npm generated the matching lockfile workspace edge without changing any other dependency version. The Web client imports the internal Contract package and does not import Backend or Domain implementation into the browser bundle.
- Exactly five fixed upload workflows are exposed: Buyer Order Evidence (`ORDER_EVIDENCE` / `BUYER_VISIBLE`), Buyer Review Evidence (`REVIEW_EVIDENCE` / `SELLER_VISIBLE`), Seller Product Application Image (`PRODUCT_APPLICATION_IMAGE` / `SELLER_VISIBLE`), Staff Buyer Refund Proof (`BUYER_REFUND_PROOF` / `INTERNAL_ONLY`), and Staff Seller Settlement Proof (`SELLER_SETTLEMENT_PROOF` / `INTERNAL_ONLY`). No arbitrary Purpose/Visibility/identity/path selector or deferred internal-communication workflow exists.
- The frontend holds an explicit snapshot of the current server file policies: exact maximum counts, 10/20 MiB limits, image MIME sets, and PDF only for the three evidence/proof workflows. Local validation rejects empty/oversize/over-count files, missing or mismatched MIME/extension, unsafe/multiple extensions, duplicate File identity, and duplicate name/size/lastModified descriptors before network activity; server byte inspection remains authoritative.
- Strict Zod schemas cover exact Upload Intent request/response, Upload Content response, Complete request/response, bounded identifiers, positive safe integer versions/byte sizes, nonnegative safe integer times, and 64-character lowercase SHA-256. Context validation binds Purpose/Visibility, slot count and uniqueness, Intent/File IDs, Manifest count, and every VERIFIED file to the selected workflow and Intent.
- The upload Controller implements `IDLE`, `VALIDATING`, `CREATING_INTENT`, `INTENT_READY`, `UPLOADING`, `COMPLETING`, `VERIFIED`, `RESTART_REQUIRED`, `ERROR`, `CANCELED`, `FILE_COMPENSATION_REQUIRED`, and `DEPENDENCY_UNAVAILABLE`, with per-slot `PENDING`, `UPLOADING`, `UPLOADED`, `FAILED`, and `CANCELED` states. Public snapshots contain only workflow, safe slot metadata, measured progress, request ID, safe error, retry/restart flags, and verified safe Manifest.
- Intent creation uses the exact fixed path, credentialed identity-aware JSON Transport, AbortSignal, exact descriptors, and one memory-only Idempotency-Key. Intent success releases the create key. A replay or any unavailable/null token discards transient authority and enters `RESTART_REQUIRED`; explicit restart creates a new key and no ambiguous Intent network failure silently retries.
- Upload content uses a dedicated native `XMLHttpRequest` with `withCredentials=true`, `PUT` to the fixed identity lifecycle prefix, `Accept`, `X-Upload-Token`, per-slot Idempotency-Key, AbortSignal, and exactly one browser-generated multipart `file` part. It never sets multipart Content-Type, converts bytes to base64, or places file bytes in Query cache.
- Real XHR upload progress is projected only from `lengthComputable` events with positive totals; bytes and percent are bounded, otherwise the snapshot remains `INDETERMINATE`. Slot success is recorded only after a valid HTTP success envelope, and Operation VERIFIED is recorded only after strict Complete.
- Cancel aborts the current XHR, stops later slots and Complete, enters `CANCELED`, and clears File/token/key private memory without claiming server cleanup or issuing compensation/delete calls. Replacing files cancels the old operation before creating a new Intent and new keys.
- Each slot owns a separate memory-only Idempotency-Key. An explicit identical retry after `NETWORK_FAILURE` or `REQUEST_IN_PROGRESS` reuses the same File/token/File ID/key; successful upload releases token/key. Slots never share keys, no mutation retries automatically, and unsafe expiry/token rejection/file change/conflict paths require restart.
- Complete runs only after every slot is `UPLOADED`, posts exact latest Intent `expected_version` with its own memory-only key, and reuses that key only for an explicit lost-response or `REQUEST_IN_PROGRESS` retry. Success releases the key and exposes only `upload_intent_id`, intent version, request ID, and verified File ID/version/Purpose/Visibility/MIME/byte-size/SHA-256.
- `FILE_UPLOAD_EXPIRED`, rejected upload authority, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, and storage conflict abandon old upload authority and require a new Intent. `REQUEST_IN_PROGRESS` preserves the matching command key without concurrent submit or polling. `FILE_VALIDATION_FAILED` never reaches Complete. `FILE_COMPENSATION_REQUIRED` and `DEPENDENCY_UNAVAILABLE` remain distinct safe states; the browser performs no object cleanup.
- JSON fetch and XHR share the same Success/Failure Envelope, request ID, safe-details, Retry-After, status-category, and normalization functions. Both cross the same generation-aware identity 401 coordinator: Buyer/Seller clear both Customer roots, Staff clears Staff only, cleanup is awaited, and a stale upload 401 cannot invalidate a newer fresh Session generation.
- Production and tests prove upload tokens, Idempotency-Keys, and File objects never enter the public snapshot, Query cache, Web Storage, URL, DOM, or log. No object key, permanent/signed URL, owner/scope/storage metadata, Read Intent, download, Object URL, Link, Grant, business consume endpoint, or phantom internal-communication route was added.
- Formal tests use the single `setupServer` lifecycle with `onUnhandledRequest: 'error'`. Two new test files add 70 cases, including all five real Intent paths, exact descriptors/credentials/headers/multipart bytes, genuine XHR progress, cancel/abort, replay, malformed envelopes, Purpose/Visibility/slot/Manifest mismatch, multi-slot isolation, per-slot keys, explicit retry, Complete ordering, all required file error states, Customer/Staff 401 isolation, and stale-generation protection. No global fetch stub is used.
- Validation passed: isolated-cache `npm ci`; Web typecheck; Wave 14A security verifier; 16 Wave 14A test files / 227 tests / 0 failed; Web production build; 4 Playwright smoke tests / 0 failed; repository `npm run check` with 126 test files / 806 tests / 0 failed and all workspace builds/Worker dry-run passed.
- Database invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views, with no `0028`. Backend, Contracts, Domain, and Migrations were not modified; package changes are limited to the exact Web `@ygb/contracts` direct dependency and generated lockfile edge.
- Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files. Task 20.1 remains unchecked because Read Intent, download, and Object URL are deferred. Remaining UI primitives, final visual refinement, full business browser acceptance, formal OpenSpec Verify, Ponytail, PR, Integration, `main`, deployment, Push, and Wave 14B remain unstarted.

## A5AR_UPLOAD_RECOVERY_EVIDENCE

- The Controller now derives `canCancel` from the live operation stage and rejects cancel before aborting unless the operation is validating, creating an Intent, Intent-ready, uploading, or in an Upload-stage retry/dependency state. `COMPLETING`, `VERIFIED`, and `FILE_COMPENSATION_REQUIRED` are non-cancelable; the harness disables its Cancel action from the same snapshot capability.
- A centralized runtime transition assertion guards every Controller publication. It rejects terminal-to-canceled transitions, Complete before every public Slot is `UPLOADED`, and VERIFIED without a strictly validated Complete Manifest. Cancel after VERIFIED preserves the exact Manifest; cancel/retry/start/replace after compensation preserves the terminal state and request ID.
- Complete owns the active operation until it settles. `cancel` cannot abort it, `replaceFiles` waits without starting another Intent, and ambiguous Complete failure preserves the original Complete Idempotency-Key, expected version, receipts, and request body for user-directed retry only.
- One `releaseAllSlotAuthorities()` path clears every Slot Upload Token and Idempotency-Key before abandoning an Intent. Multi-Slot first-file 401 clears Customer transport plus the complete old Intent authority; first-file 422 also releases original File references, sets `requiresFileReselection`, stops later Slots/Complete, and cannot retry or restart the old Intent.
- A 2xx Upload schema/parse failure and response-loss network failure remain ambiguous remote results. The current File, File Object ID, Upload Token, and per-Slot key are retained; later Slots and Complete stop; only explicit retry reuses the identical Token/key/body. Explicit business and unsafe Contract failures release all Intent authority.
- A 2xx malformed Complete schema/Manifest response and response-loss network failure remain retryable without VERIFIED. Explicit retry reuses the exact Complete key and `{ expected_version: 1 }` body; no automatic mutation retry, new key, or new Intent is created.
- `FILE_NOT_VERIFIED` has an explicit non-verified, non-retryable, non-cancelable state with its safe request ID and restart/support semantics. The unsafe Intent authority is cleared, no automatic Complete/polling/compensation occurs, and VERIFIED is never projected.
- Every successful Upload retains a private safe receipt containing MIME, byte size, SHA-256, and uploaded File version after releasing Token/key. Complete cross-validates each unique Intent File ID, workflow Purpose/Visibility/allowed MIME, exact receipt MIME/size/SHA, File version `uploadedVersion + 1`, and Complete Intent version `intentVersion + 1` before publishing a safe Manifest.
- Formal Controller/MSW/XHR evidence covers all terminal cancel and occupancy rules, multi-Slot 401/422 cleanup, malformed and network-loss Upload/Complete recovery with key/body reuse, FILE_NOT_VERIFIED, all receipt/Manifest mismatches, exact backend v1→v2 Intent and v2→v3 File evolution, compensation lifecycle release, and `canCancel` stage values.
- Final validation passed: isolated-cache `npm ci`; Web typecheck; Wave 14A security verifier and build; 16 Wave 14A test files / 244 tests / 0 failed; 4 Playwright tests / 0 failed; repository 126 test files / 823 tests / 0 failed; all workspace builds and Worker dry-run passed.
- Strict JSON OpenSpec validation passed target 1/1 and repository-wide 8/8 with 0 failures. Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files. Database invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views, with no `0028`.
- Task 20.1 remains unchecked: Read Intent, download, Object URL, remaining File UI, formal browser acceptance, and formal OpenSpec Verify remain deferred. Backend, Contracts, Domain, Migrations, dependency files, Push, PR, Integration, `main`, and deployment were not modified or started.

## A5AR2_COMPLETE_RECOVERY_LOCK_EVIDENCE

- `COMPLETING` and Complete-stage `ERROR` / `DEPENDENCY_UNAVAILABLE` now form one locked recovery context. Network loss, successful-status malformed responses, `REQUEST_IN_PROGRESS`, and dependency failure retain the original Complete Idempotency-Key, Intent expected version, Upload receipts, and request body for explicit retry only.
- Public snapshots expose `canStartNewOperation` and `canReplaceFiles`. Both are false throughout Complete recovery and compensation terminal state; the Controller checks them before release or key generation, and the test harness disables its start/replace action from `canReplaceFiles`.
- `start`, `replaceFiles`, and `restart` are safe no-ops while Complete is in flight or recoverable. They preserve the exact Snapshot and Complete context, create no Intent/key, and never abort Complete. Explicit retry reuses the same key and `{ expected_version: 1 }` body and can recover to VERIFIED.
- VERIFIED permits a new independent upload with new Create, Upload, and Complete keys. FILE_NOT_VERIFIED permits explicit restart with the retained safe file selection. A `requiresFileReselection` error permits a fresh file/Intent; an ambiguous Upload can still be canceled or explicitly replaced, but direct `start` remains unavailable until that Upload is ended.
- The unused event Reducer and its duplicate transition map were deleted. `FILE_UPLOAD_TRANSITIONS` is the only immutable transition authority, `assertFileUploadTransition` enforces it for every Controller publication, and transition-programming errors use `FileUploadTransitionError` and are rethrown rather than normalized as network, contract, or user errors.
- Runtime workflow validation now precedes private-state release, Snapshot workflow assignment, VALIDATING, and key generation. Purpose literals, deferred `ORDER_EVIDENCE_INTERNAL_COMMUNICATION`, unknown strings, null, undefined, numbers, and objects fail closed as safe `VALIDATION_ERROR` with only approved workflow details, no network/cache/session impact, and no illegal transition. A later legal workflow remains fully usable.
- Formal MSW/Controller coverage proves all four Complete recovery locks and same-key/body retry, in-flight Complete occupancy, compensation no-ops, VERIFIED/FILE_NOT_VERIFIED/new-file recovery, ambiguous Upload replace/cancel, public capabilities, seven invalid runtime workflow classes, zero request/key generation, and legal recovery after invalid input. Tests no longer import or assert the deleted Reducer.
- Final validation passed: isolated-cache `npm ci`; Web typecheck; Wave 14A security verifier/build; 16 Wave 14A test files / 263 tests / 0 failed; 4 Playwright tests / 0 failed; repository 126 test files / 842 tests / 0 failed; all workspace builds and Worker dry-run passed.
- Strict JSON OpenSpec validation passed target 1/1 and repository-wide 8/8 with 0 failures. Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files. Database invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views, with no `0028`.
- `npm audit` reported 6 unresolved entries: 3 high, 3 moderate, 0 critical/low. Direct affected packages are runtime `hono` and `react-router-dom`, plus dev-only `wrangler`; only `hono` has a non-major-version fix suggestion in the audit result. No dependency fix or package-file change was made.
- Task 20.1 remains unchecked because Read Intent, download, Object URL, remaining File UI, and formal OpenSpec Verify remain deferred. Push, PR, Integration, `main`, deployment, and remote resource changes were not performed.

## FINAL_IMPLEMENTATION_VALIDATION_EVIDENCE

### Final build scope

- Final implementation adds the complete identity-bound File Read Intent/content flow, bounded binary verification, memory-only access authority, exact-length streaming, and ephemeral Object URL create/revoke lifecycle. The security verifier now requires these production paths and their formal MSW evidence.
- The frozen shared UI inventory is complete and component-tested: shell/navigation, fields/forms, data, overlay/navigation, feedback, state, request ID, progress, and skeleton primitives all use semantic light tokens and accessible state contracts.
- Root, Buyer, Seller, and Staff surfaces received final Quiet Operations polish without fake business data, dark mode, gradients, heavy shadows, customer-facing English branding, or `V2`. The accepted visual reference records final AA contrast values.
- Final Playwright acceptance contains 29 foundation scenarios plus 12 deterministic screenshot scenarios. It covers root and all login routes, password-route guards, Buyer 320px navigation, Seller desktop/drawer/card fallback, Staff desktop/narrow/logout flows, 401/mismatch, 403/404/503, keyboard focus, reduced motion, 200% text zoom, and five viewport sizes.

### Dependency and security disposition

- Exact `hono` was advanced from `4.12.32` to patched `4.12.34`. The `miniflare` dependency graph is pinned to `undici 7.29.0` through a narrow root override. No Backend source, Contract, Domain, Migration, route, schema, or production resource changed.
- Final `npm audit --json`: 0 critical, 2 high, 0 moderate, 0 low. Both reported nodes are the same React Router RSC-mode advisory. This application uses `BrowserRouter` as a static Vite SPA and does not import or enable React Server Components, server actions, or React Router framework/data-action mode; therefore the advisory path is not deployment-reachable in Wave 14A. The audit-recommended `7.11.0` change is an unsafe cross-range downgrade and was not applied. This residual is accepted for controller review, not represented as zero advisory inventory.
- `npm ci` install-script review reported five pending package scripts (`esbuild`, two `fsevents` versions, `msw`, and `workerd`); installation and all build/test gates completed without approving new scripts.
- The final Wave 14A verifier rejects `/api/v2`, client authority/storage, raw exception diagnostics, File Link/Grant/storage authority, deferred internal-communication capability, unsafe read headers/bytes, missing URL revocation, incomplete primitives, obsolete root semantics, and incomplete browser acceptance.

### Formal OpenSpec Verify report

| Dimension | Result |
|---|---|
| Completeness | 43/46 tasks complete; the only unchecked tasks are explicitly unauthorized Ponytail, Integration, and `main` advancement |
| Correctness | 42/42 Requirements mapped; 84/84 Scenarios covered by production structure plus unit/component/MSW/Playwright evidence |
| Coherence | Provider ownership, identity isolation, API/error/idempotency/file rules, Quiet Operations, responsive/accessibility rules, and deferred boundaries follow Proposal/Design |

- API client Requirements map to `apps/web/src/api/**`, Query/idempotency/session controllers, and formal transport/protected/MSW tests.
- Design/accessibility Requirements map to `apps/web/src/styles/**`, `apps/web/src/ui/primitives.tsx`, component tests, Playwright reflow/focus tests, and the accepted screenshots.
- File Requirements map to `apps/web/src/files/**`, the single upload transition authority, the File Read transition authority, XHR/fetch transports, and 149 scoped File tests.
- Routing/shell Requirements map to `apps/web/src/App.tsx`, identity boundaries, browser route/guard/error tests, and the 12 screenshot states.
- Runtime/session Requirements map to `apps/web/src/main.tsx`, runtime config, Router/Query providers, independent Customer/Staff boundaries, generation-aware invalidation, and logout/password flows.
- Testing-quality Requirements map to the strict shared MSW lifecycle, 18 Wave test files, 128 repository test files, 41 Playwright tests, security/migration/Wave verifiers, and strict OpenSpec validation.
- CRITICAL: 0. WARNING: 0. SUGGESTION: 0. Final assessment: all authorized Wave 14A implementation checks passed and the Change is ready for controller review, but not for archive/integration until governance authorizes the remaining stages.

### Exact final validation results

- `npm ci --cache /tmp/wave14a-npm-cache-delivery`: passed; 226 packages installed, 233 audited.
- Web typecheck: passed.
- Wave 14A: 18 test files / 322 tests / 0 failed.
- Repository: 128 test files / 901 tests / 0 failed.
- Playwright: 41 passed / 0 failed, including 12 external screenshots in `/tmp/wave14a-final-20260804-122857`.
- Web production build and every workspace build: passed; API Wrangler dry-run: passed.
- Security scan: passed across 656 project files.
- Database invariants: 27 migrations / schema 27 / 117 tables / 221 triggers / 0 foreign-key errors; no `0028`.
- Wave 13 route/file invariants: 138 active routes / 5 active purpose routes / 0 generic Link routes / 0 generic Grant routes / 0 R2 authority fields.
- OpenSpec target strict: 1 passed / 0 failed / 0 issues.
- OpenSpec repository strict: 8 passed / 0 failed. The 27 INFO notices remain confined to pre-existing Wave 13 Specs and the pre-Wave 13 audit Change; this Change has 0 issues.

### Deferred production boundary

`NOT_PRODUCTION_VERIFIED`: no real Feishu, production R2, production data, mainland-network validation, business workflow acceptance, deployment, PR, Push, Integration, `main` advancement, or Wave 14B–17 work was performed or claimed. Ponytail remained OFF throughout and was not run.

## FINAL_CONTROLLER_REMEDIATION_EVIDENCE

### Controller findings closed

- Root `/` now renders exactly `月光白` and `请使用工作人员发送的专属链接登录。` as visible content. The obsolete access eyebrow, trust note, standalone brand mark, identity links, buttons, and login controls are absent; component and Playwright assertions enforce the exact two-string contract.
- Seller Shell now places three semantic `MetricCard` items immediately after the Page Header and before filters: 订单、评论、结算. Every value is `—` and every detail is `业务模块开放后显示`; no quantity, amount, trend, percentage, or fabricated status is shown. The grid wraps responsively and remains covered by the 200% reflow gate.
- Reusable `Sidebar` items now use React Router `NavLink` with route-aware `aria-current`. `/seller`, `/seller/products`, and `/seller/orders` each expose only the matching current item; client navigation preserves the mounted Session, and collapsed navigation retains each full accessible name.
- `FileReadController` now owns a private, memory-only `retryAvailableAt` window behind an injectable clock. A valid 429 Retry-After disables retry without releasing the Read Intent/token, performs no automatic request, and enables only explicit same-token retry at the deadline. Missing/invalid Retry-After requires restart. 503 retains immediate explicit same-token retry. Cancel, success, restart, dispose, and a new File reference clear the window, and no absolute timestamp enters the public snapshot.
- Formal File Read evidence covers a 7-second Retry-After, safe no-op retry through 6.999 seconds, availability at exactly 7 seconds without automatic transport, one explicit same-token request, cancel cleanup, new-Intent restart, invalid-header restart, and immediate explicit 503 retry.

### Final remediation validation

- Isolated-cache `npm ci --cache /tmp/wave14a-npm-cache-remediation`: passed; 226 packages installed and 233 audited. The unchanged install-script review listed `esbuild`, two `fsevents` versions, `msw`, and `workerd`; no new scripts were approved.
- Web typecheck: passed. Wave 14A security verifier/typecheck/build: passed. Wave 14A tests: 18 files / 330 tests / 0 failed.
- Playwright production-build acceptance: 42 passed / 0 failed, including 12 deterministic external screenshots in `/tmp/wave14a-final-remediation-20260804-152230`.
- Repository `npm run check`: passed; 128 test files / 909 tests / 0 failed, all security/migration/Wave gates passed, all workspace builds passed, and API Wrangler dry-run passed.
- Database and route invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 0 foreign-key errors / 138 active routes; no `0028` exists.
- Strict OpenSpec target validation: 1 passed / 0 failed / 0 issues. Strict repository validation: 8 passed / 0 failed; the same 27 INFO notices remain outside this Change.
- Formal OpenSpec Verify: `COMPLETE=42`, `INCONSISTENT=0`, `MISSING=0`, `PARTIAL=0`, `NOT_VERIFIED=0`, `CRITICAL=0`, `WARNING=0`, `SUGGESTION=0`. All 84 Scenarios remain covered. Tasks remain 43/46; only the explicitly unauthorized Ponytail, Integration, and `main` governance stages are unchecked.
- Final `npm audit --json`: 0 critical, 2 high, 0 moderate, 0 low. Both nodes describe the same React Router RSC-mode CSRF advisory. Wave 14A remains a Vite `BrowserRouter` SPA with no React Server Components, server actions, or framework/data-action mode, so this advisory path is not deployment-reachable in the implemented architecture. The suggested cross-range downgrade was not applied.
- The remediation scope changed only Web source/tests/styles and the Wave 14A security verifier before this evidence update. Backend, Contracts, Domain, Migrations, package manifests, lockfile, routes, schema, and production resources were not modified.
- Ponytail, Push, PR, Integration, `main`, deployment, archive, and Wave 14B were not run or started.

## PONYTAIL_DISPOSITION_EVIDENCE

- The separately authorized read-only Ponytail review ran against review HEAD `0b0740a890cfefbfee47a23626d33987b42e60c4` after final acceptance. It reported `BLOCKING=0`, modified 0 files, and created 0 commits.
- Controller disposition is frozen and recorded without reinterpretation: R-01, R-02, R-03, R-04, and R-05 are `ACCEPT`; O-01 is `LATER`; D-01 through D-07 are `REJECT` because they cross the frozen security, identity, File, accessibility, architecture, or governance boundaries.
- R-01 removed only the unused upload `workflowForTest()` helper and its now-unused `fileUploadWorkflows` import. R-02 removed only the unused `Checkmark` and `VisuallyHidden` React components and their exclusive imports; the `.visually-hidden` CSS and every active accessibility primitive remain.
- R-03 moved the two byte-for-byte duplicate Controller error-classification helpers to the existing `api/errors.ts` module. Unknown errors still become safe `MALFORMED_RESPONSE` / `CONTRACT` failures, only explicit `CANCELED` is cancellation, and the upload/read `safeError`, `safeDetails`, and request-ID projections remain distinct and unchanged.
- R-04 merged only the identical `display: grid` and `place-items: center` declarations for `.identity-entry`, `.login-page`, and `.centered`. R-05 merged only the four identical Status/Alert color declaration pairs with ordinary comma selectors. Selector sets, specificity, tokens, color values, semantics, Root/login layout, 320px behavior, and 200% reflow are unchanged.
- O-01 remains deferred: `apps/web/src/testable.tsx` and the existing `App.browser.test.tsx` import path are retained because a one-line reduction does not justify expanding this final cleanup; a later business module may refactor it naturally. No D-01 through D-07 boundary proposal was implemented.
- The accepted implementation changes 5 Web source files by 38 insertions and 83 deletions, a net reduction of 45 lines. It does not change functional behavior, public Controller APIs, fixed workflows, upload/read state machines, identity/session handling, File authority, accessibility, or visual semantics.
- Isolated-cache `npm ci` passed with 226 packages installed and 233 audited. Targeted validation passed 5 test files / 176 tests / 0 failed. Final Wave 14A validation passed 18 test files / 330 tests / 0 failed; the Wave 14A security verifier, Web typecheck, production build, and workspace checks passed.
- Final Playwright acceptance passed 42 / 42 with 0 failures and regenerated all 12 deterministic external screenshots in `/tmp/wave14a-final-ponytail-cleanup`. Root still has exactly its two approved visible strings; Quiet Operations, three Seller metric cards, Buyer/Seller/Staff layouts, state colors/contrast, 320px behavior, and 200% reflow are unchanged.
- Repository validation passed 128 test files / 909 tests / 0 failed, all workspace builds, migration/security/Wave verifiers, and API Worker dry-run. Database invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views / 0 foreign-key errors, with no `0028`.
- Strict OpenSpec validation passed target 1/1 with 0 issues and repository-wide 8/8; the 27 INFO notices remain outside this Change. Formal OpenSpec Verify remains `COMPLETE=42`, `INCONSISTENT=0`, `MISSING=0`, `PARTIAL=0`, `NOT_VERIFIED=0`, `CRITICAL=0`, `WARNING=0`, and `SUGGESTION=0`; all 84 Scenarios remain covered.
- Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios / 17 Change files. Tasks are 44/46 complete; only 33.1 Integration and 34.1 `main` advancement remain pending.
- Final `npm audit --json` reports 0 critical / 2 high / 0 moderate / 0 low. Both nodes represent the same React Router RSC-mode advisory; the Wave 14A Vite `BrowserRouter` SPA does not use RSC, server actions, or framework/data-action mode, so the advisory path is not deployment-reachable. No dependency or override changed.
- Backend business source, Contracts, Domain, Migrations, package manifests, and lockfile are unchanged. Integration, `main`, PR, archive, deployment, production resources, and later business modules were not executed or started.

## INTEGRATION_VALIDATION_EVIDENCE

- Clean Integration branch `integration/wave14a-frontend-foundation-auth-api-client` was created from starting remote `main` SHA `503709a5745931e6732d32f2ed5ae6967b299faa` in its dedicated Worktree.
- Feature SHA `ab7be31f7906363af92e2ef974ff3e5eb7ff3fa7` entered Integration through `git merge --ff-only`; no merge commit, squash, rebase, amend, or source development was performed on Integration.
- Isolated-cache `npm ci` passed with 226 packages installed and 233 audited. The unchanged audit inventory reported 2 high-severity entries; no dependency or package-file change was made.
- Integration validation passed: Wave 14A security verifier; 18 Wave 14A test files / 330 tests / 0 failed; Web typecheck and production build; 42 Playwright tests / 0 failed; repository `npm run check` with 128 test files / 909 tests / 0 failed; all workspace typechecks/builds; and API Wrangler dry-run.
- Strict repository-wide OpenSpec validation passed 14/14 with 0 failures. Structure remains 7 Capabilities / 42 Requirements / 84 Scenarios.
- Database invariants remain 27 migrations / schema 27 / 117 tables / 221 triggers / 10 final views / 0 foreign-key errors, with no `0028`.
- No business source, Backend, Contract, Domain, Migration, package manifest, or lockfile was modified during Integration. The archive was not rewritten; only this governance task/evidence file changed.
- Remote `main` remains at `503709a5745931e6732d32f2ed5ae6967b299faa` and has not yet been advanced. Task 34.1 remains pending until the separately required validated fast-forward.
