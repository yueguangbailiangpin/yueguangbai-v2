# Pre-Wave 13 Baseline Conformance Audit

## 1. Executive Summary

This remote static audit reviewed formal `main` at `f28c52a36e9498c37453a4a12755d9ad8459ae65` before Big Module 5 formal frontend development.

The Buyer and Seller backend surfaces are broadly mature: trusted customer sessions, tenant-scoped read models, idempotent mutations, optimistic concurrency, dedicated DTO projections, safe file read intents, order-instruction state machines, formal orders, reviews, settlement views, and refund status APIs are present. Financial and database evidence is especially strong: integer money, immutable facts, reversal-based corrections, projected/completed profit views, audited synchronous CSV export, migration assertions, unique claims, triggers, audit, outbox, and idempotency are mutually reinforcing.

The formal frontend baseline is nevertheless **NO_GO** because current production route registration does not establish a trusted Staff session or populate `staffAuthorization`. Every Staff and Internal Finance handler is registered, but the production `createApp()`/`index.ts` path contains no Staff authentication middleware or Staff login/session route. Handlers fail closed, which prevents an authorization bypass, but also makes the entire Staff frontend surface unreachable. This is a P1 readiness failure.

A second P1 issue is a current governance conflict: `AGENTS.md` and the latest engineering governance require an independent Staff identity/session boundary with Feishu at most an optional identity source, while Decision D-004 and `resolveStaffAuthorizationByFeishu` remain Feishu-specific. The Staff authentication contract cannot be frozen until project control resolves that authority conflict.

No P0 vulnerability was confirmed. The audit did not run local commands, tests, D1, Wrangler, OpenSpec CLI, or Ponytail.

## 2. Audit Scope

- Formal `main` at the fixed SHA.
- Migrations `0001–0026`.
- Buyer, Seller, Staff, Internal Finance, Authentication, and file-related APIs.
- Contracts, domain rules, production implementation, relevant tests, migrations, and verifiers.
- Current frontend API readiness.

## 3. Explicit Non-Scope

- No production implementation changes.
- No bug fixes or refactors.
- No migration `0027`.
- No historical Wave 1–12 specification reconstruction.
- No test changes.
- No local commands, D1, Wrangler, OpenSpec CLI, Ponytail, deployment, PR, Integration, or `main` advancement.

## 4. Authority Sources

The audit used the authority order in `AGENTS.md`, then inspected:

- `openspec/config.yaml`;
- `docs/AI_ENGINEERING_GOVERNANCE.md`;
- `docs/decisions/V2_DECISION_REGISTER.md`;
- `docs/product/V2_PRODUCT_RULES.md`;
- `docs/contracts/**`;
- `docs/architecture/**`;
- `docs/migration/**`;
- `package.json`;
- migrations, contracts, domain, API, scripts, and test source.

Chat memory, old-repository behavior, file-name inference, and generic industry assumptions were not used as authority.

## 5. Audit Method

1. Verified the remote branch relationship before writing.
2. Read governance and OpenSpec project rules.
3. Read the real API registration entrypoint.
4. Extracted actual methods and paths from route source.
5. Traced representative requirements through implementation, contracts, tests, migrations, and verifiers.
6. Classified 115 requirements using fixed status terms.
7. Built a route readiness inventory.
8. Performed `REMOTE_SEMANTIC_VERIFY`.
9. Recorded local validation requests rather than claiming runtime execution.

## 6. Evidence Strength Model

**Strong:** production source plus matching contract/test/database evidence.

**Medium:** implementation with a missing key test, test without full production path, static verifier only, or only one defense layer.

**Weak:** documentation, names, comments, conversation, or inference alone. Weak evidence cannot create a PASS.

Statuses are exactly `PASS`, `PARTIAL`, `FAIL`, `NOT_VERIFIED`, and `GOVERNANCE_CONFLICT`.

## 7. Current Baseline

The following numbers are the previously accepted Integration baseline and were **not rerun in this audit**:

| Item | Historical accepted value | Runtime label |
|---|---:|---|
| Migrations | 0001–0026 | PREVIOUSLY_VALIDATED |
| Schema version | 26 | PREVIOUSLY_VALIDATED |
| Application tables | 113 | PREVIOUSLY_VALIDATED |
| Triggers | 213 | PREVIOUSLY_VALIDATED |
| Views | 10 | PREVIOUSLY_VALIDATED |
| Test files | 99 | PREVIOUSLY_VALIDATED |
| Tests | 511 | PREVIOUSLY_VALIDATED |

Current source still contains the corresponding migration chain and verifier/test gates, but local revalidation remains pending.

## 8. Identity and Authorization

