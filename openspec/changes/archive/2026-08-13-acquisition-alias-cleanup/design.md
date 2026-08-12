## Context

See `proposal.md` for motivation. The live Staff route already renders the
canonical chain `StaffRouteModule → AcquisitionCoreWorkbench →
AcquisitionCoreWorkbenchV4`; the retired alias is not a route dependency.
The current Acquisition API, contract and source-authority behavior are owned
by the D-035-aligned route/domain tests and `staff-acquisition-funnel` spec.

## Goals / Non-Goals

**Goals:**

- Keep one frontend evidence owner for Acquisition: the canonical V4 component,
  its MSW test, the Staff route and the browser flow.
- Make verifier checks structural where they prove composition/retirement, and
  keep DTO and security semantics in contracts plus behavior tests.

**Non-Goals:**

- No API, contract, schema, Migration, D1, permission, idempotency, Audit,
  Outbox, privacy, pagination or file-flow change.
- No Admin, Buyer, Seller or other Staff legacy cleanup.

## Decisions

### Move tests to V4 instead of retaining a compatibility wrapper

The valid legacy scenarios render `AcquisitionWorkbench`, which only
re-exported the canonical component. They now render V4 directly under the
same Staff session boundary and MSW handlers. Keeping the wrapper would leave
two names for one UI and make future evidence ownership fuzzy; changing the
route to import V4 directly would violate the agreed canonical chain.

### Verify composition and evidence paths, not brittle UI/body strings

The verifier confirms the Staff route-to-Core-to-V4 composition, presence of
the canonical MSW and browser tests, and absence of both retired paths. It
continues to check the current API route, exact contract, D-035-aligned
behavior evidence, fail-closed source guards, immutable/audited attribution,
dedupe/profit isolation and maintenance gate. Exact browser request bodies are
not the DTO authority; the contract and behavior tests are.

### Preserve authority boundaries

D-038 records only the evidence retirement and cites D-035 for current
`channel_id` semantics. D-026 remains historical and unchanged. No archival
Change is edited.

## Risks / Trade-offs

- [A hidden import still uses the alias] → repository-wide consumer search,
  verifier absence assertions, typecheck and build prevent deletion from
  silently breaking a live path.
- [Static verifier drifts from runtime semantics] → retain only composition
  invariants in it; current DTO/security semantics are covered by API contract
  and behavior suites.
- [Evidence cleanup accidentally broadens scope] → diff/migration checks and
  the explicit non-goals keep unrelated legacy surfaces out.

## Migration Plan

No data migration or deployment exists. The local rollout is: move evidence,
remove zero-consumer aliases, run focused and module verification, validate
OpenSpec, then archive only after Formal Verify succeeds. Rollback is a normal
source diff revert before publication.
