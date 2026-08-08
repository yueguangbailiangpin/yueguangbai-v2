# production-go-local-preparation Specification

## Purpose
TBD - created by archiving change final-production-go-local-preparation. Update Purpose after archive.
## Requirements
### Requirement: Release evidence distinguishes local proof from external truth
The release audit SHALL classify every finding as repository-evidenced, locally repairable, owner-authorized or Production GO blocking, and SHALL NOT represent a mock, dry-run, placeholder, archived Change, local test or configuration example as a deployed external capability.

#### Scenario: A local provider dry-run passes
- **WHEN** Drive, Feishu or Staff MCP passes against a mock or local adapter with zero external calls
- **THEN** the local capability may be marked repository-evidenced while real Provider activation remains owner-authorized and Production GO blocked.

#### Scenario: A historical acceptance file says pass
- **WHEN** current executable evidence, configuration or external receipts do not support the historical statement
- **THEN** the current audit records the narrower truth and does not inherit the broader pass claim.

### Requirement: Release lineage, dependencies and migrations are verified from executable evidence
The audit SHALL bind its baseline to a fetched remote SHA, SHALL verify the lockfile and installed dependency tree plus a current authoritative audit, and SHALL prove the Migration filenames are continuous and ordered without inferring any remote Migration status.

#### Scenario: React Router advisory debt is checked
- **WHEN** the package manifest, lockfile, installed tree, npm audit and current advisory are inspected
- **THEN** the result states the resolved version, affected ranges and whether the installed version is affected, rather than relying on prose stating zero vulnerabilities.

#### Scenario: Repository migration 0037 exists
- **WHEN** the local chain ends at 0037
- **THEN** the audit proves local continuity but still requires an owner-authorized read of the production ledger before any online Migration.

### Requirement: Production configuration gaps fail closed
The audit SHALL require an explicit production hosting and Worker configuration, D1/R2 adapter bindings, managed Secrets, independent alert receiver and controlled deployment/rollback path, and SHALL block Production GO when only placeholders, local mocks or missing adapters exist.

#### Scenario: Example Wrangler bindings exist
- **WHEN** an example file contains replacement markers or an R2 binding is not adapted to the application's storage port
- **THEN** it is not a deployable production configuration and Production GO remains blocked.

#### Scenario: No CI workflow or enforceable branch protection exists
- **WHEN** the repository has no current CI workflow and branch protection cannot be verified or enabled under the current plan
- **THEN** the owner must approve and evidence an alternative release-control process or complete an independent automation Change before GO.

### Requirement: External integrations activate in reversible phases
Drive, Feishu, Scheduler and Staff MCP SHALL remain disabled until their own prerequisites pass, SHALL use separate kill switches and approvals, and SHALL preserve D1/Web authority when disabled.

#### Scenario: Drive archive is enabled
- **WHEN** the owner authorizes archive rollout
- **THEN** shadow copy precedes verified proxy read, byte/MIME/SHA-256 read-back and D1 Manifest persistence, and R2 deletion receives a later separate approval.

#### Scenario: Staff Agent proposes a formal action
- **WHEN** Staff MCP returns a draft or recommendation for a refund, settlement, review, rate or order closure
- **THEN** no formal mutation occurs and the Staff member must open the controlled Web page, reauthorize and confirm current facts.

### Requirement: Final Production GO is an explicit owner decision bound to complete evidence
The release SHALL remain `NO-GO` while any P0/P1 blocker, required network/browser journey, backup/restore proof, Provider receipt, privacy/compliance decision, release-control decision or final owner signature is missing or failed.

#### Scenario: All local gates pass
- **WHEN** repository tests, static verification, local D1, browser mocks and OpenSpec validation pass but external evidence is incomplete
- **THEN** the conclusion remains `LOCAL_CANDIDATE_ONLY / PRODUCTION_NO-GO` and no production action occurs.

#### Scenario: Owner signs final approval
- **WHEN** all required evidence is timestamped, reconciled to one immutable release SHA, no blocker remains and the owner explicitly records Production GO
- **THEN** operators may execute only the separately authorized release steps in the approved order and must retain rollback evidence.