### Confirmed strengths

- Customer auth uses backend password verification and signed session cookies.
- Buyer and Seller actors are resolved from the authenticated customer account rather than request-supplied owner IDs.
- Staff effective authorization supports role defaults, personal grants, final personal DENY, leader scope, owner-only permissions, active status, and data scope.
- Staff route handlers fail closed when `staffAuthorization` is absent.
- Internal Finance requires active Staff, system-owner role, and `FINANCIAL_VIEW`; export additionally requires `FINANCIAL_EXPORT`.
- Seller Organization OWNER does not satisfy system-owner finance checks.
- Buyer and Seller projections have dedicated privacy verifiers and route-specific read models.

### Confirmed gap

`apps/api/src/index.ts` registers Staff routes, while `apps/api/src/app.ts` only installs request ID, error handling, security headers, health, and not-found behavior. No production Staff authentication middleware or Staff login/session route populates `context.get('staffAuthorization')`. Source comments in `staff-assignment/routes.ts` explicitly state that an upstream verified Staff middleware is required and that endpoints fail closed until it exists.

Result: no confirmed bypass, but all Staff frontend and Internal Finance APIs are operationally unreachable from the real production entrypoint.

AUTH totals: **10 PASS, 4 PARTIAL, 1 FAIL, 0 NOT_VERIFIED**.

## 9. Financial Integrity

All 25 financial requirements are PASS on remote source evidence plus historical validation:

- JPY integer; CNY integer fen; rates use e8 scale.
- No REAL/FLOAT finance facts and no floating-point fact calculation helpers.
- Customer-facing large money values use precision-safe serialization.
- Snapshots and ledgers are immutable; corrections use reversal/new facts.
- Formal Order creates Seller Principal Due; Review Approved creates Service Fee Due.
- Buyer Refund and Seller settlement remain independent.
- Seller payments support split allocation, reversal, reallocation, and unallocated credit.
- Buyer Refund supports payment, reversal, and OVERPAID derivation.
- Projected Gross Profit, Completed Gross Profit, Attributed Cash, and Company Cash Flow have current view/read-model evidence.
- Missing/duplicate/conflicting facts are classified rather than silently treated as valid zero.
- Export is owner-gated, audited, SHA-256 hashed, synchronous, ephemeral, bounded to 50,000 rows/25 MiB, BOM+CRLF+RFC4180 safe, and formula-injection protected.
- Buyer/Seller DTO isolation is covered by dedicated verifiers.

The Staff authentication blocker prevents frontend use but does not invalidate the financial formulas themselves.

FIN totals: **25 PASS, 0 PARTIAL, 0 FAIL, 0 NOT_VERIFIED**.

## 10. File Security

Confirmed layers include upload intents, preflight authorization and limits, object-storage metadata verification, VERIFIED transitions, entity links, explicit audience grants, short read intents, dynamic authorization, object-key privacy, no permanent URL storage, server-controlled ownership/scope, compensation, retryable residual cleanup, purpose/audience isolation, dedicated settlement-proof authorization, and exact one-file order evidence in the domain layer.

One inconsistency is non-fatal but should be corrected: the Buyer order-evidence HTTP parser accepts one to ten `file_object_ids`, while `normalizeEvidenceFileIds` rejects anything except exactly one. Security and business behavior remain correct because the domain rejects extra files, but the route contract advertises a wider shape than the real rule.

FILE totals: **16 PASS, 1 PARTIAL, 0 FAIL, 0 NOT_VERIFIED**.

## 11. Business State Machines

Remote evidence supports all 23 required flows:

- Buyer self-registration and authentication.
- Reservation creation/cancellation and capacity/version protection.
- Buyer self-pay disclosure and explicit acceptance.
- Post-approval instruction tasks and reconciliation.
- Versioned instructions, safe main-image reads, ordered keyword PNG assets.
- Initial six-hour and correction two-hour deadlines.
- Exactly one order screenshot and PRICE_MISMATCH handling.
- Immutable Buyer self-pay finance snapshot and formal-order linkage.
- Database-backed Amazon order-number claim uniqueness.
- Expiry, capacity release, and bounded reconciliation.
- Review submission, evidence versions, metadata, decisions, and service-fee creation.
- Buyer Refund payment/status facts.
- Idempotency, expected-version concurrency, audit, outbox, and server-controlled transitions.

FLOW totals: **23 PASS, 0 PARTIAL, 0 FAIL, 0 NOT_VERIFIED**.

## 12. API and DTO Readiness

