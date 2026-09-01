# Design: stage7f-visual-evidence-fixture-repair

## Context

The fixed checkout is the authoritative source for this handoff. Existing Stage 7F browser files were written against earlier component contracts: a hidden drawer copy was selected with `.first()`, role labels no longer matched the Staff navigation table, the dashboard fixture used retired funnel data, image evidence lacked the controlled Staff read-intent chain, and settlement fixtures did not satisfy the current strict pagination/read contracts. Review seller/member pages also need the current access-management read shapes, and the Seller home member schema must accept the `wechat_id` field already returned by the backend member endpoint.

## Goals

- Make the existing deterministic browser fixtures parse against the current strict schemas without changing production contracts.
- Make waits target visible semantic headings, tables, and navigation metadata rather than hidden duplicate text or implementation-only selectors.
- Capture and review exactly 17 Staff evidence views and four `/review` recovery views.
- Keep normal-state assertions strict: visible key data, no loading/error/unavailable/MALFORMED state, decoded images where present, no horizontal overflow, and no retired placeholder navigation.

## Non-Goals

- No change to production endpoint behavior, authorization, data exposure, financial calculation, pagination semantics, or database state.
- No replacement of the real React pages with fixture-only markup.
- No broad CSS primitive change. The only style adjustment is the existing Dashboard-specific 44px control acceptance.

## Proposed Design

### 1. Fixture alignment

Use the current source schemas as the authority. The Staff visual fixture supplies current Dashboard summary fields, order-evidence preflight fields, controlled Staff file read-intent/content responses, and current role permissions. The contacts and settlement fixtures use exact endpoint matching and current strict page wrappers. Review demo data adds only the three access-management GET responses required by `StaffAccountsWorkspace`. The Seller home read schema is aligned to the existing backend member DTO by adding its nullable `wechat_id` field; no endpoint or response is changed.

### 2. Evidence browser spec

The dedicated evidence spec runs against the built local Review runtime and captures one named PNG for each frozen evidence item. It uses the current production routes and real page components. Each capture is preceded by semantic readiness assertions, forbidden-state checks, image decode checks, and a document-width check. The mobile drawer views explicitly open the real navigation/filter drawer before capture.

### 3. Evidence accounting

The 17 Staff files cover workbench, order list/detail responsive states, buyer/seller customers, product and reservation surfaces, buyer refunds, finance responsive states, and service-channel settings. Dashboard, access-management, settlement, and the remaining service-channel normal-state checks are also exercised by the existing focused suites; their screenshots are retained as supplemental evidence where those suites already own the flow. The four recovery files cover `/review`, `/review/buyer`, `/review/seller`, and `/review/staff`.

### 4. Boundaries

All evidence is local deterministic demo data. No production/staging/remote acceptance is inferred. The parent Stage 7F evidence/task and handoff are updated only after the final 21-file manifest is present and individually inspected.

## Risks / Trade-offs

- The screenshot harness intentionally asserts current user-visible semantics, so future copy or information-architecture changes must update evidence names and acceptance deliberately.
- Demo fixtures remain isolated to browser/review verification and are not substitutes for staging or production data checks.
