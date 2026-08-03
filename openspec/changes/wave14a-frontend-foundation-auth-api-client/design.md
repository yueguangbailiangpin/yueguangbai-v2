# Design: Wave 14A Frontend Foundation

## 1. Current State

`apps/web` is a React 19/Vite 8 static foundation card mounted under `StrictMode`. It has hard-coded CSS, one server-rendered unit test, and no router, browser test environment, API/session/query/file layer, identity shells, or shared primitives. The default Hono app exposes 138 verified routes and safe envelopes under `/api/*`; Wave 14A consumes but does not change them.

## 2. Target Architecture

The target is one frontend application with public routes and three isolated identity domains. A small runtime layer owns configuration, transport, envelope parsing, Zod validation, normalized errors, query policy, and file state. Feature route modules consume that layer. UI primitives consume semantic tokens. No frontend layer becomes an authorization or business-fact source.

```text
Browser
  → React bootstrap / Root Error Boundary
  → React Router
  → Query Client
  → Buyer | Seller | Staff Session Boundary
  → Identity Shell
  → route component
  → identity-keyed query/mutation
  → origin-relative /api/*
```

## 3. App Bootstrap

Bootstrap validates the root element and public runtime configuration before rendering. It installs global styles/tokens, the root error boundary, router, and query integration. Configuration accepts only non-secret, origin-relative values needed by the browser; production hosts are never embedded in source. Lazy route failures and render failures end in safe branded states with recovery and request/correlation context where available.

## 4. Provider Tree

The implementation follows this logical order:

```text
StrictMode
→ Root Error Boundary
→ Router
→ Query Client
→ identity-specific Session Boundary
→ Route Shell
```

Router integration may require the Query provider to wrap or be passed into router construction, but the observable ownership stays the same: one Query Client with identity-rooted keys, separate Session boundaries, and no universal mixed-identity provider.

## 5. Router Architecture

React Router defines public `/`, three login routes, a Staff callback transition, and nested `/buyer`, `/seller`, `/staff` protected trees. Each tree owns its guard, shell, scoped errors, and not-found state. Validated relative return paths preserve destination without enabling open redirects. Search params hold serializable list/drawer context only after strict parsing.

## 6. Identity Domain Separation

Buyer, Seller, and Staff have distinct Session state types, controller hooks, route guards, query-key factories, and shell ownership. Customer Auth's shared Cookie is acknowledged explicitly: Buyer requires `account_type=BUYER`; Seller requires `SELLER_MEMBER`. Buyer and Seller therefore share a transport invalidation coordinator named `CUSTOMER_TRANSPORT_INVALIDATION_GROUP` without sharing UI state or authority. A successful Customer login first cancels and clears both Customer roots, then authenticates only the server-returned matching domain. Mismatch does not enter the opposite shell. Staff cannot consume Customer Session, Customer domains cannot consume Staff Session, and Staff state/cache is never changed by Customer invalidation.

## 7. Root Entry

`/` displays `月光白`, a brief neutral introduction, Buyer entry, and Seller entry. It does not show Staff. The page is low-density, keyboard navigable, and avoids marketing illustration or fake production status. Direct `/staff/login` remains available because concealment is not security.

## 8. Buyer Shell

The Buyer shell is mobile-first, emphasizes current stage/next action/deadline, and has one principal action per view. The fixed bottom navigation is 首页、任务、订单资料、评论、我的. It has no persistent desktop sidebar, supports 320px, and reserves content/safe-area space under the fixed navigation. Wave 14A routes show honest foundation placeholders only.

## 9. Seller Shell

The Seller shell is desktop-first and medium density: left navigation, organization/store context, page header/action, metrics, filters, table container, and right drawer region. Drawer selection is route-compatible and restores row focus, filters, pagination, and scroll. Small screens use accessible cards or an independent detail route.

## 10. Staff Shell

The Staff shell is a high-density operational workspace with queue, detail, and action panes. DOM order and landmarks match the logical queue → detail → actions workflow. Internal/customer-visible content and finance/ordinary actions use separate sections and labels. Narrow screens collapse to queue → detail → review drawer while retaining navigation state.

## 11. API Client

One low-level `fetch` transport accepts a path restricted to `/api/*`, method, body, headers, expected schema, identity domain, `AbortSignal`, and optional operation context. It always uses `credentials: include`, never accepts a production base URL or secrets, parses headers/status before payload, and returns validated data plus request metadata. Endpoint adapters own concrete paths and schemas.

## 12. Runtime DTO Validation

Zod schemas model the success/error envelope and the exact fields used by each Wave 14A endpoint. Schemas align with `@ygb/contracts` through typed fixtures and compile-time compatibility assertions where feasible. Unknown/malformed envelopes, missing request IDs, invalid money/date shapes, or DTO drift become a sanitized `CONTRACT` category error; raw payload is not displayed or persisted.

## 13. Query Key Architecture

