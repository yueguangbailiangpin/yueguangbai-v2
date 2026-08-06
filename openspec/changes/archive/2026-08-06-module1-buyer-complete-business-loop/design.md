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

Routes follow `references/buyer-route-map.md`. A protected `BuyerLayout` owns brand header, outlet, bottom navigation, safe route states, and bottom padding. Each list/detail/form is a separate route module. Evidence creation requires `/buyer/order-materials/new?reservation_id=<id>` and review creation requires `/buyer/reviews/new?formal_order_id=<id>`. The query identifier is mandatory, 1–120 characters, restricted to the shared safe identifier character set, and rechecked against eligibility after every load/refresh/direct link. Navigation state is non-authoritative display help only; Session storage never restores a source ID. Missing/invalid IDs go to the safe owning list or NotFound, and stale IDs never render a submit form.

## 4. Dashboard Task Aggregation

The dashboard starts independent first-page queries for evidence, review, evidence eligibility, review eligibility, refunds, demands, and a bounded reservation subset. It derives the fixed priority model in `buyer-task-priority-model.md`, de-duplicates by domain/aggregate ID, and sorts deadline groups by earliest applicable server time. Refund preview includes only returned DUE, PARTIALLY_PAID, or OVERPAID items and may order those returned items by their own `updated_at`; it never claims unread, new-message, or detected status-change semantics. PAID remains available on refund history but is not a default high-priority task. Instruction state reads are limited to a small visible reservation set. Any `next_cursor` becomes 查看全部, never a total.

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

`/buyer/register` is public but not linked from root/login. The form sends the exact registration Contract, optionally including a real verifier token. Backend feature/config/verifier/rate-limit/conflict hiding remains final. A 201 writes/replaces the HttpOnly Customer cookie but does not set client authentication. It immediately enters `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`: cancel Buyer requests, cancel Seller requests, clear Buyer root, clear Seller root, preserve Staff, then `GET /api/customer-auth/session`. Only a validated BUYER Session enters `/buyer`. A mismatched Session logs out and clears both Customer roots; cleanup or Session reread failure stays fail closed with an explicit safe retry. Password and verifier token remain operation-local and never enter Query, Storage, URLs, or logs.

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

The DTO supplies entity-specific read-intent paths for main and ordered keyword images. `BuyerInstructionImageReadIntentAdapter` accepts only Buyer identity, the current validated reservation ID, and `main` or a current positive integer position. It verifies the DTO path exactly matches `/api/buyer-portal/reservations/<current-id>/order-instruction/images/<main-or-position>/read-intent`; any other `/api` path or mismatch fails closed. The adapter constructs the call rather than forwarding an arbitrary string. Because the instruction response omits `file_object_id` and `replayed`, its normalized provider result records those assertions as unavailable rather than inventing them; `access_token_available=false` or a null token always produces RESTART_REQUIRED. The unchanged content stage validates MIME, length, no-store and nosniff, creates one Object URL, and revokes it on close/change/unmount/cancel/error. Query cache holds only the instruction handle DTO.

## 13. Order Evidence Form

Context is reloaded from the required `reservation_id` query through eligibility and instruction state. Fields are Amazon order number, required `amazon_order_date`, integer final paid JPY, one screenshot, and optional note. The date must exactly match `YYYY-MM-DD`, parse as a valid Gregorian date, and remains the Amazon-page date-only value without timezone conversion. Initial and resubmit commands both carry it; initial uses version 0 and resubmit uses the detail's current positive version. The form keeps display input separate from normalized server response.

Migration 0028 is required because baseline `order_evidence_versions` and `formal_orders` lack this fact. It adds `amazon_order_date TEXT` to both tables with `NULL OR (YYYY-MM-DD and date(value)=value)` checks so existing rows safely remain NULL. It recreates `trg_order_evidence_version_submission_guard` to reject NULL on every new version, and recreates `trg_formal_order_source_guard` to reject NULL on new orders and require equality with the selected evidence version. Existing `trg_order_evidence_versions_no_update` and `trg_formal_orders_no_update` continue to prevent history edits. No table other than those two changes and no index is added because the module does not filter or join by this field. Historical NULL is displayed as unknown and is never derived from `submitted_at`, `confirmed_at`, or `confirmed_business_date`; a new formal order cannot be confirmed from missing-date evidence until an authoritative remediation exists.

## 14. Exact Screenshot Rule

The form instantiates `buyerOrderEvidence`, whose existing workflow maximum is one image. The UI accepts one selection; Complete must return exactly one VERIFIED receipt; business body must contain exactly one ID. UI, HTTP guard, and Domain all enforce the rule independently.

