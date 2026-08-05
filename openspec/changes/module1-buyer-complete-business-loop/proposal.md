# Change Proposal: Module 1 Buyer Complete Business Loop

## 1. Why

Wave14A delivered the validated React/Vite foundation, identity-separated Customer Session handling, safe API transport, Query roots, accessible primitives, and complete upload/read clients. The Buyer shell still contains only placeholders. This Change freezes a real, end-to-end Buyer business experience that consumes the existing backend and Contract facts without turning the frontend into a business authority.

## 2. Scope

The future implementation covers direct Buyer registration, login/password handoff, dashboard, public demand browsing, explicit self-pay acceptance, reservation create/list/detail/cancel, order instruction and images, order-evidence upload/submit/resubmit/withdraw, formal-order reads, review eligibility/upload/submit/resubmit/withdraw/file reads, refund reads, Buyer Me/logout, mobile refinement, runtime DTO validation, precise Query caching, unit/component/MSW/Playwright, security checks, and browser acceptance.

This planning round creates only the 24 files in this Change directory. It changes no React business source.

## 3. Non-Goals

- No Seller business page.
- No Staff business page.
- No Backend modification.
- No Contract modification.
- No Domain modification.
- No Migration and no new schema version.
- No new API or dashboard aggregation endpoint.
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

Existing Buyers use `/buyer/login`; staff sends new Buyers `/buyer/register` directly. After a matching Buyer Session, the dashboard shows a bounded prioritized preview. Buyers browse demands, explicitly accept self-pay facts, create and manage reservations, read an approved instruction and short-lived images, upload exactly one order screenshot with order number and final JPY, resolve change requests, read confirmed order snapshots, submit and revise one-to-three review evidence files, view refund balances and payment/reversal history, inspect account facts, change password, and log out.

## 5. Routing Impact

The protected Buyer tree gains distinct dashboard, demand/detail, reservation/list/detail, order-material/list/form/detail, formal-order/list/detail, review/list/form/detail, refund/list/detail, and Me routes. Bottom navigation remains exactly 首页、任务、订单资料、评论、我的. Root remains the exact dedicated-link notice; Buyer login does not expose registration or other identities.

## 6. API Impact

No endpoint changes. The module consumes 38 registered Buyer-relevant endpoints: five registration/Auth, seven portal/demand/reservation, three instruction, six order evidence, two formal order, seven review, two refund, and six Buyer file HTTP endpoints. All protected business requests use `identityApiRequest('buyer', ...)`.

There is no aggregate dashboard API. Dashboard preview is deliberately bounded by returned cursor pages and a strict cap on per-reservation instruction-state reads. It never claims total counts.

## 7. Contract Impact

No Contract change. Frontend-owned Zod schemas mirror only published DTOs, enums, action arrays, decimal-string fields, cursor pages, and envelopes. `allowed_actions`, `can_cancel`, instruction state booleans, versions, deadlines, and snapshots remain authoritative.

One gap is recorded: order-evidence file DTOs do not expose the positive file version required by generic read intent. Historical screenshot metadata can be shown, but a reopen preview cannot be implemented safely without later controller-approved Contract/backend work.

## 8. File Impact

The later Web implementation reuses `buyerOrderEvidence` for exactly one verified image and `buyerReviewEvidence` for generic uploads while limiting the review command to three verified files. Instruction and review reads use entity-specific short read intents. Tokens remain private memory, bytes stay out of Query cache, and Object URLs are revoked. No permanent URL or object key is displayed.

## 9. Security Impact

Buyer, Seller, and Staff remain separate. Buyer/Seller continue sharing one Customer-cookie invalidation group; a real Customer 401 clears both Customer Query roots and preserves Staff, while 403/404 keeps the Session. Registration fails closed behind backend feature and human-verification controls. The client never supplies role/scope/owner authority, reveals concealed resources, logs credentials/tokens, or exposes raw diagnostics.

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
- Customer-cookie replacement can cross Buyer/Seller UI state; existing shared invalidation must remain intact.
- Stale versions can overwrite user work; mutations do not auto-retry and conflicts refetch explicitly.
- File token/Object URL leaks can expose protected content; Wave14A controller-private lifecycle remains mandatory.
- Generic review upload allows ten files, but business submission allows three; the form must enforce the narrower command boundary.
- Order-evidence historical preview lacks a file version; guessing would violate the file Contract.
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
- Historical order-evidence preview remains metadata-only under the current Contract; full preview requires later controller disposition.

## 17. Deferred Work

- Contract/backend decision for historical order-evidence file version/readability.
- Any server-side dashboard aggregation or total counts.
- Seller complete business loop.
- Staff operations and internal-communication files.
- Real Feishu, human-verification provider, production R2, mainland-network, deployment, data migration, and production acceptance.
- Formal Verify, review, Integration, archive/sync, and main advancement until the implementation and controller gates authorize them.
