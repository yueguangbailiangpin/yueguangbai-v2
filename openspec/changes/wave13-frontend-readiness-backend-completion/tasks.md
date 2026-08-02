# Tasks: Wave 13 Frontend Readiness Backend Completion

Planning tasks checked below were completed by remote repository reading and `REMOTE_PLANNING_REVIEW` only. No implementation, local CLI, test, D1, R2, OpenSpec CLI, Verify, Ponytail or Integration task is checked.

## 0. Authority and Controller Decisions

- [x] 0.1 Read and reconcile governance, audit, decision, product, contract, architecture, migration, OpenSpec skill and relevant source/test authority. **Output:** evidence-backed Wave 13 planning basis. **Verify:** every design decision names an existing capability or explicit gap.
- [x] 0.2 Freeze controller decisions for Staff authority, PRICE_MISMATCH, `/api/*`, login/session TTL, minimal 0027, Provider prerequisites and Wave 16 alert boundary. **Output:** revised Design and Delta Specs. **Verify:** implementation is not allowed to reselect those rules.
- [x] 0.3 Maintain Proposal, Design, Tasks and six Capability Delta Specs under the single Change directory. **Output:** complete `wave13-frontend-readiness-backend-completion` artifact set. **Verify:** all planned requirements have scenarios and no base spec is modified.
- [x] 0.4 Re-run `REMOTE_PLANNING_REVIEW` for identity, route path, FilePurpose, error codes, ledger, mismatch, security events and frontend gates. **Output:** revised review statement in Design. **Verify:** review is explicitly not OpenSpec CLI validate or OpenSpec Verify.
- [x] 0.5 Verify remote planning scope and branch ancestry before ordinary commits. **Output:** only the Change directory is modified. **Verify:** final GitHub compare shows no forbidden path and no unknown commit.

## 1. Migration Analysis

- [x] 1.1 Inventory existing Staff identity/authorization, Customer Auth tables, file, evidence, refund, Audit, Outbox and Idempotency structures. **Output:** Existing Capability Inventory. **Verify:** inventory distinguishes direct reuse, pattern reuse and prohibited cross-domain table reuse.
- [x] 1.2 Freeze schema decision: `0027_staff_auth_sessions.sql` is required with `session_version` plus four Staff auth tables; Customer Auth rate-limit/security-event tables are not reused. **Output:** minimal migration design. **Verify:** no idle-timeout/last-seen field, role/permission/scope copy, long-lived Provider token or generic Provider framework.

## 2. Migration 0027（实现阶段）

- [ ] 2.1 Implement consecutive Migration `0027_staff_auth_sessions.sql` with `staff_users.session_version`, `staff_login_states`, `staff_sessions`, `staff_auth_rate_limits` and `staff_auth_security_events`. **Output:** one SQL migration only. **Verify:** no Customer table rewrite and no extra identity table.
- [ ] 2.2 Add CHECK, unique, FK, lifecycle, expiry, immutable-event and index constraints described by Design. **Output:** deterministic schema 27 constraints. **Verify:** empty-schema and schema-26 upgrade inspection.
- [ ] 2.3 Add cleanup/retention-compatible columns and forward-only rollback notes without per-request `last_seen`, idle-timeout writes or production data reads. **Output:** migration documentation/tests. **Verify:** existing Staff receive version 1 and business/financial rows are unchanged.

## 3. Contracts

- [ ] 3.1 Add Staff Auth/internal Session DTO, error and environment-config contracts with fixed 10-minute login state and 12-hour absolute Session TTL/no idle timeout. **Output:** exported safe contracts and Provider adapter boundary. **Verify:** typecheck plus exact-key/config-missing tests.
- [ ] 3.2 Add purpose-bound File HTTP, Staff Order Evidence and Staff Buyer Refund request/response contracts using only verified existing FilePurpose/FileVisibility constants. **Output:** no overlapping second API DTOs. **Verify:** contract tests cover required/optional/authority fields, mismatch fields and money/date formats.
- [ ] 3.3 Add minimal public `PRICE_MISMATCH` error Contract/mapping, retain existing `FILE_COMPENSATION_REQUIRED`, and correct old contract/document `/api/v2/*` references to canonical `/api/*` without aliases. **Output:** one status/code/path Contract. **Verify:** route/docs scan finds no Wave 13 `/api/v2` or duplicate route version.

