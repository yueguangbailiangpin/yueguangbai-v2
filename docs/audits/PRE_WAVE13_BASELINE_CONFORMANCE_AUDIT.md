# Pre-Wave 13 Baseline Conformance Audit

## 1. Executive Summary

This remote static audit reviewed formal `main` at `f28c52a36e9498c37453a4a12755d9ad8459ae65` before Big Module 5 formal frontend development.

The backend has strong domain and database foundations. Buyer and Seller read/mutation flows are generally tenant-scoped, idempotent, versioned, and projected through safe DTOs. File services implement upload intents, verification, links, audience grants, short reads, compensation, and cleanup. Financial facts use integer money, immutable ledgers/snapshots, reversal-based corrections, conflict-aware views, audited exports, triggers, audit, outbox, and transaction assertions.

The result is nevertheless **NO_GO**. Three P1 blockers were confirmed:

1. The production app registers Staff routes but has no trusted Staff login/session middleware that populates `staffAuthorization`.
2. Required frontend HTTP capabilities are absent even though service implementations exist: file upload intent/completion/link routes, Staff order-evidence review routes, and Staff Buyer Refund payment/reversal routes.
3. Current authority conflicts on Staff identity: latest governance requires an independent Staff identity/session boundary, while Decision D-004 and the current resolver remain Feishu-specific.

No P0 vulnerability was confirmed. No local commands, tests, D1, Wrangler, OpenSpec CLI, or Ponytail were run.

## 2. Audit Scope

- Fixed formal `main` SHA.
- Migrations `0001–0026`.
- Buyer, Seller, Staff, Internal Finance, Authentication, and file capabilities.
- Contracts, domain rules, production implementation, tests, migrations, and verifiers.
- Formal frontend API readiness.

## 3. Explicit Non-Scope

No production code changes, fixes, refactors, migration `0027`, historical spec reconstruction, test changes, local execution, deployment, PR, Integration, `main` advancement, or frontend implementation.

## 4. Authority Sources

Authority followed `AGENTS.md`, then current governance, decision, product, contract, architecture, and migration documents. Implementation evidence came from `packages/contracts/src/**`, `packages/domain/src/**`, `apps/api/src/**`, `migrations/**`, `scripts/**`, and relevant test source.

Chat memory, old repositories, file-name inference, and generic industry practice were not authority.

## 5. Audit Method

1. Verified remote `main`, audit branch, merge base, and ahead/behind.
2. Read OpenSpec 1.7.0 project skills and `spec-driven` configuration.
3. Read the real route registration entrypoint.
4. Traced requirements through implementation, contracts, tests, database, and verifiers.
5. Built 115 requirement classifications and an actual method/path inventory.
6. Performed `REMOTE_SEMANTIC_VERIFY`.
7. Recorded local validation requests rather than claiming runtime results.

## 6. Evidence Strength Model

- **Strong:** production implementation plus matching contract/test/database evidence.
- **Medium:** an important layer is missing or only static verification exists.
- **Weak:** documentation, names, comments, conversation, or inference alone.

Statuses are `PASS`, `PARTIAL`, `FAIL`, `NOT_VERIFIED`, or `GOVERNANCE_CONFLICT`. Missing evidence is not labelled FAIL.

## 7. Current Baseline

These are historical accepted Integration results, not commands run in this audit:

| Item | Accepted baseline | Runtime evidence |
|---|---:|---|
| Migrations | 0001–0026 | PREVIOUSLY_VALIDATED |
| Schema version | 26 | PREVIOUSLY_VALIDATED |
| Application tables | 113 | PREVIOUSLY_VALIDATED |
| Triggers | 213 | PREVIOUSLY_VALIDATED |
| Views | 10 | PREVIOUSLY_VALIDATED |
| Test files | 99 | PREVIOUSLY_VALIDATED |
| Tests | 511 | PREVIOUSLY_VALIDATED |

## 8. Identity and Authorization

### Strengths

- Customer login verifies backend credentials and issues signed customer sessions.
- Buyer and Seller actors derive from trusted sessions and scoped database rows.
- Staff effective authorization supports active status, role defaults, personal grants, final personal DENY, owner-only restrictions, team/assignment scope, and data-scope resolution.
- Staff handlers fail closed when `staffAuthorization` is absent.
- Internal Finance requires active Staff system owner plus `FINANCIAL_VIEW`; export additionally requires `FINANCIAL_EXPORT`.
- Seller Organization OWNER does not satisfy system-owner checks.

### P1 gap

`apps/api/src/index.ts` registers `/api/staff/**`, while `apps/api/src/app.ts` installs no Staff authentication/session middleware. Staff handlers explicitly expect an upstream trusted context that does not exist in the production entrypoint. This is not an authentication bypass; it is a complete Staff frontend reachability failure.

AUTH totals: **10 PASS, 4 PARTIAL, 1 FAIL, 0 NOT_VERIFIED**.

## 9. Financial Integrity

All 25 financial requirements are PASS on source plus historical validation evidence:

