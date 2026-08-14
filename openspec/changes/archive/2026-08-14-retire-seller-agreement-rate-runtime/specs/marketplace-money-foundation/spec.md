## ADDED Requirements

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

## MODIFIED Requirements

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