## 4. Staff Auth Provider Adapter

- [ ] 4.1 Verify implementation-time official Feishu documentation and approved app configuration, then implement environment-configured authorization URL and server-side code exchange. **Output:** Provider interface and Feishu implementation. **Verify:** endpoint/app ID/secret/scope/tenant/redirect are not hard-coded and production parameters are not sourced from model memory.
- [ ] 4.2 Validate configured tenant and stable `open_id`, using optional `user_id` only for corroboration/conflict detection. **Output:** fail-closed verified identity result. **Verify:** unknown tenant, missing subject and conflicting claims tests.
- [ ] 4.3 Support a fake Provider adapter, bounded timeout and normalized dependency errors; missing configuration and identity headers fail closed. **Output:** deterministic Provider behavior. **Verify:** substitute, timeout, unavailable, config-missing and header-bypass tests.

## 5. Staff Login State

- [ ] 5.1 Implement `POST /api/staff-auth/login/start` with Origin/redirect validation, cryptographic state generation and fixed ten-minute TTL. **Output:** route and service. **Verify:** success, invalid Origin, invalid redirect and authority-field tests.
- [ ] 5.2 Implement atomic hashed-state consume for `GET /api/staff-auth/feishu/callback`. **Output:** single-use state repository/command. **Verify:** invalid, expired, duplicate and concurrent replay tests.
- [ ] 5.3 Record sanitized state lifecycle security events and cleanup expired temporary rows. **Output:** events and cleanup service. **Verify:** no raw state/code/token in persisted or logged payloads.

## 6. Internal Staff Session

- [ ] 6.1 Implement opaque 256-bit Staff Session issuance and hashed persistence with `__Host-`, HttpOnly, Secure, SameSite=Lax, Path=/ and fixed twelve-hour absolute TTL. **Output:** session service/cookie helpers. **Verify:** no idle timeout/refresh or per-request session write.
- [ ] 6.2 Implement current session, logout and replay-safe current-session revocation. **Output:** `GET session` and `POST logout` routes. **Verify:** safe DTO, revoke and Cookie-clear tests.
- [ ] 6.3 Implement logout-all through `session_version` increment and all-session revocation. **Output:** logout-all command. **Verify:** other-device session rejection and idempotency/concurrency tests.

## 7. Staff Session Middleware

- [ ] 7.1 Resolve the opaque Cookie to one ACTIVE unexpired session and validate Staff status, `session_version` and issued `authorization_version`. **Output:** required Staff middleware. **Verify:** absent, malformed, tampered, expired, revoked, inactive and version-mismatch tests all return 401.
- [ ] 7.2 Reuse `resolveAssignmentStaffAuthorization` to recalculate roles, Permission, Personal DENY, Team, Department and Data Scope on every request. **Output:** trusted `staffAuthorization`. **Verify:** DENY, inactive team/department and scope tests.
- [ ] 7.3 Normalize middleware 401/503/security-event behavior and ignore Feishu/client Actor headers. **Output:** fail-closed boundary. **Verify:** route handler is not invoked on failure and header bypass is denied.

## 8. Default App Registration and Canonical Paths

- [ ] 8.1 Register Staff Auth public routes before protected Staff routes under `/api/*` only. **Output:** production route installation. **Verify:** route inventory contains no `/api/v2` alias.
- [ ] 8.2 Install Staff Session Middleware for every existing `/api/staff/**` and Internal Finance route. **Output:** all protected routes receive trusted context. **Verify:** representative route-family E2E and no-session 401 matrix.
- [ ] 8.3 Remove test-only assumptions from production wiring without removing test injection seams or introducing a second Contract version. **Output:** explicit production/test composition. **Verify:** production app cannot directly accept an Actor while isolated tests remain possible.

## 9. File HTTP Flow

- [ ] 9.1 Implement the six purpose-bound upload-intent routes with server-derived Actor and the exact EXISTING Purpose/Visibility table from Design. **Output:** Customer/Staff intent endpoints. **Verify:** every route constant exists; `PRODUCT_IMAGE`, keyword image and support attachment remain out of scope.
- [ ] 9.2 Implement bounded multipart upload and complete routes over existing File Services. **Output:** domain-bound upload/complete endpoints. **Verify:** MIME/size/digest/expiry/replay/HEAD tests.
- [ ] 9.3 Implement short read-intent create/consume endpoints and keep link/grant inside business commands. **Output:** safe file reads with no generic link API. **Verify:** scope/revoke/replay/object-key and permanent-URL leakage tests.

