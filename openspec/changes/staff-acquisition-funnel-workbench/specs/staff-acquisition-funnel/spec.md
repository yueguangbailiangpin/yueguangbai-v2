# Staff Acquisition Funnel Requirements

## ADDED Requirements

### Requirement: Owner controls acquisition channels
Only an authorized system owner SHALL create, disable or version acquisition channels, configure Staff channel effective periods and record or correct daily consultation counts.

#### Scenario: Non-owner attempts channel administration
- **WHEN** pre_sales, seller_ops, buyer_refund, Buyer or Seller calls an administration command
- **THEN** the command is denied without changing channel, count or audit facts.

### Requirement: Daily consultation is a channel aggregate
The system SHALL store one versioned consultation-person count per channel and `Asia/Shanghai` business date and SHALL preserve every owner correction in audit history.

#### Scenario: Owner corrects a daily count
- **WHEN** the expected version matches and the non-negative bounded count changes
- **THEN** the new version becomes current and the prior value, actor, reason and time remain auditable.

#### Scenario: One person consults more than one channel
- **WHEN** one person consults the same channel repeatedly on one Beijing date and also consults another channel
- **THEN** the person counts once in each consulted channel and is not counted twice within either channel for that date.

### Requirement: Lead registration follows four-role duties
pre_sales SHALL create Buyer leads, seller_ops SHALL create Seller leads, buyer_refund SHALL create neither, and owner SHALL administer both within current permissions and scope.

#### Scenario: Staff creates a lead
- **WHEN** the trusted role and requested lead type do not match
- **THEN** the backend rejects the command even if the UI exposed or modified the form.

### Requirement: Channel is server-derived
Lead creation SHALL derive exactly one active channel from trusted Staff, lead type and creation time and SHALL NOT accept authoritative channel selection from the Staff request.

#### Scenario: Channel configuration is missing or ambiguous
- **WHEN** zero or multiple active assignments match the Staff and lead type
- **THEN** no lead is created and a stable configuration error is returned.

### Requirement: WeChat-added people are individual leads
Each valid lead SHALL represent one Buyer or Seller added on private WeChat with minimal protected identity data, immutable origin channel and originating Staff, and each normalized identity SHALL have at most one active lead per lead type.

#### Scenario: Duplicate identity is entered
- **WHEN** an active same-type lead already owns the normalized WeChat identity under the duplicate policy
- **THEN** the command returns the existing/conflict result without increasing the added-WeChat count.

### Requirement: Business conversions are system-linked
Registration, reservation, formal order, no-participation, Seller cooperation and finance conversion SHALL be derived from D1 business facts rather than re-entered by Staff.

#### Scenario: A linked business fact changes
- **WHEN** a qualifying registration, reservation terminal state, formal order or Seller activation commits
- **THEN** the funnel read model reflects it idempotently without a second manual conversion record.

### Requirement: No-participation means no reservation submission
An effective Buyer lead SHALL count as 未参加 only while no reservation has ever been submitted for that linked Buyer identity as of `data_as_of`.

#### Scenario: A reservation is submitted after lead creation
- **WHEN** a Buyer lead previously counted as 未参加 submits its first reservation
- **THEN** it leaves the 未参加 count and never re-enters because that reservation is later rejected, cancelled, expired or otherwise changes state.

### Requirement: Source attribution is not overwritten
Original channel and originating Staff SHALL remain immutable for attribution; later assignment or correction SHALL be represented by separate current-owner or correction facts.

#### Scenario: Lead is transferred
- **WHEN** another Staff becomes responsible
- **THEN** current responsibility changes with audit, while origin-channel and origin-Staff performance remain unchanged.

### Requirement: Profit is not double counted
Order/profit attribution SHALL use the linked Buyer lead origin by default, while Seller acquisition reporting remains a separate consultation-to-cooperation funnel.

#### Scenario: One order is linked to both Buyer and Seller acquisition contexts
- **WHEN** channel performance totals are aggregated
- **THEN** the order and its profit appear once in Buyer-origin totals and are not added again to Seller-origin totals.

### Requirement: Acquisition entry is integrated and bookmarkable
The Staff Web SHALL expose acquisition inside the workbench and at a stable same-origin bookmarkable route, with all panels and commands protected by backend authorization.

#### Scenario: Buyer-refund Staff opens the direct route
- **WHEN** the current authorization lacks acquisition permissions
- **THEN** registration controls are absent and direct API calls remain forbidden.

### Requirement: Unconverted lead identity is time-bounded
An unconverted lead SHALL have its private WeChat identity and nonessential personal data anonymized twelve months after the latest follow-up, unless a linked business/finance fact, security or dispute hold, or legal retention rule requires preservation.

#### Scenario: Retention deadline is reached
- **WHEN** a lead has no conversion or preservation exception and its latest follow-up is older than twelve months
- **THEN** retry-safe processing anonymizes the private identity, retains a minimal audit event and does not expose the removed value through API, logs, exports or caches.
