# Historical order master and chat screenshot migration

## ADDED Requirements

### Requirement: Full source manifest is reproducible and conserved

The local generator MUST read only `数据母表`, verify the frozen source SHA-256, and emit exactly one manifest record for every non-empty source row. It MUST include a stable source row key, source row number, raw text provenance, and deterministic manifest hash.

#### Scenario: source rows are conserved

- **WHEN** the local dry-run completes for the frozen workbook
- **THEN** it reports 16,304 source rows, 14,902 structural candidates and 1,402 quarantined rows under the current blank-status cutoff and platform rules, with candidate plus quarantine equal to source rows.

#### Scenario: source drift fails closed

- **WHEN** the workbook SHA-256 or required `数据母表` headers differ
- **THEN** the generator fails before writing a manifest and reports zero external writes.

### Requirement: Order lines and duplicate orders are preserved

The manifest MUST model each recognized marketplace-aware order row as an order line, MUST expose unique `(marketplace_code, platform_order_identifier)` identities and duplicate groups, preserve raw identifiers and normalization basis, and MUST quarantine exact duplicate source facts without deleting or silently coalescing conflicting rows.

#### Scenario: marketplace-aware order shapes are classified

- **WHEN** an order identifier matches Amazon `^\d{3}-\d{7}-\d{7}$`, Rakuten `^\d{6}-\d{8}-\d{10}$` or TikTok Japan `^585\d{15}$`
- **THEN** it receives the corresponding marketplace code and remains eligible for local structural candidacy; it is not isolated merely for failing the Amazon shape.

#### Scenario: Amazon missing separator is explicit

- **WHEN** an order identifier matches `^\d{3}-\d{14}$`
- **THEN** it retains the raw value, deterministically exposes a 3-7-7 normalized identifier with basis `NORMALIZED_MISSING_SEPARATOR`, and does not silently rewrite source provenance.

#### Scenario: unsupported pure numeric outlier remains closed

- **WHEN** a pure numeric order identifier is 17 digits and does not match the confirmed TikTok `^585\d{15}$` rule
- **THEN** it remains unrecognized and is quarantined for order shape without guessing a platform.

#### Scenario: duplicate-group identity is present only for repeated orders

- **WHEN** a recognized marketplace-aware order has exactly one source row
- **THEN** `order_number_key` remains populated and `duplicate_group_key` is `null`.

- **WHEN** a recognized marketplace-aware order has more than one source row
- **THEN** every preserved line in that group receives the same non-null `duplicate_group_key` and the reported group size is greater than one.

#### Scenario: conflicting duplicate order facts remain separate

- **WHEN** one Amazon order number occurs with differing product, store, price or other source facts
- **THEN** each source row remains a distinct order line and the duplicate group is reported as conflicting.

#### Scenario: exact duplicate source facts are isolated

- **WHEN** one Amazon order number has multiple identical non-image source facts
- **THEN** all such source rows are quarantined with `EXACT_DUPLICATE_SOURCE_FACTS` and no row is silently deleted.

### Requirement: Refund and lifecycle mapping is dual-sided and provenance-preserving

The manifest MUST map buyer and seller-principal statuses independently, apply frozen order-number overrides before raw labels, preserve raw refund labels and basis, apply the blank-status order-date cutoff at the inclusive `2026-01-01` boundary, and never treat a date prefix as an imported payment date.

#### Scenario: refund evidence improves buyer status only

- **WHEN** a wait-refund label has a parseable refund date and W-column refund screenshot
- **THEN** buyer status is `REFUNDED`, while seller status remains determined by the frozen label or order override.

#### Scenario: unresolved refund labels remain isolated

- **WHEN** refund status is a `催评` variant
- **THEN** buyer and seller-principal statuses are both `PENDING`, mapping is `MAPPED`, lifecycle is `ACTIVE`, basis is `OWNER_RULE`, and the raw label remains provenance.

#### Scenario: blank refund status uses the inclusive date cutoff

- **WHEN** raw refund status is blank and order date is `2025-12-31`
- **THEN** buyer and seller-principal status are `REFUNDED`, mapping is `MAPPED`, lifecycle is `ACTIVE`, basis is `OWNER_RULE_DATE_CUTOFF`, and the blank raw value remains provenance.

