# Change Proposal: Wave 14A Frontend Foundation, Routing, Auth and API Client

## 1. Why

Wave 13 has supplied and validated the backend baseline required by a formal frontend: 138 registered endpoints, stable response envelopes, Customer and Staff sessions, purpose-bound file HTTP flows, and protected Buyer, Seller, and Staff route families. The current Web application is still a single static React/Vite foundation screen without routing, session orchestration, API validation, query caching, file transfer, shared UI primitives, or browser smoke coverage. Wave 14A freezes an implementable frontend foundation before any identity-specific business pages are built.

## 2. Scope

This Change plans only the implementation of application bootstrap, React Router routing, the public identity entry, three identity-specific shells, three frontend session state domains, a typed and runtime-validated `/api/*` client, TanStack Query cache policy, safe errors, an in-memory file transfer client, semantic design tokens, shared UI primitives, accessibility foundations, and unit/component/MSW/Playwright smoke tests. The future implementation is limited to frontend foundation behavior and local Fake Provider validation.

## 3. Non-Goals

- No formal Buyer demand, reservation, order, review, or refund business page.
- No formal Seller product, demand, order, review, settlement, or finance business page.
- No formal Staff review, assignment, refund, settlement, or finance business page.
- No backend or Contract modification and no new API route.
- No Migration or historical data import.
- No deployment, production resource, production R2, or real Feishu connection.
- No dark mode or theme switcher in the first version.
- No Wave 15, 16, or 17 work.
- No PR, Integration, or `main` advancement in this planning Change.

## 4. User Impact

The later implementation will give users a Chinese-language root identity entry and reliable identity-specific login/protected-route states. Buyer receives a mobile-first shell, Seller a desktop business shell, and Staff a high-density operations shell. Wave 14A does not yet expose real business workflows, so shell destinations use explicit foundation/placeholder states rather than simulated business data.

## 5. Architecture Impact

The Web app gains a provider tree, route modules, identity-separated session boundaries, TanStack Query, Zod validation, a single origin-relative API transport, semantic CSS tokens, and reusable accessible primitives. No backend architecture or database fact source changes. D1 and R2 remain authoritative through existing Worker APIs.

## 6. Contract Impact

No Contract changes are proposed. The implementation consumes the current `@ygb/contracts` compile-time shapes and adds frontend-owned Zod schemas for untrusted network payloads. The only API prefix is `/api/*`; the API success/error envelopes and `request_id` are mandatory. Buyer and Seller login use the real shared Customer Auth routes and distinguish `account_type`; Staff uses the real Staff Auth flow.

## 7. Security Impact

All requests use `credentials: include`. The frontend never reads HttpOnly cookies, stores session tokens, treats roles/permissions/scope as authority, embeds secrets, or persists sensitive Query data. Identity-specific query keys prevent cross-domain reuse, while Buyer and Seller participate in one `CUSTOMER_TRANSPORT_INVALIDATION_GROUP` because their shared Customer Cookie can be replaced or invalidated by either domain. Customer login, account-type mismatch, Customer logout, or a validated Customer 401 cancels and clears both Customer roots without changing Staff. Errors exclude stack, SQL, object keys, Provider tokens, cookies, secrets, and raw internal exceptions. File tokens and idempotency keys live only in operation-scoped memory.

## 8. Visual Direction

The displayed product name is **月光白** and the visual system is **Quiet Operations**: light, calm, trustworthy, clear, professional, low-distraction, and efficient. Brand blue is the universal primary action color. Buyer blue, Seller green, and Staff purple identify shells without splitting the product into unrelated brands. The first release is light-only and uses semantic CSS custom properties through Tailwind.

## 9. Accessibility Impact

The foundation plans semantic landmarks, full keyboard operation, visible focus, focus trapping/restoration for overlays, labels and error relationships, non-color state cues, screen-reader announcements, 200% zoom, 320px support, reduced-motion behavior, suitable targets, table semantics, and complete loading/empty/error/403/404/request-id states.

## 10. Testing Impact

