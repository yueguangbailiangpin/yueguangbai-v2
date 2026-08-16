# Rakuten and TikTok Japan Marketplace Foundation

## ADDED Requirements

### Requirement: Japan marketplaces are canonical and provider-disabled

The registry MUST expose `RAKUTEN_JP` and `TIKTOK_JP` with region `JP`, transaction currency `JPY`, Chinese display names, and `adapter_status=UNAVAILABLE`. Amazon registry rows and existing JP alias behavior MUST remain compatible.

#### Scenario: registry resolves the new marketplaces

- **WHEN** local registry resolution requests `RAKUTEN_JP` or `TIKTOK_JP`
- **THEN** it returns JP/JPY and the correct Chinese platform label, while a provider-required operation returns `MARKETPLACE_ADAPTER_UNAVAILABLE` without an external call

#### Scenario: Amazon remains compatible

- **WHEN** existing Amazon JP/US resolution and identifier validation run
- **THEN** they retain their prior canonical codes and Amazon order/ASIN behavior

### Requirement: platform identifiers are separated from Amazon legacy fields

Formal order, evidence and product identity contracts MUST use `marketplace_code` with platform-neutral identifiers. Rakuten/TikTok identifiers MUST NOT be validated as Amazon order numbers or ASINs. Uniqueness MUST be scoped by marketplace so equal strings on different platforms do not collide.

#### Scenario: confirmed Rakuten order and TikTok product are accepted

- **WHEN** a local importer validates Rakuten order `123456-20260810-0000000001` and TikTok product `tiktokDLP2555Q`
- **THEN** it returns platform-neutral identifiers associated with their own marketplace codes and does not populate an Amazon legacy field

#### Scenario: same identifier is isolated across marketplaces

- **WHEN** two local identity rows use the same platform order or product string under different marketplace codes
- **THEN** both are accepted, while a duplicate under the same marketplace is rejected

#### Scenario: non-Amazon formal order has no Amazon legacy projection

- **WHEN** an in-scope Rakuten or TikTok `platform_formal_orders` record is read by the Seller API
- **THEN** the DTO returns `legacy_projection=NONE`, null Amazon order/ASIN and null unavailable finance/workflow projections while preserving the canonical marketplace and platform identifiers

### Requirement: identifier validation is layered and fail closed

The common validator MUST enforce only normalized non-empty bounded identifiers and reject control characters. The Rakuten historical order profile MUST validate `6-digit-store-8-digit-date-10-digit-sequence`. The TikTok historical `585`/18-digit rule MUST be opt-in and MUST NOT constrain the default future TikTok validator.

#### Scenario: TikTok future identifier is not rejected by historical evidence

- **WHEN** a TikTok order does not match the optional historical 585 profile but is a valid bounded platform identifier
- **THEN** the default validator accepts it and the historical-profile validator rejects it with a profile-specific error

#### Scenario: malformed identifiers fail without provider access

- **WHEN** an identifier is empty, contains a control character, exceeds the bound, or violates a selected strict profile
- **THEN** validation returns a stable local error and records zero provider/external calls

#### Scenario: profile and control-character boundaries fail closed

- **WHEN** an Amazon identifier is supplied with a Rakuten/TikTok profile, or any generic identifier contains a control character including leading/trailing tab or newline
- **THEN** validation rejects it before normalization can hide the mismatch or control character

### Requirement: seller organization and store isolation is retained

Identity bindings MUST accept only an active seller organization and a store belonging to that organization and marketplace. Cross-organization, cross-store, disabled-store, revoked-scope and Personal DENY requests MUST be rejected or concealed according to existing Seller policy, with no identity or audit row created on denial.

#### Scenario: TikTok Philips mapping is representable but not provisioned

- **WHEN** a local fixture describes store Philips under organization `ygbceping:ls381048211`
- **THEN** the contract can represent the mapping, but the Migration creates no seller, store, member, order or product business row

#### Scenario: revoked or Personal DENY access remains denied

- **WHEN** a Seller member loses store scope or a Personal DENY applies
- **THEN** identity reads return the existing concealed/forbidden result and cannot be bypassed by a marketplace or store value supplied by the client

#### Scenario: order and product scopes match exactly

