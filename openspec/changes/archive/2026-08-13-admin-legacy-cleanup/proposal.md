## Why

The live Admin route renders `FrozenAdminBusinessDashboard`, but the retired
`AdminBusinessDashboard` still owns MSW evidence and the only frontend
trend/drilldown consumer. That leaves two frontend narratives for one route
and makes the retained backend capabilities look like current UI requirements.

## What Changes

- Move still-valid owner visibility, session-cache invalidation, and rendered
  summary/funnel/financial-fact coverage to a canonical Frozen-dashboard MSW
  test; preserve browser route evidence.
- Delete the zero-consumer legacy Admin component, its MSW test, and only its
  frontend client/query/runtime helper surface.
- Keep every Admin API route, trend/drilldown/read-model implementation,
  shared backend contract, D1 query-plan evidence, authorization boundary, and
  migration byte unchanged.
- Make the Admin verifier report backend/schema/query-plan evidence separately
  from canonical frontend composition and behavior-evidence paths.
- Record the evidence migration in a new Decision without changing D-025 or
  archived history.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a canonical-evidence and zero-consumer frontend retirement;
runtime requirements and published API contracts do not change.

## Impact

Affected code is limited to the Admin frontend evidence/helpers, the local
verifier, Decision Register, and this Change. No API, runtime business rule,
authorization policy, schema, Migration, D1/R2 resource, deployment, secret,
or external system changes. Rollback is an ordinary local diff revert before
publication; no business or financial fact is written.
