# stage7f-visual-evidence-fixture-repair Specification

## ADDED Requirements

### Requirement: Evidence fixtures match current strict runtime responses

The isolated Stage 7F browser fixtures MUST return the current strict response shapes for every endpoint used by the focused Staff and Review evidence flows. Fixture changes MUST remain local to browser/demo data and MUST NOT weaken production schemas or bypass response parsing.

#### Scenario: Staff visual fixture reaches normal image evidence

- **WHEN** the Staff workbench or product detail requests a protected image and order evidence preflight
- **THEN** the fixture returns a schema-valid read intent, valid image content metadata/body, and a ready preflight without an error panel or loading placeholder

#### Scenario: Settlement and settings evidence uses current pagination/read shapes

- **WHEN** the isolated settlement, finance, or service-channel harness requests current read endpoints
- **THEN** it receives the exact current response envelope and page fields needed by the production components, with representative non-zero normal data

#### Scenario: Review access-management pages load

- **WHEN** Review Staff opens the access-management surface as an Owner
- **THEN** seller-organization assignments, buyer assignments, and personal-deny reads resolve as strict demo responses rather than a blocked or malformed state

### Requirement: Evidence capture is semantic and strict

The dedicated evidence harness MUST capture exactly 17 Staff views and four `/review` recovery views from the real local browser runtime. Before each capture it MUST assert visible key data, absence of error/loading/unavailable/MALFORMED states, decoded images when the page contains images, and no horizontal overflow. Mobile drawer evidence MUST open the actual drawer and assert its visible dialog state.

#### Scenario: Normal-state failure aborts capture

- **WHEN** any required view contains a forbidden error/loading/unavailable state, undecoded image, overflow, or missing key data
- **THEN** the test fails before writing that view's accepted evidence and the view remains unresolved

#### Scenario: Each required view is manually reviewable

- **WHEN** the 21 screenshots are generated
- **THEN** the evidence record names every file and records an individual manual visual inspection result; test completion alone is not treated as visual acceptance

### Requirement: Repair remains within the visual-evidence boundary

The Change MUST NOT modify backend contracts, database/migrations, authorization/permission policy, business calculations, production data, remote environments, or the completed Stage 7F-4 child Change. Any UI style adjustment MUST be narrowly scoped to the existing Dashboard 44px control acceptance.

#### Scenario: Local-only closure

- **WHEN** the Change is committed
- **THEN** the final report identifies local-only evidence, leaves remote/production untouched, and records no push, deploy, sync, or archive action
