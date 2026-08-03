# Existing Web Inventory

## Baseline

- Baseline: `origin/main` at `503709a5745931e6732d32f2ed5ae6967b299faa`.
- Web workspace: `@ygb/web`, version `0.1.0`.
- Runtime: React `19.2.8`, React DOM `19.2.8`, Vite `8.1.5`, TypeScript `6.0.3` from the root workspace.
- Current production source has five Web files under `apps/web/src` plus `index.html`, package, TypeScript, and Vite configuration.

## Current Application

`main.tsx` locates `#root`, throws `root_element_missing` when absent, and mounts `App` under `StrictMode`. `App.tsx` is a single static foundation card. There is no router, provider hierarchy beyond StrictMode, Error Boundary, API client, Session state, query cache, file client, identity shell, reusable component library, or code-split route.

The existing customer-visible copy contains `YUEGUANGBAI V2`, `月光白 V2`, `Phase 1A`, and foundation status text. Those strings are baseline inventory only; Wave 14A implementation must replace customer-facing English branding and `V2` with `月光白`.

## Current Styling

`styles.css` contains global CSS with a minimum body width of 320px, system Chinese-capable font stack, a centered hero card, hard-coded colors, one large shadow, and no semantic token layer. There is no Tailwind configuration, responsive identity layout, reduced-motion rule, focus system, status-token system, or theme architecture.

## Current Tests

`App.test.tsx` uses `renderToStaticMarkup` in the repository-wide Node Vitest environment. It checks the current placeholder copy and absence of a production-connection claim. There is no jsdom, Testing Library, user-event, MSW, Playwright, accessibility interaction coverage, or Web-specific Vitest project/configuration.

## Current Configuration and Dependency Gaps

- `apps/web/package.json` has React/React DOM and Vite React plugin only.
- `apps/web/tsconfig.json` inherits strict root rules and includes `vite/client`.
- `apps/web/vite.config.ts` builds ES2023 with source maps and has no dev API proxy or test block.
- Root Vitest uses `environment: node` for all tests.
- No React Router, TanStack Query, Zod, Tailwind, lucide-react, Radix, Testing Library, user-event, MSW, jsdom, or Playwright is installed.
- `packages/ui` exists as a workspace package but currently has no planned Wave 14A source ownership; the controller scope freezes implementation decisions to later work and forbids modifying it during planning.

## Planning Consequence

Wave 14A must evolve the existing Vite app rather than create a second frontend. It must preserve strict TypeScript/build behavior, introduce browser-focused test configuration without changing backend test semantics, replace scattered color values with semantic tokens, and keep all business pages out of this foundation wave.
