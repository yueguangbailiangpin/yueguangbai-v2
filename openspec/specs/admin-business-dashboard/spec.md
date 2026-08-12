# admin-business-dashboard Specification

## Purpose
TBD - created by archiving change admin-business-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Dashboard is owner-only
Business dashboard and trend APIs SHALL require Active Staff system owner plus FINANCIAL_VIEW, with Personal DENY final precedence.

#### Scenario: Non-owner or denied owner requests dashboard data
- **WHEN** authorization lacks either required condition or contains the final DENY
- **THEN** no global metric, internal profit, customer detail or cached prior-owner response is returned.

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

### Requirement: Summary windows use Beijing calendar boundaries
The dashboard SHALL provide today, Monday-based natural week and natural month windows using `Asia/Shanghai`, while storing source timestamps as UTC facts.

#### Scenario: A UTC timestamp crosses Beijing midnight
- **WHEN** metrics are grouped for the selected window
- **THEN** the fact belongs to the Beijing calendar date and the response declares timezone and exact date bounds.

### Requirement: Core acquisition and order metrics are system-derived
New Buyers, reservations, formal orders, no-participation, business completion and Seller cooperation SHALL be computed from their frozen D1 facts and SHALL NOT accept manually entered conversion results.

#### Scenario: A later state changes
- **WHEN** a reservation is cancelled or an order becomes business-complete
- **THEN** historical creation metrics remain based on creation facts and current terminal/conversion metrics reflect the new authoritative state.

#### Scenario: Buyer submits a reservation
- **WHEN** a Buyer lead that had no reservation submits its first reservation
- **THEN** it leaves the 未参加 metric permanently, regardless of the reservation's later rejection, cancellation, expiry or other state.

### Requirement: Buyer funnel is cohort-correct
The Buyer funnel SHALL report consultation, WeChat-added lead, active registration, reservation, formal order and business completion by source cohort rather than dividing unrelated same-day totals.

#### Scenario: A lead converts in a later week
- **WHEN** the original acquisition cohort is viewed
- **THEN** its later conversion is attributed back to that cohort and not to the later week's consultation denominator.

### Requirement: Seller funnel is separate
The Seller funnel SHALL report consultation, WeChat-added Seller lead and confirmed cooperation separately from Buyer order/profit totals.

#### Scenario: Seller and Buyer leads participate in one order
- **WHEN** both funnel views are aggregated
- **THEN** Seller cooperation is visible without duplicating the Buyer-attributed order or profit.

### Requirement: Staff and channel performance preserve origin
Performance views SHALL use immutable origin Staff/channel for acquisition contribution and SHALL distinguish it from current responsibility after transfers.

#### Scenario: Lead owner changes
- **WHEN** a lead is reassigned before conversion
- **THEN** origin performance and current-owner workload remain separately explainable.

### Requirement: Projected and completed profit are separate
The dashboard SHALL display projected gross profit and completed gross profit as separate CNY-fen aggregates using the canonical formulas and respective CONFIRMED and APPROVED date bases.

#### Scenario: Order is projected but not finance-complete
- **WHEN** a formal order has a valid snapshot but lacks completed finance facts
- **THEN** it contributes only to projected profit and not to completed profit.

### Requirement: Missing finance facts are explicit
Missing, duplicate or conflicting finance facts SHALL be excluded from valid profit sums and reported as conflict counts rather than silently treated as zero.

#### Scenario: Finance position conflicts
- **WHEN** the canonical read model returns a non-valid finance status
- **THEN** the dashboard increments the conflict count and does not invent a profit value.

### Requirement: Trends are bounded and auditable
DAY, WEEK and MONTH trends SHALL use bounded server queries, exact filters and a declared `data_as_of`; the browser SHALL not create authority by regrouping raw private facts.

#### Scenario: Unsupported or excessive query is submitted
- **WHEN** parameters are unknown, repeated or outside the allowed range
- **THEN** the API returns a stable validation error without running an unbounded scan.
