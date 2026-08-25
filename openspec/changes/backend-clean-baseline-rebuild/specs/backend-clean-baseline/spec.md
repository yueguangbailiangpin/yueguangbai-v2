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