Customer APIs are mostly ready. Main limitations are inconsistent exact-key/query strictness and route-family error/disclosure conventions. Customer login/password parsers and several Seller/Staff route parsers select known values without uniformly rejecting unknown fields. Major list APIs are cursor-based and bounded, but a complete SQL-level audit of every list path still requires local validation.

Staff APIs are NOT_READY as a group because trusted Staff authentication/session creation is absent from the production entrypoint.

API requirement totals: **6 PASS, 8 PARTIAL, 1 FAIL, 0 NOT_VERIFIED**.

The full method/path inventory and per-route readiness are in `PRE_WAVE13_FRONTEND_API_READINESS.md`.

## 13. Migration and Database Integrity

Confirmed source evidence includes:

- consecutive migrations `0001–0026`;
- schema-version assertions and transition to 26;
- foreign keys, unique indexes, strict tables, CHECK constraints, and transaction assertions;
- audit, outbox, and idempotency foundations;
- 0025 backup/rebuild/copy behavior preserving Staff permission history while adding `FINANCIAL_VIEW`;
- immutable financial tables and export events protected against UPDATE/DELETE;
- active Amazon order-number unique claims;
- file relation/audience constraints;
- behavior-focused migration tests and current verifier script references.

Real D1/test-double parity is NOT_VERIFIED in this remote audit.

DB totals: **19 PASS, 0 PARTIAL, 0 FAIL, 1 NOT_VERIFIED**.

## 14. P0 Findings

**Count: 0.**

No confirmed cross-tenant bypass, authentication bypass, customer disclosure of internal finance, destructive financial mutation, confirmed data loss, or unrecoverable production disaster path was found.

## 15. P1 Findings

### P1-01 — Production Staff authentication/session boundary is missing

**Evidence:** `apps/api/src/index.ts`, `apps/api/src/app.ts`, all Staff route authorization readers, and the explicit upstream-middleware comment in `apps/api/src/staff-assignment/routes.ts`.

**Impact:** Staff work queues, catalog review, order-instruction publication, review decisions, seller payment operations, reconciliation, proof reads, and Internal Finance cannot be used by the formal frontend.

**Required action:** define and implement the trusted Staff session producer/middleware and route contract; add end-to-end route tests using the real production entrypoint.

### P1-02 — Staff identity authority conflict

**Evidence:** latest `AGENTS.md`/engineering governance require an independent Staff identity/session boundary; Decision D-004 and `resolveStaffAuthorizationByFeishu` use Feishu as the primary resolution path.

**Impact:** frontend login/session contracts and backend middleware cannot be frozen without deciding whether Feishu is mandatory, optional, or merely one verified identity source.

**Required action:** project control resolves the authority conflict without rewriting evidence to fit current code; implementation then follows the winning authority.

## 16. P2 Findings

### P2-01 — Exact-key validation is not uniform

Customer auth and several Seller/Staff parsers do not consistently reject unknown fields. This increases contract drift and makes generated-client assumptions unreliable.

### P2-02 — Query/error/disclosure conventions are not fully uniform

Some route families strictly reject unknown/repeated query parameters while others do not. Customer routes often conceal scope as 404; some Staff routes return explicit 403. The difference may be intentional by domain, but it is not yet freeze-ready as a shared frontend rule.

### P2-03 — Order-evidence route cardinality differs from domain cardinality

The HTTP parser permits up to ten file IDs while the domain enforces exactly one. Runtime behavior is safe; contract clarity is not.

### P2-04 — Local D1 and full current gate not executed

Trigger behavior, strict table behavior, transaction semantics, cursor behavior, object-storage integration, and test-double parity remain local validation requirements.

## 17. P3 Findings

### P3-01 — Repeated response wrappers

Many route files repeat small `success()` wrappers around `apiSuccess`, request ID, status, and no-store headers.

### P3-02 — Repeated ordinary pagination adapters

Buyer formal order, Buyer refund, and Seller portal modules contain similar bounded cursor/page adapters. Consolidation may reduce maintenance, but only after retaining route-specific tests and without changing cursor semantics.

## 18. Not Verified Items

- Real D1 versus test substitute parity.
- Current runtime counts after rerunning the full local gate.
- Real object-storage/R2 compensation and cleanup behavior under Integration faults.
- Production Staff identity/session behavior, because no production path currently exists.

Requirement-level NOT_VERIFIED count: **1** (`DB-020`). Other local checks are validation requests or confirmed blockers rather than unknown compliance states.

## 19. Governance Conflicts

### GOVERNANCE_CONFLICT-001 — Staff identity source

- Latest authority: independent Staff identity/session; Feishu optional as an identity source.
- Conflicting decision/current implementation: Feishu-specific Staff identity resolution.
- Result: do not silently select either interpretation; do not freeze Staff auth contracts.

