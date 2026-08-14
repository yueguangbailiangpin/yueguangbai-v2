# seller-complete-business-loop Specification

## Purpose
Define the Seller-safe, multi-store, multi-currency, financially immutable and accessible business workspace from catalog through truthful order completion.
## Requirements
### Requirement: Seller workspace resolves a single active Seller Persona

The system SHALL require an active Seller Persona for every Seller workspace request, SHALL keep Buyer and Seller query state separate, and SHALL expose no Buyer or Staff facts through Seller responses.

#### Scenario: Dual-persona customer enters Seller workspace

- **WHEN** a customer with Buyer and Seller Personas enters a protected Seller route
- **THEN** the server resolves only the Seller membership and the client uses only Seller-scoped query keys.

#### Scenario: Buyer-only session calls Seller API

- **WHEN** a session without an active Seller Persona calls a Seller route
- **THEN** access fails without revealing Seller organization, Store or financial data.

### Requirement: Organization and Store scope are enforced server-side

The system SHALL scope every Seller business read by Seller Organization and current authorized Stores, SHALL conceal out-of-scope resources as not found, and SHALL NOT trust client-selected organization or Store authority.

#### Scenario: Authorized multi-store switch

- **WHEN** a member selects one of its authorized JP or US Stores
- **THEN** the workspace and API return only that Store's records while retaining the global Organization context.

#### Scenario: Cross-organization identifier

- **WHEN** a Seller supplies another Organization's Store or record identifier
- **THEN** the server returns concealed not-found with no ownership metadata.

### Requirement: Marketplace capability is truthful

The Seller workspace SHALL support active Amazon JP and Amazon US Store context from the Marketplace registry and SHALL present Korea as disabled until its Adapter and workflow are approved.

#### Scenario: Active US Store

- **WHEN** an authorized Amazon US Store is selected
- **THEN** the UI labels USD order money and uses platform-neutral identifiers from the response.

#### Scenario: Korea Store command

- **WHEN** a Seller attempts a Korea-specific command while the Marketplace is disabled
- **THEN** the command fails closed and the UI does not imply availability.

### Requirement: Seller order money and snapshots are currency explicit

The system SHALL return order amounts as decimal-string integer minor units with explicit currency and exponent, SHALL return Seller CNY facts as decimal-string fen, and SHALL return the immutable Seller Principal Rate Policy and service-fee snapshots used by the order. Amazon formal orders SHALL have a non-null principal-policy snapshot; platform orders whose current import scope does not carry financial authority SHALL return the entire financial projection as null rather than inventing a rate or amount.

#### Scenario: USD order display

- **WHEN** a Seller reads an Amazon US formal order with current financial authority
- **THEN** the response identifies USD minor units, CNY quote currency, daily base rate, policy markup, final integer rate and scale, rounding rule, snapshot version, and principal amount without floating-point calculation or a legacy agreement-rate projection.

#### Scenario: Legacy JP order display

- **WHEN** a Seller reads an Amazon JP order admitted after Schema 69
- **THEN** generic and retained JP compatibility amount fields describe the same immutable values and the principal-policy snapshot is the only Seller-rate authority.

#### Scenario: Platform order lacks approved financial import

- **WHEN** a Seller reads a Rakuten or TikTok platform order whose financial facts were not imported under an approved authority
- **THEN** payment, Seller principal, principal-policy snapshot, service-fee snapshot, and business completion remain null and the UI labels them unavailable without fallback.

### Requirement: Seller principal policy snapshots are read-only to Seller

The system SHALL allow a Seller to view the immutable platform order date, daily base rate, applied principal-policy scope and version, markup, final rate, rounding rule, and Seller principal amount used by an authorized order, and SHALL provide no Seller route that submits, confirms, rejects, or edits Staff-controlled rate or policy facts.

#### Scenario: Seller views locked principal policy

- **WHEN** a Seller opens an authorized Amazon formal order
- **THEN** the exact principal-policy snapshot is displayed read-only and no legacy agreement-rate field is present in the response.

#### Scenario: Seller attempts principal-policy mutation

- **WHEN** a Seller calls a Staff principal-policy command or supplies rate or policy fields in a Seller command
- **THEN** the request is rejected or ignored by a strict allowlist and no policy, rate, snapshot, or principal fact changes.

### Requirement: Principal and service fee remain independent

The system SHALL expose Seller principal and Seller service fee as separate CNY amounts, statuses and traceable payable/allocation facts and SHALL NOT combine them into one authoritative balance or status.

#### Scenario: Principal paid while fee remains due

- **WHEN** principal is fully allocated and service fee is unpaid
- **THEN** the Seller sees principal complete and service fee pending as distinct components.