Keys use immutable factories such as `['buyer', 'session']`, `['seller', 'session']`, and `['staff', 'session']`, followed by resource name and canonical filters/IDs. No key crosses an identity root. Query cancellation uses the provided `AbortSignal`. Customer login, account-type mismatch, Customer logout, Customer Session 401, or Buyer/Seller protected-API 401 cancels Buyer and Seller requests and removes both Customer roots. Staff logout/401 cancels and removes only Staff. Sensitive data is never persisted or hydrated from browser storage.

## 14. Error Architecture

`FrontendApiError` contains `code`, `httpStatus`, `requestId`, `safeDetails`, `retryAfter`, and `category`. Categories distinguish validation, authentication, permission, not found, conflict, rate limit, dependency, file compensation, network, cancellation, contract, and unknown-safe failure. Code-specific presenters map to Chinese user action; components never render raw internal message/details. 403/404 do not mutate Session. Request ID is consistently available in ErrorState/DependencyUnavailable.

## 15. Idempotency Lifecycle

A mutation action allocates one random key when the user begins the logical operation, captures the immutable request body, and retains both in memory through explicitly safe transport retry. Rendering does not allocate keys. New body/new action receives a new key. Terminal completion, cancel, or abandonment releases it. Mutation libraries do not auto-retry. `expected_version` is copied only from the latest validated DTO and conflict requires refresh/review.

## 16. Session State Machines

Each identity implements `UNKNOWN → LOADING → AUTHENTICATED | UNAUTHENTICATED | DEPENDENCY_ERROR`. A refresh/retry may return to LOADING. A validated Customer 401 resets both Buyer and Seller to UNAUTHENTICATED or forces fresh resolution after canceling/clearing both Customer roots; a Staff 401 resets only Staff and clears only Staff. Customer login success and account-type mismatch use the same two-root invalidation before authenticating only the matching domain or showing a safe mismatch entry. 503/network/contract failure transitions to DEPENDENCY_ERROR without claiming logout. 403/404 change no Session state. Protected content is absent until AUTHENTICATED.

## 17. Staff Auth Flow

The UI posts `return_to` to `/api/staff-auth/login/start`, validates the returned authorization URL, and navigates the browser. The backend callback verifies Provider identity and sets the HttpOnly Staff Cookie. The allowlisted frontend callback/return route fetches `/api/staff-auth/session`, removes transient callback query state from history, and enters Staff Shell. Tests use the repository Fake Provider; real Feishu integration is Wave 16.

## 18. Buyer/Seller Auth Inventory

Both login pages post the real `login_identifier` and `password` to `/api/customer-auth/login`; neither invents OAuth or a unified role picker. On success, the shared Cookie may have replaced the prior Customer identity, so both Customer roots are canceled/cleared before `CustomerHttpSession.account_type` authenticates only its matching domain. If the type does not match the requested login, neither Customer shell is entered automatically; the user receives a safe mismatch notice and the correct entry link. Password-change-required is a 403 workflow state requiring the real change-password endpoint, not logout. Buyer alone may expose the real self-registration route later within approved scope; Wave 14A plans login/session foundation, not a full registration business page.

## 19. File Transfer State Machine

```text
IDLE → CREATING_INTENT → INTENT_READY → UPLOADING
→ UPLOADED → COMPLETING → VERIFIED → CONSUMED_BY_BUSINESS
```

Cancelable/transient branches are `CANCELLED`, `EXPIRED`, `TOKEN_REPLAY`, `NETWORK_ERROR`, `VALIDATION_ERROR`, and `COMPENSATION_REQUIRED`. The client creates a route-bound intent, holds upload token in memory, sends exactly one multipart `file`, completes with current intent version, returns verified File ID/version to a business command, creates read intent, holds read token in memory, and consumes bytes. Expiry/replay restarts with a new intent. It never creates Link/Grant, handles object keys, or stores permanent URLs.

## 20. Design Token Architecture

Light-theme semantic CSS custom properties define canvas/surface/border/text/brand/identity/status, shadows, radii, spacing, typography, line height, and z-index. Tailwind maps utilities to those properties. Raw colors stay in the token definition and contrast fixtures. Identity scopes override accent variables only. Naming permits a future dark token set but no alternate theme exists in Wave 14A.

## 21. Quiet Operations Visual Rules

The product is displayed as `月光白`. Surfaces use borders and subtle tonal changes more than shadows. Universal primary actions use brand blue; identity accents remain sparse. Motion is brief and functional. Glass, neon, large gradients, default admin-template styling, solid sidebars, heavy repeated shadows, illustration-heavy marketing layout, crowded ERP presentation, English customer branding, and customer-facing `V2` are prohibited.

## 22. Responsive Strategy

Mobile-first base CSS guarantees 320px and 200% zoom. Buyer remains focused and single-column. Seller progressively collapses navigation/table/drawer. Staff changes from three panes to sequential queue/detail/action views. Fixed/sticky regions reserve space and safe-area inset. Breakpoints respond to content readability rather than named devices.

