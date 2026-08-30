# stage7f4-legacy-css-ownership Specification

## ADDED Requirements

### Requirement: Retired CSS entry points have one explicit compatibility boundary

The web runtime MUST NOT import `global.css`, `design-freeze.css`, or
`staff-shell-v2.css`. Any current rule retained from those files MUST live in the named
compatibility/page layer documented by the Change, with the original effective cascade
order preserved. `tokens.css` MUST remain the only shared token source.

#### Scenario: Retired imports are rejected

- **WHEN** the source ownership guard scans `apps/web/src/main.tsx` and the web styles
- **THEN** none of the three retired entry names or their import paths are present, and the
  canonical compatibility import order is present exactly once.

#### Scenario: Current compatibility consumer remains styled

- **WHEN** a current Buyer, Seller, or Staff component emits a class retained in the
  compatibility evidence manifest
- **THEN** exactly one maintained CSS ownership layer defines the relevant selector, and
  the component remains covered by the existing route/component tests.

### Requirement: CSS cleanup is conservative and duplicate-free

Maintained CSS MUST contain no exact same-context duplicate rule and no byte-identical
consecutive block of 256 lines or more. Cleanup MUST preserve selector specificity,
declaration values, media context, keyframes, reset behavior, and the final effective
visual rules unless a selector is proven dead by production-source evidence.

#### Scenario: Dynamic class family is preserved

- **WHEN** the Buyer task, alert, status, identity, or Staff risk/status class is composed
  at runtime
- **THEN** every known emitted value remains defined in a maintained stylesheet and the
  source guard documents the composition instead of classifying it as dead.

#### Scenario: Dead selector branch is removed only with proof

- **WHEN** a selector branch has no production source consumer after dynamic-family
  inspection
- **THEN** the branch may be removed, while a grouped rule's live sibling branches remain;
  test-only strings and historical documentation cannot be the sole reason to retain it.

### Requirement: Portal accessibility and visual behavior remains unchanged

The CSS migration MUST preserve the current Buyer/Seller/Staff desktop and mobile shells,
Drawer/modal overlays, forms, tables, loading/empty/error states, keyboard focus-visible
indicators, reduced-motion behavior, responsive breakpoints, local Material Symbols
Rounded outline/filled assets, and no-horizontal-overflow behavior. It MUST NOT change
product text, route/navigation structure, authorization, data fetching, or file identity.

#### Scenario: Three portal desktop and mobile review

- **WHEN** the final built app is served locally with the existing deterministic fixtures
  at desktop and 390px mobile viewports
- **THEN** Buyer, Seller, and Staff representative shell/list/form/detail states render
  without unexpected error states, the existing Drawer/modal interaction remains usable,
  and reviewed screenshots are recorded for each viewport.

#### Scenario: Focus and reduced motion remain visible

- **WHEN** a keyboard focuses a portal control or the browser requests reduced motion
- **THEN** the existing visible focus ring and reduced-motion behavior remain present in
  the computed presentation and focused tests/browser evidence.

### Requirement: The Change remains local and presentation-only

The final Change MUST contain no API, contract, domain, schema, migration, D1 data,
permission, cursor/envelope, deployment, remote CI, Cloudflare, Drive, queue, or
production-resource mutation. Production MUST remain `NO-GO`.

#### Scenario: Scope review

- **WHEN** the final diff, command log, and local status are reviewed
- **THEN** only CSS/import/guard/test/local-evidence/OpenSpec files are changed, all
  required local commands have direct exit evidence, and no remote or production write was
  attempted.
