# Current reservable product and seller mapping

## ADDED Requirements

### Requirement: current whitelist is authoritative

The local projection MUST treat only the `工作表1` and `飞利浦产品` worksheets from the frozen current-summary source as the current reservation whitelist. Rows from `订单明细`, `订单详情`, or historical folders MUST NOT become current products solely because they contain a valid ASIN.

The frozen read-only snapshot contains 114 current source rows: 109 rows with valid platform product identifiers and 5 rows quarantined for missing identifiers. It contains 88 unique current products: 86 Amazon ASIN identities and two `JP_RAKUTEN` identities, `R-1` and `S-1`.

#### Scenario: historical-only product remains closed

- **WHEN** a historical row has a valid ASIN that does not appear in either current worksheet
- **THEN** the preview keeps it as historical supply or quarantine evidence and does not mark it current or reservation-eligible.

#### Scenario: current worksheets are both included

- **WHEN** a valid row appears in either `工作表1` or `飞利浦产品`
- **THEN** it participates in current-product deduplication and can produce an eligible mapped offering after seller resolution.

### Requirement: product identity and field validation are explicit

The projection MUST normalize a product by `(marketplace_code, platform_product_identifier)`. Amazon identifiers MUST be valid 10-character ASINs. `JP_RAKUTEN` MUST accept only the explicit identifiers `R-1` and `S-1`. Missing or invalid identifiers MUST be quarantined. It MUST preserve duplicate current rows as source rows while exposing one standard-product candidate per normalized key and reporting conflicting product fields.

#### Scenario: duplicate current rows coalesce

- **WHEN** multiple current rows have the same marketplace and normalized ASIN
- **THEN** preview emits one standard-product candidate and retains all source row references.

#### Scenario: explicit Rakuten identifiers are valid

- **WHEN** a row contains `R-1` or `S-1` in the ASIN field
- **THEN** it is retained as a valid `JP_RAKUTEN` product identity and is not treated as an Amazon ASIN.

### Requirement: seller identity is folder-bounded unless explicitly linked

Historical seller groups MUST be keyed by `(source_folder_id, normalized_wechat)` by default. The parser MUST apply only the frozen folder defaults, approved channel aliases, and the nine owner-confirmed seller mappings; equal WeChat values across folders MUST remain separate unless an explicit mapping links them.

#### Scenario: same WeChat in different folders stays separate

- **WHEN** two valid historical rows normalize to the same WeChat but have different frozen source folders
- **THEN** preview emits two seller organization keys and does not merge their offerings.

#### Scenario: confirmed Philips and GoldHorizon mapping is one organization

- **WHEN** current rows use `Philips Power オフィシャル` or `GoldHorizon Direct`
- **THEN** both resolve to the explicit `ls381048211` seller organization in the `ygbceping` channel, with separate store/product context and no duplicate organization.

### Requirement: seller supply preserves multi-seller ASINs

The projection MUST retain one mapped offering per distinct seller organization and marketplace-aware product key. It MUST NOT overwrite an earlier seller when multiple sellers supply the same product identity, and it MUST report those keys in a multi-seller anomaly section.

#### Scenario: one ASIN has two sellers

- **WHEN** current or historical evidence maps one `(marketplace, platform_product_identifier)` to two distinct seller organization keys
- **THEN** both offerings remain in the preview and the product appears in `sameAsinMultiSeller`.

### Requirement: unresolved history fails closed

Historical rows with missing/ambiguous seller WeChat, unknown channel, invalid ASIN, conflicting explicit routing, or the excluded `自发货-店铺评论` source MUST remain `QUARANTINED`/`EXCLUDED` and MUST NOT create a login, invitation, active offering, or reservation opening.

#### Scenario: missing seller identity

- **WHEN** a historical product has no seller WeChat and no owner-confirmed file mapping
- **THEN** it is included in the quarantined-history report with a stable exception code and no mapped offering.

#### Scenario: current product has an explicit seller but no history

- **WHEN** a current product uses an owner-confirmed current-store mapping and no historical row matches its product key
- **THEN** it is reported under confirmed sellers without history and remains a local preview result only.

### Requirement: preview is read-only and reproducible

Preview MUST be deterministic for the same normalized manifests, include a manifest hash and source references, and report external calls and writes as zero. The implementation MUST not call Tencent Docs or production resources during local parsing/tests.

#### Scenario: repeated preview is stable

- **WHEN** the same local current and historical manifests are previewed twice
- **THEN** the hash, counts, mappings, and anomaly ordering are identical.
