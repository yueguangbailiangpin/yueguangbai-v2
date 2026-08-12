## Context

See `proposal.md` for motivation. The current production route is
`App /staff/* → StaffRouteModule → StaffAdminRouteModule →
FrozenAdminBusinessDashboard`. The older `AdminBusinessDashboard` is not a
route consumer; it alone performs trend and drilldown requests.

## Goals / Non-Goals

**Goals:**

- Establish one frontend evidence owner: Frozen component MSW behavior plus the
  existing route/browser flow.
- Retire only zero-consumer legacy frontend code and test-only helpers.
- Retain an auditable separation between backend capability proof and frontend
  composition/behavior evidence.

**Non-Goals:**

- No dashboard redesign, API removal, contract change, runtime alteration,
  authorization change, migration, D1 data operation, or deployment.
- No restoration of a drilldown or trend UI merely because its backend route is
  still available.
- No cleanup outside the Admin evidence surface.

## Decisions

### Keep retained backend capabilities independent of the Frozen consumer

The existing backend routes, query model, contracts, D1 query-plan check, and
their focused API/D1 tests remain unchanged. Frozen currently reads summary,
daily acquisition facts, and financial projections; it deliberately does not
make trend/drilldown a current UI requirement. Deleting the backend because a
consumer retires would change a separately retained capability; retaining a
hidden legacy page to justify backend code would preserve duplicate ownership.

### Migrate behavior, not obsolete presentation requirements

The canonical MSW test renders `FrozenAdminBusinessDashboard` under a trusted
Staff session. It proves owner rendering of server facts, the owner +
`FINANCIAL_VIEW` client gate without requests for an ineligible role, and 401
staff-root cache invalidation. Browser evidence continues to cover the actual
route, responsive layout, no private-field leakage, and no legacy drilldown
controls. It does not copy custom date, trend, pagination, or drilldown UI
assertions from the retired component.

### Use structural verifier assertions only for ownership boundaries

The verifier uses parsed TypeScript imports/JSX and path existence/absence to
prove route-to-Frozen composition, canonical test/e2e paths, and legacy-file
retirement. It separately runs the existing local D1 schema/query-plan proof.
It reports those as different evidence classes; it does not pretend static
backend markers prove frontend behavior. Runtime behavior remains owned by the
targeted Vitest/API/browser gates.

## Risks / Trade-offs

- [A hidden consumer imports legacy UI/helper] → repository-wide consumer
  search, structural absence checks, Web typecheck, and build.
- [A retained backend capability is misrepresented as Frozen UI] → explicit
  verifier output separation and browser assertion that no drilldown control is
  rendered.
- [A 401 leaves private cache] → canonical MSW test uses the Frozen query key
  and relies on the existing Staff-root invalidation path.

## Migration Plan

No data migration, schema action, D1/R2 access, production resource, remote
Git, deployment, secret, or real data operation exists. The local sequence is:
add canonical evidence; remove zero-consumer files/helpers; update verifier and
Decision; run focused gates; validate and formally verify OpenSpec; sync the
no-delta Change and archive it. Rollback is a normal revert of this local diff
before publication.