#### Scenario: Payment covers several orders

- **WHEN** one payment is allocated across multiple payables
- **THEN** each allocation identifies its payable, type, net amount and reversal state so every order remains traceable.

### Requirement: Financial state is Staff-controlled, immutable and precise

The system SHALL derive Seller-visible settlement status from immutable CNY-fen payable/payment/allocation/reversal facts using integer arithmetic and SHALL provide no Seller command to confirm payment, change audit fields or overwrite completed facts.

#### Scenario: Allocation reversal

- **WHEN** Staff records an authorized reversal
- **THEN** Seller-visible net balances and progress update from the new reversal fact while prior facts remain auditable.

#### Scenario: Decimal or floating-point input

- **WHEN** a financial path receives a floating-point or ambiguous currency value
- **THEN** validation fails before a financial fact is created.

### Requirement: Business completion uses four independent components

The system SHALL derive order business completion from review, Buyer refund, Seller principal and Seller service fee, and SHALL mark the aggregate complete only when every component is complete or explicitly not applicable.

#### Scenario: Three complete and one pending

- **WHEN** any one component remains pending, partial, missing-required or conflicted
- **THEN** the order aggregate remains incomplete and identifies that component without exposing hidden details.

#### Scenario: All components terminal

- **WHEN** all four components are complete or explicitly not applicable
- **THEN** the order aggregate is complete and shows the four terminal component states.

### Requirement: Seller progress never invents hidden facts

The system SHALL compute completion on the server from authoritative facts, SHALL expose Buyer refund only as a coarse completion component, and SHALL not expose Buyer refund amount, proof, identity or Staff/internal details.

#### Scenario: Buyer refund is pending

- **WHEN** a refund-required order is not fully paid
- **THEN** Seller sees only that the Buyer refund component is pending.

#### Scenario: Missing authoritative source

- **WHEN** a required source fact is absent or inconsistent
- **THEN** the component is pending or conflicted rather than guessed complete.

### Requirement: Settlement proofs remain associated, audited and dynamically authorized

The system SHALL preserve an immutable proof association and audit trail for every recorded Seller payment, SHALL issue short-lived proof reads only to currently authorized Staff through dynamic responsibility and Personal DENY checks, and SHALL not return proof metadata, object keys or permanent URLs in Seller DTOs.

#### Scenario: Authorized Staff proof read

- **WHEN** authorized Staff requests a proof linked to a Seller payment
- **THEN** the server rechecks current permission and organization responsibility and returns a short-lived read intent.

#### Scenario: Seller or cross-organization proof request

- **WHEN** a Seller principal or Staff outside the responsible Organization requests the proof
- **THEN** the read is concealed and no proof metadata, storage identifier or token is disclosed.

### Requirement: Seller mutations preserve state, version and idempotency

Every Seller business write SHALL require a valid Idempotency-Key, request hash and applicable expected version, SHALL validate its state machine and final transaction assertions, and SHALL append audit evidence.

#### Scenario: Exact replay

- **WHEN** the same key and request body are replayed
- **THEN** the same completed result is returned without duplicate business facts.

#### Scenario: Stale or changed replay

- **WHEN** the expected version is stale or the same key carries a different body
- **THEN** the command returns a stable conflict and changes no state.

### Requirement: Seller UI is Chinese, Beijing-time and accessible

The system SHALL provide Chinese Seller pages, display timestamps in `Asia/Shanghai`, support 390px primary and 320px minimum layouts, keyboard and touch operation, visible focus, non-color status and 200 percent reflow.

#### Scenario: Mobile Seller journey

- **WHEN** a Seller uses a 390px viewport to switch Store and inspect an order
- **THEN** context, amounts, progress and next actions remain readable without horizontal page scrolling.

#### Scenario: Keyboard and reduced motion

- **WHEN** a Seller navigates by keyboard with reduced motion enabled
- **THEN** focus order and focus indication remain clear and no essential state depends on animation or color alone.

### Requirement: Existing JP, Buyer and Staff contracts remain compatible

The system SHALL preserve existing JP Seller data semantics and existing Buyer/Staff endpoint behavior while adding Seller generic fields and pages.

#### Scenario: Existing JP fixture regression

- **WHEN** the full legacy JP Seller fixture and API tests run
- **THEN** identifiers, JPY/CNY values, snapshots, permissions and responses remain semantically unchanged.

#### Scenario: Buyer and Staff regression

- **WHEN** complete Buyer and Staff suites run after this Change
- **THEN** their routes, authorization, DTO privacy and financial behavior remain unchanged.
