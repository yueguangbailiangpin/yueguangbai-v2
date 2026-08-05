# Design: Module 1 Buyer Complete Business Loop

## 1. Current Buyer Frontend

The baseline Buyer tree is a real authenticated shell but every business destination is an EmptyState. Wave14A already owns Router, Query Client, Customer Session/password/logout controllers, runtime envelope validation, safe errors, semantic UI primitives, MSW lifecycle, and file upload/read controllers. Module 1 extends these foundations; it does not replace them.

## 2. Buyer Journey Map

```text
direct registration or Buyer login
  → dashboard
  → demand detail + self-pay acceptance
  → reservation
  → approved instruction + protected images
  → exactly-one order evidence
  → verified formal order snapshot
  → eligible review + one-to-three evidence files
  → approved review/refund due
  → refund balance and payment/reversal history
  → Me/password/logout
```

Every arrow is conditional on a separate returned status/action. The client does not automatically advance a business state.

## 3. Buyer Route Architecture

Routes follow `references/buyer-route-map.md`. A protected `BuyerLayout` owns brand header, outlet, bottom navigation, safe route states, and bottom padding. Each list/detail/form is a separate route module. Form routes re-resolve current eligibility on refresh and do not trust navigation state as authority.

## 4. Dashboard Task Aggregation

The dashboard starts independent first-page queries for evidence, review, evidence eligibility, review eligibility, refunds, demands, and a bounded reservation subset. It derives the fixed priority model in `buyer-task-priority-model.md`, de-duplicates by domain/aggregate ID, and sorts deadline groups by earliest applicable server time. Instruction state reads are limited to a small visible reservation set. Any `next_cursor` becomes 查看全部, never a total.

## 5. Query Key Architecture

All keys begin with `buyer`:

```text
buyer/session
buyer/me
buyer/dashboard-preview
buyer/demands/{filters}
buyer/demand/{demandId}
buyer/reservations/{filters}
buyer/reservation/{reservationId}
buyer/instruction/{reservationId}/state
buyer/instruction/{reservationId}/content
buyer/order-evidence/eligible/{filters}
buyer/order-evidence/list/{filters}
buyer/order-evidence/detail/{submissionId}
buyer/formal-orders/list/{filters}
buyer/formal-orders/detail/{formalOrderId}
buyer/reviews/eligible/{filters}
buyer/reviews/list/{filters}
buyer/reviews/detail/{reviewCaseId}
buyer/refunds/list/{filters}
buyer/refunds/detail/{refundId}
```

Key factories normalize only safe URL/filter values. No key contains password, token, note text, file bytes, Object URL, or idempotency key.

## 6. Partial Failure Model

Route-essential detail failure owns the route state. Dashboard sources and optional cross-links fail independently. Valid previous page data remains visibly distinct from fetching a later cursor. 403/404 retains Buyer shell; 401 enters the existing shared Customer invalidation; 503/network/contract errors show a safe request ID and explicit retry. One source failure never converts another source's empty result.

## 7. Registration Flow

`/buyer/register` is public but not linked from root/login. The form sends the exact registration Contract, optionally including a real verifier token. Backend feature/config/verifier/rate-limit/conflict hiding remains final. Success receives the HttpOnly cookie and contract next path, then establishes/rereads the Buyer Session cycle. Malformed response or account mismatch fails closed. Password and verifier token are never cached.

## 8. Demand List and Detail

The list uses cursor infinite/paged query without totals. Cards show every Buyer-safe fact and named units. Detail has its own query and retains the returned demand version. No ASIN, URL, keywords, Seller organization, or internal note is requested or synthesized.

## 9. Self-pay Acceptance

The detail presents reference amount, basis points, estimated self-pay, estimated refundable principal, and version in one rule panel. The real checkbox starts unchecked. The accepted tuple is `(demand_version, buyer_self_pay_bps)`; refetch with either change clears acceptance. The POST body uses only that tuple.

## 10. Reservation State Machine

```text
PENDING_REVIEW → APPROVED | REJECTED | CANCELLED | EXPIRED
APPROVED       → CANCELLED | EXPIRED (server authority)
```

The frontend renders returned history/snapshots. `can_cancel` is the only cancel affordance authority; cancellation still sends latest version and may conflict. Approved status opens the instruction-state journey but does not itself authorize evidence submit.

## 11. Order Instruction State Machine

