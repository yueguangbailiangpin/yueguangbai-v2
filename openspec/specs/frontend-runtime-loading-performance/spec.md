# frontend-runtime-loading-performance Specification

## Purpose
TBD - created by archiving change frontend-runtime-loading-performance-v2. Update Purpose after archive.
## Requirements
### Requirement: Local experience preview uses production assets
The repository SHALL provide a repeatable local experience preview that serves the current production build's hashed static assets with same-origin anonymous in-memory API fixtures instead of serving the client through the Vite development module graph.

#### Scenario: Boss opens the local Buyer or Seller test URL
- **WHEN** the production-style preview is started after a successful Web build
- **THEN** the browser receives built assets and can use process-lifetime Buyer, Seller and Staff test identities without contacting production or external resources.

#### Scenario: Preview process stops
- **WHEN** the local preview process exits
- **THEN** its anonymous database and sessions are discarded and no production data or resource remains changed.

### Requirement: Buyer instruction code loads on demand
The Buyer order-instruction page and its protected file-read dependencies SHALL be isolated from the default Buyer dashboard and SHALL load only after an authorized Buyer enters an instruction route.

#### Scenario: Buyer opens the default dashboard
- **WHEN** an authenticated Buyer opens `/buyer`
- **THEN** the instruction route chunk and protected file-read dependencies are not prerequisites for rendering the dashboard.

#### Scenario: Buyer opens an instruction route
- **WHEN** an authenticated Buyer opens `/buyer/reservations/:reservationId/instruction`
- **THEN** the instruction chunk loads through the existing Chinese accessible loading/failure boundary after the customer session boundary succeeds.

### Requirement: Seller submission code loads on demand
Seller product-application and demand-submission pages SHALL be isolated from the default Seller workbench so their form, upload and mutation dependencies load only when an authorized user enters a matching submission route.

#### Scenario: Seller opens the default workbench
- **WHEN** an authenticated Seller opens `/seller`
- **THEN** the submission route chunk and file-upload dependency are not prerequisites for rendering the dashboard.

#### Scenario: Seller opens a submission route
- **WHEN** an authenticated authorized Seller opens `/seller/products/new` or `/seller/demands/new`
- **THEN** the submission chunk loads through the existing Chinese accessible loading/failure boundary and server permission remains authoritative.

### Requirement: Security and business behavior remain unchanged
The optimization SHALL preserve session, forced-password, mismatch cleanup, Personal DENY, Scope, cache and file Audience isolation and SHALL NOT change API, Contract, Domain, Migration, financial or business facts.

#### Scenario: One customer uses the other portal entry
- **WHEN** a Buyer session opens Seller or a Seller session opens Buyer
- **THEN** the established mismatch cleanup and denial flow runs without exposing the other portal's protected content.

### Requirement: Performance evidence is reproducible
Acceptance SHALL include matching-environment before/after production bundle sizes and at least three cold runs for representative Buyer and Seller login-to-workbench paths, while labeling local timings as laboratory evidence rather than production Web Vitals.

#### Scenario: Change is proposed for acceptance
- **WHEN** Implementation Verify runs
- **THEN** evidence identifies commit, Node/npm/lockfile, raw/gzip chunks, requests/bytes/timings, median method, remaining risks and confirms no JavaScript chunk exceeds 500 kB.

