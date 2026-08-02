# Pre-Wave 13 Requirement Traceability Matrix

## Scope and Evidence Rules

Baseline: formal `main` at `f28c52a36e9498c37453a4a12755d9ad8459ae65`.

This matrix is a remote static audit. It did not run local commands. Historical baseline results are labelled `PREVIOUSLY_VALIDATED`; all inspected source is also `NOT_RUN_IN_THIS_AUDIT` unless a local validation request is stated.

## Evidence Catalog

### Authority

- **A-GOV** — `AGENTS.md`; `docs/AI_ENGINEERING_GOVERNANCE.md`.
- **A-DEC** — `docs/decisions/V2_DECISION_REGISTER.md`.
- **A-PROD** — `docs/product/V2_PRODUCT_RULES.md`.
- **A-CONTRACT-DOC** — `docs/contracts/**`.
- **A-ARCH** — `docs/architecture/**`; `docs/migration/**`.

### Implementation

- **I-ENTRY** — `apps/api/src/index.ts`; `apps/api/src/app.ts`.
- **I-CUST-AUTH** — `apps/api/src/http-auth/routes.ts`; `apps/api/src/middleware/customer-auth.ts`; `apps/api/src/customer-auth/**`.
- **I-STAFF-AUTH** — `apps/api/src/staff/authorization-policy.ts`; `apps/api/src/staff/staff-authorization.ts`; Staff route `requireStaffActor`/`requireAuthorization` functions.
- **I-BUYER** — `apps/api/src/buyer-self-registration/routes.ts`; `buyer-portal/routes.ts`; `buyer-formal-orders/routes.ts`; `buyer-refund-status/routes.ts`.
- **I-SELLER** — `apps/api/src/seller-portal/routes.ts`; `seller-formal-orders/routes.ts`; `seller-reviews/routes.ts`; `seller-settlements/seller-routes.ts`.
- **I-ORDER** — `apps/api/src/order-instructions/**`; `apps/api/src/order-evidence/**`; `apps/api/src/buyer-order-evidence-portal/routes.ts`.
- **I-REVIEW** — `apps/api/src/reviews/**`; `apps/api/src/buyer-reviews/routes.ts`; `apps/api/src/seller-reviews/routes.ts`.
- **I-SETTLEMENT** — `apps/api/src/seller-settlements/**`.
- **I-FINANCE** — `apps/api/src/internal-finance/**`; `packages/domain/src/finance/**`.
- **I-FILES** — `apps/api/src/files/**`; customer/staff dedicated read-intent routes.
- **I-FOUNDATION** — `apps/api/src/foundation/audit.ts`; `idempotency.ts`; `outbox.ts`.
- **I-STAFF-WORKFLOW** — `apps/api/src/staff-assignment/routes.ts`; `apps/api/src/staff-catalog-routes.ts`; `apps/api/src/reviews/staff-routes.ts`.

### Contracts

- **C-AUTH** — `packages/contracts/src/http-auth.ts`; `buyer-self-registration.ts`; customer session DTOs.
- **C-STAFF** — `packages/contracts/src/staff.ts`; Staff assignment contracts.
- **C-BUYER** — Buyer portal, order evidence, formal order, review, and refund contracts under `packages/contracts/src/**`.
- **C-SELLER** — Seller portal, formal order, review, and settlement contracts under `packages/contracts/src/**`.
- **C-FILE** — `packages/contracts/src/file-storage.ts` and file/audience DTO contracts.
- **C-FINANCE** — internal finance filters, DTOs, export types, and error contracts under `packages/contracts/src/**`.

### Test and Verifier Source

- **T-STAFF** — `apps/api/src/staff/authorization-policy.test.ts`; `staff-authorization.test.ts`; `provision-staff.test.ts`; `packages/contracts/src/staff.test.ts`.
- **T-ORDER** — order instruction/evidence module tests; `apps/api/src/order-instructions/phase3g-source-policy.test.ts`.
- **T-REVIEW** — review command, portal, metadata, and projection tests in `apps/api/src/reviews/**` and portal modules.
- **T-FILE** — file storage, audience, read-intent, compensation, duplicate-binding, and settlement-proof tests in `apps/api/src/files/**` and settlement/review modules.
- **T-SETTLEMENT** — seller payable/payment/allocation/reversal/reconciliation tests; `apps/api/src/seller-settlements/wave11-migrations.test.ts`.
- **T-FINANCE** — `packages/domain/src/finance/wave12-finance.test.ts`; internal-finance route/read-model/export tests.
- **V-MIGRATION** — `scripts/verify-migrations.mjs`; migration guard scripts; `scripts/verify-wave12-migrations.mjs`.
- **V-FINANCE** — `scripts/verify-phase3l-financial-reporting.mjs`; `verify-phase3m-financial-exports.mjs`; `verify-wave12-financial-formulas.mjs`; `verify-wave12-financial-security.mjs`.
- **V-DTO** — `scripts/verify-wave11-dto-isolation.mjs`; `scripts/verify-wave12-dto-isolation.mjs`.
- **V-SETTLEMENT** — `scripts/verify-phase3k-seller-payments.mjs`; `scripts/verify-seller-finance-security.mjs`.