## 10. Staff Order Evidence API

- [ ] 10.1 Implement scoped list/detail read models and routes using `ORDER_VIEW`, including reference/final/difference facts and safe screenshot reference. **Output:** queue and detail DTOs. **Verify:** cursor, Personal DENY, assignment/team/global and scope-miss 404 tests.
- [ ] 10.2 Implement request-changes over the existing fixed two-hour service; screenshot/final-amount inconsistency or unclear proof must use this path. **Output:** buyer-visible modification flow. **Verify:** deadline, replay, stale version, Audit and screenshot-disagreement tests.
- [ ] 10.3 Implement atomic approve with exact mismatch fields and existing Evidence/Formal Order/Claim/Snapshot/Payable statements. **Output:** one-batch approval route. **Verify:** no-ack and ack=false return `PRICE_MISMATCH`; missing reason and meaningless ack return `VALIDATION_ERROR`; acknowledged mismatch succeeds; Audit/Event facts and replay reason are immutable.

## 11. Staff Buyer Refund API

- [ ] 11.1 Implement scoped Buyer Refund list/detail read models using `BUYER_REFUND_VIEW`. **Output:** Staff-safe ledger DTOs. **Verify:** Personal DENY, owner/team/global scope, 404 concealment and money-string tests.
- [ ] 11.2 Implement record-payment route over the existing append-only service and proof authorization. **Output:** immutable Payment HTTP command. **Verify:** split payment, OVERPAID, proof, stale version, replay, Audit/Outbox/assertion tests.
- [ ] 11.3 Implement scoped reversal route over the existing Reversal service. **Output:** immutable Reversal HTTP command. **Verify:** partial/full reversal, exceeds-payment, cross-obligation/scope and immutable-fact tests.

## 12. HTTP Contract Hardening

- [ ] 12.1 Add shared strict JSON-object/exact-key/authority-field helpers only for Wave 13 routes, including conditional mismatch acknowledgment validation. **Output:** bounded parser use without full-repo rewrite. **Verify:** unknown, missing, empty, unsafe, mismatch and authority-field tests.
- [ ] 12.2 Add strict single-value query, canonical limit, bounded cursor and inclusive-date helpers for affected list/callback routes. **Output:** frozen query behavior. **Verify:** unknown/duplicate query, malformed cursor and date-range tests.
- [ ] 12.3 Freeze `/api/*` as the only route version, 401/403/404, mismatch/state/version/idempotency/file/dependency mappings and identity-specific DTOs. **Output:** public Contract matrix. **Verify:** recursive DTO/error/path snapshots.

## 13. Audit, Security Events, Outbox and Idempotency

- [ ] 13.1 Add known-Staff Session lifecycle Audit and immutable `staff_auth_security_events` for failure, limit, replay, identity conflict, Provider failure and Session rejection. **Output:** structured evidence without fabricated Actor. **Verify:** no real-time alert/notification implementation; Wave 16 boundary remains.
- [ ] 13.2 Reuse existing Audit/Outbox/idempotency foundations for Evidence and Refund; mismatch Audit/Formal Order Event records reference, final, difference, ack, reason and confirmer. **Output:** deduplicated committed facts. **Verify:** replay does not duplicate events or alter reason.
- [ ] 13.3 Add transaction assertions for new composite boundaries and deterministic failure marking. **Output:** atomic completion proofs. **Verify:** injected batch/assertion failure leaves no partial order/refund facts.

## 14. Unit Tests

- [ ] 14.1 Add pure tests for state/token hashing, Cookie config, redirect allowlist, no-idle absolute expiry and Provider claim normalization/config failure. **Output:** Staff auth unit suite. **Verify:** deterministic edge-case coverage.
- [ ] 14.2 Add pure tests for strict parsers, cursor/date/money, exact-one-file and existing Purpose/Visibility mapping. **Output:** Contract unit suite. **Verify:** boundary and malformed-value matrix.
- [ ] 14.3 Add pure tests for mismatch conditional validation and request-hash normalization without duplicating Domain finance formulas. **Output:** approval adapter/orchestrator unit suite. **Verify:** all eight controller-specified mismatch cases are represented across unit/route tests.

