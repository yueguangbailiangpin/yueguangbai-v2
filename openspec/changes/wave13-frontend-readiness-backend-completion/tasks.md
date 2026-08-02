# Tasks: Wave 13 Frontend Readiness Backend Completion

Planning tasks checked below were completed by remote repository reading and REMOTE_PLANNING_REVIEW only. No implementation, local CLI, test, D1, R2, OpenSpec CLI, Verify, Ponytail or Integration task is checked.

## 0. Authority and Decision

- [x] 0.1 Read and reconcile the required governance, audit, decision, product, contract, architecture, migration, OpenSpec skill and relevant source/test authority. **Output:** evidence-backed Wave 13 planning basis. **Verify:** every design decision names an existing capability or explicit gap.
- [x] 0.2 Freeze the Staff authority boundary: Feishu Provider, D1 `staff_users` authority, Worker internal Session, no direct Feishu Staff API authority. **Output:** Design sections 6–11. **Verify:** rejected alternatives include direct token/header/client Actor trust.
- [x] 0.3 Author the Proposal, Design, Tasks and six Capability Delta Specs under the single Change directory. **Output:** complete `wave13-frontend-readiness-backend-completion` artifact set. **Verify:** all planned requirements have scenarios and no base spec is modified.
- [x] 0.4 Perform REMOTE_PLANNING_REVIEW against scope, identity, file, ledger, permission and frontend gates. **Output:** review statement in Design. **Verify:** review is explicitly not OpenSpec CLI validate or OpenSpec Verify.
- [x] 0.5 Verify remote planning scope and branch ancestry before ordinary commits. **Output:** only the Change directory is planned for modification. **Verify:** final GitHub compare shows no forbidden path and no unknown commit.

## 1. Migration Analysis

- [x] 1.1 Inventory existing Staff identity, authorization, file, evidence, refund, Audit, Outbox and Idempotency structures. **Output:** Existing Capability Inventory. **Verify:** inventory distinguishes direct reuse from extension.
- [x] 1.2 Decide whether schema 26 is sufficient. **Output:** Decision B recommending minimal `0027_staff_auth_sessions.sql`. **Verify:** gap list proves missing login state, Staff Session, session version, auth rate limit and security event.

## 2. Migration 0027（仅在确认需要时）

- [ ] 2.1 Implement consecutive Migration `0027_staff_auth_sessions.sql` with `staff_users.session_version` and the four approved Staff auth tables. **Output:** one SQL migration only. **Verify:** migration review confirms no role/permission/scope copy and no Provider token storage.
- [ ] 2.2 Add CHECK, unique, FK, lifecycle, expiry, immutable-event and index constraints described by Design. **Output:** deterministic schema 27 constraints. **Verify:** empty-schema and schema-26 upgrade inspection.
- [ ] 2.3 Add cleanup/retention-compatible columns and forward-only rollback notes without reading production data. **Output:** migration documentation/tests. **Verify:** existing Staff receive version 1 and business/financial rows are unchanged.

## 3. Contracts

- [ ] 3.1 Add Staff Auth and internal Session DTO/error/config contracts. **Output:** exported contracts for login, session, safe Staff projection and Provider adapter boundary. **Verify:** typecheck plus exact-key contract tests.
- [ ] 3.2 Add purpose-bound File HTTP, Staff Order Evidence and Staff Buyer Refund request/response contracts. **Output:** no overlapping second API DTOs. **Verify:** contract tests cover required/optional/authority fields and money/date formats.
- [ ] 3.3 Reconcile public error mappings with the existing catalog and add only proven minimal codes/details if required. **Output:** frozen status/code matrix. **Verify:** route tests assert each documented mapping.

## 4. Staff Auth Provider Adapter

- [ ] 4.1 Implement the Feishu authorization URL and server-side code exchange adapter using approved runtime configuration. **Output:** Provider interface and Feishu implementation. **Verify:** unit tests use anonymous fixtures and never persist/return access tokens.
- [ ] 4.2 Validate Provider tenant and stable `open_id`, using optional `user_id` only for corroboration/conflict detection. **Output:** fail-closed verified identity result. **Verify:** unknown tenant, missing subject and conflicting claims tests.
- [ ] 4.3 Apply bounded timeout and normalized dependency errors without accepting Provider identity headers. **Output:** deterministic Provider failure behavior. **Verify:** timeout/unavailable/header-bypass tests.

## 5. Staff Login State

- [ ] 5.1 Implement `POST /api/staff-auth/login/start` with Origin/redirect validation, cryptographic state generation and ten-minute TTL. **Output:** route and service. **Verify:** success, invalid Origin, invalid redirect and authority-field tests.
- [ ] 5.2 Implement atomic hashed-state consume for the Feishu callback. **Output:** single-use state repository/command. **Verify:** invalid, expired, duplicate and concurrent replay tests.
- [ ] 5.3 Record sanitized state lifecycle security events and cleanup expired temporary rows. **Output:** events and cleanup service. **Verify:** no raw state/code/token in persisted or logged payloads.

