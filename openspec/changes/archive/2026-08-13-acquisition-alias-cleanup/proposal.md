## Why

The Staff acquisition route has already selected the V4 workbench through its
canonical composition chain, but an obsolete `AcquisitionWorkbench` re-export
and its test still act as duplicate evidence. Retiring that alias makes the
current route, render, API contract and behavior evidence unambiguous without
changing the Acquisition product behavior.

## What Changes

- Move the valid role-closure and Owner acquisition-view MSW coverage from the
  obsolete alias to `AcquisitionCoreWorkbenchV4`.
- Retire the zero-consumer `AcquisitionWorkbench` alias and its legacy-named
  test file.
- Make the Acquisition verifier prove the canonical composition, current
  contract/behavior evidence and required fail-closed invariants without
  retaining obsolete UI/body text markers.
- Record the evidence retirement as a new Decision while preserving D-026 and
  D-035 exactly as historical/current product authority respectively.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a canonical-evidence and alias-retirement refactor; it changes
neither runtime behavior nor a current OpenSpec requirement.

## Impact

Affected files are the Acquisition frontend test/evidence surface, its local
verifier and the Decision Register. No API route, contract, schema, migration,
authorization rule, production resource or external system changes. No
Migration is required. Rollback is a normal local diff revert before any
publication; permission, privacy, attribution, immutable-origin, audit and
deduplication behavior remain owned by the existing runtime and tests.