- integer JPY, integer-fen CNY, e8 rates;
- no REAL/FLOAT facts or prohibited floating-point calculations;
- precision-safe JSON/CSV money;
- immutable facts and reversal-based corrections;
- principal due on Formal Order and service fee due on Review approval;
- independent Buyer Refund and Seller settlement ledgers;
- split allocation, reversal, reallocation, unallocated credit, and OVERPAID derivation;
- projected/completed gross profit, attributed cash, and company cash flow formulas;
- missing/conflicting facts classified rather than guessed as zero;
- owner-only finance view/export;
- export audit, outbox, SHA-256, 50,000-row/25-MiB limits, BOM, CRLF, RFC4180, formula-injection protection, and no persisted CSV/permanent URL;
- Buyer/Seller DTO finance isolation.

FIN totals: **25 PASS**.

## 10. File Security

The service layer satisfies upload intent, preflight checks, HEAD verification, VERIFIED state, entity links, audience grants, short reads, dynamic authorization, object-key privacy, no permanent URL, server-controlled ownership/scope, compensation, retry cleanup, purpose/audience isolation, settlement-proof authorization, and exactly one order screenshot at the domain layer.

Two frontend concerns remain:

1. The order-evidence HTTP parser accepts one to ten IDs, while the domain enforces exactly one. Runtime safety is preserved, but the contract is wider than the real rule.
2. No file upload/create/complete/link HTTP routes are registered in the production entrypoint. The strong service layer is therefore unavailable to the formal frontend.

FILE totals: **16 PASS, 1 PARTIAL** at requirement level; missing HTTP reachability is classified under API-013/P1.

## 11. Business State Machines

All 23 required state-machine requirements have supporting evidence: Buyer registration, reservation capacity, self-pay acceptance, instruction task creation, versioned instructions, safe image reads, ordered keyword PNG, six-hour/two-hour deadlines, one screenshot, PRICE_MISMATCH, financial snapshot, formal-order linkage, database order-number uniqueness, expiry/release, reconciliation, review lifecycle, service-fee creation, refund facts, idempotency, expected-version concurrency, audit/outbox, and server-controlled transitions.

However, two implemented Staff operational service surfaces are not registered as HTTP APIs:

- order-evidence read/request-changes/verify;
- Buyer Refund read/record-payment/reverse-payment.

Thus the internal state machines are present, but the formal Staff frontend cannot drive them.

FLOW totals: **23 PASS** at implementation requirement level; API reachability is a separate P1.

## 12. API and DTO Readiness

Registered route inventory:

- 39 READY;
- 17 READY_WITH_LIMITATIONS;
- 52 NOT_READY;
- 0 NOT_VERIFIED.

The 52 NOT_READY routes are all registered Staff/Internal Finance endpoints blocked by absent Staff authentication. Missing file-upload, Staff order-evidence, and Staff Buyer Refund capabilities are additional NOT_READY capabilities, not included in the registered-route count.

API requirement totals: **6 PASS, 8 PARTIAL, 1 FAIL**.

Full evidence is in `PRE_WAVE13_FRONTEND_API_READINESS.md`.

## 13. Migration and Database Integrity

Source evidence supports:

- consecutive `0001–0026`;
- schema transition to 26;
- foreign keys, unique indexes, strict tables, CHECK constraints, transaction assertions;
- audit, outbox, and idempotency foundations;
- 0025 backup/rebuild/copy preservation of Staff permission history;
- immutable finance/export records protected from UPDATE/DELETE;
- active Amazon order-number uniqueness;
- file relation/audience constraints;
- behavior-oriented migration tests and current verifier scripts.

Real D1 versus test-double parity remains NOT_VERIFIED.

DB totals: **19 PASS, 1 NOT_VERIFIED**.

## 14. P0 Findings

**0.** No confirmed cross-tenant access, authentication bypass, customer disclosure of internal finance, destructive financial fact mutation, confirmed data loss, or unrecoverable production disaster path.

## 15. P1 Findings

### P1-01 — Missing production Staff authentication/session boundary

**Evidence:** `apps/api/src/index.ts`, `apps/api/src/app.ts`, Staff route context readers, and the explicit upstream-middleware comment in `staff-assignment/routes.ts`.

**Impact:** every registered Staff/Internal Finance route is unreachable by a real formal frontend.

**Action:** resolve the Staff identity authority, implement the trusted Staff session producer/middleware, and add end-to-end tests through the production entrypoint.

### P1-02 — Missing required frontend HTTP capability surfaces

**Evidence:**

- `apps/api/src/files/**` contains upload intent/upload/complete/link/grant services, but no file route registration exists.
- `apps/api/src/order-evidence/read-order-evidence.ts` and `review-order-evidence.ts` exist, but no Staff order-evidence routes are registered.
- `apps/api/src/buyer-refunds/**` contains ledger/payment/reversal services, but no Staff Buyer Refund routes are registered.

**Impact:** Buyers/Staff cannot obtain required file IDs through formal APIs; Staff cannot verify orders into Formal Orders or record/reverse Buyer Refund payments through a formal frontend.

