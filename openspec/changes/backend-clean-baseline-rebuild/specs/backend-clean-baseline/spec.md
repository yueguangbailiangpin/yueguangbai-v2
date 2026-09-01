# backend-clean-baseline Specification

## ADDED Requirements

### Requirement: Rebuild execution gates

The rebuild SHALL enforce the two D-054 gates: legacy verification scripts SHALL only be deleted after their still-valid protected assertions are migrated to new baseline tests or new verifiers that actually pass; and the source-deletion stage SHALL only start after every non-archive OpenSpec change has been classified as completed, superseded, merge-into-rebuild or unrelated/keep with reason, affected source and disposition recorded in `docs/migration/V2_BACKEND_REBUILD_INVENTORY.md` §5.

#### Scenario: A legacy verifier is deleted before equivalence

- **WHEN** a legacy verify script listed in inventory §7 is removed while its mapped new test or verifier has never been executed successfully
- **THEN** the deletion violates D-054 gate 1 and must be reverted.

#### Scenario: Deletion proceeds only after classification

- **WHEN** all eleven non-archive changes are classified per inventory §5 and the classification is committed
- **THEN** the source deletion stage may begin.

### Requirement: Clean baseline replaces the legacy migration chain

The repository SHALL provide a single forward-only baseline migration chain starting at `0001` that creates the full retained business schema. The legacy chain 0001–0075 and its scaffolding tables (`phase3*_backup_*`, `*_next`) SHALL be removed from the working tree while remaining recoverable through Git history. A fresh local database SHALL initialize from empty in one pass, and the rebuilt migration verifier SHALL keep fresh, sequential, wrong-order, repeat and dirty-stock rollback checks plus foreign-key and integrity checks.

#### Scenario: Empty local database initializes

- **WHEN** the rebuilt chain is applied to an empty local D1
- **THEN** initialization succeeds in one pass and the schema version assertion equals the baseline version.

#### Scenario: Financial invariants survive the rebuild

- **WHEN** the baseline schema is created
- **THEN** money and rates use integer storage with explicit scales, completed financial facts are append-only via guards, and every retained write path keeps idempotency, version, audit and outbox boundaries.

### Requirement: Cold archive uses business-entity bundles with queued workers

Archive units SHALL be ORDER (order, review, buyer chat and seller chat evidence), BUYER_REFUND_PAYMENT and SELLER_SETTLEMENT_PAYMENT. Each unit SHALL produce one ZIP bundle with `manifest.json` streamed to a temporary R2 object without buffering the whole package in the Worker and without recompressing JPEG entries, uploaded to Google Drive resumptably, read back and verified on size, MIME and SHA-256 before any R2 hot copy deletion. Background execution SHALL use a retriable queue consumer template whose messages contain only opaque `bundle_id`, `version` and `trace_id`, with per-message acknowledgement, a dead letter queue, exponential backoff for 403/429, and an initially configurable Drive concurrency of 3. Duplicate delivery SHALL NOT create duplicate files or duplicate deletions. The first historical archive pass SHALL be shadow-copy only.

#### Scenario: Bundle verification fails

- **WHEN** the read-back size, MIME or SHA-256 mismatches
- **THEN** no R2 hot copy is deleted, the bundle stays retryable, and the failure is recorded in D1 with metrics.

#### Scenario: Duplicate queue delivery

- **WHEN** the same `bundle_id` and `version` message is delivered twice
- **THEN** exactly one Drive file and one manifest update result, with no duplicate R2 deletion.

### Requirement: Restore is staff-triggered and never widens visibility

Only Staff SHALL trigger archive restoration. Buyers and Sellers SHALL only see an archived placeholder with a contact-staff hint. After restoration the temporary R2 copy SHALL be authorized by the original file audience and resource ownership, SHALL NOT widen visibility, and SHALL be removed after seven days; the original Drive archive bundle is retained permanently.

#### Scenario: Buyer views an archived file

- **WHEN** a Buyer requests content whose file object is in the archived state
- **THEN** the response is an archived placeholder with a contact-staff hint and contains no Drive identifiers or object keys.

#### Scenario: Staff restores an archived order's images

- **WHEN** authorized Staff triggers restore for an order bundle
- **THEN** restoration runs asynchronously into temporary R2, original audience grants govern every read, and the copy is scheduled for cleanup in seven days.

### Requirement: Dashboard is simplified to owner essentials

