# Proposal: stage7f4-legacy-css-retirement

## Why

Stage 7F-4 has not been executed. The current web entry still loads three historical CSS
layers (`global.css`, `design-freeze.css`, and `staff-shell-v2.css`) before the current
Buyer/Seller/Staff layers. Local source inspection shows a fully shadowed duplicate visual
layer in `design-freeze.css`, dead old shell selectors, an unused Staff search parent
selector, and repeated selectors whose ownership is unclear. Existing duplicate-block and
boundary checks do not prove that these historical entry layers are retired.

This Change makes only the locally provable CSS ownership and dead-rule cleanup. It keeps
the effective cascade and current portal behavior stable, and it stops at any selector
whose consumer is dynamic or whose removal would require a product/UI redesign.

## What Changes

- Replace the three retired CSS entry imports with one explicitly named local compatibility
  layer whose contents retain only proven current consumers and their original cascade order.
- Remove the byte-for-byte equivalent, later-shadowed first visual layer from
  `design-freeze.css` before migration, then remove the retired entry file.
- Remove the unused `staff-topbar-search` subtree and retire `staff-shell-v2.css`; preserve
  current Staff search, order-evidence, reference-panel, focus, and reduced-motion rules in
  their authoritative compatibility/page layer.
- Remove only source-proven dead selector branches and exact same-context duplicate rules;
  preserve `alert-${tone}`, `status-${tone}`, `buyer-task-${item.kind}`, and other
  runtime-composed class families with explicit evidence.
- Add a static ownership guard that rejects reintroduction of the retired entry imports,
  large exact duplicate CSS blocks, and unowned cross-file duplicate selectors in the
  maintained CSS layers.
- Record selector ownership, dynamic-class exceptions, retained compatibility rules, and
  local visual/test evidence in this Change.

## Capabilities

### New Capabilities

- `stage7f4-legacy-css-ownership`: provable retirement and ownership boundaries for the
  local web CSS layers without changing portal product behavior.

### Modified Capabilities

- None. Existing frontend runtime, accessibility, routing, portal visual, asset, and
  testing specs remain authoritative; this Change only makes their CSS source ownership
  explicit.

## Impact and boundaries

- Scope is limited to `apps/web` styles/imports, static CSS guards, focused frontend tests,
  local Playwright/screenshot evidence, and this OpenSpec Change.
- No API, Contract, Domain, Migration, D1 data/schema, permission, privacy, file flow,
  cursor/envelope, Stage 8, deployment, Cloudflare, Drive, CI, or production resource is
  changed or accessed.
- Buyer remains a buyer portal with its existing three navigation destinations; Seller keeps
  its existing order communication screenshot contract and four staff permissions; Staff
  keeps its current navigation and scoped `sa-`/`sp-` presentation.
- Rollback is a normal revert of the one local commit. No reset, rebase, stash, clean,
  squash, amend, push, archive, or deployment is part of this Change.

## Acceptance stop point

Full retirement is accepted only if source/static guards, focused component tests,
typecheck/build/full test/check, strict OpenSpec validation, and local Buyer/Seller/Staff
desktop plus 390px browser evidence pass on the final worktree. If any current selector
cannot be migrated without changing effective presentation or relying on an unverified
dynamic consumer, it remains in the named compatibility layer and is listed as an
explicitly unresolved dependency; the Change must not claim that all historical rules were
deleted.