## 6. Internal Staff Session

- [ ] 6.1 Implement opaque 256-bit Staff Session issuance and hashed persistence with the approved Cookie attributes and twelve-hour TTL. **Output:** session service/cookie helpers. **Verify:** issuance, fixation, Cookie flags and token-hash tests.
- [ ] 6.2 Implement current session, logout and replay-safe current-session revocation. **Output:** `GET session` and `POST logout` routes. **Verify:** safe DTO, revoke and Cookie-clear tests.
- [ ] 6.3 Implement logout-all through `session_version` increment and all-session revocation. **Output:** logout-all command. **Verify:** other-device session rejection and idempotency/concurrency tests.

## 7. Staff Session Middleware

- [ ] 7.1 Resolve the opaque Cookie to one ACTIVE unexpired session and validate Staff/session versions. **Output:** required Staff middleware. **Verify:** absent, malformed, tampered, expired, revoked and inactive tests.
- [ ] 7.2 Reuse `resolveAssignmentStaffAuthorization` to recalculate roles, Permission, Personal DENY, Team, Department and Data Scope on every request. **Output:** trusted `staffAuthorization`. **Verify:** DENY, inactive team/department and authorization-version tests.
- [ ] 7.3 Normalize middleware 401/503/security-event behavior and ignore Feishu/client Actor headers. **Output:** fail-closed boundary. **Verify:** route handler is not invoked on failure and header bypass is denied.

## 8. Default App Registration

- [ ] 8.1 Register Staff Auth public routes before protected Staff routes in the default app. **Output:** production route installation. **Verify:** route inventory and callback accessibility tests.
- [ ] 8.2 Install Staff Session Middleware for every existing `/api/staff/**` and Internal Finance route. **Output:** all protected routes receive trusted context. **Verify:** representative route-family E2E and no-session 401 matrix.
- [ ] 8.3 Remove test-only assumptions from production entrypoint wiring without removing test injection seams. **Output:** explicit production/test composition. **Verify:** production app cannot directly accept an Actor while isolated service tests remain possible.

## 9. File HTTP Flow

- [ ] 9.1 Implement the six purpose-bound upload-intent routes with server-derived Actor/Purpose/Visibility. **Output:** Customer/Staff intent endpoints. **Verify:** allowed Purpose and arbitrary-purpose/authority injection tests.
- [ ] 9.2 Implement bounded multipart upload and complete routes over existing File Services. **Output:** domain-bound upload/complete endpoints. **Verify:** MIME/size/digest/expiry/replay/HEAD tests.
- [ ] 9.3 Implement short read-intent create/consume endpoints and keep link/grant inside business commands. **Output:** safe file reads with no generic link API. **Verify:** scope/revoke/replay/object-key and permanent-URL leakage tests.

## 10. Staff Order Evidence API

- [ ] 10.1 Implement scoped list/detail read models and routes using `ORDER_VIEW`. **Output:** queue and detail DTOs. **Verify:** cursor, Personal DENY, assignment/team/global and scope-miss 404 tests.
- [ ] 10.2 Implement request-changes route over the existing fixed two-hour service using exact body, Idempotency-Key and expected version. **Output:** buyer-visible modification flow. **Verify:** deadline, replay, stale version, Audit and Outbox tests.
- [ ] 10.3 Implement atomic approve orchestrator using existing Evidence/Formal Order/Claim/Snapshot/Payable statements. **Output:** one-batch approval route. **Verify:** exactly-one-file, PRICE_MISMATCH, rollback, duplicate order number and formal-order assertion tests.

## 11. Staff Buyer Refund API

- [ ] 11.1 Implement scoped Buyer Refund list/detail read models using `BUYER_REFUND_VIEW`. **Output:** Staff-safe ledger DTOs. **Verify:** Personal DENY, owner/team/global scope, 404 concealment and money-string tests.
- [ ] 11.2 Implement record-payment route over the existing append-only service and proof authorization. **Output:** immutable Payment HTTP command. **Verify:** split payment, OVERPAID, proof, stale version, replay, Audit/Outbox/assertion tests.
- [ ] 11.3 Implement scoped reversal route over the existing Reversal service. **Output:** immutable Reversal HTTP command. **Verify:** partial/full reversal, exceeds-payment, cross-obligation/scope and immutable-fact tests.

## 12. HTTP Contract Hardening

