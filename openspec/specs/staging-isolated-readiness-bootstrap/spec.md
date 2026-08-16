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

The operator tool SHALL accept only an exact staging D1 identity and Git-external owner-only input, require Schema 70, empty Staff authority and zero business stock across the guarded acquisition, Audit/Outbox, Buyer/Customer, file, order, product, review, Seller and finance entry tables, then atomically create exactly one active Owner, role, email identity, synthetic staging Buyer channel, authorization event and immutable Audit with command idempotency and final assertions. Its REST parameter arrays SHALL contain only strings. It SHALL expose no HTTP route, password or Access bypass.

#### Scenario: Empty staging D1 is bootstrapped

- **WHEN** an authorized operator submits a valid normalized identity and idempotency key to a fully migrated empty staging D1
- **THEN** exactly one Owner authority and one deterministic synthetic Buyer channel commit, and a same-request replay returns the same non-PII result without duplicate facts.

#### Scenario: Target, state or transaction is unsafe

- **WHEN** the environment resembles production/default, Schema is incomplete, any Staff authority or guarded business stock exists, the same key has different input, or any batch statement fails
- **THEN** the operation fails closed without partial Staff, identity, role, authorization or Audit facts.

### Requirement: Staging test identities use formal lifecycle paths

After first-owner bootstrap, the remaining canonical Staff accounts SHALL be created through the formal Owner-only Staff management API and authenticate through distinct Access-capable emails. The staging release SHALL explicitly enable invitation-based Buyer registration using the bootstrapped synthetic Buyer channel. Buyer and Seller synthetic accounts SHALL use formal onboarding, activation and password paths. Committed files and command output SHALL contain no real email, password, OTP, token or Secret.

#### Scenario: Operator prepares role-chain acceptance

- **WHEN** the Owner creates acquisition, pre_sales, seller_ops and buyer_refund Staff plus Buyer/Seller synthetic identities
- **THEN** each identity remains revocable, Staff has no application password, and all authority derives from the existing Access/D1 or Customer lifecycle boundary.

### Requirement: T8 activation evidence is redacted and independently reviewable

The repository SHALL record a T8-only staging activation summary that proves the reviewed release identity, isolated resource classes, Schema 70 migration ledger, pre/post integrity and foreign-key results, first-Owner outcome, required managed Secret names, Access-protected custom domain and authenticated health/readiness results. The committed evidence SHALL exclude Cloudflare resource IDs, Access audience/policy IDs, emails, Secret values, request IDs and raw provider logs. T9 business acceptance, T10 recovery and Production GO SHALL remain separate.

#### Scenario: Staging infrastructure baseline is activated

- **WHEN** the exact reviewed tree is ordinarily merged and deployed only to isolated staging resources, migrations 0069 and 0070 complete from an empty Schema 68 baseline, first-Owner bootstrap succeeds, and authenticated health/readiness return the governed staging profile
- **THEN** the T8 evidence records the merged SHA, Schema/ledger 70, integrity `ok`, zero foreign-key errors, one Owner authority, real R2 binding health, four `ok` readiness checks and five `not_required` checks without recording sensitive provider values.

#### Scenario: Evidence attempts to overclaim scope

- **WHEN** a T8 report includes T9 role/business acceptance, T10 recovery, production evidence, raw provider identifiers or unverified health claims
- **THEN** the Change is not ready for independent review or archive.

### Requirement: T9 acceptance evidence is stable-ID keyed, redacted and independently reviewable

The repository SHALL record the T9 staging acceptance outcome as a 67-row register with stable IDs (A01–H07), a final denominator summary (Passed/Failed/Conflict/Blocker), and Git-external `0600` evidence files for every executed row. Committed evidence SHALL exclude Cloudflare resource IDs, Access policy IDs, emails, tokens, passwords, request IDs and raw provider logs; buyer/seller identifiers SHALL be masked in committed documents. Environment-limited rows (missing staging adapters, single-order concurrency, external-network blockers) SHALL be classified with explicit evidence instead of being silently dropped. T10 recovery evidence and Production GO gates SHALL remain separate.

#### Scenario: T9 register is complete and evidence is verifiable

- **WHEN** all executable A–H rows have been exercised on staging (or explicitly classified) and the register reports 62 PASS / 0 FAIL with 3 governance conflicts and 2 external blockers
- **THEN** the register and evidence index are the review entry point, every PASS row maps to a 0600 evidence file, masked identifiers appear as `t9***01`-style projections, and no raw credentials or provider identifiers appear in the commit.

#### Scenario: Acceptance evidence is incomplete or overclaims

- **WHEN** a T9 row claims PASS without staging evidence, a count omits its denominator, environment limits are not recorded, or raw identifiers leak into committed documents
- **THEN** the Change is not ready for independent review or archive.
