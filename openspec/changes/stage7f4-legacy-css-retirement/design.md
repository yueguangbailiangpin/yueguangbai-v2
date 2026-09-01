# Design: stage7f4-legacy-css-retirement

## 1. Current evidence and ownership model

The baseline is the local working tree at `feature/staging-workflow-rate-ux` /
`a364623ff111974286d1b71ebda92e3d37eb84f4`, verified before mutation. The current static
entry order is:

`tokens.css → global.css → design-freeze.css → staff-shell-v2.css → buyer-portal.css →
seller-portal.css → base.css → primitives.css → staff-shell.css → staff-pages.css →
staff-icons.css`.

The target order keeps `tokens.css` first, replaces the three retired entries with one
`portal-compat.css` in their original position, then keeps the current portal and Staff
authoritative layers in their existing order. `tokens.css` remains the only shared design
token source. `buyer-portal.css`, `seller-portal.css`, `base.css`, `primitives.css`,
`staff-shell.css`, `staff-pages.css`, and `staff-icons.css` are not redesigned.

`portal-compat.css` is a bounded migration layer, not a new visual system. Its retained
rules are copied in the original `global.css → design-freeze.css → staff-shell-v2.css`
order so equal-specificity cascade behavior is preserved. It may contain an old class only
when a current production component still emits it and no equivalent authoritative rule
exists. The evidence table records each retained family and its consumer.

## 2. Duplicate and dead-rule proof

- Parse CSS with a syntax-aware parser and include media/keyframe ancestor context when
  comparing rules.
- Remove the first `design-freeze.css` visual layer only after confirming every selector
  and declaration body in lines 1–574 has the same later-context counterpart; the local
  baseline comparison found 180 first-layer selectors and no missing or different later
  selector body.
- Remove exact same-context duplicate rules from the migrated compatibility content while
  retaining the last occurrence in the effective cascade. This preserves late responsive
  or state overrides when the duplicate declaration body is identical. Do not treat a
  selector with a different media context, specificity, or declaration body as a duplicate.
- A selector is dead only when its production source consumer set is empty after checking
  JSX/TSX literal classes, `classes(...)` composition, route/fixture source, and known
  dynamic families. Test-only text and historical Markdown do not keep a runtime selector
  alive.
- For comma-separated selectors, remove only a dead selector branch and retain a branch
  that has a production consumer. Never remove a whole grouped rule because one branch is
  unreferenced.

## 3. Dynamic and safety exceptions

The guard must explicitly preserve these runtime-composed families and their known values:

- `identity-${target}` → `identity-buyer`, `identity-seller`;
- `alert-${tone}` → `alert-info`, `alert-success`, `alert-warning`, `alert-danger`;
- `toast-${tone}` → `toast-info`, `toast-success`, `toast-danger`;
- `status-${tone}` → neutral, processing, success, warning, danger, expired, conflict;
- `buyer-task-${item.kind}` → `buyer-task-urgent`, `buyer-task-action`,
  `buyer-task-system`;
- current `sa-*`/`sp-*` variants composed from Staff risk/status values and the existing
  Buyer/Seller `mwb-*`/`mws-*` visual variants.

The source guard also checks that local Material Symbols Rounded SVG assets and the
outline/filled adapter remain unchanged, no Lucide import returns, no retired Staff
navigation/class entry returns, and no inline style or external call is introduced.

## 4. File actions

| Existing file | Action | Evidence boundary |
| --- | --- | --- |
| `global.css` | Retire as an entry; migrate current shared/portal compatibility rules to `portal-compat.css`; omit dead selector branches and exact same-context duplicates | Generic primitives/auth and current Buyer/Seller/Staff compatibility consumers remain covered; no current page is redesigned |
| `design-freeze.css` | Retire as an entry; migrate only current rules after removing the proven shadowed duplicate layer and dead old shell branches | Dynamic Buyer task variants and current Staff finance/order/refund/search/reference consumers remain explicitly listed |
| `staff-shell-v2.css` | Delete; migrate current order-reference rules to Staff page ownership and retain no `.staff-topbar-search` subtree | Current search is owned by `.sa-topbar__search`; no runtime source emits `.staff-topbar-search` |
| `portal-compat.css` | Retained temporarily as a named compatibility boundary | No new consumer may be added without changing the evidence manifest and guard |

The migration must not modify React route logic, component props, DTOs, permissions,
business text, product navigation, screenshot entry behavior, or data fetching.

## 5. Accessibility, responsive, and visual preservation

Retain reset/base behavior, local font/material icon handling, semantic focus-visible
rings, overlay/drawer/modal geometry, tables/forms/loading/empty/error states, responsive
breakpoints, reduced-motion rules, and the existing token values. The final local browser
review covers Buyer/Seller/Staff desktop and 390px mobile, shell, representative list/form/
detail states, drawer/modal, loading/empty/error, keyboard focus, reduced motion, and
horizontal-overflow checks. Authentication or fixture gaps are reported as gaps and cannot
be substituted with static source inspection.

## 6. Rejected alternatives

- Deleting all three files without a consumer inventory is rejected because current Buyer,
  Seller, Staff compatibility classes and dynamic class families still have consumers.
- Rewriting selectors or introducing a new palette/spacing/font/UI framework is rejected
  because it changes the frozen visual contract and expands scope.
- A broad search/replace or unscoped global renaming is rejected because it can hide
  specificity changes and make visual equivalence unprovable.
- Remote, staging, Cloudflare, Drive, CI, and production checks are rejected because this
  task is local-only; their state cannot be inferred from local CSS tests.