## 15. Order Evidence Mutation Lifecycle

SUBMIT, RESUBMIT and WITHDRAW are rendered only from `allowed_actions`. Each button creates one operation key; mutations do not auto-retry. Same-body explicit retry is allowed only for a controller-owned ambiguous result. Success precisely invalidates eligibility, evidence list/detail, affected reservation/instruction state, and dashboard.

## 16. PRICE_MISMATCH Presentation

`price_mismatch=true` creates a warning labelled `实际支付金额与参考金额不一致` and displays the signed returned JPY difference. It does not replace the evidence status, block detail, or become a transport/system error. The frontend never calculates a replacement financial snapshot.

## 17. Formal Order Read Model

List filters map exactly to the registered query parameters and reject repeats/unknowns locally. List/detail display immutable confirmed DTO facts, the distinct `amazon_order_date` snapshot, and evidence summary. New formal orders require and lock the same date as their source evidence version. Historical nullable dates render as unknown without substitution. Snapshot JPY/CNY/rate values remain decimal strings until integer-safe formatting. There are no Buyer formal-order mutations.

## 18. Review Eligibility

Eligibility returns either no current case with SUBMIT or CHANGES_REQUESTED with RESUBMIT. Initial entry uses the required `formal_order_id` query, validates it, and rereads eligibility after refresh/direct link before displaying a form. Navigation state may prefill safe display context but never authorizes submission, and Session storage is not used. The page does not infer eligibility from a formal order alone. The review type is copied from the returned order and must match the form payload.

## 19. Review Form

Fields are formal order ID, expected version, exact review type, nullable review URL, evidence file objects/versions, and optional note. URL stays nullable rather than being inferred from review type. One-to-three files are required by the current route parser/domain contract.

## 20. Review Mutation Lifecycle

Initial version is 0; resubmit uses current positive version and full replacement payload; withdraw uses current positive version. CHANGES_REQUESTED displays public reason before edit. Success invalidates eligibility, review list/detail, dashboard, and any cross-link preview; it does not globally clear Buyer queries.

## 21. Review File Integration

`buyerReviewEvidence` can upload ten at the generic layer, but the business form selects at most three. Complete receipts provide the positive file versions used in the command. Current review detail returns each explicit-audience file link and version. `BuyerReviewFileReadIntentAdapter` validates the review ID, file-link ID, positive version, and CREATE_READ_INTENT action, then constructs the fixed specialized route from those validated entity IDs; it never forwards a DTO path. Content consumption reuses Wave14A.

## 22. Refund Read Model

List shows immutable obligation balances/times and empty actions. Detail preserves every payment and reversal activity with its balance-after. DUE, PARTIALLY_PAID, PAID, and OVERPAID are textually distinct. No transfer or edit control exists.

## 23. Money and Date Formatting

Decimal strings pass a digits-only signed/nonnegative formatter appropriate to the field, grouped without numeric coercion. JPY gets `JPY`/`日元`; CNY fen is rendered through string division/padding rather than floating point; basis points are rendered through integer string logic; rate remains an e8 snapshot. `amazon_order_date` is a Gregorian date-only string and receives no timezone conversion. Epoch-millisecond deadlines/timestamps are validated safe integers and displayed in the frozen Buyer timezone `Asia/Shanghai` with that timezone explicit. `confirmed_business_date` is the server business date and never substitutes for the Amazon order date.

## 24. Buyer Me

Me displays only the published Buyer and Session fields. REVIEW_REQUIRED shows a limitation notice. Links lead to formal orders, refunds, password change, and logout. There are no edit controls for display name, WeChat, number, marketplace, or review state.

## 25. File Upload/Read Integration

All binary content transport, response-header validation, token lifecycle, Customer 401 handling, and Object URL cleanup continue through Wave14A. A narrow `FileReadIntentProvider` boundary replaces only intent creation; public `FileReadController` does not accept a path string. Its fixed implementations are `GenericBuyerFileReadIntentAdapter`, `BuyerInstructionImageReadIntentAdapter`, `BuyerReviewFileReadIntentAdapter`, and `BuyerOrderEvidenceFileReadIntentAdapter`. Generic, review, and order-evidence adapters validate returned `file_object_id`/replay assertions where their Contracts provide them. Instruction maps missing assertions as unavailable, never fabricated. Every adapter treats absent token availability or a null token as RESTART_REQUIRED.