The admin dashboard SHALL expose only today/this-week/this-month (`Asia/Shanghai`, weeks starting Monday) customer, reservation and formal-order counts, pending refunds, pending settlements, abnormal overdue items, and the owner financial summary reusing the formal internal finance formulas restricted to Active owner with `FINANCIAL_VIEW` after Personal DENY. Complex acquisition funnels, multi-dimensional channel trends and large drill-downs SHALL be removed, while manual source and first-touch attribution facts remain.

#### Scenario: Non-owner requests the financial summary

- **WHEN** an Active Staff member without the system owner role or `FINANCIAL_VIEW`, or an owner with a Personal DENY on financial view, requests the summary
- **THEN** the request fails closed and no internal profit is exposed.

### Requirement: The production Drive adapter is real code that stays disabled until activation

The repository SHALL contain a production Google Drive HTTP client implementing the DriveArchiveClient port: resumable session creation with metadata and `X-Upload-Content-Type/-Length` headers, 256 KiB-aligned chunk PUTs with `Content-Range`, 308 `Range` parsing for partial acceptance and resume, star-range status queries, OAuth refresh-token provider abstraction with cache invalidation, metadata reads with `supportsAllDrives`, and `alt=media` streaming read-back. Retry handling SHALL cover 429/5xx/network with bounded exponential backoff honoring `Retry-After`; 401 SHALL refresh the token once then fail closed; 403, malformed responses and read-back mismatches SHALL fail closed without retry. Session URIs and tokens SHALL never be persisted to D1, logs, audit payloads or client responses. The adapter SHALL expose no permission-creation and no delete calls. While `ARCHIVE_DRIVE_UPLOAD_ENABLED` is false the pipeline SHALL make zero HTTP requests.

#### Scenario: Read-back hash mismatch forbids hot deletion

- **WHEN** the Drive read-back bytes hash to anything other than the recorded zip SHA-256
- **THEN** the job fails as drive verification failure, no R2 hot copy is deleted, and the bundle remains unverified.

#### Scenario: Upload switch off means zero requests

- **WHEN** a bundle job runs with the Drive upload switch disabled
- **THEN** the manifest and temp-ZIP phases may run but zero Drive HTTP requests are made and the job retries as a dependency gap.

### Requirement: Historical image inventory is read-only and capacity-verified

The image inventory tooling SHALL scan a source directory without ever writing it, hash bytes in streaming fashion, sniff MIME types from magic bytes rather than extensions, record facts in checkpointed inventory tables with immutable byte-level columns, and classify business relations only by deterministic matching against an import batch's file plans: unmatched relations SHALL quarantine. Reconciliation SHALL detect duplicate content, referenced-but-missing, orphan and unreadable files via SQL-side pagination and SHALL write artifacts only to an explicitly provided output directory that does not overlap the source. The tooling SHALL be verified with at least 100,000 synthetic image entries proving checkpoint resume equivalence and bounded memory, and SHALL NOT execute R2 or Drive uploads.

#### Scenario: Source directory integrity

- **WHEN** an inventory run completes over a source directory
- **THEN** every source file's bytes and timestamps are unchanged and no new files exist in the source directory.

#### Scenario: Unresolvable business relation

- **WHEN** an image file cannot be deterministically matched to exactly one import file plan (no match, ambiguous match, or no import batch provided)
- **THEN** the file is quarantined with a finding and never classified LINKED.

### Requirement: Unmatched historical identities stay explicitly unresolved

Historical import rows whose buyer or seller identity cannot be matched SHALL still be snapshotted losslessly but SHALL carry a durable IDENTITY_UNMATCHED quarantine row, and SHALL NOT be visible in Buyer or Seller portals by construction. Identity overrides SHALL record the original source value, resolved value, operator, reason, timestamp and import run id. Promotion of unresolved rows SHALL require deterministic mapping or an audited manual override.

#### Scenario: Unmatched row applies without portal exposure

- **WHEN** an apply writes a row whose identities are unmatched
- **THEN** the snapshot row and its IDENTITY_UNMATCHED quarantine row are written, no buyer/seller/formal-order row is created, and portal-visible table counts are unchanged.

#### Scenario: Audited override resolves an identity

- **WHEN** staff inserts an identity override referencing the import run
- **THEN** subsequent resolution uses the override and the override row carries original value, resolved value, operator, reason, time and import batch id.

### Requirement: Archive retention is six UTC calendar months

Hot retention and archive eligibility SHALL be computed as the full business closure timestamp plus six UTC calendar months with month-end clamped to the target month's last day, stored as UTC milliseconds, and never as a flat day offset or local-calendar-month computation. Display formatting MAY use Asia/Shanghai without altering the stored eligibility value. The closure DTO's archive_due_at and the bundle selector's eligibility gate SHALL use the same computation.

#### Scenario: Month-end clamping