- **WHEN** raw refund status is blank and order date is `2026-01-01`
- **THEN** buyer and seller-principal status are `PENDING`, mapping is `MAPPED`, lifecycle is `ACTIVE`, basis is `OWNER_RULE_DATE_CUTOFF`, and the blank raw value remains provenance.

- **WHEN** raw refund status is blank and order date is missing or invalid
- **THEN** the row remains isolated for the existing date reason and does not receive a guessed cutoff status.

### Requirement: Product and seller authority fails closed

The generator MUST normalize marketplace-aware product identities and compare historical product keys with the latest current mapping evidence. It MUST preserve single-seller candidates, unresolved sellers, multi-seller ambiguity and no-current-match results as distinct outcomes, and MUST NOT create a formal seller binding from product similarity alone.

#### Scenario: TikTok owner-confirmed local candidate is not an Amazon ASIN

- **WHEN** one of the ten `^585\d{15}$` TikTok rows has a blank source product identifier
- **THEN** the manifest retains raw blank provenance, records manual identifier `tiktokDLP2555Q` and canonical `TIKTOKDLP2555Q`, records owner-confirmed store `Philips` and Seller Organization `ygbceping:ls381048211`, and keeps production eligibility false because the registry lacks TikTok.

#### Scenario: local-only marketplace projections fail closed

- **WHEN** an order or product belongs to `JP_RAKUTEN` or `JP_TIKTOK`
- **THEN** production eligibility remains false, the order carries the corresponding `MARKETPLACE_REGISTRY_UNSUPPORTED_*` blocker, and the product schema status is `LOCAL_CANONICAL_CANDIDATE_REGISTRY_UNSUPPORTED`.

#### Scenario: multi-seller product cannot bind an order

- **WHEN** current mapping evidence has more than one Seller Organization for a product key
- **THEN** the row remains a candidate-only result with an explicit cross-seller guard and no authoritative binding.

#### Scenario: unknown historical product remains closed

- **WHEN** a valid historical product key is absent from current mapping evidence
- **THEN** the row is classified as `NO_CURRENT_PRODUCT_MATCH` and is not made production-import eligible.

### Requirement: Chat and arrival images have separate conservation policies

The generator MUST count H-column chat image anchors at image level, classify them as deferred association or isolated, preserve H-image conservation, and mark every K-column arrival image as `IGNORE_DO_NOT_MODEL_DO_NOT_IMPORT`. It MUST not extract or upload image bytes.

#### Scenario: chat image waits for formal order authority

- **WHEN** an H-column image belongs to a structural candidate with a valid order
- **THEN** the manifest records a deferred `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` association plan that requires formal-order, Seller Organization, Store and Audience checks.

#### Scenario: TikTok chat plan remains local-only

- **WHEN** an H-column image belongs to one of the owner-confirmed TikTok rows
- **THEN** it records the deferred chat association plan with the owner-confirmed `Philips`/organization scope, while retaining the `MARKETPLACE_REGISTRY_UNSUPPORTED_JP_TIKTOK` production blocker and performing no upload.

#### Scenario: Rakuten chat plan remains local-only

- **WHEN** an H-column image belongs to a recognized `JP_RAKUTEN` order
- **THEN** its deferred association plan carries `MARKETPLACE_REGISTRY_UNSUPPORTED_JP_RAKUTEN`, cannot be attached early, and performs no upload.

#### Scenario: arrival image is never repurposed

- **WHEN** a K-column image anchor is present
- **THEN** it is counted for evidence only and is not modeled as chat evidence, uploaded or displayed.

### Requirement: Dry-run has zero external writes and explicit future controls

The dry-run MUST report zero external calls, Tencent Docs writes, database writes, R2 writes, image-byte extraction, Migration runs and deployments. It MUST document future idempotency, replay, duplicate-image and rollback controls without executing them.

#### Scenario: local dry-run remains read-only

- **WHEN** the full generator and negative tests run
- **THEN** only caller-selected local evidence files are written and all external-write counters are zero.