- [ ] 12.1 Add shared strict JSON-object/exact-key/authority-field helpers only where required by Wave 13 routes. **Output:** bounded parser use without full-repo rewrite. **Verify:** unknown key, missing key, empty string, array and unsafe-number tests.
- [ ] 12.2 Add strict single-value query, canonical limit, bounded cursor and inclusive-date helpers for affected list/callback routes. **Output:** frozen query behavior. **Verify:** unknown/duplicate query, malformed cursor and date-range tests.
- [ ] 12.3 Freeze 401/403/404, state/version/idempotency, file and dependency mappings plus identity-specific DTO projections. **Output:** public Contract matrix. **Verify:** recursive DTO/error snapshots.

## 13. Audit/Outbox/Idempotency

- [ ] 13.1 Add known-Staff Session lifecycle Audit and unknown/failed authentication security events with minimized context. **Output:** immutable evidence without fabricated Actor. **Verify:** secret/PII scan and lifecycle tests.
- [ ] 13.2 Reuse existing Audit/Outbox/idempotency foundations for Evidence and Refund routes. **Output:** deduplicated committed events. **Verify:** replay does not duplicate events or outbox rows.
- [ ] 13.3 Add transaction assertions for new composite boundaries and ensure failure marking is deterministic. **Output:** atomic completion proofs. **Verify:** injected batch-failure and assertion-failure tests.

## 14. Unit Tests

- [ ] 14.1 Add pure tests for state/token hashing, Cookie config, redirect allowlist and Provider claim normalization. **Output:** Staff auth unit suite. **Verify:** deterministic edge-case coverage.
- [ ] 14.2 Add pure tests for new HTTP parsers, cursor/date/money conversion and exact one-file rule. **Output:** Contract unit suite. **Verify:** boundary and malformed-value matrix.
- [ ] 14.3 Add pure tests for composite approval/refund route mapping without duplicating Domain formulas. **Output:** adapter/orchestrator unit suite. **Verify:** existing Domain tests remain authoritative.

## 15. Route Tests

- [ ] 15.1 Add Staff Auth route tests for start, callback, session, logout and logout-all. **Output:** authenticated route coverage. **Verify:** every Staff Auth scenario maps to a test.
- [ ] 15.2 Add File HTTP route tests across Buyer, Seller and Staff domains. **Output:** purpose/auth/contract coverage. **Verify:** upload/read/link boundaries and token leakage checks.
- [ ] 15.3 Add Staff Order Evidence and Buyer Refund route tests. **Output:** list/detail/mutation coverage. **Verify:** permission/scope/idempotency/version/privacy matrix.

## 16. Production Entrypoint E2E

- [ ] 16.1 Exercise the real default app login callback and internal Cookie issuance with a fake Provider adapter, not direct Actor injection. **Output:** trusted Staff E2E. **Verify:** session reaches a representative Staff route.
- [ ] 16.2 Exercise every existing Staff/Internal Finance route family through middleware for valid/no-session/denied contexts. **Output:** production registration matrix. **Verify:** no route lacks `staffAuthorization`.
- [ ] 16.3 Exercise representative File, Evidence and Refund operations through the default app. **Output:** P1-02 reachability evidence. **Verify:** route inventory and end-to-end response assertions.

## 17. D1 Migration Tests

- [ ] 17.1 Apply 0001–0027 from empty database. **Output:** schema 27 migration test. **Verify:** user version, table/index/trigger counts, FK and integrity.
- [ ] 17.2 Upgrade an anonymous schema-26 fixture to 0027. **Output:** forward migration proof. **Verify:** existing Staff session version defaults to 1 and old facts remain.
- [ ] 17.3 Test Migration constraints and guard behavior. **Output:** negative schema tests. **Verify:** duplicate state/session hash, invalid lifecycle/time and destructive mutation failures.

## 18. D1 Behavior Tests

- [ ] 18.1 Test real D1 state consume and session revoke/version behavior versus test doubles. **Output:** parity evidence. **Verify:** concurrent single-use and version checks.
- [ ] 18.2 Test real D1 composite Evidence approval and Refund append/reversal batches. **Output:** transaction/assertion parity. **Verify:** injected conflict leaves no partial facts.
- [ ] 18.3 Re-run trigger, STRICT table, cursor and integer/string conversion behavior relevant to Wave 13. **Output:** DB-020 supplement. **Verify:** discrepancies are recorded, not hidden.

## 19. R2 Failure and Compensation Tests

- [ ] 19.1 Test R2 put, receipt and HEAD failures through formal File HTTP routes. **Output:** normalized dependency/validation outcomes. **Verify:** no linkable orphan is committed.
- [ ] 19.2 Test D1 final-commit failure after R2 put with successful compensation delete. **Output:** deletion proof. **Verify:** object and D1 lifecycle terminate consistently.
- [ ] 19.3 Test compensation-delete failure and cleanup retry to success. **Output:** delete-pending/cleanup evidence. **Verify:** retry is idempotent and no object key leaks.