### Database

- **D-STAFF** — `migrations/0002_staff_identity_permissions.sql`; permission tables and constraints rebuilt by `migrations/0025_internal_finance_reporting.sql`.
- **D-FILE** — `migrations/0010_file_storage.sql`; later file-audience/order-instruction migrations.
- **D-ORDER** — `migrations/0021_order_instructions.sql`; formal order/order-evidence claim constraints.
- **D-REVIEW** — `migrations/0022_review_submission_metadata.sql` and review/payable triggers.
- **D-SETTLEMENT** — `migrations/0023_seller_payables.sql`; `0024_seller_payments_allocations.sql`.
- **D-FINANCE** — `migrations/0025_internal_finance_reporting.sql`; `0026_financial_export_audit.sql`.
- **D-FOUNDATION** — `transaction_assertions`, `audit_events`, `integration_outbox`, `command_idempotency_records` across migrations.

## Matrix

| Requirement ID | Domain | Requirement | Source of Authority | Implementation Evidence | Contract Evidence | Test Evidence | Database Evidence | Runtime Evidence | Status | Severity | Frontend Impact | Recommended Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-001 | AUTH | Buyer/Seller/Staff identity domains separated | A-GOV,A-DEC | I-CUST-AUTH,I-STAFF-AUTH | C-AUTH,C-STAFF | T-STAFF | D-STAFF | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Customer domains are usable; Staff HTTP identity is not production-complete | Resolve Staff identity/session contract before freeze |
| AUTH-002 | AUTH | Sessions only from trusted backend context | A-GOV,A-DEC | I-ENTRY,I-CUST-AUTH,I-STAFF-AUTH; no registered Staff session producer | C-AUTH,C-STAFF | T-STAFF | D-STAFF | NOT_RUN_IN_THIS_AUDIT | FAIL | P1 | Staff UI cannot establish a trusted usable session | Implement/approve trusted Staff auth middleware and route contract |
| AUTH-003 | AUTH | Client cannot forge authority identifiers/roles/scope | A-GOV | I-CUST-AUTH,I-BUYER,I-SELLER,I-STAFF-WORKFLOW | C-AUTH,C-BUYER,C-SELLER,C-STAFF | T-STAFF | D-STAFF | NOT_RUN_IN_THIS_AUDIT | PASS | — | Safe actor derivation for inspected routes | Retain and locally regression-test |
| AUTH-004 | AUTH | Missing Staff authorization fails closed | A-GOV | Staff `requireStaffActor`/`requireAuthorization` functions | C-STAFF | T-STAFF | D-STAFF | NOT_RUN_IN_THIS_AUDIT | PASS | — | Staff routes return 401/403 rather than execute | Preserve fail-closed behavior when middleware is added |
| AUTH-005 | AUTH | Inactive Staff rejected | A-GOV | `resolveStaffAuthorizationByFeishu` checks staff/identity ACTIVE | C-STAFF | T-STAFF | D-STAFF | NOT_RUN_IN_THIS_AUDIT | PASS | — | Inactive accounts cannot produce effective context | Revalidate with production session integration |
| AUTH-006 | AUTH | Personal DENY final precedence | A-GOV | `calculateEffectiveStaffAuthorization` | C-STAFF | `authorization-policy.test.ts` DENY case | D-STAFF | PREVIOUSLY_VALIDATED | PASS | — | Permission UI must display effective denial | Keep DENY regression test mandatory |
| AUTH-007 | AUTH | System owner distinct from Seller Organization OWNER | A-GOV,A-PROD | I-STAFF-AUTH,I-SELLER,I-FINANCE | C-STAFF,C-SELLER | T-STAFF,T-FINANCE | D-STAFF,D-SETTLEMENT | NOT_RUN_IN_THIS_AUDIT | PASS | — | Prevents Seller owner from internal-finance access | Freeze terminology in frontend contracts |
| AUTH-008 | AUTH | FINANCIAL_VIEW requires active Staff system owner | A-GOV | `internal-finance/shared.ts::requireFinancialActor` | C-FINANCE,C-STAFF | T-FINANCE | D-STAFF,D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Internal finance screens remain owner-only | Preserve dual role+permission check |
| AUTH-009 | AUTH | Export additionally requires FINANCIAL_EXPORT | A-GOV | `requireFinancialActor(...,{export:true})` | C-FINANCE | T-FINANCE | D-STAFF,D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Export button must depend on both permissions | Freeze permission behavior after Staff auth fix |
| AUTH-010 | AUTH | SELLER_SETTLEMENT_VIEW cannot replace FINANCIAL_VIEW | A-GOV | I-SETTLEMENT,I-FINANCE | C-STAFF,C-FINANCE | T-SETTLEMENT,T-FINANCE | D-STAFF | PREVIOUSLY_VALIDATED | PASS | — | Settlement users cannot see profit reports | Retain separate navigation capability flags |
| AUTH-011 | AUTH | Permission followed by scope and projection | A-GOV | `resolveStaffDataScope`; seller/buyer scoped read models; dedicated file auth | C-BUYER,C-SELLER,C-FILE | T-STAFF,T-FILE | D-STAFF,D-FILE | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Most key modules comply; complete route-by-route local coverage is pending | Add integration tests after Staff middleware exists |
| AUTH-012 | AUTH | 404/403 disclosure policy | A-GOV,A-CONTRACT-DOC | Buyer/Seller errors often conceal scope; some Staff routes expose FORBIDDEN | Shared API errors | Portal/staff route tests | Scope FKs/queries | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Frontend error handling is not fully uniform | Freeze a route-family disclosure matrix |
| AUTH-013 | AUTH | Buyer DTO excludes Staff/internal finance | A-GOV,A-PROD | I-BUYER,I-ORDER,I-REVIEW | C-BUYER | V-DTO,T-ORDER,T-REVIEW | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Buyer frontend can consume safe projections | Rerun DTO isolation verifier locally |
| AUTH-014 | AUTH | Seller DTO excludes Buyer Refund cost/profit/other Seller data | A-GOV,A-PROD | I-SELLER,I-SETTLEMENT | C-SELLER | V-DTO,T-SETTLEMENT | D-SETTLEMENT,D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Seller portal projections are suitable | Rerun DTO isolation verifier locally |
| AUTH-015 | AUTH | GRANT/DENY/inactive/cross-tenant/empty-context tested | A-GOV | I-STAFF-AUTH,portal scope queries | C-STAFF | T-STAFF plus portal tests | D-STAFF | PREVIOUSLY_VALIDATED | PARTIAL | P2 | Core cases exist; unified production HTTP coverage is absent | Add end-to-end Staff and cross-tenant route tests |
| FIN-001 | FIN | JPY uses integer | A-GOV,A-PROD | I-ORDER,I-FINANCE | C-BUYER,C-FINANCE | T-ORDER,T-FINANCE,V-FINANCE | D-ORDER,D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Stable numeric input/display | Retain integer validation |
| FIN-002 | FIN | CNY uses integer fen | A-GOV,A-PROD | I-SETTLEMENT,I-FINANCE | C-SELLER,C-FINANCE | T-SETTLEMENT,T-FINANCE,V-FINANCE | D-SETTLEMENT,D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Frontend must treat fen strings precisely | Freeze cny_fen naming |
| FIN-003 | FIN | Rate uses cny_per_jpy_e8 | A-GOV,A-PROD | pricing/snapshot domain paths | Finance/pricing contracts | V-FINANCE | Snapshot migrations | PREVIOUSLY_VALIDATED | PASS | — | Avoids floating-rate ambiguity | Keep e8 helpers centralized |
| FIN-004 | FIN | No REAL/FLOAT finance facts | A-GOV | I-FINANCE,I-SETTLEMENT | C-FINANCE | V-FINANCE,V-MIGRATION | D-SETTLEMENT,D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | No precision-risk schema contract | Rerun schema scan |
| FIN-005 | FIN | No parseFloat/toFixed finance calculation | A-GOV | `packages/domain/src/finance/**`; finance read models | C-FINANCE | V-FINANCE,T-FINANCE | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Stable calculation semantics | Keep prohibited-token verifier |
| FIN-006 | FIN | JSON money uses decimal string | A-GOV | database integer-to-string helpers; settlement route `integerString` | C-FINANCE,C-SELLER | T-FINANCE,T-SETTLEMENT | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | JS clients avoid precision loss | Frontend must not coerce to Number |
| FIN-007 | FIN | Facts not overwritten in place | A-GOV | ledger/snapshot command patterns | C-FINANCE | T-SETTLEMENT,T-FINANCE | immutable triggers/views | PREVIOUSLY_VALIDATED | PASS | — | Historical financial audit remains valid | Preserve append-only commands |
| FIN-008 | FIN | Corrections use reversal/new fact | A-GOV | payment/refund reversal commands | C-SELLER,C-FINANCE | T-SETTLEMENT | D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Correction UI must call reversal actions | Do not expose generic edit/delete |
| FIN-009 | FIN | Formal Order creates Seller Principal Due | A-PROD | formal-order integration and payable creation/reconciliation | C-BUYER,C-SELLER | T-ORDER,T-SETTLEMENT | D-ORDER,D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Seller settlement appears after confirmation | Retain exactly-once assertions |
| FIN-010 | FIN | Review Approved creates Service Fee Due | A-PROD | review approval/payable integration | C-SELLER | T-REVIEW,T-SETTLEMENT | D-REVIEW,D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Fee due follows approval | Preserve replay test |
| FIN-011 | FIN | Buyer Refund ledger independent | A-PROD | refund modules versus settlement modules | C-BUYER,C-SELLER | refund/settlement tests | separate ledger tables | PREVIOUSLY_VALIDATED | PASS | — | Seller never receives buyer refund cost | Keep separate DTOs |
| FIN-012 | FIN | Seller payment split/allocation/reversal/reallocation/unallocated | A-PROD | I-SETTLEMENT | C-SELLER | T-SETTLEMENT,V-SETTLEMENT | D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Staff finance workflow has required actions | Staff auth remains external blocker |
| FIN-013 | FIN | Buyer Refund payment/reversal/OVERPAID | A-PROD | buyer refund ledger services/read models | C-BUYER | refund tests | refund obligation/payment/balance views | PREVIOUSLY_VALIDATED | PASS | — | Buyer status is derivable and safe | Rerun refund regressions |
| FIN-014 | FIN | Projected Gross Profit formula | A-GOV,A-PROD | `internal_order_finance_positions` view/read model | C-FINANCE | T-FINANCE,V-FINANCE | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Owner dashboard projection is defined | Freeze formula names |
| FIN-015 | FIN | Completed Gross Profit formula | A-GOV,A-PROD | finance view/read model | C-FINANCE | T-FINANCE,V-FINANCE | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Completed KPI is safe after Staff auth | Preserve qualifying-state tests |
| FIN-016 | FIN | Attributed Cash formula | A-GOV | finance view joins allocation/refund facts | C-FINANCE | T-FINANCE,V-FINANCE | D-FINANCE,D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Per-order cash attribution is stable | Keep reversal cases |
| FIN-017 | FIN | Company Cash Flow formula | A-GOV | `readFinanceCashFlow` | C-FINANCE | T-FINANCE,V-FINANCE | D-FINANCE,D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Cash-flow chart semantics are defined | Freeze CASH date basis |
| FIN-018 | FIN | Missing/conflicting facts not guessed as zero | A-GOV | finance position conflict classification | C-FINANCE | T-FINANCE,V-FINANCE | D-FINANCE view counts/nulls | PREVIOUSLY_VALIDATED | PASS | — | UI must display conflict/not-available states | Do not coerce null to zero |
| FIN-019 | FIN | Internal finance view owner + FINANCIAL_VIEW | A-GOV | `requireFinancialActor` | C-FINANCE | T-FINANCE | D-STAFF | PREVIOUSLY_VALIDATED | PASS | — | Owner-only screen | Block until Staff session exists |
| FIN-020 | FIN | Export also FINANCIAL_EXPORT | A-GOV | internal-finance export route | C-FINANCE | T-FINANCE | D-STAFF | PREVIOUSLY_VALIDATED | PASS | — | Export button permission is explicit | Block until Staff session exists |
| FIN-021 | FIN | Export Audit/Outbox/SHA-256 | A-GOV | `generateAuditedFinancialCsv` | C-FINANCE | T-FINANCE,V-FINANCE | D-FINANCE,D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Download has traceable export ID | Rerun export verifier |
| FIN-022 | FIN | CSV not persisted/no R2/permanent URL | A-GOV | synchronous `Response(bytes)`; metadata says persisted_csv false | C-FINANCE | T-FINANCE,V-FINANCE | only `financial_export_events` metadata | PREVIOUSLY_VALIDATED | PASS | — | Browser receives direct download | Keep file system separate |
| FIN-023 | FIN | CSV 50000 rows/25 MiB | A-GOV | bounded collectors and serializer | C-FINANCE | T-FINANCE,V-FINANCE | D-FINANCE CHECK limits | PREVIOUSLY_VALIDATED | PASS | — | UI must surface EXPORT_TOO_LARGE | Keep preflight and output limit tests |
| FIN-024 | FIN | BOM/CRLF/RFC4180/formula injection | A-GOV | `packages/domain/src/finance/csv.ts` | C-FINANCE | `wave12-finance.test.ts`,V-FINANCE | N/A | PREVIOUSLY_VALIDATED | PASS | — | Safe spreadsheet download | Preserve byte-level BOM test |
| FIN-025 | FIN | Customer APIs isolate profit/refund cost | A-GOV,A-PROD | I-BUYER,I-SELLER | C-BUYER,C-SELLER | V-DTO | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Customer frontends safe | Rerun isolation verifier |
| FILE-001 | FILE | Upload intent required | A-GOV | `files/create-upload-intent.ts` | C-FILE | T-FILE | D-FILE | PREVIOUSLY_VALIDATED | PASS | — | Frontend uses intent workflow | Keep direct-object upload unavailable |
| FILE-002 | FILE | Pre-upload auth/duplicate/capacity checks | A-GOV | create intent/authorization services | C-FILE | T-FILE | D-FILE constraints | PREVIOUSLY_VALIDATED | PASS | — | Errors occur before upload | Preserve bounded request contracts |
| FILE-003 | FILE | Post-upload HEAD verification | A-GOV | `complete-upload-intent.ts::verifyStoredObject` | C-FILE | T-FILE | D-FILE metadata | PREVIOUSLY_VALIDATED | PASS | — | Upload completion can be trusted | Use real object-storage integration test |
| FILE-004 | FILE | VERIFIED state | A-GOV | completion service atomic transitions | C-FILE | T-FILE | D-FILE status CHECKs | PREVIOUSLY_VALIDATED | PASS | — | Only verified files selectable | Retain status gating |
| FILE-005 | FILE | Entity link required | A-GOV | `file-entity-links.ts` and dedicated business links | C-FILE | T-FILE | D-FILE | PREVIOUSLY_VALIDATED | PASS | — | File ownership in UI is explicit | Keep versioned link DTOs |
| FILE-006 | FILE | Audience grant required | A-GOV | `file-audience-authorization.ts`; explicit audience links | C-FILE | T-FILE | D-FILE | PREVIOUSLY_VALIDATED | PASS | — | Seller/Buyer visibility remains controlled | Preserve grant revocation semantics |
| FILE-007 | FILE | Short read intent | A-GOV | `file-read-service.ts`; dedicated portal routes | C-FILE | T-FILE | D-FILE read-intent tables | PREVIOUSLY_VALIDATED | PASS | — | No permanent asset URL | Frontend must request intent on demand |
| FILE-008 | FILE | Dynamic read authorization | A-GOV | audience authorization at create/consume; dedicated proof/review checks | C-FILE | T-FILE | D-FILE | PREVIOUSLY_VALIDATED | PASS | — | Revocation can take effect | Keep consume-time checks |
| FILE-009 | FILE | object_key not in DTO | A-GOV | file DTO projections | C-FILE | V-DTO,T-FILE | D-FILE stores server-side key | PREVIOUSLY_VALIDATED | PASS | — | Storage topology hidden | Rerun DTO verifier |
| FILE-010 | FILE | No permanent URL stored | A-GOV | I-FILES | C-FILE | T-FILE | D-FILE has object keys/intents, not permanent URLs | PREVIOUSLY_VALIDATED | PASS | — | URL lifetime remains short | Preserve schema rule |
| FILE-011 | FILE | Client cannot choose owner/scope/grant | A-GOV | trusted actor/business integration | C-FILE | T-FILE | D-FILE owner/grant FKs/CHECKs | PREVIOUSLY_VALIDATED | PASS | — | Prevents forged audience | Keep authority fields absent from public body |
| FILE-012 | FILE | R2 failure compensation | A-GOV | `compensation.ts`; completion failure path | C-FILE | T-FILE | D-FILE deletion states/retry fields | PREVIOUSLY_VALIDATED | PASS | — | Failed uploads do not silently orphan | Validate against real R2 adapter locally |
| FILE-013 | FILE | Residual cleanup retry-safe | A-GOV | cleanup/reconciliation services | C-FILE | T-FILE | delete_attempt_count/next_delete_at/status | PREVIOUSLY_VALIDATED | PASS | — | Operations can retry safely | Keep bounded cleanup worker contract |
| FILE-014 | FILE | Purpose/audience isolation | A-GOV | file authorization and business validators | C-FILE | T-FILE | D-FILE purpose/visibility CHECKs | PREVIOUSLY_VALIDATED | PASS | — | Prevents cross-feature file reuse | Preserve purpose-specific routes |
| FILE-015 | FILE | Settlement proof authorization | A-GOV | `seller-settlements/staff-proof-routes.ts`; dynamic file auth | C-FILE,C-SELLER | T-FILE,T-SETTLEMENT | D-FILE,D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Proof reads are scoped | Staff auth is the remaining reachability blocker |
| FILE-016 | FILE | Exactly one order screenshot | A-PROD | `normalizeEvidenceFileIds` requires length 1 | C-BUYER | T-ORDER | D-ORDER,D-FILE | PREVIOUSLY_VALIDATED | PASS | — | Buyer UI should select one screenshot | Align route parser maximum with domain rule |
| FILE-017 | FILE | Unauthorized/expired/revoked/duplicate tests | A-GOV | I-FILES | C-FILE | T-FILE | D-FILE | PREVIOUSLY_VALIDATED | PARTIAL | P2 | Broad evidence exists; complete current route matrix not remotely enumerated | Run full file suite and add missing route-level cases |
| FLOW-001 | FLOW | Buyer registration and identity | A-PROD | `buyer-self-registration/routes.ts`; customer auth | C-AUTH,C-BUYER | buyer registration/auth tests | identity/account tables | PREVIOUSLY_VALIDATED | PASS | — | Buyer onboarding API ready | Freeze registration path and errors |
| FLOW-002 | FLOW | Reservation and capacity occupation | A-PROD | reservation submit/cancel services | C-BUYER | reservation tests | reservation unique/version/capacity assertions | PREVIOUSLY_VALIDATED | PASS | — | Demand booking usable | Retain concurrency tests |
| FLOW-003 | FLOW | Self-pay display and acceptance | A-PROD | Buyer demand DTO and reservation acceptance parser | C-BUYER | buyer portal tests | reservation acceptance snapshot | PREVIOUSLY_VALIDATED | PASS | — | Frontend must show exact bps before submit | Freeze acceptance fields |
| FLOW-004 | FLOW | Approval creates instruction task | A-PROD | order-instruction reconciliation/work item integration | C-STAFF | T-ORDER | D-ORDER,D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Staff task exists logically | Unreachable until Staff auth fixed |
| FLOW-005 | FLOW | Versioned instruction | A-PROD | order instruction aggregate/version read model | C-BUYER,C-STAFF | T-ORDER | D-ORDER | PREVIOUSLY_VALIDATED | PASS | — | Buyer/Staff can display current/history | Freeze version DTOs after auth fix |
| FLOW-006 | FLOW | Safe product main image | A-GOV,A-PROD | instruction image read-intent route | C-FILE,C-BUYER | T-ORDER,T-FILE | D-FILE,D-ORDER | PREVIOUSLY_VALIDATED | PASS | — | Buyer image access is short-lived | Keep position contract |
| FLOW-007 | FLOW | Ordered keyword PNG | A-PROD | asset preparation/generator integration | C-STAFF | T-ORDER | D-ORDER,D-FILE | PREVIOUSLY_VALIDATED | PASS | — | Staff publishes deterministic assets | Validate generator binding in Integration |
| FLOW-008 | FLOW | Initial six-hour deadline | A-PROD | publish/evidence deadline integration | C-BUYER,C-STAFF | T-ORDER | D-ORDER | PREVIOUSLY_VALIDATED | PASS | — | Buyer countdown is defined | Frontend must use server timestamps |
| FLOW-009 | FLOW | Two-hour correction deadline | A-PROD | resubmission deadline statements | C-BUYER,C-STAFF | T-ORDER | D-ORDER | PREVIOUSLY_VALIDATED | PASS | — | Correction countdown is defined | Preserve server-side enforcement |
| FLOW-010 | FLOW | One order screenshot | A-PROD | I-ORDER | C-BUYER | T-ORDER | D-ORDER,D-FILE | PREVIOUSLY_VALIDATED | PASS | — | Single-file UX | Align route parser |
| FLOW-011 | FLOW | PRICE_MISMATCH | A-PROD | instruction evidence integration/error mapping | C-BUYER,C-STAFF | T-ORDER | D-ORDER | PREVIOUSLY_VALIDATED | PASS | — | UI can display mismatch state | Freeze public error/message mapping |
| FLOW-012 | FLOW | Buyer self-pay finance snapshot | A-PROD | formal order integration/read models | C-BUYER,C-FINANCE | T-ORDER,T-FINANCE | D-ORDER,D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Immutable financial context available | Keep snapshot private as appropriate |
| FLOW-013 | FLOW | Formal order linkage | A-PROD | formal-order confirmation integration | C-BUYER,C-SELLER | T-ORDER | D-ORDER,D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Buyer/Seller order pages have canonical order | Preserve atomic assertions |
| FLOW-014 | FLOW | Amazon order number DB uniqueness | A-PROD | claim service and conflict mapping | C-BUYER | T-ORDER | active unique claim index | PREVIOUSLY_VALIDATED | PASS | — | Duplicate order number receives stable conflict | Retain historical-conflict review path |
| FLOW-015 | FLOW | Expiry and capacity release | A-PROD | expiry scan/reservation services | C-STAFF,C-BUYER | T-ORDER | D-ORDER,D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Buyer slots/countdowns remain accurate | Run expiry scan tests locally |
| FLOW-016 | FLOW | Reconciliation | A-GOV | instruction/asset/payable reconciliation | C-STAFF,C-FINANCE | T-ORDER,T-SETTLEMENT | D-ORDER,D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Admin recovery actions exist | Staff auth blocks UI use |
| FLOW-017 | FLOW | Review submission/approval/metadata | A-PROD | I-REVIEW | C-BUYER,C-SELLER,C-STAFF | T-REVIEW | D-REVIEW | PREVIOUSLY_VALIDATED | PASS | — | Buyer/Seller review pages usable | Staff decisions blocked by auth |
| FLOW-018 | FLOW | Approval creates service fee | A-PROD | review decision/payable integration | C-SELLER,C-FINANCE | T-REVIEW,T-SETTLEMENT | D-REVIEW,D-SETTLEMENT | PREVIOUSLY_VALIDATED | PASS | — | Seller settlement updates after approval | Preserve idempotency |
| FLOW-019 | FLOW | Refund state/payment facts | A-PROD | refund services/read model | C-BUYER | refund tests | refund ledger/views | PREVIOUSLY_VALIDATED | PASS | — | Buyer refund status API usable | Keep cost fields private |
| FLOW-020 | FLOW | Idempotent replay | A-GOV | I-FOUNDATION used across commands | Shared mutation contracts | module tests | D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Frontend retries can be safe | Require Idempotency-Key consistently |
| FLOW-021 | FLOW | expected_version concurrency | A-GOV | mutation route parsers/services | mutation contracts | module tests | version columns/transaction assertions | PREVIOUSLY_VALIDATED | PASS | — | Stale forms get VERSION_CONFLICT | Standardize conflict handling UX |
| FLOW-022 | FLOW | Audit and Outbox | A-GOV | I-FOUNDATION integrations | event contracts | module tests/verifiers | D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Operational traceability exists | Rerun full gate |
| FLOW-023 | FLOW | Client cannot skip state | A-GOV | command-specific routes; server transitions | domain contracts | module tests | status CHECKs/triggers | PREVIOUSLY_VALIDATED | PASS | — | No generic status setter needed | Keep state fields out of mutation bodies |
| API-001 | API | Exact-key body validation | A-GOV,A-CONTRACT-DOC | strict in many modules; customer login and several Seller/Staff parsers accept extras | all contracts | route tests | N/A | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Generated clients may hide server inconsistency | Make exact-key behavior uniform before freeze |
| API-002 | API | Unknown/repeated query rejection | A-GOV,A-CONTRACT-DOC | strong in Buyer formal/refund/finance; incomplete in some Seller/Staff lists | portal/filter contracts | route tests | N/A | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Filter bugs may be silently ignored | Introduce shared exact-query helper |
| API-003 | API | Stable bounded pagination | A-GOV | module cursor helpers and max limits | page DTOs | pagination tests | indexed sort keys | PREVIOUSLY_VALIDATED | PASS | — | List screens can paginate | Freeze page envelope |
| API-004 | API | Large data avoids OFFSET | A-GOV | keyset/cursor in major portals/finance; not every read model remotely enumerated | page contracts | pagination tests | supporting indexes | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Potential scale inconsistency in unreviewed lists | Complete SQL-level pagination inventory locally |
| API-005 | API | Strict cursor validation | A-GOV | module decode helpers/length bounds | cursor contracts | pagination tests | N/A | PREVIOUSLY_VALIDATED | PASS | — | Invalid cursors fail safely | Keep cursor opaque to UI |
| API-006 | API | Stable errors | A-GOV,A-CONTRACT-DOC | module-specific normalization; some semantically similar codes differ | shared `ApiErrorCode` plus module codes | route tests | N/A | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Frontend needs route-family mapping | Publish error contract table before freeze |
| API-007 | API | Consistent 404/403 | A-GOV | customer concealment versus Staff explicit forbidden is not fully normalized | error contracts | route tests | scope queries | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Error UX cannot be fully shared | Approve disclosure policy by auth domain |
| API-008 | API | Stable empty page | A-GOV | list read models/page DTOs | C-BUYER,C-SELLER,C-FINANCE | pagination tests | N/A | PREVIOUSLY_VALIDATED | PASS | — | Empty states predictable | Freeze envelope |
| API-009 | API | Stable money serialization | A-GOV | integer JPY; decimal-string fen helpers | C-BUYER,C-SELLER,C-FINANCE | T-FINANCE,T-SETTLEMENT | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Money display implementable | Provide frontend parsing utility |
| API-010 | API | UTC timestamp/business date semantics | A-GOV | epoch ms plus validated YYYY-MM-DD filters | all DTO/filter contracts | route/finance tests | D-FINANCE date views | PREVIOUSLY_VALIDATED | PASS | — | Date displays/filters are defined | Document timezone in generated client |
| API-011 | API | Safe Buyer/Seller projections | A-GOV,A-PROD | portal-specific read models | C-BUYER,C-SELLER | V-DTO | scoped DB joins | PREVIOUSLY_VALIDATED | PASS | — | Customer portals safe | Rerun DTO gates |
| API-012 | API | Minimize internal IDs | A-GOV | DTOs often include business IDs; some file/read-intent/internal IDs exposed for follow-up actions | all contracts | DTO tests/verifiers | N/A | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P3 | Mostly harmless but contract noise | Review each ID for required frontend action |
| API-013 | API | All frontend actions have reachable API | A-GOV | Customer APIs reachable; all Staff handlers depend on never-populated production `staffAuthorization` | all contracts | module tests use injected context | D-STAFF | NOT_RUN_IN_THIS_AUDIT | FAIL | P1 | Staff and internal-finance frontend cannot operate | Resolve Staff auth before Big Module 5 |
| API-014 | API | No conflicting overlapping APIs | A-GOV | shared customer auth plus domain portals; some duplicate validators/error maps | all contracts | route tests | N/A | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P2 | Contract ownership needs clearer freeze boundaries | Designate canonical route/DTO per action |
| API-015 | API | Frontend contracts freezeable | A-GOV | Buyer/Seller mostly stable; Staff identity/session and strictness unresolved | all contracts | test/verifier evidence | D-STAFF | NOT_RUN_IN_THIS_AUDIT | PARTIAL | P1 | Full frontend freeze is blocked | Freeze customer contracts separately; defer Staff freeze |
| DB-001 | DB | Migrations consecutive 0001–0026 | A-GOV,A-ARCH | package migration tooling | N/A | V-MIGRATION | migrations/0001–0026 | PREVIOUSLY_VALIDATED | PASS | — | No schema numbering ambiguity | Re-run locally |
| DB-002 | DB | schema_version 26 accepted | A-GOV | 0026 advances 25→26 | N/A | V-MIGRATION | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Backend baseline version known | Reconfirm local D1 |
| DB-003 | DB | 113 application tables accepted | A-GOV | verifier/schema test source | N/A | V-MIGRATION | all migrations | PREVIOUSLY_VALIDATED | PASS | — | Capacity baseline known | Recount locally |
| DB-004 | DB | 213 triggers accepted | A-GOV | verifier/schema test source | N/A | V-MIGRATION | all migrations | PREVIOUSLY_VALIDATED | PASS | — | Defense count baseline known | Recount and behavior-test locally |
| DB-005 | DB | 10 views accepted | A-GOV | verifier/schema test source | N/A | V-MIGRATION | all migrations | PREVIOUSLY_VALIDATED | PASS | — | Read-model baseline known | Recount locally |
| DB-006 | DB | Foreign keys | A-GOV | SQL commands rely on declared relationships | N/A | migration tests | all relevant migrations | PREVIOUSLY_VALIDATED | PASS | — | Prevents orphan business rows | Validate PRAGMA foreign_keys behavior |
| DB-007 | DB | Unique constraints | A-GOV | identity/idempotency/order/file claims | N/A | module/migration tests | D-STAFF,D-FILE,D-ORDER,D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Duplicate actions constrained | Keep DB as final backstop |
| DB-008 | DB | CHECK constraints | A-GOV | strict domain SQL | N/A | migration tests | all migrations, especially 0010/0023–0026 | PREVIOUSLY_VALIDATED | PASS | — | Invalid status/range blocked | Re-run behavior tests |
| DB-009 | DB | transaction_assertions | A-GOV | command batches insert assertions | N/A | module tests | D-FOUNDATION | PREVIOUSLY_VALIDATED | PASS | — | Atomic invariant failures surface | Preserve assertion table/trigger |
| DB-010 | DB | Audit events | A-GOV | I-FOUNDATION used by material commands | event DTOs | module tests | audit_events | PREVIOUSLY_VALIDATED | PASS | — | Operational audit available | Keep request/idempotency metadata |
| DB-011 | DB | Outbox | A-GOV | I-FOUNDATION | event contracts | module tests | integration_outbox | PREVIOUSLY_VALIDATED | PASS | — | Async integration can reconcile | Keep dedup constraints |
| DB-012 | DB | Idempotency constraints | A-GOV | acquire/complete/fail helpers | mutation contracts | module tests | command_idempotency_records | PREVIOUSLY_VALIDATED | PASS | — | Safe retries | Standardize header requirement |
| DB-013 | DB | 0025 rebuild preserves permission rows/fields | A-GOV | 0025 backup-copy-drop sequence | C-STAFF | wave12 migration tests,V-MIGRATION | D-FINANCE | PREVIOUSLY_VALIDATED | PASS | — | Staff grants/denies not lost | Re-run row-preservation fixture |
| DB-014 | DB | Immutable finance tables reject update/delete | A-GOV | no generic mutation services | C-FINANCE | V-FINANCE,migration tests | immutability triggers including 0026 | PREVIOUSLY_VALIDATED | PASS | — | No destructive edit UI | Keep reversal-only endpoints |
| DB-015 | DB | Amazon order number unique claim | A-PROD | claim service | C-BUYER | T-ORDER | D-ORDER unique active claim | PREVIOUSLY_VALIDATED | PASS | — | Duplicate order UX stable | Re-run concurrency fixture |
| DB-016 | DB | File relations/audience constraints | A-GOV | I-FILES | C-FILE | T-FILE | D-FILE | PREVIOUSLY_VALIDATED | PASS | — | File access data remains coherent | Validate revocation/duplicate link fixtures |
| DB-017 | DB | Migration rebuild data-loss safeguards | A-GOV | 0025 backup/rebuild/assertions; other rebuild guards | N/A | V-MIGRATION | migrations with transaction assertions | PREVIOUSLY_VALIDATED | PASS | — | Lowers migration loss risk | Re-run on populated fixture |
| DB-018 | DB | Schema tests validate behavior | A-GOV | migration tests exercise constraints/immutability in addition to counts | N/A | migration suites | all migrations | PREVIOUSLY_VALIDATED | PASS | — | Counts are not sole evidence | Keep negative behavior tests |
| DB-019 | DB | Verifiers match current source | A-GOV | package scripts reference Wave 11/12 chain; recent fixes removed stale 0025 assumptions | N/A | V-MIGRATION,V-FINANCE,V-DTO,V-SETTLEMENT | migrations 0001–0026 | PREVIOUSLY_VALIDATED | PASS | — | Local gate is defined | Run complete current `check` gate |
| DB-020 | DB | Test doubles versus real D1 parity | A-GOV | remote audit inspected source only | N/A | local runtime required | production D1 behavior | LOCAL_VALIDATION_REQUIRED | NOT_VERIFIED | P2 | Trigger/transaction/runtime edge parity not proven here | Execute real local D1/Wrangler-compatible validation |

## Status Totals

| Domain | PASS | PARTIAL | FAIL | NOT_VERIFIED |
|---|---:|---:|---:|---:|
| AUTH | 10 | 4 | 1 | 0 |
| FIN | 25 | 0 | 0 | 0 |
| FILE | 16 | 1 | 0 | 0 |
| FLOW | 23 | 0 | 0 | 0 |
| API | 6 | 8 | 1 | 0 |
| DB | 19 | 0 | 0 | 1 |
| **Total** | **99** | **13** | **2** | **1** |

`GOVERNANCE_CONFLICT` is recorded as an overlay finding rather than a second status on AUTH-002: `AGENTS.md` and current governance require an independent Staff identity/session boundary, while Decision D-004 and the current resolver remain Feishu-specific. The conflict directly blocks Staff contract freeze.
