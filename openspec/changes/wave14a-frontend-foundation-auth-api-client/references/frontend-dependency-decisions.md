# Frontend Dependency Decisions

## Accepted Runtime Dependencies

| Capability | Decision | Boundary |
|---|---|---|
| Routing | React Router | Declarative public/auth/protected route trees, nested identity shells, search params, and route-level error handling. No second router. |
| Server state | TanStack Query | Network cache, cancellation, invalidation, and identity-key isolation. It is not a client authority or general application store. |
| Runtime validation | Zod | Validate envelopes and endpoint DTOs at the network boundary. `@ygb/contracts` remains compile-time authority; Zod does not create a second business contract. |
| Styling | Tailwind CSS + CSS custom properties | Utility composition consumes semantic tokens. Raw palette values are confined to token definitions and contrast tests. |
| Icons | lucide-react | Consistent icon set; icons are decorative or receive accessible names as appropriate. No icon-only meaning without text/label. |
| Accessible overlay primitives | Radix Primitives, only as needed | Dialog, Drawer, Dropdown, Popover, and Tooltip may use narrowly installed primitives for focus/keyboard behavior. No full component suite. |

## Accepted Test Dependencies

| Capability | Decision | Boundary |
|---|---|---|
| Unit/component runner | Vitest | Preserve existing repository runner; add Web-specific jsdom configuration without changing API tests from Node. |
| Component interaction | Testing Library + user-event | Test behavior, roles, names, focus, keyboard operation, and announcements instead of implementation details. |
| Network mocks | MSW | Mock the actual `/api/*` boundary and envelope/error semantics. No direct data-client mocking in integration-style component tests. |
| Browser smoke | Playwright | Minimal local production-build smoke for root, login routes, guard states, shells, keyboard/focus, 320px, and representative failures. No Wave 14B–D business acceptance. |

## State Management

Local UI state uses React component state. Small stable cross-component UI state may use narrowly scoped Context. Remote/server state uses TanStack Query. Identity-specific Session boundaries remain separate. A narrow `CUSTOMER_TRANSPORT_INVALIDATION_GROUP` coordinator may cancel/clear the Buyer and Seller query roots together when their shared Cookie is replaced or lost; it carries no combined authenticated identity, role, permission, or business data. No mixed Auth Context, Redux, MobX, generic event bus, or universal store is introduced.

Sensitive Query caches are memory-only. There is no localStorage/sessionStorage persistence of session, token, role, permission, organization authority, upload/read token, or business response cache.

## Forms

Wave 14A does not add React Hook Form or another form framework. Login/foundation forms use native controlled/uncontrolled React patterns with semantic labels and errors. The first complex Buyer business form in Wave 14B triggers a new evidence-based evaluation; Wave 14A must not build a speculative form abstraction.

## Internationalization

Visible Simplified Chinese copy is grouped by feature/route sufficiently to permit later extraction. A complete i18n framework is rejected for Wave 14A because no language switch is in scope. The app does not hard-code language decisions inside transport, DTO schemas, or routing authority.

## Rejected Dependencies and Patterns

- Ant Design, MUI, Chakra, Bootstrap, and other full UI frameworks: conflict with the frozen visual system and add broad styling/runtime surface.
- Redux, MobX, and universal stores: no state problem in this wave requires them.
- Browser-persisted auth/session libraries: cannot read or replace HttpOnly Cookie authority and risk sensitive persistence.
- Axios solely for transport: native `fetch`, `AbortSignal`, and explicit envelope parsing cover the requirement with less surface.
- A generated API client in Wave 14A: current contracts are TypeScript source rather than an OpenAPI generator input; runtime Zod adapters remain explicit and testable.
- A full form or i18n framework: deferred until real later-wave requirements justify it.
- Broad Radix installation: primitives are added individually only when interaction semantics require them.

## Version and Installation Gate

Planning freezes capabilities, not guessed package versions. Implementation must select versions compatible with React 19, TypeScript 6, Vite 8, Node 24, current browser targets, and the lockfile; install only after controller freeze. License, bundle effect, maintenance status, and transitive install scripts are reviewed before commit.