Count: **1**.

## 20. Frontend Blocking Items

1. Trusted Staff authentication/session contract and production middleware.
2. Resolution of the Staff identity authority conflict.
3. End-to-end Staff route tests through the real production entrypoint.
4. Contract decision for exact-key/query/error/disclosure conventions.
5. Local full-gate, OpenSpec CLI, D1, and Wrangler-compatible validation.

Buyer/Seller contract work is substantially more ready than Staff work, but this audit does not authorize starting formal Big Module 5 implementation.

## 21. Local Validation Requests

- Install dependencies through the authorized local workflow.
- Run the repository full `check` gate.
- Run every Wave 11/Wave 12 verifier referenced by `package.json`.
- Reconfirm migrations 0001–0026, schema version 26, tables 113, triggers 213, views 10.
- Reconfirm 99 test files and 511 tests, or document an intentional new baseline.
- Run strict OpenSpec validation and the real OpenSpec verify workflow.
- Run real D1-compatible migration and behavior tests on populated fixtures.
- Run Staff authentication end-to-end tests after the P1 fix.
- Run object-storage/R2 integration tests for HEAD verification, compensation, and retry cleanup.
- Run authorized Wrangler validation before Integration.

## 22. Ponytail Candidate Areas

Ponytail was not run. These are review candidates only; none is a deletion recommendation.

| File/symbol | Why it may be over-designed or duplicated | Why lower risk | Behavior that might change | Tests that must remain | Later review? |
|---|---|---|---|---|---|
| `apps/api/src/buyer-formal-orders/routes.ts::success` | Repeats standard success envelope/header behavior | No authorization or finance semantics | Header/status/request-id packaging | Buyer formal-order route tests | Yes |
| `apps/api/src/buyer-refund-status/routes.ts::success` | Same response-wrapper pattern | Read-only portal packaging | Envelope/header consistency | Buyer refund portal tests | Yes |
| `apps/api/src/seller-formal-orders/routes.ts::success` | Same response-wrapper pattern | Read-only DTO packaging | Status/header/request-id behavior | Seller formal-order route tests | Yes |
| `apps/api/src/buyer-formal-orders/pagination.ts` | Similar bounded cursor adapter to other portals | Ordinary pagination adaptation | Cursor encoding/limit defaults | Pagination golden and malformed-cursor tests | Yes, cautiously |
| `apps/api/src/buyer-refund-status/pagination.ts` | Similar page adapter | Read-only pagination | Cursor/empty-page behavior | Refund pagination tests | Yes, cautiously |
| `apps/api/src/seller-portal/pagination.ts` | Shared-looking portal cursor/limit parsing | No direct authorization decision | Limits, cursor ordering, repeated-query behavior | Seller portal pagination and tenant-scope tests | Yes, cautiously |

## 23. Ponytail Excluded Areas

Permanently excluded from this audit’s Ponytail candidates:

- `migrations/**`;
- Authentication and Authorization;
- Personal DENY and Staff data scope;
- Internal Finance, Seller Payment, Allocation, Reversal, Buyer Refund;
- Idempotency, Audit, Outbox, transaction assertions, triggers;
- File Audience and dynamic file authorization;
- order/review state machines and reconciliation;
- data recovery and safety verifiers;
- CSV injection defenses;
- BigInt/integer financial code;
- all data-loss protections.

## 24. Recommendation

Do not start formal Big Module 5 frontend implementation against the full backend surface. First resolve the Staff identity authority conflict and add the trusted Staff authentication/session path. Then freeze Staff contracts and execute the complete local validation set.

The Buyer/Seller APIs may be treated as leading freeze candidates, subject to exact-key/query/error cleanup and local gate confirmation.

## 25. Go/No-Go for Big Module 5

# NO_GO

Reason: two P1 findings exist. Under the fixed decision rule, any P1 requires NO_GO.

## REMOTE_SEMANTIC_VERIFY

This section is a remote semantic comparison, **not** OpenSpec CLI Verify and not `$openspec-verify-change`.

| Result | Count | Meaning |
|---|---:|---|
| COMPLETE | 99 | Requirement supported by current evidence |
| PARTIAL | 13 | Material layer/consistency evidence incomplete |
| MISSING | 1 | Required frontend capability is absent/unreachable (`API-013`) |
| INCONSISTENT | 1 | Staff session requirement conflicts with authority/current implementation (`AUTH-002`) |
| NOT_VERIFIED | 1 | Real D1/test-double parity requires local execution (`DB-020`) |
| **Total** | **115** | All requirements classified |

Local Codex must still run the real OpenSpec CLI validation/verify workflow after blockers are resolved.