Vitest remains the runner. The frontend adds jsdom, Testing Library, user-event, MSW, and a minimal Playwright smoke harness. Tests cover bootstrap, route guards, identity separation, envelopes, status/error policy, cancellation, retry, idempotency lifecycle, file state machines, keyboard/focus behavior, responsive shell landmarks, and production-build smoke. Browser business acceptance remains Wave 14E.

## 11. Dependency Impact

Planned dependencies are React Router, TanStack Query, Zod, Tailwind CSS, lucide-react, Testing Library, user-event, MSW, jsdom, and Playwright. Radix Primitives may be added only for interaction primitives that genuinely require focus/keyboard management. No large UI framework, Redux, MobX, universal store, form framework, or full i18n framework is added. Form-library evaluation is deferred to the first complex form in Wave 14B.

## 12. Rollout Boundary

Implementation proceeds as a frontend-only feature after controller freeze, using local APIs, Fake Feishu Provider, Mock Service Worker, and browser smoke fixtures. No real business workflow is declared accepted. Production R2, real Feishu, mainland-network testing, deployment, and release gates remain later waves.

## 13. Risks

- The Buyer and Seller frontend state/query namespaces consume one backend Customer Cookie; `account_type` mismatch must fail closed, both Customer roots must be invalidated on Customer transport replacement/loss, and Staff must remain unchanged.
- Runtime Zod schemas can drift from TypeScript Contracts unless contract fixtures and negative tests remain paired.
- Retry logic can duplicate mutations unless mutation retry is off by default and one logical operation owns one idempotency key.
- File uploads span network, R2, and D1; cancellation, token expiry, replay, and compensation states require an explicit state machine.
- Dense Staff layouts can regress keyboard navigation, zoom, or reading order without component and browser checks.
- Dependency growth can turn the foundation into a framework project; each dependency has a narrow accepted purpose.

## 14. Controller Decisions

- Public paths are `/`, `/buyer/**`, `/seller/**`, and `/staff/**`; login entries are separated.
- `/` shows Buyer and Seller only; Staff enters directly at `/staff/login`.
- Displayed brand is only `月光白`; English brand names and `V2` are not customer-facing.
- React Router, TanStack Query, Zod, Tailwind plus CSS variables, and lucide-react are frozen.
- Buyer/Seller/Staff remain separate frontend session and query domains; no universal Auth Context exists.
- Buyer/Seller form `CUSTOMER_TRANSPORT_INVALIDATION_GROUP`: Customer login, mismatch, logout, and Customer 401 clear both Customer roots; Staff login/logout/401 clears only Staff.
- Mutation retry is disabled by default; GET network retry is finite; 401/403/404/409/422 are not auto-retried.
- `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` remains only a historical global Purpose in Wave 14A; it has no active upload intent, Staff consume, Link, or Grant HTTP capability, and its complete workflow remains deferred to Wave 15.

## 15. Deferred Work

- Wave 14B: Buyer business pages and first complex form dependency review.
- Wave 14C: Seller business pages, tables, filters, drawers, and settlement views.
- Wave 14D: Staff queues, review actions, refunds, settlements, and finance workbench.
- Wave 14E: complete browser and business acceptance.
- Wave 15: internal Staff operations, including the deferred internal-communication file workflow.
- Wave 16: real Feishu integration.
- Wave 17: production R2, mainland network, deployment, migration/import, and production acceptance.

## CONTROLLER_FREEZE

- Planning frozen at `4200c5aa8dbb9d21a7566cfe24a228768002edca`.
- 7 Capabilities / 42 Requirements / 84 Scenarios are frozen.
- Quiet Operations, Customer shared-transport invalidation, and the real route map are frozen.
- Local Codex is the sole source writer; Backend, Contracts, and Migrations remain unchanged.
- Implementation requires local browser validation, formal OpenSpec Verify, and complete gates.
- Ponytail remains OFF pending independent authorization.

## Controller Dedicated-Link Amendment

`/` is a dedicated-link notice only. It displays 月光白 and asks users to use the correct link supplied by staff; it has no selector, login form, or identity link. A Customer mismatch must call Customer logout, clear both Customer roots, and show one neutral message without cross-identity handoff.