## 15. Route Tests

- [ ] 15.1 Add Staff Auth route tests for start, callback, session, logout and logout-all. **Output:** authenticated route coverage. **Verify:** official-config adapter seam, 10-minute state and 12-hour Session rules are asserted.
- [ ] 15.2 Add File HTTP route tests across Buyer, Seller and Staff domains. **Output:** six Purpose/Visibility/auth/contract coverage. **Verify:** upload/read/link boundaries, existing `FILE_COMPENSATION_REQUIRED` and token leakage checks.
- [ ] 15.3 Add Staff Order Evidence and Buyer Refund route tests. **Output:** list/detail/mutation coverage. **Verify:** eight mismatch tests, permission/scope/idempotency/version/privacy and refund matrix.

## 16. Production Entrypoint E2E

- [ ] 16.1 Exercise the real default app login callback and internal Cookie issuance with a fake Provider adapter, not direct Actor injection. **Output:** trusted Staff E2E. **Verify:** Session reaches a representative Staff route.
- [ ] 16.2 Exercise every existing Staff/Internal Finance route family through middleware for valid/no-session/denied contexts. **Output:** production registration matrix. **Verify:** no route lacks `staffAuthorization`.
- [ ] 16.3 Exercise representative File, Evidence and Refund operations through `/api/*`. **Output:** P1-02 reachability evidence. **Verify:** route inventory contains no `/api/v2` alias.

## 17. D1 Migration Tests

- [ ] 17.1 Apply 0001–0027 from empty database. **Output:** schema 27 migration test. **Verify:** schema version, table/index/trigger counts, FK and integrity.
- [ ] 17.2 Upgrade an anonymous schema-26 fixture to 0027. **Output:** forward migration proof. **Verify:** existing Staff session version defaults to 1, Customer Auth tables remain unchanged and old facts remain.
- [ ] 17.3 Test Migration constraints and guard behavior. **Output:** negative schema tests. **Verify:** duplicate state/session hash, invalid lifecycle/time and destructive mutation failures.

## 18. D1 Behavior Tests

- [ ] 18.1 Test real D1 state consume and session revoke/version behavior versus test doubles. **Output:** parity evidence. **Verify:** concurrent single-use, 12-hour expiry, no idle refresh and version checks.
- [ ] 18.2 Test real D1 composite Evidence approval and Refund append/reversal batches. **Output:** transaction/assertion parity. **Verify:** mismatch and injected conflict leave no partial facts.
- [ ] 18.3 Re-run trigger, STRICT table, cursor and integer/string conversion behavior relevant to Wave 13. **Output:** DB-020 supplement. **Verify:** discrepancies are recorded, not hidden.

## 19. R2 Failure and Compensation Tests

- [ ] 19.1 Test R2 put, receipt and HEAD failures through formal File HTTP routes. **Output:** normalized dependency/validation outcomes. **Verify:** no linkable orphan is committed.
- [ ] 19.2 Test D1 final-commit failure after R2 put with successful compensation delete. **Output:** deletion proof. **Verify:** object and D1 lifecycle terminate consistently.
- [ ] 19.3 Test compensation-delete failure and cleanup retry to success. **Output:** delete-pending/cleanup evidence. **Verify:** existing 503 `FILE_COMPENSATION_REQUIRED`, idempotent retry and no object-key leakage.

## 20. Security Verifiers

- [ ] 20.1 Add verifier for Staff routes missing Session Middleware, `/api/v2` aliases or Feishu/client authority headers. **Output:** production auth/path guard. **Verify:** intentionally unsafe fixtures fail.
- [ ] 20.2 Add verifier for auth secrets, Provider tokens, Cookie/token hashes and object keys in logs/Audit/Outbox/DTOs. **Output:** leakage guard. **Verify:** recursive scan covers nested payloads.
- [ ] 20.3 Add verifier for unknown FilePurpose constants, client-selected Visibility, generic file link/grant routes, missing `PRICE_MISMATCH` mapping and Buyer Refund/Seller Settlement permission mixing. **Output:** architectural boundary guard. **Verify:** forbidden patterns fail.

