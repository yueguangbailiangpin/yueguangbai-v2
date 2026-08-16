## Purpose

Defines how the canonical A-H staging acceptance matrix is executed and recorded without confusing local checks, external blockers, recovery work or production approval with real staging evidence.

## ADDED Requirements

### Requirement: Canonical staging acceptance is itemized and reproducible
The repository SHALL record exactly the current 67 A-H acceptance entries with stable IDs A01-A09, B01-B10, C01-C07, D01-D09, E01-E08, F01-F10, G01-G07 and H01-H07. Every entry SHALL have one of `PASS`, `FAIL`, `BLOCKED`, `CONFLICT` or `NOT_APPLICABLE`, an evidence class, an execution timestamp or dependency, and a reproducible redacted evidence reference. A local test, mock, template, dry-run or old release result SHALL NOT be reported as a real staging operation.

#### Scenario: Real staging operation passes
- **WHEN** an entry is executed against the exact isolated staging release and its success plus relevant no-side-effect/final-state assertions are captured
- **THEN** the entry may be `PASS` with a Git-external raw-evidence reference and a committed redacted summary

#### Scenario: Legacy wording conflicts with current authority
- **WHEN** an entry requires a repository state or business model that conflicts with the current canonical contract
- **THEN** the entry is `CONFLICT` and the evidence identifies the current authority without modifying runtime code merely to make the old wording pass

#### Scenario: Required external execution is unavailable
- **WHEN** an entry requires T10 recovery, mainland-network observation, production approval or another separately governed operator action
- **THEN** the entry is `BLOCKED` or `NOT_APPLICABLE` with the exact dependency and is not silently omitted from the 67-item denominator

### Requirement: Staging evidence remains isolated and redacted
T9 SHALL use only synthetic staging identities and business data through formal application paths. Raw provider logs, resource IDs, Access audience/policy IDs, emails, credentials, request identifiers and unredacted business payloads SHALL remain in a Git-external `0600` evidence bundle. T9 SHALL NOT access or mutate production resources, production data or real business identities.

#### Scenario: Evidence is committed
- **WHEN** T9 results are added to Git
- **THEN** only stable IDs, aggregate outcomes, release SHAs, non-sensitive counts, hashes and logical external-evidence references are committed

#### Scenario: Production remains gated
- **WHEN** all executable staging entries pass
- **THEN** the outcome may be `STAGING_ACCEPTED` but Production GO remains `NO_GO` until separately authorized and evidenced

### Requirement: Recovery-dependent rows preserve the T10 boundary
T9 SHALL include H01-H03 in the 67-item register but SHALL NOT perform or claim the isolated backup/restore exercise inside the T9 evidence Change. Their final status SHALL reference the independently reviewed T10 evidence when available.

#### Scenario: T10 has not completed
- **WHEN** T9 records H01, H02 or H03 before the independent recovery Change is complete
- **THEN** the row remains `BLOCKED` with dependency `T10` and cannot contribute to a full-pass claim

#### Scenario: T10 evidence is merged
- **WHEN** independently reviewed T10 evidence proves the corresponding D1 backup, isolated restore or R2 manifest behavior
- **THEN** T9 may update the linked row without copying raw recovery evidence or collapsing the two Change boundaries
