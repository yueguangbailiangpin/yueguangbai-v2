## Purpose

Preserve Seller settlement history after Store disablement without broadening non-financial Seller authority.

## ADDED Requirements

### Requirement: OWNER settlement preserves organization-wide financial history

The Seller Portal SHALL allow a current active OWNER of an active Seller Organization to read organization-wide settlement summary, payable and payment history. The summary and payable projection SHALL include immutable historical settlement facts for Stores that are now disabled. The current Seller UI Store selection SHALL NOT narrow or change these settlement reads.

#### Scenario: A Store is disabled with an outstanding historical payable

- **WHEN** an active OWNER reads settlement after an organization Store with an existing payable has been disabled
- **THEN** the OWNER summary includes that outstanding amount and the payable list/detail can return the disabled Store's historical payable.

#### Scenario: OWNER changes the current Store selector

- **WHEN** an OWNER selects any current Store while the settlement page is open
- **THEN** settlement summary, payables and payments remain organization-wide and no client-selected `store_id` becomes authorization or a settlement filter.

#### Scenario: OWNER reads organization payment history

- **WHEN** an active OWNER reads Seller payments or unallocated credit
- **THEN** the service returns the organization's payment history without projecting internal company finance fields.

### Requirement: FINANCE settlement remains limited to current assigned active Stores

The Seller Portal SHALL allow a current active FINANCE member to read settlement summary and payables only for Store IDs produced by current active assignments or grants joined to current active Stores. FINANCE SHALL NOT receive disabled, revoked, unassigned or cross-organization payable facts, organization-level unallocated credit, or organization payment resources.

#### Scenario: FINANCE is assigned only an active Store

- **WHEN** active and disabled Stores in the same organization both have historical payables and FINANCE is currently assigned only the active Store
- **THEN** FINANCE summary and payables include only the assigned active Store and conceal the disabled Store payable.

#### Scenario: FINANCE probes organization payments

- **WHEN** FINANCE requests organization-level Seller payments
- **THEN** the resource is concealed because payments have no authoritative Store attribution and FINANCE does not have organization scope.

### Requirement: Financial-history preservation does not reactivate non-financial Store authority

The organization-wide OWNER settlement exception SHALL be consumed only by Seller settlement summary, payable and payment reads. It SHALL NOT alter active Store resolution or grant catalog, product application, demand, formal-order, review, file, upload or write authority for a disabled Store. FINANCE and other non-OWNER members SHALL continue to derive all non-financial Store authority from current active assignments or grants joined to active Stores.

#### Scenario: Disabled Store remains outside general member scope

- **WHEN** a disabled Store retains historical settlement facts
- **THEN** those facts remain available only through the applicable settlement history boundary and the Store does not become active or assigned for non-financial reads, files or writes.

### Requirement: Seller settlement scope copy is explicit

The Seller settlement page SHALL tell OWNER that settlement is organization-wide financial history including disabled-Store historical settlement and does not follow the current Store selector. The FINANCE page SHALL state that settlement is aggregated only across authorized Stores and does not follow the current Store selector.

#### Scenario: OWNER and FINANCE open settlement

- **WHEN** the trusted Seller identity response reports `ORGANIZATION` for OWNER or `ASSIGNED_STORES` for FINANCE
- **THEN** the page renders the matching unambiguous scope explanation without changing request scope or financial values.
