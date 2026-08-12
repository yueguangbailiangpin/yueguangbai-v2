# Admin business dashboard alignment

## ADDED Requirements

### Requirement: FrozenAdminBusinessDashboard is the canonical frontend

The canonical Admin frontend SHALL be `FrozenAdminBusinessDashboard` and SHALL provide today, this week, and this month windows; operating metrics; Buyer and Seller funnels; channel and daily facts; projected and completed profit; and current operating-integrity facts. The browser SHALL continue to format server facts and SHALL not calculate authoritative profit.

#### Scenario: Owner opens the canonical dashboard

- **WHEN** an authorized owner opens the Admin business dashboard
- **THEN** the frozen frontend exposes the required windows and current operating facts using the existing owner and `FINANCIAL_VIEW` boundary.

#### Scenario: Legacy frontend consumer is inspected

- **WHEN** the older dashboard drilldown/trend consumer is found in the repository
- **THEN** it is classified as a non-mandatory legacy consumer-audit target, not as a reason to delete backend trend/drilldown/read-model/contracts.

### Requirement: Backend dashboard evidence remains available for a later consumer audit

Existing trend, drilldown, read-model, and API Contract surfaces SHALL remain retained and behaviorally unchanged in this alignment. Their future consumer audit is separate from the canonical frontend decision and SHALL not be converted into a frontend retirement claim.

#### Scenario: Backend dashboard contracts are reviewed

- **WHEN** the dashboard backend and Contract inventory are audited
- **THEN** trend/drilldown/read-model evidence remains available, with no API deletion or contract weakening in this Change.

#### Scenario: Canonical frontend is selected

- **WHEN** the Admin UI acceptance evidence is evaluated
- **THEN** `FrozenAdminBusinessDashboard` is the required frontend evidence surface, while retained backend consumers are tracked separately.