The state endpoint is always queried before content. UNPUBLISHED, EXPIRED, CANCELLED, and COMPLETED have distinct non-action states. ACTIVE content is fetched only when readable. `evidence_status`, `can_submit_evidence`, `can_read_images`, and the applicable deadline govern presentation. Full content returning 409/410 invalidates stale state.

## 12. Instruction Image Read Flow

The DTO supplies entity-specific read-intent paths for main and ordered keyword images. Each view owns a FileReadController with a fresh operation key. The first response token is private; content fetch validates MIME, length, no-store and nosniff. The viewer creates one Object URL and revokes it on close/change/unmount/cancel/error. Query cache holds only the instruction handle DTO.

## 13. Order Evidence Form

Context is reloaded from eligibility and instruction state. Fields are Amazon order number, integer final paid JPY, one screenshot, and optional note. Initial uses version 0; resubmit uses the detail's current positive version. The form keeps display input separate from normalized server response.

## 14. Exact Screenshot Rule

The form instantiates `buyerOrderEvidence`, whose existing workflow maximum is one image. The UI accepts one selection; Complete must return exactly one VERIFIED receipt; business body must contain exactly one ID. UI, HTTP guard, and Domain all enforce the rule independently.

## 15. Order Evidence Mutation Lifecycle

SUBMIT, RESUBMIT and WITHDRAW are rendered only from `allowed_actions`. Each button creates one operation key; mutations do not auto-retry. Same-body explicit retry is allowed only for a controller-owned ambiguous result. Success precisely invalidates eligibility, evidence list/detail, affected reservation/instruction state, and dashboard.

## 16. PRICE_MISMATCH Presentation

`price_mismatch=true` creates a warning labelled `实际支付金额与参考金额不一致` and displays the signed returned JPY difference. It does not replace the evidence status, block detail, or become a transport/system error. The frontend never calculates a replacement financial snapshot.

## 17. Formal Order Read Model

List filters map exactly to the registered query parameters and reject repeats/unknowns locally. List/detail display immutable confirmed DTO facts and evidence summary. Snapshot JPY/CNY/rate values remain decimal strings until integer-safe formatting. There are no formal-order mutations.

## 18. Review Eligibility

Eligibility returns either no current case with SUBMIT or CHANGES_REQUESTED with RESUBMIT. The page does not infer eligibility from a formal order alone. The review type is copied from the returned order and must match the form payload.

## 19. Review Form

Fields are formal order ID, expected version, exact review type, nullable review URL, evidence file objects/versions, and optional note. URL stays nullable rather than being inferred from review type. One-to-three files are required by the current route parser/domain contract.

## 20. Review Mutation Lifecycle

Initial version is 0; resubmit uses current positive version and full replacement payload; withdraw uses current positive version. CHANGES_REQUESTED displays public reason before edit. Success invalidates eligibility, review list/detail, dashboard, and any cross-link preview; it does not globally clear Buyer queries.

## 21. Review File Integration

`buyerReviewEvidence` can upload ten at the generic layer, but the business form selects at most three. Complete receipts provide the positive file versions used in the command. Current review detail returns each explicit-audience file link and version. Specialized read intent binds review ID, link ID, and version; content consumption reuses Wave14A.

## 22. Refund Read Model

List shows immutable obligation balances/times and empty actions. Detail preserves every payment and reversal activity with its balance-after. DUE, PARTIALLY_PAID, PAID, and OVERPAID are textually distinct. No transfer or edit control exists.

## 23. Money and Date Formatting

Decimal strings pass a digits-only signed/nonnegative formatter appropriate to the field, grouped without numeric coercion. JPY gets `JPY`/`日元`; CNY fen is rendered through string division/padding rather than floating point; basis points are rendered through integer string logic; rate remains an e8 snapshot. Epoch milliseconds are validated safe integers and displayed in `Asia/Shanghai` with explicit deadline labels.

## 24. Buyer Me

Me displays only the published Buyer and Session fields. REVIEW_REQUIRED shows a limitation notice. Links lead to formal orders, refunds, password change, and logout. There are no edit controls for display name, WeChat, number, marketplace, or review state.

## 25. File Upload/Read Integration

All file transport continues through Wave14A clients. Business modules receive safe verified manifests, not tokens. Upload/read private states dispose on route exit. The known order-evidence DTO gap means historical screenshot files show metadata only: generic read cannot be called without an authoritative positive file version.

## 26. Idempotency

One logical mutation owns one 8–128-character generated key. Key and exact body remain in operation memory through explicit ambiguous retry, then are discarded on success, safe terminal failure, cancel, or body change. File stages and business stages have separate keys. Registration backend owns its internal operation key.

