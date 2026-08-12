# Staff acquisition funnel source-authority alignment

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Original source is immutable and correction is controlled

The original Lead channel and originating Staff SHALL remain immutable attribution facts. A correction SHALL use the existing append-only, audited correction history and SHALL NOT overwrite the original source. Staff-safe Lead projections SHALL continue to exclude protected source Staff and private origin metadata.

#### Scenario: A source needs correction

- **WHEN** an authorized correction flow records a different effective source with a reason
- **THEN** the original source remains auditable, the correction is an additional immutable history fact with an Audit event, and ordinary Staff projections remain privacy-safe.
