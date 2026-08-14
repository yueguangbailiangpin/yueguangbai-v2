# Marketplace and Money Foundation Specification

## Purpose

Define the stable Marketplace, ownership, currency, rate, fee and immutable financial-snapshot boundaries required to extend the JP baseline safely to Amazon US and a disabled future Korea capability.

## Requirements

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

### Requirement: Formal-order confirmation has one Seller principal authority

The system SHALL create a formal order only through the Staff order-evidence approval command, SHALL derive Seller principal from the platform order-date daily base rate plus the confirmed Seller Principal Rate Policy, and SHALL NOT select behavior through a compatibility flag or fall back to a Seller Agreement Rate.

#### Scenario: Required principal authority is complete

- **WHEN** authorized Staff approves valid order evidence with an exact platform order date, a confirmed daily base rate for that date and currency, and an eligible confirmed principal policy
- **THEN** the order, immutable principal-policy snapshot, financial snapshot, payable, audit, idempotency result, and outbox facts are committed atomically with integer HALF_UP calculation.

#### Scenario: Base rate or policy is missing

- **WHEN** the platform order-date daily base rate or eligible confirmed principal policy cannot be resolved
- **THEN** confirmation fails closed with the stable pricing dependency error and creates no order, snapshot, payable, audit, successful idempotency, or outbox fact.

#### Scenario: Parallel confirmation authority is attempted

- **WHEN** an internal or HTTP caller attempts to confirm an order outside the Staff order-evidence approval command
- **THEN** no second confirmation service or route is available and no formal fact is created.

### Requirement: Rate and fee current keys follow the approved business dimensions

The system SHALL key Buyer daily rates by business date and source currency to CNY, Seller Principal Rate Policies by source-currency pair with an optional Seller Organization override, and service fee rules by Seller Organization, Marketplace and review type. Organization principal-policy overrides SHALL take precedence over the currency-pair default, explicit zero markup SHALL differ from no eligible policy, every rule SHALL be versioned, and completed facts SHALL keep their original immutable snapshots.

#### Scenario: Seller override takes precedence

- **WHEN** a Seller Organization has an eligible confirmed source-currency override and an eligible currency-pair default for the platform order date
- **THEN** formal-order confirmation locks the organization override with the exact daily base rate, markup, final rate, policy version, rounding rule, and principal result.

#### Scenario: Seller shares one JPY rate

- **WHEN** one Seller Organization has multiple JPY Stores and no eligible organization override
- **THEN** all eligible formal orders use the same current JPY-to-CNY currency-pair default policy while each order locks its own platform order-date daily base-rate snapshot.

#### Scenario: Currency-pair default applies

- **WHEN** no eligible Seller Organization override exists and an eligible confirmed currency-pair default exists
- **THEN** formal-order confirmation locks the default policy and records a null policy Seller Organization without consulting a legacy agreement rate.

#### Scenario: Rule changes after completion

- **WHEN** a rate, principal policy, or fee rule receives a new version after an order or review is completed
- **THEN** prior facts retain the old snapshot and only eligible later facts use the new version.