- **WHEN** an order identity references a product identity
- **THEN** both identities are either unscoped or have the exact same seller organization and store; cross-organization, cross-store and scoped/unscoped combinations are rejected

### Requirement: buyer registration support is explicit

Buyer invitation and registration MUST share one buyer-supported marketplace allowlist. This Change MUST NOT issue Rakuten/TikTok buyer invitations while their registration flow and legacy invitation FK do not support those marketplaces.

#### Scenario: unsupported buyer invitation has no partial write

- **WHEN** Staff submits `RAKUTEN_JP` or `TIKTOK_JP` to the buyer-invitation route
- **THEN** the API returns controlled 400 and writes no invitation, token event, audit event or idempotency result

### Requirement: internal communication evidence remains protected

Chat screenshots for these marketplaces MUST continue to use `ORDER_EVIDENCE_INTERNAL_COMMUNICATION`, short read intents and Seller lazy loading. Responses MUST NOT expose R2 object keys, permanent URLs, or unrestricted file bytes.

#### Scenario: authorized short read is scoped

- **WHEN** an authorized Seller reads an internal communication evidence item for an in-scope order
- **THEN** the system rechecks permission and returns only the short-lived controlled read result; an out-of-scope or revoked request is denied

#### Scenario: platform attachment reuses the protected file chain

- **WHEN** authorized Staff attaches a verified Seller-visible image to an in-scope Rakuten/TikTok formal order
- **THEN** one immutable platform communication evidence/file association is created with `ORDER_EVIDENCE_INTERNAL_COMMUNICATION`, explicit Seller-organization audience and exact organization/store scope, while the existing Amazon association remains unchanged

#### Scenario: platform screenshot availability is dynamic

- **WHEN** an in-scope platform formal order has an active verified screenshot association
- **THEN** the Seller formal-order DTO reports `AVAILABLE` with the current file version and the existing lazy control can request one short read intent; no association reports `NONE`, and revoked member/store/link/grant/file authority is concealed as not found

### Requirement: mixed formal-order pagination is globally stable

Seller formal-order pagination MUST merge legacy and platform records using one descending `(confirmed_at, formal_order_id)` keyset. Every accepted row MUST appear exactly once across consecutive pages, including equal timestamps.

#### Scenario: mixed pages neither skip nor repeat

- **WHEN** legacy and platform formal orders are interleaved across timestamps and page boundaries
- **THEN** following `next_cursor` to exhaustion returns the global sort order with no missing or duplicate formal-order id

### Requirement: Migration is transactional and reversible before new facts

Migration `0042_rakuten_tiktok_jp_marketplace_foundation.sql` MUST apply after schema 41, be idempotency-guarded against repeat and wrong-order execution, preserve Amazon rows, and leave no partial DDL or schema-version change after failure. It MUST not access production D1/R2 or insert real historical data.

#### Scenario: fresh and sequential local D1 succeed

- **WHEN** local D1 applies all migrations in order
- **THEN** schema version is 42, registry, identity and platform screenshot association schema assertions pass, object inventory is current, and integrity/foreign-key checks are clean

#### Scenario: repeat or wrong-order local execution rolls back

- **WHEN** 0042 is repeated or run without schema 41
- **THEN** the transaction fails with the governed assertion and leaves the prior schema/data unchanged

#### Scenario: legacy registry is a frozen compatibility parent

- **WHEN** local SQL attempts to insert, update or delete `marketplace_registry_legacy_0029`
- **THEN** a compatibility-boundary trigger rejects the mutation and canonical resolution continues to use only `marketplace_registry`

### Requirement: adapter and UI state is honest and Chinese

Runtime and UI contracts MUST display Chinese platform names and unavailable-provider state. No UI action may imply Rakuten/TikTok provider connectivity while registry `adapter_status` is unavailable. A separate provider feature flag MUST NOT be claimed until a real provider-required runtime path consumes it.

#### Scenario: unavailable platform is rendered honestly

- **WHEN** a Seller or Staff DTO contains `RAKUTEN_JP` or `TIKTOK_JP`
- **THEN** it renders the Chinese platform name and “未接入/暂不可用” state, without a provider action or invented external status
