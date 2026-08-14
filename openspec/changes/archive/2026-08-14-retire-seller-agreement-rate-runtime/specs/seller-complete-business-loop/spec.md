## ADDED Requirements

### Requirement: Seller principal policy snapshots are read-only to Seller

The system SHALL allow a Seller to view the immutable platform order date, daily base rate, applied principal-policy scope and version, markup, final rate, rounding rule, and Seller principal amount used by an authorized order, and SHALL provide no Seller route that submits, confirms, rejects, or edits Staff-controlled rate or policy facts.

#### Scenario: Seller views locked principal policy

- **WHEN** a Seller opens an authorized Amazon formal order
- **THEN** the exact principal-policy snapshot is displayed read-only and no legacy agreement-rate field is present in the response.

#### Scenario: Seller attempts principal-policy mutation

- **WHEN** a Seller calls a Staff principal-policy command or supplies rate or policy fields in a Seller command
- **THEN** the request is rejected or ignored by a strict allowlist and no policy, rate, snapshot, or principal fact changes.

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Seller agreement rates are read-only to Seller

**Reason**: Seller Agreement Rate is retired as a runtime, Contract, UI, and schema authority and is replaced by the immutable Seller Principal Rate Policy snapshot.

**Migration**: Current Seller consumers use `seller_principal_rate_snapshot`; the legacy `seller_agreement_rate_snapshot` field is removed rather than aliased or returned as null for Amazon orders.
