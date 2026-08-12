# Formal Verify: staff-evidence-legacy-cleanup

Verified on 2026-08-12 Asia/Shanghai against the active proposal, design, tasks, delta specification, current Staff specification, D-024/D-025/D-034/D-037, implementation, tests and verifiers. Ponytail remained off. The controller authorization in this task permits semantic sync and archive after this Verify; no production, Migration, remote Git or deployment operation was performed.

## Scorecard

| Dimension | Result |
| --- | --- |
| Completeness | PASS for implementation and evidence: 15/15 implementation tasks complete; the two remaining checklist items are this controller-ordered Verify/sync/archive and post-archive final-check sequence. |
| Correctness | PASS: 1/1 added requirement and 6/6 scenarios map to implementation, retained backend boundaries and executable evidence. |
| Coherence | PASS: proposal, design, delta, D-037 and retained D-024/D-025/D-034 history agree on an equivalent frontend takeover without backend/domain change. |
| Findings | 0 critical, 0 warnings, 1 non-blocking suggestion. |

## Requirement and scenario evidence

| Requirement or scenario | Implementation and retained authority | Verification evidence | Result |
| --- | --- | --- | --- |
| Sole canonical ownership | `apps/web/src/staff/FrozenStaffWorkbench.tsx:47-54` mounts the extracted component from the Frozen work-item fallback. `apps/web/src/staff/SellerSettlementPanel.tsx:32-136` is the only runtime implementation; the two legacy files are deleted. | `scripts/verify-staff-canonical-workbench.mjs:5-65` checks route/composition/component/test/browser ownership and zero legacy files. The verifier passed with `seller_settlement_implementations: 1`. | PASS |
| Authorized view and protected proof | `SellerSettlementPanel.tsx:21-29` requires `owner`/`seller_ops` plus effective `SELLER_SETTLEMENT_VIEW`; `:40-57` disables all three reads otherwise; `:88` uses `StaffProtectedFileButton`. | `SellerSettlementPanel.roles.test.tsx:20-60` covers five roles, missing view permission, view-only and fully permitted Owner. `SellerSettlementPanel.msw.test.tsx:21-32` proves principal/fee separation and protected-proof UI. | PASS |
| Wrong role or permission does not probe | `FrozenStaffWorkbench.tsx:47-54` never mounts the panel unless the view capability is true; component queries also use `enabled` as defense in depth. | `SellerSettlementPanel.roles.test.tsx:30-46` proves zero settlement requests and zero controls for acquisition, pre_sales, buyer_refund and seller_ops without view permission. | PASS |
| Record, allocation and correction mirror | `SellerSettlementPanel.tsx:21-29` separates view, record and reverse capabilities. `:90-110` preserves allocation/reversal versions and bodies; `:115-127` preserves verified-proof record body and exact mutation recovery. | `SellerSettlementPanel.msw.test.tsx:35-59` proves allocation body, payment version, idempotency key and three-read refresh. Role tests prove record and reversal control visibility. Existing backend Seller Settlement command/security suites remain unchanged. | PASS |
| Failure stays closed | `SellerSettlementPanel.tsx:58-72` uses one `StaffMutationAuthority`; `:78-86` keeps the three reads independent; `shared/StaffPanelError.tsx:4-20` provides concealed/generic Chinese recovery and request ID. | `SellerSettlementPanel.msw.test.tsx:61-76` proves a 409 remains visible with request ID and no optimistic success. `FrozenStaffWorkbench.msw.test.tsx:33-46` proves concealed detail failure leaves the queue usable. | PASS |
| Legacy evidence migration | Package targets point to the Frozen, settlement-behavior and role tests. The scheduling verifier now points to `FrozenStaffWorkbench` and behavior evidence instead of DTO-shaped legacy source markers. Existing Foundation browser evidence covers canonical route chunking and queue/detail/action responsive order. | Targeted evidence passed: 3 settlement tests, 6 role tests, 5 Frozen tests. Staff role module tests passed 67/67. Both canonical and scheduling verifiers passed. Web typecheck and production build passed. | PASS |
| No domain/backend/Migration redesign | The diff contains no file under `apps/api`, `packages` or `migrations`. Existing authorization still grants settlement only to owner/seller_ops defaults and removes Personal DENY; Seller Settlement routes still reauthorize permission and organization scope. The canonical chooser at `SellerSettlementPanel.tsx:115` matches backend `record-payment.ts:293-315` JPEG/PNG/WebP validation. | Migration verification and guards passed through schema 65. D-037 at `docs/decisions/V2_DECISION_REGISTER.md:296-304` records only the verified frontend/evidence successor boundary. | PASS |

## Coherence review

- The legacy behavior inventory matches the extracted query paths, request bodies, loading/error/empty behavior, conservative whole-payment reversal condition, exact ambiguous retry and three-read refresh.
- The two deliberate deviations are correctly classified as pre-existing UI contract bugs: role-blind mounting and a PDF chooser rejected by the existing payment command.
- Client gating does not replace authorization. Backend ACTIVE status, effective permission/Personal DENY, Marketplace/Seller Organization scope, concealed not-found, proof audience, version, transaction, audit and outbox code are unchanged.
- `AcquisitionWorkbench`, `AdminBusinessDashboard`, Buyer and Seller runtime files are outside the diff. Shared CSS remains because repository search found active canonical consumers.
- Target and repository-wide strict OpenSpec validation passed before this Verify.

## Validation note

The first targeted settlement run exposed only premature test assertions before asynchronous reads completed; the synchronization points were corrected and the diagnosed gate passed 3/3. The Staff module command later stopped after 67/67 tests at one MSW test-only TypeScript return annotation; the annotation was corrected, the failed Web typecheck passed, and the not-yet-run Web build passed. The parent module command was deliberately not repeated because its already-passed DB, migration, verifier and test stages would be duplicated. The controller-ordered final `npm run check` remains the post-archive repository gate.

## Findings

### CRITICAL

- None.

### WARNING

- None.

### SUGGESTION

- Add a future route-level Playwright fixture with a selected Seller Organization work item to exercise the settlement-specific three-column content at desktop and narrow widths. Existing Foundation browser tests prove the canonical Staff shell/order/chunking, while current MSW tests prove settlement behavior and role boundaries; this would add visual journey coverage without changing the takeover contract.

## Assessment

All blocking implementation findings are resolved. Under the task's explicit controller authorization, the Change is eligible for semantic spec sync and archive. This Formal Verify is not independent review approval; the user-requested independent review remains the next external gate after the final repository check.
