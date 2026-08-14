# staging-isolated-readiness-bootstrap Specification

## Purpose

TBD: Define the long-term purpose after isolated staging activation and acceptance are complete.

## Requirements

### Requirement: Staging resources are isolated from production

Staging SHALL use distinct Worker, D1, R2, custom domain, Cloudflare Access application/audience, Secrets and synthetic identities. A shared Cloudflare account MAY provide resource isolation but SHALL NOT be described as account-level trust isolation.

#### Scenario: Staging configuration targets production

- **WHEN** a staging operator input names a production/default resource, mismatches the selected D1 name/ID or retains a placeholder
- **THEN** preflight fails before any D1 mutation or deployment.

### Requirement: Staging readiness is truthful and profile-specific

Staging SHALL report Scheduler, Outbox Delivery, Acquisition Maintenance, operational alerts and production recovery as `not_required`, not `ok`. It SHALL return ready only when Schema 70, isolated object storage, valid staging Access configuration and exact release SHA are `ok`, while every production-only switch remains disabled. Production SHALL continue to enforce its published readiness contract independently.

#### Scenario: Disabled staging production gates are intentional

- **WHEN** the staging release has exact disabled Scheduler, Outbox Delivery, Acquisition Maintenance and alert configuration, no production recovery attestation, plus valid required staging evidence
- **THEN** `/ready` returns 200 with five explicit `not_required` checks and four `ok` checks.

#### Scenario: Production or unknown environment is evaluated

- **WHEN** production lacks any one of its eight mandatory `ok` checks, an unknown environment is supplied, or staging enables a production-only switch
- **THEN** readiness returns 503 and no disabled capability is represented as healthy.

### Requirement: First staging Owner bootstrap is one-time and atomic

The operator tool SHALL accept only an exact staging D1 identity and Git-external owner-only input, require Schema 70, empty Staff authority and no Buyer channel, then atomically create exactly one active Owner, role, email identity, synthetic staging Buyer channel, authorization event and immutable Audit with command idempotency and final assertions. Its REST parameter arrays SHALL contain only strings. It SHALL expose no HTTP route, password or Access bypass.

#### Scenario: Empty staging D1 is bootstrapped

- **WHEN** an authorized operator submits a valid normalized identity and idempotency key to a fully migrated empty staging D1
- **THEN** exactly one Owner authority and one deterministic synthetic Buyer channel commit, and a same-request replay returns the same non-PII result without duplicate facts.

#### Scenario: Target, state or transaction is unsafe

- **WHEN** the environment resembles production/default, Schema is incomplete, any Staff authority exists, the same key has different input, or any batch statement fails
- **THEN** the operation fails closed without partial Staff, identity, role, authorization or Audit facts.

### Requirement: Staging test identities use formal lifecycle paths

After first-owner bootstrap, the remaining canonical Staff accounts SHALL be created through the formal Owner-only Staff management API and authenticate through distinct Access-capable emails. The staging release SHALL explicitly enable invitation-based Buyer registration using the bootstrapped synthetic Buyer channel. Buyer and Seller synthetic accounts SHALL use formal onboarding, activation and password paths. Committed files and command output SHALL contain no real email, password, OTP, token or Secret.

#### Scenario: Operator prepares role-chain acceptance

- **WHEN** the Owner creates acquisition, pre_sales, seller_ops and buyer_refund Staff plus Buyer/Seller synthetic identities
- **THEN** each identity remains revocable, Staff has no application password, and all authority derives from the existing Access/D1 or Customer lifecycle boundary.
