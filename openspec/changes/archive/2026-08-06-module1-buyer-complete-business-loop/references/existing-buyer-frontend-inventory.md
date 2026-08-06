# Existing Buyer Frontend Inventory

## Baseline

- Source baseline: `f8b160d8fd5f2c16509ca8ffddcd7a60c754135c`.
- `apps/web` contains 79 files: 72 under `src`, 20 test/spec files in the Web tree, two Playwright specs, and five Web root/config files.
- The stack is React 19, React Router 7, TanStack Query 5, Zod 4, Tailwind 4, lucide-react, Testing Library, MSW, Vitest, and Playwright.
- Wave14A baseline is 18 Web test files / 330 tests and 42 Playwright tests.

## Existing Buyer routes

| Route | Current implementation |
|---|---|
| `/` | Exact two-string dedicated-link notice; no identity links. |
| `/buyer/login` | Real shared Customer Auth login, target BUYER. |
| `/buyer/change-password` | Real Customer password-change route and boundary. |
| `/buyer` | Protected BuyerShell with empty placeholder. |
| `/buyer/tasks` | Protected BuyerShell with empty placeholder. |
| `/buyer/order-materials` | Protected BuyerShell with empty placeholder. |
| `/buyer/reviews` | Protected BuyerShell with empty placeholder. |
| `/buyer/me` | Protected BuyerShell with empty placeholder. |
| `/buyer/*` unknown | Buyer in-tree NotFound. |

There is no `/buyer/register`, no real Buyer business API adapter/schema, no demand/reservation/instruction/evidence/formal-order/review/refund page, and no dashboard aggregation implementation.

## Existing shell and visual foundation

- Buyer bottom navigation is already exactly 首页、任务、订单资料、评论、我的.
- Buyer uses the blue identity accent and fixed mobile bottom navigation.
- Root branding is already only 月光白.
- The semantic token system implements Quiet Operations: light canvas, low shadow, no gradients/glass/dark mode, brand blue actions, visible focus, 44px controls, state colors, reduced-motion handling, and responsive rules.
- Shared primitives include buttons, fields, checkbox, card, page header, bottom navigation, status badge, alerts, loading/skeleton, empty/error/permission/not-found states, request ID, progress, dialog, drawer, table, and accessible focus management.

## Existing API/session foundation

- `identityApiRequest(identity, client, request)` wraps the validated transport and performs identity-aware 401 invalidation.
- Query roots are `['buyer']`, `['seller']`, and `['staff']`; Buyer/Seller share Customer transport invalidation because one HttpOnly Customer cookie can represent only one Customer account at a time.
- Query defaults: stale time 0, garbage collection five minutes, finite retry only for approved GET network failures, mutation retry false.
- Customer login/password/logout/session controllers already fail closed on account-type mismatch, keep Staff cache separate, and avoid cross-identity navigation.
- Success/error envelopes and safe `request_id` projection are runtime validated.

## Existing file foundation

- `buyerOrderEvidence` is fixed to ORDER_EVIDENCE / BUYER_VISIBLE, image MIME only, one file, 20 MiB.
- `buyerReviewEvidence` is fixed to REVIEW_EVIDENCE / SELLER_VISIBLE, image or PDF, up to ten generic-upload files, 20 MiB each; this module must impose the separate three-file business-command limit.
- Upload uses intent → one-file multipart PUT → complete/VERIFIED, with private tokens and explicit retry state.
- Read uses short intent → bounded content fetch, private token, maximum 25 MiB, exact Content-Length, no-store/nosniff, in-memory bytes, Object URL create/revoke.
- File bytes are never stored in Query cache.

## Reuse decision

The later implementation extends the existing Router, Customer boundaries, Query client, primitives, tokens, upload/read controllers, MSW lifecycle, and Playwright harness. It does not introduce a second auth system, global state store, file client, UI framework, or business backend.
