# Frontend Route Map

## Routing Principles

- One origin, path-isolated identity areas: `/buyer/**`, `/seller/**`, `/staff/**`.
- React Router is the only router.
- Public and auth routes never render protected business data while Session is `UNKNOWN` or `LOADING`.
- A protected route belongs to exactly one identity domain and cannot consume another domain's Session or query key.
- Wave 14A creates route structure, shells, guard states, and foundation placeholders only; business destinations remain later-wave ownership.

## Public Routes

| Path | Access | Wave 14A behavior |
|---|---|---|
| `/` | Public | Compact `月光白` identity entry with Buyer and Seller links only. No Staff entry. |
| `*` | Public | Branded `NotFound`, preserving a safe way back to `/`. |

Hiding Staff from `/` is navigation design, not authorization. `/staff/login` remains directly reachable and backend Session/Permission is authoritative.

## Buyer Routes

| Path | Access | Guard/shell behavior |
|---|---|---|
| `/buyer/login` | Public/auth-aware | Customer credential login; accepts only resulting `account_type=BUYER`; authenticated Buyer continues to `/buyer`. |
| `/buyer` | Buyer protected | Buyer shell home foundation placeholder. |
| `/buyer/tasks` | Buyer protected | Task destination placeholder reserved for Wave 14B. |
| `/buyer/order-materials` | Buyer protected | Order-material destination placeholder reserved for Wave 14B. |
| `/buyer/reviews` | Buyer protected | Review destination placeholder reserved for Wave 14B. |
| `/buyer/me` | Buyer protected | Account destination foundation state; business profile work remains Wave 14B. |
| `/buyer/*` | Buyer domain | Buyer-scoped `NotFound`; does not fall into Seller or Staff. |

Buyer bottom navigation is fixed, in order: **首页、任务、订单资料、评论、我的**. At 320px it remains keyboard-operable, does not obscure content, and reserves safe bottom padding. There is no persistent desktop sidebar.

## Seller Routes

| Path | Access | Guard/shell behavior |
|---|---|---|
| `/seller/login` | Public/auth-aware | Customer credential login; accepts only `account_type=SELLER_MEMBER`; authenticated Seller continues to `/seller`. |
| `/seller` | Seller protected | Seller shell overview foundation placeholder. |
| `/seller/products` | Seller protected | Later Wave 14C destination. |
| `/seller/demands` | Seller protected | Later Wave 14C destination. |
| `/seller/orders` | Seller protected | Later Wave 14C destination. |
| `/seller/reviews` | Seller protected | Later Wave 14C destination. |
| `/seller/settlements` | Seller protected | Later Wave 14C destination. |
| `/seller/settings` | Seller protected | Later Wave 14C destination. |
| `/seller/*` | Seller domain | Seller-scoped `NotFound`. |

The Seller shell uses a left navigation, top organization/store context area, page title/action region, metric/filter/table structure, and a route-compatible right detail drawer. Drawer open/close must retain filters, pagination, and scroll. Small screens use an accessible card or independent detail route fallback.

## Staff Routes

| Path | Access | Guard/shell behavior |
|---|---|---|
| `/staff/login` | Public/auth-aware | Starts the real `POST /api/staff-auth/login/start` redirect flow; local tests use Fake Provider. |
| `/staff/auth/callback` | Public transition | Safe allowlisted return landing while backend callback establishes the Cookie; refreshes Staff Session and removes transient callback query data from browser history. |
| `/staff` | Staff protected | Staff three-pane foundation placeholder. |
| `/staff/queue` | Staff protected | Later Wave 14D queue destination. |
| `/staff/work/:workItemId` | Staff protected | Later Wave 14D detail destination; ID is never authority. |
| `/staff/*` | Staff domain | Staff-scoped `NotFound`. |

The Staff shell is left queue + center detail + right review actions at wide widths. Internal notes and customer-visible content, and financial actions and ordinary review actions, are visually and semantically separated. Small screens degrade to queue → detail → review drawer while preserving focus and history.

## Session Guard Matrix

| Session state | Protected route result |
|---|---|
| `UNKNOWN` | Begin resolution; render no protected data. |
| `LOADING` | Identity-scoped loading/skeleton with accessible status. |
| `AUTHENTICATED` | Render the matching identity shell. |
| `UNAUTHENTICATED` | Navigate to that identity's login with an allowlisted relative return path. |
| `DEPENDENCY_ERROR` | Render retryable `DependencyUnavailable`; do not mislabel as logged out. |

403 renders `PermissionDenied` inside the matching shell and does not log out. 404 renders `NotFound` and does not log out. 401 invalidates only the matching frontend Session domain. Customer `account_type` mismatch is treated as unauthenticated for the requested domain without borrowing authority from the other domain.

## Route State Preservation

Filters, cursor/page state, selected row, and drawer identity use route search params or identity-local navigation state with strict parsing. Unsafe absolute or cross-identity return paths are rejected. Closing a Seller drawer or completing one Staff queue action returns to the same validated list/search state and restores focus to the invoking row/control.

## Language Boundary

The first release is Simplified Chinese. Route IDs and copy catalogs are structured so visible text is not scattered through data clients, but Wave 14A does not add a full i18n framework or language switcher.
