## MODIFIED Requirements

### Requirement: Release evidence distinguishes local proof from external truth

The release audit SHALL classify every finding as repository-evidenced, locally repairable, owner-authorized or Production GO blocking, SHALL resolve governed Change evidence from exactly one active or dated archive location, and SHALL NOT represent a mock, dry-run, placeholder, archived Change, local test, local timing, or configuration example as a deployed external capability or production Web Vital result.

#### Scenario: A local provider dry-run passes

- **WHEN** Drive, Feishu or Staff MCP passes against a mock, disabled template, or local adapter with zero external calls
- **THEN** the local capability may be marked repository-evidenced while real Provider activation remains owner-authorized and Production GO blocked.

#### Scenario: Change evidence has moved or is ambiguous

- **WHEN** required evidence exists in exactly one active or dated archive location
- **THEN** the verifier reads that location; if evidence is missing, duplicated, or active and archived simultaneously, it fails closed.

#### Scenario: A historical acceptance file says pass

- **WHEN** current executable evidence, configuration, candidate provenance, or external receipts do not support the historical statement
- **THEN** the current audit records the narrower truth and does not inherit the broader pass claim.

### Requirement: Release lineage, dependencies and migrations are verified from executable evidence

The audit SHALL bind its baseline to a fetched remote SHA, SHALL verify the lockfile and installed dependency tree plus a current authoritative audit, and SHALL prove the Migration filenames are continuous and ordered without inferring any remote Migration status.

#### Scenario: React Router advisory debt is checked

- **WHEN** the package manifest, lockfile, installed tree, npm audit and current advisory are inspected
- **THEN** the result states the resolved version, affected ranges and whether the installed version is affected, rather than relying on prose stating zero vulnerabilities.

#### Scenario: Repository migration 0038 exists

- **WHEN** the local chain ends at 0038
- **THEN** the audit proves local continuity but still requires an owner-authorized read of the production ledger before any online Migration.

## ADDED Requirements

### Requirement: Local release gate is aggregate and candidate-bound

The repository SHALL provide one release-specific local gate that runs the current main gate plus final-production, Cloudflare, production-readiness, Drive, Feishu, and Staff MCP verifier/preflight coverage, SHALL stop on any failing command, and SHALL emit the current clean candidate commit and Git tree without a hard-coded historical candidate SHA.

#### Scenario: A local release candidate is checked

- **WHEN** the aggregate gate runs from a clean committed worktree
- **THEN** every required local command succeeds, output identifies the actual `HEAD` and `HEAD^{tree}`, and the conclusion remains `LOCAL_CANDIDATE_ONLY / PRODUCTION_NO-GO` while external evidence is absent.

#### Scenario: Candidate or sub-gate is invalid

- **WHEN** the tracked worktree is dirty, provenance cannot be resolved, or any required local command fails
- **THEN** the aggregate gate fails and emits no production approval.

### Requirement: Performance evidence remains proportional and local

Release preparation SHALL compare current bundle/runtime evidence with the accepted baseline, SHALL make no further split or render change without evidence of repeated unauthenticated requests, shared-chunk waste, or material render waste, and SHALL label local timings as laboratory data rather than production LCP, INP, or CLS.

#### Scenario: Current performance remains within the accepted local baseline

- **WHEN** bundle sizes, cold routes, API timings, and hot switches show no material regression or unsafe duplicate work
- **THEN** no speculative runtime optimization is added and the local evidence records that production Web Vitals remain unverified.
