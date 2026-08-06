# Change Proposal: Module 1 Buyer Complete Business Loop

## 1. Why

Wave14A delivered the validated React/Vite foundation, identity-separated Customer Session handling, safe API transport, Query roots, accessible primitives, and complete upload/read clients. The Buyer shell still contains only placeholders. This Change freezes a real, end-to-end Buyer business experience that consumes the existing backend and Contract facts without turning the frontend into a business authority.

## 2. Scope

The future implementation covers direct Buyer registration, login/password handoff, dashboard, public demand browsing, explicit self-pay acceptance, reservation create/list/detail/cancel, order instruction and images, date-complete order-evidence upload/submit/resubmit/withdraw, formal-order reads, review eligibility/upload/submit/resubmit/withdraw/file reads, refund reads, Buyer Me/logout, mobile refinement, runtime DTO validation, precise Query caching, unit/component/MSW/Playwright, security checks, and browser acceptance. It also includes only the two narrow authority prerequisites frozen below: end-to-end `amazon_order_date` and the dedicated order-evidence file read intent.

This planning round creates only the 24 files in this Change directory. It changes no React business source.

## 3. Non-Goals

- No Seller business page.
- No Staff business page.
- No unrelated Backend, Contract, Domain, or Migration modification.
- No API addition other than the single dedicated order-evidence file read-intent endpoint authorized for the later implementation.
- No schema migration other than future Migration 0028, which real Schema analysis requires solely for `amazon_order_date`; this planning round does not create it.
- No dashboard aggregation endpoint.
- No deployment.
- No production self-registration configuration enablement.
- No real human-verification service connection.
- No production R2 connection.
- No real Feishu connection.
- No internal-communication file workflow.
- No historical-data migration.
- No start of the next three large modules.
- No PR, Integration, main advancement, or production resource write in this round.

## 4. User Journeys

Existing Buyers use `/buyer/login`; staff sends new Buyers `/buyer/register` directly. After a matching Buyer Session, the dashboard shows a bounded prioritized preview. Buyers browse demands, explicitly accept self-pay facts, create and manage reservations, read an approved instruction and short-lived images, upload exactly one order screenshot with order number, required Amazon order date, and final JPY, resolve change requests, read confirmed order snapshots, submit and revise one-to-three review evidence files, view refund balances and payment/reversal history, inspect account facts, change password, and log out.

## 5. Routing Impact

The protected Buyer tree gains distinct dashboard, demand/detail, reservation/list/detail, order-material/list/form/detail, formal-order/list/detail, review/list/form/detail, refund/list/detail, and Me routes. The authoritative new-form routes are `/buyer/order-materials/new?reservation_id=<id>` and `/buyer/reviews/new?formal_order_id=<id>` so refresh and direct links re-resolve eligibility without Session storage or navigation-state authority. Bottom navigation remains exactly 首页、任务、订单资料、评论、我的. Root remains the exact dedicated-link notice; Buyer login does not expose registration or other identities.

## 6. API Impact

The formal baseline has exactly 38 registered Buyer-relevant endpoints: five registration/Auth, seven portal/demand/reservation, three instruction, six order evidence, two formal order, seven review, two refund, and six Buyer file HTTP endpoints. The future module target is exactly 39, adding only `POST /api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent`; no other API is inferred. All protected business requests use `identityApiRequest('buyer', ...)`.

There is no aggregate dashboard API. Dashboard preview is deliberately bounded by returned cursor pages and a strict cap on per-reservation instruction-state reads. It never claims total counts.

## 7. Contract Impact

The later narrow Contract prerequisite adds required `amazon_order_date` to initial and resubmit requests, the evidence DTO, and a formal-order snapshot field. It is strict `YYYY-MM-DD`, must be a valid Gregorian date, represents the date shown on the Amazon order page, remains date-only with no timezone conversion, is stored for every evidence version, and is locked into the formal-order snapshot. `submitted_at`, `confirmed_at`, and `confirmed_business_date` never substitute for it. Runtime schemas, read models, forms, MSW, and Playwright follow the same distinction.

The dedicated file-read prerequisite adds `file_entity_link_id`, positive `version`, and `allowed_actions` limited to `CREATE_READ_INTENT` to `BuyerOrderEvidenceFileDto`, plus the one endpoint above. Historical rows that cannot receive authoritative link/version facts remain metadata-only; the frontend never guesses version 1.

## 8. File Impact

The later Web implementation reuses `buyerOrderEvidence` for exactly one verified image and `buyerReviewEvidence` for generic uploads while limiting the review command to three verified files. A narrow trusted-provider extension changes only read-intent creation: fixed generic, instruction, review, and order-evidence adapters feed the existing Wave14A content/header/token/Object-URL lifecycle. Business pages cannot supply arbitrary API paths. Tokens remain private memory, bytes stay out of Query cache, and Object URLs are revoked. No permanent URL or object key is displayed.

## 9. Security Impact

