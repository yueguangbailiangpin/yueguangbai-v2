# Release Check Command Manifest Delta

## ADDED Requirements

### Requirement: Release aggregate commands resolve to current npm scripts

The release aggregate SHALL invoke only root `package.json` scripts that exist
as non-empty string entries. It SHALL use the current local authorities
`preflight:drive-archive`, `verify:staff-auth-composition`,
`verify:final-production-go:local`, and `test:browser`; it SHALL NOT invoke
`check:production-readiness`, `check:drive-archive`,
`check:staff-auth-production`, or `test:wave14a:browser`.

#### Scenario: Current command manifest is accepted

- **WHEN** the release aggregate command list is compared with the committed
  root npm manifest
- **THEN** every listed command resolves to a real script and all four retired
  names are absent.

#### Scenario: Manifest drift fails closed

- **WHEN** one or more release command keys are removed from the root npm
  manifest
- **THEN** the automated guard reports every missing key and exits non-zero
  before release subcommands are executed.

### Requirement: Release validation preserves local and production boundaries

The release aggregate SHALL preserve candidate clean-worktree provenance,
loopback-only browser execution, the explicitly authorized public npm audit
read, and the fixed `external_evidence: UNVERIFIED` and
`production_go: NO_GO` result. No release subcommand other than the authorized
dependency audit may access a remote service, deploy, or mutate a real
resource.

#### Scenario: Browser and release evidence stay bounded

- **WHEN** the aggregate runs its browser and release-preparation commands
- **THEN** the browser uses the configurable loopback port, preflights report
  zero external calls/deployments/resource mutations, and the final result
  does not claim Production GO.
