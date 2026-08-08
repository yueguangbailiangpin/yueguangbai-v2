# seller-self-service-submissions Specification

## Purpose
TBD - created by archiving change seller-portal-self-service-submissions. Update Purpose after archive.
## Requirements
### Requirement: Seller submission entry exists
The Seller portal SHALL provide clear Chinese entries for submitting a product application and, for an approved product, submitting a demand batch.

#### Scenario: Authorized Seller opens the portal
- **WHEN** an OWNER or OPERATIONS member visits the relevant Seller list
- **THEN** the permitted submission action is visible, keyboard reachable and opens the correct form.

### Requirement: Seller scope remains server-authoritative
Submission requests SHALL derive Seller Organization, member role and authorized Store scope from the trusted Customer Session and SHALL NOT accept client authority fields.

#### Scenario: Cross-Store input is submitted
- **WHEN** a Seller supplies a Store or Product outside current authorization
- **THEN** the backend conceals or rejects it without creating an application, demand, audit side effect or file link.

### Requirement: Product applications use the formal lifecycle
The Web form SHALL submit the existing product-application lifecycle with one to eight verified `PRODUCT_APPLICATION_IMAGE` files and SHALL NOT directly approve a Product or publish demand capacity. Each file reference SHALL contain only an opaque file object identifier and its expected version; the command SHALL derive all actor, organization, Store and audience authority server-side.

#### Scenario: Product application succeeds
- **WHEN** valid fields and verified images are submitted by an authorized member
- **THEN** one reviewable product application is created with replay-safe response and the Seller sees its server status.

#### Scenario: Product application images are atomically protected
- **WHEN** an authorized Seller submits one to eight owned, VERIFIED product-application images
- **THEN** the application, file entity links, explicit Seller Organization and Staff audiences, audits, Outbox records and idempotency completion commit together
- **AND WHEN** any image is missing, duplicated, stale, unverified, wrong-purpose, wrong-visibility or owned by another actor
- **THEN** the command fails without creating an application, link, audience grant, audit or Outbox side effect.

### Requirement: Demand submission is separate and append-only
The Web form SHALL create a new demand batch for an approved scoped Product and SHALL NOT overwrite a previous batch to add quantity.

#### Scenario: Seller requests additional quantity
- **WHEN** a prior demand exists and more quantity is needed
- **THEN** a new demand batch is submitted and prior batch facts remain unchanged.

### Requirement: Files follow protected transfer
Seller submission images SHALL use verified file intents and SHALL never expose storage keys, Drive identifiers or permanent URLs.

#### Scenario: Upload or completion is ambiguous
- **WHEN** network loss occurs during protected file transfer
- **THEN** the client follows the existing receipt/manifest recovery flow before any business submit can succeed.

### Requirement: Mutations are replay-safe
Product application, demand batch and allowed withdraw actions SHALL use one frozen Idempotency-Key per logical request and SHALL refresh rather than replay after deterministic permission, validation, state or version failures.

#### Scenario: Submit response is lost
- **WHEN** the request may have committed but the response is unavailable
- **THEN** retry reuses the identical action, path, body and key and does not duplicate the business fact.