## 20. Security Verifiers

- [ ] 20.1 Add verifier for Staff routes missing Session Middleware or accepting Feishu/client authority headers. **Output:** production auth guard. **Verify:** intentionally unsafe fixture fails.
- [ ] 20.2 Add verifier for auth secrets, Provider tokens, Cookie/token hashes and object keys in logs/Audit/Outbox/DTOs. **Output:** leakage guard. **Verify:** recursive scan covers nested payloads.
- [ ] 20.3 Add verifier for generic file link/grant routes and Buyer Refund/Seller Settlement permission mixing. **Output:** architectural boundary guard. **Verify:** forbidden route/permission patterns fail.

## 21. DTO Isolation Verifiers

- [ ] 21.1 Verify Buyer DTOs exclude Staff internal notes, Seller internals, other buyers and storage authority. **Output:** Buyer recursive allowlist guard. **Verify:** all affected Buyer routes pass.
- [ ] 21.2 Verify Seller DTOs exclude Buyer Refund cost/proofs, buyer privacy and internal profit. **Output:** Seller recursive allowlist guard. **Verify:** all affected Seller routes pass.
- [ ] 21.3 Verify Staff DTOs exclude Session/Provider secrets and R2 storage keys while retaining required operational fields. **Output:** Staff safe projection guard. **Verify:** list/detail/session/file responses pass.

## 22. Pre-Wave13 Audit Closure

- [ ] 22.1 Update the existing audit, traceability matrix, frontend readiness report and audit Change with implemented evidence. **Output:** one authoritative audit record. **Verify:** no second competing audit is created.
- [ ] 22.2 Recount the original 108 endpoints plus new endpoints and reclassify route readiness. **Output:** reproducible endpoint inventory. **Verify:** default-app route enumeration matches Contracts.
- [ ] 22.3 Re-evaluate P1-01/P1-02/P1-03, all other findings and GO/NO_GO without erasing prior local evidence. **Output:** evidence-based closure/residual status. **Verify:** each changed classification has cited proof.

## 23. Local Validation

- [ ] 23.1 Run dependency install and the full repository check gate in the authorized local workflow. **Output:** current test/build baseline. **Verify:** exact command/result/counts recorded.
- [ ] 23.2 Run strict migration, schema, D1 and relevant R2 local validation. **Output:** schema 27 and behavior supplement. **Verify:** FK/integrity and fault evidence recorded.
- [ ] 23.3 Record any warnings, unavailable tools or failures without claiming success. **Output:** honest validation report. **Verify:** unresolved gates remain unchecked.

## 24. OpenSpec Validation

- [ ] 24.1 Run strict validation for `wave13-frontend-readiness-backend-completion`. **Output:** machine-readable validation result. **Verify:** zero failed items.
- [ ] 24.2 Run strict all-change/spec validation required by repository governance. **Output:** repository-wide result. **Verify:** unrelated failures are reported and not bypassed.
- [ ] 24.3 Correct only valid OpenSpec formatting/semantic issues without weakening requirements. **Output:** validated artifacts. **Verify:** diff review preserves decisions and scenarios.

## 25. OpenSpec Verify

- [ ] 25.1 Execute the repository-approved OpenSpec Verify workflow if available. **Output:** actual Verify evidence. **Verify:** command/tool identity and result recorded.
- [ ] 25.2 Reconcile implementation and tests against every Wave 13 Requirement/Scenario. **Output:** complete/partial/missing matrix. **Verify:** no planning-only claim substitutes for implementation.
- [ ] 25.3 Keep Verify unavailable/failed items explicitly open. **Output:** NOT_VERIFIED list. **Verify:** audit closure reflects the same status.

## 26. Ponytail Review Gate

- [ ] 26.1 Confirm all implementation, tests, local gates, OpenSpec validation and Verify are complete before any Ponytail consideration. **Output:** eligibility decision. **Verify:** no premature Ponytail run.
- [ ] 26.2 Obtain separate approval for read-only Ponytail review and document low-risk candidates. **Output:** approved review scope. **Verify:** no automatic write/fix workflow.
- [ ] 26.3 Record Ponytail findings without applying changes on this planning branch. **Output:** optional later review report. **Verify:** `PONYTAIL_REVIEW` truthfully records run/not-run.

## 27. Integration

- [ ] 27.1 Create Integration only after all required gates and audit closure evidence pass. **Output:** authorized Integration branch/workflow. **Verify:** planning branch does not self-integrate.
- [ ] 27.2 Validate Integration from clean baseline without developing new business behavior there. **Output:** integration-only validation. **Verify:** fixes return to the Feature branch.
- [ ] 27.3 Advance main only through the approved Integration process and explicit authorization. **Output:** governed promotion. **Verify:** no direct planning-branch merge, PR, deployment or production write.