Buyer, Seller, and Staff remain separate. Buyer/Seller continue sharing one Customer-cookie invalidation group; a real Customer 401 clears both Customer Query roots and preserves Staff, while 403/404 keeps the Session. A registration 201 is not authentication authority: it immediately enters the Customer transport invalidation group, cancels Buyer and Seller requests, clears both roots, preserves Staff, rereads Customer Session, and enters `/buyer` only after `account_type=BUYER`; mismatch logs out and clears both roots. Registration fails closed behind backend feature and human-verification controls. The client never supplies role/scope/owner authority, reveals concealed resources, logs credentials/tokens, or exposes raw diagnostics.

## 10. Financial Display Impact

JPY uses integer or decimal-string presentation according to the Contract; CNY uses decimal-string fen; exchange rate uses the returned `cny_per_jpy_e8` snapshot. The UI formats but does not replace server financial facts with floating-point calculation. PRICE_MISMATCH is a visible business warning. Refund reversals and OVERPAID remain visible.

## 11. Visual Direction

Quiet Operations continues with 月光白, brand blue primary actions and Buyer-blue support. The 390px experience is primary, 320px is minimum, and each screen has one dominant task. Status, deadline, amounts, and next action outrank decoration. No fake metric wall, gradient, heavy shadow, glass effect, English brand, or customer-facing V2 label is introduced.

## 12. Accessibility

All journeys require semantic landmarks, labels/descriptions/errors, unchecked rule confirmation, keyboard and touch operation, 44px targets, visible focus, focus restoration, status beyond color, copyable wrapping order numbers, image alternatives, safe live states, 200% reflow, 320px support, reduced motion, and request-ID recovery.

## 13. Testing

The future implementation adds unit tests for schemas/formatters/status/priority/keys, component tests for every normal and boundary state, MSW tests for all exact endpoint/request/cache/token behaviors, and production-build Playwright for complete Buyer journeys. Existing 128 files / 909 tests, Wave14A 18 files / 330 tests, 42 Playwright tests, database invariants, strict OpenSpec, build, and typecheck remain regression gates.

## 14. Rollout Boundary

Planning is frozen before implementation. The later implementation uses only local/deterministic test infrastructure and existing backend contracts. Formal Verify, optional later read-only review, Integration, main, deployment, real R2/Feishu/human verification, mainland-network testing, and production acceptance are separate controller gates.

## 15. Risks

- A dashboard assembled from partial cursor pages can appear complete; the design prohibits totals and adds 查看全部.
- Instruction state can create N+1 reads; the preview is capped and never sweeps all pages.
- Customer-cookie replacement can cross Buyer/Seller UI state; registration must invalidate both Customer roots before Session reread and must not authenticate from its response alone.
- Stale versions can overwrite user work; mutations do not auto-retry and conflicts refetch explicitly.
- File token/Object URL leaks can expose protected content; Wave14A controller-private lifecycle remains mandatory.
- Generic review upload allows ten files, but business submission allows three; the form must enforce the narrower command boundary.
- Historical order-evidence rows may lack authoritative date or readable link/version facts; they remain explicit unknown/metadata-only rather than being fabricated.
- Financial formatting can lose precision if converted to floating point; decimal strings remain source values.
- Business policy around reviews/refunds remains an acknowledged product-owner risk and is not automated or hidden.

## 16. Controller Decisions

- Registration is direct-link `/buyer/register`; root and login do not advertise it.
- Bottom navigation is exactly 首页、任务、订单资料、评论、我的.
- The recommended route map in `references/buyer-route-map.md` is frozen for implementation unless Router mechanics require a semantics-preserving refinement.
- Dashboard is a bounded next-step preview, not totals or backend authority.
- Self-pay confirmation starts unchecked and resets when demand version changes.
- Exactly one verified order screenshot and at most three verified review files enter business commands.
- Full instruction uses only readable ACTIVE state; other statuses use the state endpoint.
- `allowed_actions` and returned booleans are the only frontend action authority.
- Formal orders and refunds are read-only.
- `amazon_order_date` is mandatory for every new initial/resubmit request and every new evidence version; the formal order locks the same date as a distinct snapshot fact.
- Future Migration 0028 adds nullable checked columns to `order_evidence_versions` and `formal_orders`, preserves historical NULL, rejects NULL for new rows through recreated insert/source guards, requires the formal snapshot to match its evidence version, and adds no index.
- New order-evidence files with authoritative link/version/action facts use the dedicated read intent; records that cannot be safely backfilled remain metadata-only.
- File-read intent creation uses four fixed trusted adapters; arbitrary paths are never accepted by public FileReadController APIs.

## 17. Deferred Work

- Operational remediation, if ever authorized, for historical NULL `amazon_order_date` or missing order-evidence file link/version facts; no value is inferred or backfilled without an authoritative source.
- Any server-side dashboard aggregation or total counts.
- Seller complete business loop.
- Staff operations and internal-communication files.
- Real Feishu, human-verification provider, production R2, mainland-network, deployment, data migration, and production acceptance.
- Formal Verify, review, Integration, archive/sync, and main advancement until the implementation and controller gates authorize them.