- **WHEN** a business closes on January 31 or August 31
- **THEN** eligibility lands on July 31 or the following February 28/29 respectively, at the same UTC time of day.

### Requirement: Multi-line duplicate orders require explicit mapping

Source rows sharing one order id with identical facts SHALL collapse deterministically to their group head. Groups whose product, amount, fee or rate (line-defining) columns differ SHALL be held with MULTI_LINE_ORDER_REQUIRES_MAPPING as a critical quarantine that blocks apply, preserving every original row; the importer SHALL NEVER resolve such groups by taking the first row, the last row or an automatic sum. Groups differing only in non-line-defining columns remain CONFLICTING_DUPLICATE_GROUP.

#### Scenario: Multi-product order is held

- **WHEN** two rows share an order id but differ on ASIN and order amount
- **THEN** both rows quarantine with MULTI_LINE_ORDER_REQUIRES_MAPPING, can_apply is false, and no snapshot row is written.

#### Scenario: Identical duplicate rows collapse

- **WHEN** two rows share an order id and all thirty columns are identical
- **THEN** exactly one logical order row is applied and currency totals count it once.

### Requirement: Stage 6.6 converges duplicate business models

Staff roles SHALL be exactly `owner`, `pre_sales`, `buyer_refund` and `seller_ops`; the `acquisition` role, public-pool tasking, task claiming, round-robin rotation, automatic owner fallback takeover, availability rosters, automatic reassignment and the department/team/leader/role-consolidation organization tables SHALL be removed. Assignment SHALL resolve to the fixed responsible staff: the buyer's pre-sales owner for buyer pipeline duties, the buyer's refund owner for review and refund duties, and the seller organization's account manager for seller duties; owner retains global view and processing. Buyer chat and seller order-communication screenshots SHALL be one business kind, `ORDER_COMMUNICATION_SCREENSHOT`, attached to the formal order, staff-uploaded, multiple per order, visible to all active members of the seller organization, never to buyers, concealed-404 for other sellers, with uploader, time, hash, audit and original audience preserved, cold-archived six months after full order closure without widening visibility on restore. Order payment screenshots SHALL be exactly one per order evidence version, enforced in the database through the single generic file association. Seller organization members SHALL see all stores, products, orders, communication screenshots, service fees, rates and settlement amounts/vouchers of their organization, with organization-setting and member management restricted to the organization OWNER; store grant/scope tables SHALL be removed and each product SHALL have at most one current primary contact member recorded with audited history events. Marketplace, daily exchange rates, seller markup policies and service fees SHALL each have exactly one authoritative source with immediate-effect versioning (no SUBMITTED/CONFIRMED/REJECTED dual approval), equal maintenance rights for owner and seller_ops, order-date resolution and immutable order snapshots. Exactly one immutable formal-order financial snapshot SHALL exist per order and all financial, refund, settlement, portal and reporting reads SHALL use it. `internal-finance` SHALL be the only financial calculation source; the dashboard's separate financial projection read model SHALL be removed. One aggregate staff formal-order detail endpoint SHALL replace the separate order-integrity detail, operating-integrity order lookup, buyer-advance-principal lookup alias and the finance order detail's duplicated base fields. The acquisition CRM runtime and the integration outbox (including dead letters) SHALL be removed while `buyer_channels`, audit events, domain events, idempotency, transaction assertions and the cold-archive queue jobs are retained; runtime portal and business routes SHALL NOT read historical import intermediate tables, enforced by a source-boundary guard.

#### Scenario: Buyer number is allocated at profile creation

- **WHEN** staff first records a buyer profile (or an invited registration completes)
- **THEN** the buyer number `YYYYMMDD + B/C + channel sequence` is generated immediately using the China business date of first entry, the channel counter advances atomically with optimistic locking, and the number can never be modified or reallocated afterwards.

#### Scenario: Duplicate approval endpoints are gone

- **WHEN** a client calls a removed submit/confirm/reject rate or service-fee approval endpoint, a removed acquisition/outbox route, or a removed duplicate order detail route
- **THEN** the route does not exist and a real 404 is returned.

#### Scenario: Reservation history blocks repeat participation

- **WHEN** a buyer who already has an APPROVED reservation or a formal order under a seller organization submits a new reservation for any store of that organization
- **THEN** the request is rejected with a contact-pre-sales reason unless a valid one-time manual exception exists, and the exception is consumed with audit when used.

#### Scenario: Seller sees organization-wide communication screenshots

- **WHEN** any active member of the seller organization requests an order communication screenshot of its own organization's order
- **THEN** access is granted regardless of store grant history, while another organization's member receives a concealed 404.
