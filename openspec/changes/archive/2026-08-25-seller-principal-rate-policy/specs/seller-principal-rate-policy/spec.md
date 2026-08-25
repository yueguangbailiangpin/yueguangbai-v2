# Seller principal rate policy

## ADDED Requirements

### Requirement: seller principal rate is based on the platform order date

For a new Amazon formal order, the seller-principal final rate MUST use the exact `amazon_order_date` as the China business date, the authoritative confirmed JPY→CNY daily rate for that date, and the effective seller-principal markup. The system MUST NOT use confirmation date or a nearby date as a fallback.

#### Scenario: exact order date is selected

- **WHEN** an order has `amazon_order_date=2026-08-01`, the confirmed daily rate for 2026-08-01 is `0.051`, and the selected markup is `+0.004`
- **THEN** the snapshot records the 2026-08-01 rate version and computes final rate `0.055`

#### Scenario: missing order-date rate fails closed

- **WHEN** no confirmed authoritative daily rate exists for the exact `amazon_order_date` by confirmation time
- **THEN** confirmation returns `SELLER_PRINCIPAL_RATE_NOT_FOUND` with no formal order, payable, or strategy snapshot created

### Requirement: policy priority and explicit zero are durable

The resolver MUST select a seller-organization policy over the currency-pair default when both are effective. A confirmed organization policy with markup value zero MUST be selected and MUST NOT be treated as absent.

#### Scenario: organization override wins

- **WHEN** the default is `+0.004` and the seller organization override is `+0.006`
- **THEN** the snapshot uses `+0.006` and records the override scope and version

#### Scenario: explicit zero wins

- **WHEN** the default is `+0.004` and the organization has a confirmed effective override of `0`
- **THEN** the snapshot uses zero and records the organization policy version

### Requirement: policy versions are future-effective and auditable

Policy changes MUST be versioned by scope and currency pair, carry effective time and Staff audit identity, require expected-version and idempotency controls, and affect only confirmations at or after the effective boundary. Seller customers MUST NOT write policy.

#### Scenario: future policy does not affect earlier confirmation

- **WHEN** a new policy is confirmed with an effective time after a prospective order confirmation
- **THEN** the earlier confirmation uses the prior effective policy and the later confirmation can use the new version

#### Scenario: unauthorized write is rejected

- **WHEN** a Seller customer or a Staff actor without the effective Seller-management/financial-confirmation permission submits or confirms a policy
- **THEN** the request is rejected with 403 and no policy version or audit event is created

### Requirement: confirmation stores an immutable seller-principal snapshot

Formal order confirmation MUST store platform order date, payment amount/currency, base rate version/value, selected policy scope/version/value, final rate, `HALF_UP`, and calculated seller-principal amount in one immutable snapshot. It MUST use integer fixed-point arithmetic without floating point.

#### Scenario: sample amount is calculated exactly

- **WHEN** final paid amount is 10,000 JPY, base rate is `0.051`, and markup is `+0.004`
- **THEN** seller expected principal is `55000` CNY fen and the snapshot stores final rate `5500000/100000000`

#### Scenario: database rejects an amount that is not the HALF_UP result

- **WHEN** direct SQL supplies a safe but incorrect `seller_expected_principal_amount_minor` for an otherwise valid snapshot
- **THEN** the 0041 trigger rejects the insert; the guard proves the amount using quotient/remainder decomposition without overflowing SQLite INTEGER arithmetic

#### Scenario: snapshot cannot be rewritten

- **WHEN** a caller attempts to update or delete a seller-principal snapshot after confirmation
- **THEN** the database rejects the operation and the original amount and rate remain unchanged

### Requirement: existing financial boundaries remain unchanged

This Change MUST alter only seller-principal calculation. Buyer refund, buyer daily-rate selection for its existing calculation, service fee, review, payable settlement state, and historical confirmed orders MUST retain their existing facts and behavior. The old Seller agreement/financial snapshot projection remains available for compatibility.

#### Scenario: legacy agreement change does not rewrite seller principal history

- **WHEN** a later Seller agreement version is confirmed after a formal order
- **THEN** the earlier order's old fields, new seller-principal snapshot, payable amount, buyer refund facts, and service fee facts remain unchanged