**Action:** define, contract, register, and test these APIs before frontend freeze.

### P1-03 — Staff identity governance conflict

Latest `AGENTS.md`/governance require an independent Staff identity/session boundary with Feishu optional; Decision D-004 and `resolveStaffAuthorizationByFeishu` remain Feishu-specific.

**Impact:** Staff login/session contracts cannot be frozen.

**Action:** project control decides the authority; implementation follows that decision without rewriting evidence.

## 16. P2 Findings

1. Exact-key validation is inconsistent in customer auth and several Seller/Staff parsers.
2. Unknown/repeated query rejection and 404/403 disclosure conventions are not uniform.
3. Order-evidence route cardinality differs from the exact-one domain rule.
4. Real D1, object storage, Wrangler, full tests, and OpenSpec CLI were not run in this audit.

## 17. P3 Findings

1. Repeated route-local `success()` response wrappers.
2. Repeated ordinary cursor/limit adapters across Buyer/Seller read modules.

## 18. Not Verified Items

- Real D1/test-double parity.
- Current runtime counts after full local validation.
- Real R2/object-storage fault compensation.
- Future Staff session behavior, because the path does not exist yet.

Requirement-level NOT_VERIFIED count: **1** (`DB-020`).

## 19. Governance Conflicts

### GOVERNANCE_CONFLICT-001 — Staff identity source

Independent Staff identity/session authority conflicts with the Feishu-specific decision/current resolver. Count: **1**.

## 20. Frontend Blocking Items

1. Trusted Staff authentication/session contract and middleware.
2. File upload HTTP APIs.
3. Staff order-evidence operational APIs.
4. Staff Buyer Refund operational APIs.
5. Resolution of the Staff identity governance conflict.
6. Exact-key/query/error/disclosure contract decisions.
7. Full local validation and real OpenSpec verification.

## 21. Local Validation Requests

- Run dependency installation and the full repository check gate locally.
- Rerun all Wave 11/Wave 12 verifiers.
- Reconfirm schema/table/trigger/view/test counts.
- Run strict OpenSpec validation and the real verify workflow.
- Run real D1 migration/behavior tests on populated fixtures.
- After fixes, run end-to-end Staff auth and every Staff route through the production entrypoint.
- Run real object-storage upload/HEAD/compensation/cleanup tests.
- Run authorized Wrangler validation before Integration.

## 22. Ponytail Candidate Areas

Ponytail was not run. Candidate review only:

| File/symbol | Why potentially over-designed/duplicated | Low-risk reason | Possible behavior change | Tests to retain | Review? |
|---|---|---|---|---|---|
| `buyer-formal-orders/routes.ts::success` | repeated response wrapper | no auth/finance decision | headers/status/envelope | route tests | Yes |
| `buyer-refund-status/routes.ts::success` | repeated response wrapper | read-only packaging | headers/envelope | refund tests | Yes |
| `seller-formal-orders/routes.ts::success` | repeated response wrapper | read-only packaging | headers/envelope | seller order tests | Yes |
| `buyer-formal-orders/pagination.ts` | similar cursor adapter | ordinary pagination | cursor/default limit | malformed/golden cursor tests | Cautiously |
| `buyer-refund-status/pagination.ts` | similar cursor adapter | ordinary pagination | empty page/cursor | refund pagination tests | Cautiously |
| `seller-portal/pagination.ts` | similar limit/cursor parsing | no direct auth decision | limit/cursor behavior | pagination and tenant-scope tests | Cautiously |

## 23. Ponytail Excluded Areas

Permanently excluded: migrations, Authentication, Authorization, Personal DENY, Staff data scope, Internal Finance, Seller Payment, Allocation, Reversal, Buyer Refund, Idempotency, Audit, Outbox, transaction assertions, triggers, File Audience, dynamic file authorization, order/review state machines, reconciliation, recovery, security verifiers, CSV injection defenses, BigInt/integer finance, and data-loss protection.

## 24. Recommendation

Do not begin formal Big Module 5 implementation against the full backend. Resolve all P1 blockers, freeze the missing API contracts, and execute local gates first. Buyer/Seller read contracts are leading candidates for later freeze, but that does not authorize starting the formal frontend now.

## 25. Go/No-Go for Big Module 5

# NO_GO

There are three P1 findings; any P1 requires NO_GO.

## REMOTE_SEMANTIC_VERIFY

This is not OpenSpec CLI Verify and not `$openspec-verify-change`.

| Result | Count |
|---|---:|
| COMPLETE | 99 |
| PARTIAL | 13 |
| MISSING | 1 |
| INCONSISTENT | 1 |
| NOT_VERIFIED | 1 |
| **Total** | **115** |

- `MISSING`: API-013, including absent Staff auth and required missing HTTP capability surfaces.
- `INCONSISTENT`: AUTH-002 Staff identity/session authority conflict.
- `NOT_VERIFIED`: DB-020 real D1/test-double parity.

Local Codex must still run the real OpenSpec validation/verify workflow after blockers are fixed.
