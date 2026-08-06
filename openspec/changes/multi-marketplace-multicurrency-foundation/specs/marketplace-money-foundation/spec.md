# Marketplace and Money Foundation Capability

## ADDED Requirements

### Requirement: Marketplace registry is the stable platform boundary

The system SHALL maintain stable Marketplace records containing code, platform, country or region, transaction currency and activation status, SHALL seed `AMAZON_JP`, `AMAZON_US` and `COUPANG_KR`, and SHALL NOT treat an unavailable Marketplace Adapter as permission to accept unvalidated platform facts.

#### Scenario: Known active Marketplace

- **WHEN** an authorized command references an active Marketplace with an implemented Adapter
- **THEN** the command derives platform and currency behavior from the registry and applies that Adapter.

#### Scenario: Korea boundary is reserved but unavailable

- **WHEN** a command attempts Coupang-specific validation before real rules and an Adapter are approved
- **THEN** it fails closed without inventing a number, URL or workflow rule.

### Requirement: Seller Organization is global and Store owns Marketplace

The system SHALL allow one Seller Organization to own Stores in multiple Marketplaces, SHALL require every Store to belong to exactly one Marketplace, and SHALL enforce Seller access by Organization and authorized Store rather than an Organization-level Marketplace.

#### Scenario: Multi-market Seller

- **WHEN** an authorized Seller Organization creates or accesses one Amazon JP Store and one Amazon US Store
- **THEN** both Stores remain under the same Organization with independent Marketplace facts and Store scopes.

#### Scenario: Cross-organization access

- **WHEN** a Seller actor requests a Store owned by another Organization
- **THEN** the request returns concealed not-found and exposes no Marketplace or financial facts.

### Requirement: Buyer has one immutable operational Marketplace

The system SHALL assign each Buyer Profile exactly one Marketplace, SHALL derive Buyer demand/order scope from it, and SHALL permit owner correction only before any reservation, evidence, formal order, review or financial fact exists.

#### Scenario: Correction before formal facts

- **WHEN** owner supplies an idempotent, versioned correction for a Buyer with no formal facts
- **THEN** Marketplace changes atomically and an immutable before/after Audit event is appended.

#### Scenario: Correction after formal facts

- **WHEN** any formal fact exists for the Buyer
- **THEN** Marketplace correction is rejected and no related row is changed.

### Requirement: Money and rate facts are currency explicit

The system SHALL store monetary values as integer minor units with explicit currency, SHALL use zero decimal places for JPY/KRW and two for USD/CNY, SHALL use integer-scaled rates and BigInt calculations, and SHALL lock currency, exponent, rounding and rate version into formal facts.

#### Scenario: USD order snapshot

- **WHEN** an Amazon US order becomes formal
- **THEN** its USD amount, USD/CNY rate direction, integer scale, rounding rule and rate version are persisted without floating-point conversion.

#### Scenario: Unsupported or mismatched currency

- **WHEN** a command submits a currency inconsistent with the Store Marketplace or a value outside integer bounds
- **THEN** it fails before creating order or financial facts.

### Requirement: Rate and fee current keys follow the approved business dimensions

The system SHALL key Buyer daily rates by business date and source currency to CNY, Seller agreement rates by Seller Organization and source currency to CNY, and service fee rules by Seller Organization, Marketplace and review type; all rules SHALL be versioned and completed facts SHALL keep their original snapshots.

#### Scenario: Seller shares one JPY rate

- **WHEN** one Seller Organization has multiple JPY Stores
- **THEN** all of its JPY business resolves the same current JPY/CNY agreement-rate lineage.

#### Scenario: Rule changes after completion

- **WHEN** a rate or fee rule receives a new version after an order or review is completed
- **THEN** prior facts retain the old snapshot and only eligible later facts use the new version.
