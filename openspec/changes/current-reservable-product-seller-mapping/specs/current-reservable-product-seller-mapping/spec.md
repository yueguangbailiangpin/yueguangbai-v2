# Current reservable product and seller mapping

## ADDED Requirements

### Requirement: owner availability corrections fail closed

The local projection MUST exclude current rows explicitly marked `PAUSED` and
the known blank Philips row, preserving stable exception codes and source
references. It MUST coalesce the four Somiso JP rows when they carry owner-
provided ASIN `B0GR5C43PG`. It MUST retain the historical source for
`ygbceping / shiguo0317` at `B0GRMRV64K` while excluding that offering from
available supply.

#### Scenario: paused and blank rows are excluded

- **WHEN** a current row is marked `PAUSED` or is the known blank Philips row
- **THEN** preview returns an `EXCLUDED` row and does not create a standard
  product or mapped seller offering.

#### Scenario: owner-excluded seller remains historical only

- **WHEN** `ygbceping / shiguo0317` is excluded for `B0GRMRV64K` and
  `ido-mango / szgavin68` is retained
- **THEN** the former is recorded under excluded seller evidence and the
  latter is the only available offering.

### Requirement: staging import plan is read-only and fail-closed

The staging plan MUST include every current standard product, but MUST create
an eligible candidate for each source row only when seller mapping exists, the
current row is active, and `orderTotal` is a positive integer. It MUST list
unmapped, empty/non-positive, and excluded/quarantined rows with reasons, and
MUST NOT merge same-ASIN rows with different order or review fields.
It MUST include product-version and legacy reservation runtime fields while
performing zero database, Cloudflare, Tencent Docs, or external writes.

#### Scenario: mapped positive-order product becomes a candidate

- **WHEN** a current standard product has an active row with positive integer
  `orderTotal` and a mapped seller offering
- **THEN** the JSON plan contains one eligible product/seller candidate and
  the corresponding product-version and pending reservation runtime fields.

#### Scenario: same ASIN rows remain separate tasks

- **WHEN** two current rows share an ASIN but have different order totals or
  review requirements
- **THEN** the plan emits separate source-row candidates and separate stable
  reservation task IDs.

#### Scenario: missing seller or order total stays closed

- **WHEN** a standard product has no mapped seller or no positive integer
  `orderTotal`
- **THEN** the product remains in the plan with explicit no-open reasons and
  no eligible candidate.

#### Scenario: review text does not guess task type

- **WHEN** source review text cannot be safely converted to a legacy task type
- **THEN** the plan uses only the documented conservative `TEXT` placeholder,
  marks the task pending Staff review, and does not publish it.

#### Scenario: explicit review allocation is split

- **WHEN** review text contains explicit `n单图评` and `n单文评` allocations
- **THEN** the plan emits one `IMAGE` task and one `TEXT` task with their
  respective quantities.

#### Scenario: Rakuten identities remain data-only

- **WHEN** a standard product has marketplace `JP_RAKUTEN` and identifier
  `R-1` or `S-1`
- **THEN** the plan retains a `platform_product_identities` record with
  `UNSUPPORTED_RUNTIME_MARKETPLACE` and creates no legacy product, version,
  seller offering, or reservation task.

#### Scenario: emitted SQL is idempotent

- **WHEN** the same plan is emitted twice with the same actor, timestamp, and
  batch ID
- **THEN** the SQL uses stable IDs and `INSERT OR IGNORE`, writes no seller
  channel sequence update, and produces the same SQL text.