### Requirement: policy state and audit facts are database guarded

Migration 0041 MUST enforce an initial `SUBMITTED` state, permit only `SUBMITTED` to `CONFIRMED` or `REJECTED`, make terminal policy versions and policy events immutable, and reject deletes. It MUST allow at most one pending version per scope, seller/null, and currency pair, and at most one confirmed version at each effective boundary.

#### Scenario: direct SQL cannot bypass policy or event lifecycle

- **WHEN** direct SQL inserts a confirmed policy, changes or deletes a policy/event, or inserts an event with an inconsistent transition tuple
- **THEN** D1 rejects the statement and leaves the original audit facts unchanged

#### Scenario: concurrent submissions have one pending winner

- **WHEN** two Staff commands submit different versions for the same policy target concurrently
- **THEN** exactly one pending version is created and the other command returns a stable conflict

### Requirement: snapshot source relationships are database-proven

The snapshot guard MUST require `base_rate_business_date = platform_order_date`, require the default policy organization to be `NULL`, and require an organization override's seller organization to equal the formal order's seller organization. A cross-date or cross-organization snapshot MUST be rejected before it can become a financial fact.

#### Scenario: cross-source snapshot tampering fails

- **WHEN** a caller inserts a snapshot with a base-rate date different from the platform order date or an override organization different from the formal order
- **THEN** the database rejects the insert with no snapshot or payable fact created

### Requirement: Staff data scope is independently enforced

The policy API MUST consume the trusted `staffDataScope` resolved by Staff middleware. A read for an organization outside that scope MUST return concealed `404 NOT_FOUND`; a write outside that scope MUST return `403 FORBIDDEN` before idempotency, policy, event, audit, or outbox facts are created. A currency-pair default is global data and may be submitted only by a Staff actor with `GLOBAL` data scope; under the current four-role catalog that is the `owner` role. A GLOBAL Owner may also submit an organization override for an active organization; a locally assigned Seller Ops actor may submit only its assigned organization override and MUST NOT modify the global default. Personal DENY remains effective even when the request includes `SELLER_MANAGE` in an untrusted or stale actor shape.

#### Scenario: assigned and global scopes are bounded

- **WHEN** assigned Seller Ops reads/writes its assigned organization, reads another organization, or submits a global default; and a real Owner session resolves to GLOBAL and submits the default
- **THEN** only the assigned read/write and Owner global write succeed; cross-organization reads are concealed 404, local global writes are 403, and no denied request creates policy, event, audit, outbox, or idempotency facts

### Requirement: Staff has an auditable configuration entry point

Authorized Staff MUST have a visible Staff workbench entry that reads the default and seller-organization policies, displays an explicit zero as a value, submits a future-effective change with idempotency/version fields, and lets an Owner with financial confirmation permission confirm or reject a pending version. The policy API and its error responses MUST be `Cache-Control: no-store`; Seller customers and Personal DENY actors MUST not gain access through this entry point.

#### Scenario: Staff completes a policy decision from the workbench

- **WHEN** Seller Ops opens the Staff policy entry, submits an explicit `0` or a future markup, and an authorized Owner reviews the pending row
- **THEN** the workbench displays default/override facts and the Owner can confirm or reject with stable idempotent requests, while Seller customers remain denied

### Requirement: production cutover is ordered and fail-closed

The release MUST expose an explicit `SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED` switch, defaulting to disabled. With the switch disabled, the deployed schema and Staff configuration workbench remain usable and formal-order confirmation stays on the 0040-compatible calculation path; with the switch enabled, both confirmation paths MUST require the new exact-date strategy and fail closed when it is absent. The runbook MUST apply Migration 0041, create and Owner-confirm the default JPY→CNY policy with an explicit effective time, locally verify a matching order-date rate, and only then separately authorize the switch. Historical orders and existing payables MUST never be recalculated.

#### Scenario: code enablement follows strategy activation

- **WHEN** the release window has applied 0041 but has not yet created and confirmed an effective default JPY→CNY policy
- **THEN** the switch remains disabled and confirmation uses the compatibility path; after the policy and order-date rate resolve successfully, a separately authorized switch enablement turns on fail-closed enforcement