## 23. Accessibility Strategy

Semantic landmarks, headings, lists/tables, labels, described errors, live status announcements, visible focus, keyboard parity, suitable targets, and non-color status cues are mandatory. Dialog/Drawer use proven focus trap, initial focus, Escape/close semantics, background inertness, and focus restoration. Reduced-motion suppresses nonessential transitions. Image alt policy and table caption/header associations are component contracts.

## 24. Testing Pyramid

Pure unit tests cover parsers, key factories, error mapping, retry decisions, return paths, idempotency, tokens, and state reducers. jsdom component tests cover route guards, shells, forms, focus, keyboard, loading/error states, and responsive landmarks. MSW tests validate real `/api/*` requests/envelopes/status/cancellation. Playwright provides a minimal built-app smoke. Existing Node API tests remain unchanged.

## 25. Browser Smoke Strategy

Smoke runs against the production Web build with deterministic mocked/local network boundaries. It visits `/`, three login entries, one protected route per identity, direct Staff login, 320px Buyer navigation, Seller drawer focus restoration, Staff narrow fallback, 403/404/503/request-id states, and keyboard-only critical paths. It does not assert Wave 14B–D business completion or real Provider/R2 behavior.

## 26. Security Boundaries

No browser storage for secrets/session/query cache; no Cookie reads; no client authority; no cross-identity query keys; no `/api/v2`; no hard-coded production host. Return paths are same-origin/identity allowlisted. Errors are allowlisted. File and idempotency tokens are memory-only. Customer transport invalidation cancels/removes Buyer and Seller roots together; Staff invalidation remains Staff-only. Backend remains final for Session, Permission, Scope, state, version, and file access.

## 27. Dependency Decisions

React Router, TanStack Query, Zod, Tailwind/CSS variables, lucide-react, Vitest, Testing Library, user-event, MSW, jsdom, and Playwright are accepted. Radix is per-primitive only. Full UI frameworks, Redux/MobX/general stores, Axios-only duplication, browser auth persistence, form framework, and full i18n are rejected/deferred. Exact versions are selected only during implementation compatibility review.

## 28. Alternatives Rejected

- Three separate applications: duplicates foundation and weakens consistent branding/testing.
- One universal Session/Auth provider: risks identity confusion and violates frozen separation.
- Trust TypeScript without runtime schemas: network data is untrusted.
- Automatic mutation retries: unsafe under partial/lost responses.
- Persisted Query/session cache: increases private-data exposure.
- Generic file Link/Grant client: violates business-command ownership.
- Large UI/form/i18n frameworks: speculative surface without Wave 14A need.

## 29. Implementation Phases

1. Reconfirm authority/inventory and install approved dependencies.
2. Add runtime configuration, tokens, Web test environments, bootstrap, error boundary, and router.
3. Add identity Session domains, login flows, route guards, and shells.
4. Add API envelopes/errors/query keys/idempotency and endpoint adapters.
5. Add file transfer state/client and shared accessible primitives.
6. Add unit/component/MSW/Playwright smoke, security verifiers, build/typecheck/browser validation.
7. Run OpenSpec validation/Verify and later governance gates only when explicitly authorized.

## 30. Rollback Strategy

Wave 14A has no database, backend, Contract, or production resource change. Runtime rollback is a normal revert of frontend commits/dependencies/lockfile on the feature branch. The old static Web page remains the baseline reference. No schema/data rollback exists. File test objects are local/mocked and never production facts.

## 31. Acceptance Gates

- Only approved frontend/package/test/config files change during implementation; this planning branch changes only its OpenSpec Change.
- Display brand, route map, shells, tokens, components, and accessibility match frozen references.
- Three Session/query domains and Customer account-type mismatch tests pass.
- `/api/*`, credentials, envelopes, Zod, cancellation, retry, errors, idempotency, versions, and file boundaries pass unit/MSW tests.
- Vitest counts are updated honestly; full repository check, typecheck, build, Wrangler dry-run, security/migration/Wave11–13 gates remain green.
- Minimal Playwright smoke passes without claiming business acceptance.
- OpenSpec target/all strict pass; implementation Verify, Ponytail, Integration, main, deployment, real Feishu/R2, and production validation occur only in their authorized stages.

## CONTROLLER_FREEZE

- Planning frozen at `4200c5aa8dbb9d21a7566cfe24a228768002edca`: 7 Capabilities, 42 Requirements, and 84 Scenarios.
- Quiet Operations, Customer shared-transport invalidation, and the real route map are implementation constraints.
- Local Codex is the only source writer. Backend, Contracts, and Migrations are not editable in this feature.
- Browser validation, full gates, and formal OpenSpec Verify are mandatory before controller review.
- Ponytail remains OFF pending independent authorization.