The future order-evidence endpoint is `POST /api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent` with positive `expected_file_version`, returning `read_intent_id`, `file_object_id`, `access_token`, `access_token_available`, `expires_at`, and `replayed`. `BuyerOrderEvidenceFileReadIntentAdapter` constructs this fixed route from validated submission/link IDs and requires DTO `file_entity_link_id`, positive `version`, and the sole file action CREATE_READ_INTENT. The server conceals submission/link scope misses as 404, verifies the link is a currently visible file of the current Buyer's submission, matches the version, and uses explicit audience or current formal file authorization. Replay never reissues a token. Content remains the existing Buyer file-read-intent bytes endpoint. New authoritative files can preview; historical/unbackfillable files remain metadata-only without a guessed version.

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

Pure/runtime tests cover schemas, key factories, priority/dedupe, date-only versus timezone formatters, status/action maps, strict adapter path validation, and form reducers. Components cover normal plus failure/boundary/accessibility states, including registration transport invalidation. MSW covers the 38 baseline endpoints plus the one authorized target endpoint, exact transport/envelope/cache/idempotency, 401/403/404, and file lifecycle. Playwright covers integrated route/user journeys, refreshed/direct new-form links, date capture, and safe historical metadata-only files. Repository gates remain the final regression layer.

## 32. Playwright Journeys

Deterministic scenarios cover registration 201 followed by dual-root invalidation and BUYER Session confirmation, registration unavailable/mismatch, login/password, mixed/partial dashboard without unread/change claims, demand/reservation/cancel, instruction strict-path image reads, evidence date/submit/mismatch/change/withdraw/dedicated file read/metadata fallback, formal-order date snapshot/filter/detail, review deep-link/submit/change/withdraw/file read/approved, refund activities/overpaid, Me/review-required/logout, cross-resource not-found, dependency, keyboard, 390/320, 200% and reduced motion.

## 33. Security Boundaries

The design preserves server-derived authority, Customer-cookie invalidation, concealed 404, permission 403, no client role/scope, no token persistence, no storage authority, no permanent URLs, no raw diagnostics, and no financial recomputation. Root/link placement is product routing, never a security claim.

## 34. Alternatives Rejected

- Any API beyond the one order-evidence file read intent: outside the two narrow authority prerequisites.
- Load all cursor pages/instruction states: unbounded latency and false completeness.
- One giant Buyer page: breaks journey, routing, focus, and mobile hierarchy.
- Second auth/cache/file framework: duplicates Wave14A and risks security drift.
- Arbitrary read-intent path injection or guessed order-evidence file version: violates scope/version-bound reads.
- Derive Amazon order date from timestamps/business date: changes a required source fact.
- Global Query invalidation after every mutation: crosses unrelated facts and increases stale races.
- Floating-point money helpers: can change financial presentation.

## 35. Implementation Phases

1. Implement only the authorized Contract/Domain/read-model prerequisites, Migration 0028, and the one order-evidence read-intent endpoint.
2. Runtime schemas, query keys, safe formatters, and four fixed read-intent adapters.
3. Buyer layout/routes, registration, Me/session actions.
4. Dashboard, demands, reservations, instruction/images.
5. Evidence upload/date/forms/list/detail/actions and dedicated file reads.
6. Formal orders, reviews/files, refunds.
7. Mobile/accessibility polish and unit/component/MSW.
8. Playwright, security verifier, full regression, strict OpenSpec and browser acceptance.

Each phase keeps the build usable. Phase 1 is restricted to the two authorized prerequisites; it cannot expand Seller/Staff business behavior, financial formulas, internal communication, or API surface.

## 36. Rollback Strategy

This planning round creates no backend fact. During later implementation, Web rollback remains route-level while Migration 0028 is forward-only: nullable historical columns remain, new-write guards stay enforced, and no destructive attempt removes captured dates. Already-submitted facts remain in D1. Any production rollout or operational remediation requires a separate controller-approved deployment gate.

## 37. Acceptance Gates

- 10 capabilities / 58 requirements / 116 scenarios / 24 files.
- Baseline facts trace to source; the two explicitly authorized target prerequisites are marked future and tested end to end.
- All Buyer requests use identity transport and Buyer-rooted keys.
- One screenshot, three review files, version/idempotency, financial and file boundaries pass static/runtime tests.
- Web typecheck/build, new unit/component/MSW, full repository tests, Wave14A Playwright and new Buyer Playwright pass.
- Planning regression remains 27 migrations / schema 27 / 117 tables / 221 triggers / 10 views. Later implementation must add Migration 0028 exactly as the date-fact prerequisite and reverify counts; this round does not create it.
- Target/all strict OpenSpec, Git scope and clean Worktree pass.
- Formal Verify, review, Integration, main and deployment remain pending until controller authorization.