## 27. Version Conflict

VERSION_CONFLICT never performs last-write-wins. The UI captures safe non-secret draft input, refetches the current aggregate, explains the change, and requires explicit comparison/resubmission with a new valid operation. Self-pay acceptance resets when demand version changes. File version conflicts restart from the authoritative file reference.

## 28. Error Architecture

Runtime schemas validate envelopes and DTOs before cache insertion. Stable errors map to authentication, permission, not-found, conflict, validation, rate-limit, dependency, network, cancellation, and contract states. Only 401 triggers invalidation. Safe request ID is displayed; raw error details are never rendered. Mutation retry remains disabled.

## 29. Mobile Layout

At 390px, a single content column and one sticky/fixed bottom navigation drive the experience. Page content reserves bottom safe area. Amount rows wrap; order numbers use copy controls and break-safe digits; images use bounded aspect containers; action bars stack at 320px. Larger widths may use two columns for facts and media but preserve source order.

## 30. Accessibility

Semantic headings/landmarks, labeled controls, required/description/error relationships, true checkbox confirmation, focus-visible, 44px targets, keyboard order, alert/live semantics, focus return, non-color status, alt text, reduced motion, 200% reflow, and loading layout stability are acceptance requirements. Disabled controls retain explanations.

## 31. Testing Pyramid

Pure/runtime tests cover schemas, key factories, priority/dedupe, formatters, status/action maps and form reducers. Components cover normal plus failure/boundary/accessibility states. MSW covers exact transport, envelope, cache, idempotency, 401/403/404 and file lifecycle. Playwright covers integrated route/user journeys. Repository gates remain the final regression layer.

## 32. Playwright Journeys

Deterministic scenarios cover registration success/unavailable, login/password, mixed/partial dashboard, demand/reservation/cancel, instruction/read images, evidence submit/mismatch/change/withdraw, formal-order filter/detail, review submit/change/withdraw/file read/approved, refund activities/overpaid, Me/review-required/logout, cross-resource not-found, dependency, keyboard, 390/320, 200% and reduced motion.

## 33. Security Boundaries

The design preserves server-derived authority, Customer-cookie invalidation, concealed 404, permission 403, no client role/scope, no token persistence, no storage authority, no permanent URLs, no raw diagnostics, and no financial recomputation. Root/link placement is product routing, never a security claim.

## 34. Alternatives Rejected

- New dashboard API: forbidden Backend scope and unnecessary for bounded preview.
- Load all cursor pages/instruction states: unbounded latency and false completeness.
- One giant Buyer page: breaks journey, routing, focus, and mobile hierarchy.
- Second auth/cache/file framework: duplicates Wave14A and risks security drift.
- Guess order-evidence file version: violates version-bound file reads.
- Global Query invalidation after every mutation: crosses unrelated facts and increases stale races.
- Floating-point money helpers: can change financial presentation.

## 35. Implementation Phases

1. Runtime schemas, query keys, safe formatters, API adapters.
2. Buyer layout/routes, registration, Me/session actions.
3. Dashboard, demands, reservations, instruction/images.
4. Evidence upload/forms/list/detail/actions.
5. Formal orders, reviews/files, refunds.
6. Mobile/accessibility polish and unit/component/MSW.
7. Playwright, security verifier, full regression, strict OpenSpec and browser acceptance.

Each phase keeps the Web build usable; no backend phase exists.

## 36. Rollback Strategy

Before release, rollback is branch-level: remove/disable Module 1 frontend route modules while retaining Wave14A login/shell foundation. No data/schema rollback exists because this Change creates no backend facts by itself; already-submitted facts remain in D1. A production rollout would require controller-approved deployment and safe route-level rollback, not destructive data changes.

## 37. Acceptance Gates

- 10 capabilities / 58 requirements / 116 scenarios / 24 files.
- All paths, DTO fields, statuses, actions and errors trace to baseline source.
- All Buyer requests use identity transport and Buyer-rooted keys.
- One screenshot, three review files, version/idempotency, financial and file boundaries pass static/runtime tests.
- Web typecheck/build, new unit/component/MSW, full repository tests, Wave14A Playwright and new Buyer Playwright pass.
- Database remains 27 migrations / schema 27 / 117 tables / 221 triggers / 10 views, with no next migration.
- Target/all strict OpenSpec, Git scope and clean Worktree pass.
- Formal Verify, review, Integration, main and deployment remain pending until controller authorization.
