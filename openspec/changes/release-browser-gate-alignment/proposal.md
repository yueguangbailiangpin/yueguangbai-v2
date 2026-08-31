## Why

The current release browser gate has nine reproducible failures caused by
responsive setup occurring after navigation, stale assertions for retired or
renamed UI labels, an unscoped duplicate heading assertion, and fixtures that
no longer satisfy the current strict response schemas. The product pages and
their current three-portal navigation are already the accepted authority, so
the gate must be brought back into alignment before the release checks can be
trusted.

## What Changes

- Set each affected screenshot test's viewport before navigation so the test
  exercises the intended responsive DOM.
- Align the generic screenshot fixtures and assertions with the current
  Buyer, Seller, and Staff page contracts, including current Seller identity
  fields, `订单与沟通`, the Seller organization heading, and the Staff greeting.
- Scope the Stage 6.6 Staff customer heading assertion to the main content
  region so the shell title and page content title are not treated as an
  ambiguity.
- Add the nullable `wechat_id` field required by the current Seller member
  response schema to the Stage 7 visual fixture.
- Preserve the current page structure, navigation, strict assertions, visual
  evidence harness, and the environment-gated Buyer pilot behavior.

## Capabilities

This is a test-fixture, selector, and release-gate alignment change. It does
not change a runtime product requirement, API contract, permission matrix,
database fact, or visual design. The change therefore opts out of delta specs
with `skip_specs: true` in `.openspec.yaml`.

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- Browser harness files under `apps/web/e2e/` and their generated local PNG
  evidence only.
- OpenSpec release-gate documentation and task evidence.
- No migration, dependency, Worker/API, database, Cloudflare, remote, or
  production change.