## 21. DTO Isolation Verifiers

- [ ] 21.1 Verify Buyer DTOs exclude Staff internal notes, mismatch reason, Seller internals, other buyers and storage authority. **Output:** Buyer recursive allowlist guard. **Verify:** all affected Buyer routes pass.
- [ ] 21.2 Verify Seller DTOs exclude Buyer Refund cost/proofs, buyer privacy and internal profit. **Output:** Seller recursive allowlist guard. **Verify:** all affected Seller routes pass.
- [ ] 21.3 Verify Staff DTOs exclude Session/Provider secrets and R2 keys while retaining mismatch/refund operational fields. **Output:** Staff safe projection guard. **Verify:** list/detail/session/file responses pass.

## 22. Pre-Wave13 Audit Closure

- [ ] 22.1 Update the existing audit, traceability matrix, frontend readiness report and audit Change with implemented evidence. **Output:** one authoritative audit record. **Verify:** no second competing audit is created.
- [ ] 22.2 Recount the original 108 endpoints plus new canonical `/api/*` endpoints and reclassify readiness. **Output:** reproducible endpoint inventory. **Verify:** services and `/api/v2` aliases are not counted.
- [ ] 22.3 Re-evaluate P1-01/P1-02/P1-03, all other findings and GO/NO_GO without erasing prior local evidence. **Output:** evidence-based closure/residual status. **Verify:** each changed classification has cited proof.

## 23. Local Validation

- [ ] 23.1 Run dependency install and the full repository check gate in the authorized local workflow. **Output:** current test/build baseline. **Verify:** exact command/result/counts recorded.
- [ ] 23.2 Run strict migration, schema, D1 and relevant R2 local validation. **Output:** schema 27 and behavior supplement. **Verify:** FK/integrity and fault evidence recorded.
- [ ] 23.3 Record warnings, unavailable tools or failures without claiming success. **Output:** honest validation report. **Verify:** unresolved gates remain unchecked.

## 24. OpenSpec Validation

- [ ] 24.1 Run strict validation for `wave13-frontend-readiness-backend-completion`. **Output:** machine-readable validation result. **Verify:** zero failed items.
- [ ] 24.2 Run strict all-change/spec validation required by repository governance. **Output:** repository-wide result. **Verify:** unrelated failures are reported and not bypassed.
- [ ] 24.3 Correct only valid OpenSpec formatting/semantic issues without weakening frozen controller decisions. **Output:** validated artifacts. **Verify:** Requirement count 52 and Scenario count 104 unless a justified Delta is recorded.

## 25. OpenSpec Verify

- [ ] 25.1 Execute the repository-approved OpenSpec Verify workflow if available. **Output:** actual Verify evidence. **Verify:** command/tool identity and result recorded.
- [ ] 25.2 Reconcile implementation and tests against every Wave 13 Requirement/Scenario. **Output:** complete/partial/missing matrix. **Verify:** planning review never substitutes for implementation.
- [ ] 25.3 Keep Verify unavailable/failed items explicitly open. **Output:** NOT_VERIFIED list. **Verify:** audit closure reflects the same status.

## 26. Ponytail Review Gate

- [ ] 26.1 Confirm all implementation, tests, local gates, OpenSpec validation and Verify are complete before any Ponytail consideration. **Output:** eligibility decision. **Verify:** no premature Ponytail run.
- [ ] 26.2 Obtain separate approval for read-only Ponytail review and document low-risk candidates. **Output:** approved review scope. **Verify:** no automatic write/fix workflow.
- [ ] 26.3 Record Ponytail findings without applying changes on this planning branch. **Output:** optional later review report. **Verify:** `PONYTAIL_REVIEW` truthfully records run/not-run.

## 27. Integration

- [ ] 27.1 Create Integration only after all required gates and audit closure evidence pass. **Output:** authorized Integration branch/workflow. **Verify:** planning branch does not self-integrate.
- [ ] 27.2 Validate Integration from clean baseline without developing new business behavior there. **Output:** integration-only validation. **Verify:** fixes return to the Feature branch.
- [ ] 27.3 Advance main only through the approved Integration process and explicit authorization. **Output:** governed promotion. **Verify:** no direct planning-branch merge, PR, deployment or production write.
