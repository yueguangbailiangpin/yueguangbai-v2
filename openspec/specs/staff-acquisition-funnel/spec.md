# staff-acquisition-funnel Specification

## Purpose
TBD - created by archiving change staff-acquisition-funnel-workbench. Update Purpose after archive.
## Requirements
### Requirement: Owner controls acquisition channels
Only an authorized system owner with `ACQUISITION_ADMIN` SHALL create, disable or version acquisition channels, configure Staff channel effective periods, and record or correct daily consultation counts. The `acquisition` role SHALL NOT gain these commands from D-034, a historical Personal GRANT, a Team/Leader pack or a client-supplied permission projection.

#### Scenario: Non-owner attempts channel administration
- **WHEN** acquisition, pre_sales, seller_ops, buyer_refund, Buyer or Seller calls a consultation write or channel administration command
- **THEN** the command is denied before idempotency acquisition and without changing consultation, event, Audit or idempotency facts.

### Requirement: Daily consultation is a channel aggregate
The system SHALL store one versioned consultation-person count per channel and `Asia/Shanghai` business date and SHALL preserve every owner correction in immutable domain-event and general Audit history. Immediately after the conditional consultation mutation, the write batch SHALL assert `changes()=1` through `transaction_assertions` before writing event, Audit or idempotency-completion facts, and SHALL retain the final state/version/count assertion as defense in depth. It SHALL mark an acquired idempotency claim failed if any batch statement fails.

The consultation's Buyer or Seller funnel SHALL come from the channel's current single operational audience. Historical `BOTH` channels SHALL NOT accept new consultation writes.

#### Scenario: Owner corrects a daily count
- **WHEN** owner submits a bounded count with the current expected version and an Idempotency-Key
- **THEN** the system commits one current version, one immutable event, one Audit event and a completed idempotency fact, replays an identical request, and rejects a different hash or stale version without extra facts.

#### Scenario: The consultation batch fails
- **WHEN** a conditional mutation or final assertion fails after idempotency acquisition
- **THEN** the batch leaves no consultation, event, Audit or successful idempotency fact and the claim is cleaned to a retry-safe failed state.

#### Scenario: Two corrections share one expected version
- **WHEN** two requests use different Idempotency-Keys but the same consultation, expected version and target count, and one wins during the other's commit window
- **THEN** the winner alone commits its version, event, Audit and idempotency fact, while the stale mutation's immediate assertion fails and no ghost success survives.

#### Scenario: An unknown batch dependency fails
- **WHEN** the consultation batch throws an error that is not an explicit Acquisition OCC error
- **THEN** the claim is cleaned to failed, the unknown error is preserved for the existing route boundary to map to `DEPENDENCY_UNAVAILABLE`, and it is not mislabeled `VERSION_CONFLICT`.

#### Scenario: One person consults more than one channel
- **WHEN** one person consults the same channel repeatedly on one Beijing date and also consults another channel
- **THEN** the person counts once in each consulted channel and is not counted twice within either channel for that date.

### Requirement: Lead registration follows five-role duties
pre_sales SHALL create Buyer leads, seller_ops SHALL create Seller leads, buyer_refund SHALL create neither, owner SHALL administer both within current permissions and scope, and acquisition SHALL operate Marketplace-scoped Prospect/source/read workflows without creating, reading or managing formal Buyer/Seller Leads.

#### Scenario: Staff creates or reads a formal Lead
- **WHEN** the trusted role and requested formal Lead duty do not match, including an acquisition actor with no formal Lead duty
- **THEN** the backend rejects the command or read even if the UI or a historical permission row suggests otherwise.

### Requirement: Acquisition consultation history is Marketplace concealed
Owner SHALL read consultation history globally. Acquisition SHALL read consultation rows and history only for channels in its current Marketplace scope. An absent or cross-scope consultation id SHALL produce the same concealed `NOT_FOUND` response.

#### Scenario: Acquisition reads same-scope history
- **WHEN** acquisition requests a consultation whose channel Marketplace is in its current scope
- **THEN** the immutable event history is returned in stable order.

#### Scenario: Acquisition probes cross-scope history
- **WHEN** acquisition requests a consultation whose channel Marketplace is outside its current scope
- **THEN** the API returns concealed `NOT_FOUND` and reveals no event or consultation metadata.

### Requirement: Explicit controlled source declaration
Lead creation SHALL accept `channel_id` as an explicit client-submitted or client-confirmed source declaration. The declaration SHALL NOT grant authorization. The backend SHALL fail closed unless the trusted actor has the required Lead duty and current Marketplace scope, and the declared channel exists, is ACTIVE, matches the Lead's Buyer/Seller audience and matches the requested Marketplace.

#### Scenario: A legal direct Lead declares its source
- **WHEN** authorized pre_sales or seller_ops Staff with current Marketplace scope creates a direct Lead without a Prospect and declares an ACTIVE same-audience, same-Marketplace channel
- **THEN** the system creates the Lead with that channel as its immutable original source.

#### Scenario: An invalid declared source is submitted
- **WHEN** a Lead request declares an unknown, DISABLED, wrong-audience, wrong-Marketplace, or out-of-scope channel
- **THEN** the system rejects the request without creating a Lead, even if the client supplied a syntactically valid `channel_id`.

### Requirement: Prospect-to-Lead inherits the exact origin channel
When a formal Lead is created from a Prospect, the requested type and Marketplace SHALL match the Prospect and the declared `channel_id` SHALL exactly equal the Prospect's original channel. The Staff member SHALL NOT replace that origin during conversion.

#### Scenario: A Prospect converts using its original source
- **WHEN** an authorized Staff member creates a Lead from a Prospect using the Prospect's type, Marketplace and exact original channel
- **THEN** the Lead records that exact original channel and inherited origin metadata, and the Prospect is converted.

#### Scenario: A Prospect source is mismatched
- **WHEN** a Lead request references a Prospect but declares another channel, type or Marketplace
- **THEN** the system rejects it without converting the Prospect or creating a Lead.

### Requirement: Original source is immutable and correction is controlled
The original Lead channel and originating Staff SHALL remain immutable attribution facts. A correction SHALL use the existing append-only, audited correction history and SHALL NOT overwrite the original source. Staff-safe Lead projections SHALL continue to exclude protected source Staff and private origin metadata.

#### Scenario: A source needs correction
- **WHEN** an authorized correction flow records a different effective source with a reason
- **THEN** the original source remains auditable, the correction is an additional immutable history fact with an Audit event, and ordinary Staff projections remain privacy-safe.

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
