## Why

The isolated staging infrastructure is active, but the canonical A-H acceptance matrix has not been executed against real staging behavior. T9 needs a stable 67-item evidence register that reports passes, failures, stale conflicts and external blockers honestly instead of converting local tests or old wording into a blanket staging claim.

## What Changes

- Assign stable IDs A01-A09, B01-B10, C01-C07, D01-D09, E01-E08, F01-F10, G01-G07 and H01-H07 to the current 67 A-H matrix entries.
- Execute each item using real staging operations, remote D1/R2 facts or explicit external evidence as appropriate, while retaining raw evidence outside Git.
- Record `PASS`, `FAIL`, `BLOCKED`, `CONFLICT` or `NOT_APPLICABLE` per item with a reproducible evidence reference.
- Correct stale governance references that call the current A-H matrix 68 items.
- Keep T10 recovery, mainland-network operator evidence and Production GO separate even when a T9 row depends on them.

## Capabilities

### New Capabilities

- `staging-acceptance-evidence`: Governs itemized, redacted and non-inflated staging A-H acceptance evidence.

### Modified Capabilities

None.

## Impact

- Adds evidence/governance artifacts and synthetic staging business facts created through formal application paths.
- Uses only the existing isolated staging Worker, D1, R2, Access application, domain and synthetic identities.
- No migration, deployment-contract, production-resource or real-business-data change is authorized by this Change.
