# Proposal: current-documentation-fact-alignment

## Why

Several current-facing statements still describe the pre-rebuild Schema 70,
retained Staff MCP/provider wording, a non-existent UI package, an in-progress
backend rebuild, and an unarchived settlement Change. The current checkout,
`db:verify`, `verify:api-contract`, source tree, and OpenSpec archive now prove
more precise facts, so the four directly affected documents need a narrow
alignment before they are used as current-state references.

## What Changes

- Update `README.md` to record Schema 36 and distinguish retired core runtime
  surfaces from retained tombstones, historical records, and fail-closed import
  candidates; keep the verified current 241-endpoint boundary in
  `CURRENT_SYSTEM_STATE.md`.
- Remove the non-existent `packages/ui` entry from
  `docs/architecture/V2_ARCHITECTURE.md`.
- Split the current implementation statement from historical stage narrative
  in `docs/CURRENT_SYSTEM_STATE.md`, mark the backend rebuild complete, record
  that the historical 7A-1R-B → 7A-2 route has been traversed, and retain the
  NOT_RUN, Stage 8 authorization, historical endpoint-count, and production
  boundary facts.
- Update D-058 in `docs/decisions/V2_DECISION_REGISTER.md` to point to its
  archived Change while retaining the local-only, unpushed, undeployed and
  remote-resource boundary.

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。This is a documentation-only fact correction. `.openspec.yaml` sets
`skip_specs: true`; no product, API, permission, migration, or DTO
requirement changes.

## Impact

Only the four named documentation files and this OpenSpec Change are changed.
The evidence basis is the current clean checkout at `ecc173ab…`,
`npm run db:verify` (Schema 36), `npm run verify:api-contract` (241 endpoints),
the current source/directory scan, and the archived
`openspec/changes/archive/2026-08-30-seller-settlement-read-boundary` path.
There is no Migration, code, test implementation, configuration, remote
resource, deployment, push, or production-state change.
