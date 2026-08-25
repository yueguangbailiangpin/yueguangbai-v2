# cold-image-archive Specification

## Purpose
Define the controlled lifecycle for moving the four frozen business-evidence file purposes from R2 to permanent owner-controlled Google Drive storage after verified business closure, while preserving authorization, auditability, fail-closed runtime activation and reversible operations.
## Requirements
### Requirement: Eligible evidence becomes due six natural months after complete business closure

The system SHALL mark only order evidence, review evidence, Buyer Refund proof and Seller Settlement proof as archive eligible, SHALL require all applicable Review, Buyer Refund, Seller Principal and Seller Service Fee components to be completed or not required, SHALL compute `archive_due_at` by adding six Asia/Shanghai calendar months to the recorded business-close time, and SHALL use the latest due time when one file covers multiple orders or settlement items.

#### Scenario: Complete order reaches due date

- **WHEN** all applicable components are terminal and the stored archive due time arrives
- **THEN** the four eligible evidence purposes may enter the archive queue in bounded order.

#### Scenario: Order is not fully closed

- **WHEN** any applicable component is pending, disputed, reopened or incomplete
- **THEN** no associated file is deleted from R2 or finalized as archived.

#### Scenario: One settlement proof covers multiple orders

- **WHEN** a Seller Settlement proof is associated with orders having different business-close times
- **THEN** the file remains in R2 until the latest associated six-month archive due time.

### Requirement: Business closure and reopening are controlled versioned facts

The system SHALL expose Staff application commands for close and reopen, SHALL require an ACTIVE owner with effective `SCHEDULED_OPERATIONS_RUN`, SHALL honor Personal DENY, expected version, request-hash idempotency and Audit, and SHALL accept `NOT_APPLICABLE` only as an explicit command fact with a reason. The system SHALL read completed components from their existing business facts, SHALL use `formal_orders.confirmed_at` as the completion baseline for an explicitly not-applicable component, and SHALL compute `business_closed_at` as the maximum of order confirmation and all actual completion times rather than command execution time.

#### Scenario: Missing component is not inferred as not applicable

- **WHEN** a component has no completion fact and the authorized close command does not explicitly mark it not applicable
- **THEN** closure fails and no archive closure fact is written.

#### Scenario: Late close command does not postpone retention

- **WHEN** an authorized owner records an otherwise valid closure after the business was already complete
- **THEN** the six-month deadline starts from the persisted order/completion facts, not the Staff click time.

### Requirement: Drive copy is verified before R2 deletion

The system SHALL upload an eligible R2 object to the owner-authorized Google Drive folder, SHALL read the Drive object back and verify byte size, MIME and SHA-256, SHALL persist an immutable Manifest, and SHALL permit R2 deletion only after a versioned transition to verified state.

#### Scenario: Verified archive

- **WHEN** Drive upload and read-back exactly match the R2 Manifest
- **THEN** the file becomes Drive-verified and a later idempotent step may delete R2 and mark it archived.

#### Scenario: Upload or verification fails

- **WHEN** Drive is unavailable, OAuth fails, bytes/MIME/hash differ or D1 finalization conflicts
- **THEN** R2 remains intact, the attempt is safely retryable and an operations failure is recorded.

### Requirement: Archived files remain accessible only through controlled system reads

The system SHALL keep the existing short-lived read-intent boundary, SHALL recalculate D1 authorization and Audience before every content read, SHALL proxy Drive bytes server-side for archived files, and SHALL NOT expose Drive file IDs, OAuth tokens, public shares or permanent links.

#### Scenario: Authorized archived read

- **WHEN** a Buyer, Seller or Staff actor with current authority presents a valid read intent for an archived file
- **THEN** the content endpoint streams the Drive object with safe headers and no Google identifier disclosure.

#### Scenario: Unauthorized or expired read

- **WHEN** the actor lacks current resource/Audience authority or the intent is missing, expired or replay-invalid
- **THEN** the request fails with existing concealment semantics and Drive is not contacted when authorization already fails.

### Requirement: Owner Google account and archived objects are continuity monitored

The system SHALL use only the approved owner account and dedicated archive folder, SHALL store credentials only as managed Secrets, SHALL periodically verify account authorization, file existence and Manifest consistency, and SHALL never automatically delete permanently archived Drive objects.

#### Scenario: Authorization remains healthy

- **WHEN** reconciliation checks the approved account and a sample/batch of archived files
- **THEN** access and Manifest health are recorded without exposing credentials.

#### Scenario: Account or file becomes unavailable

- **WHEN** OAuth is revoked, the folder loses access or a Drive file is missing
- **THEN** affected reads fail closed, R2 deletions stop and an independent operations alert is raised.

### Requirement: Runtime activation and dry-run are fail closed

The system SHALL instantiate the production Google Drive adapter only when the total switch is enabled and every named Secret/var binding is present, SHALL otherwise keep the capability hard-disabled, and SHALL allow adapter object injection only as a test/runtime override. Scheduler dry-run SHALL skip reconciliation and every Drive/R2 call and SHALL write no archive, Manifest, reconciliation or rehydration business fact; it MAY record only scheduled-operation run facts.

#### Scenario: Runtime configuration is incomplete

- **WHEN** any OAuth, folder or owner binding is absent or the total switch is not enabled
- **THEN** no production Drive adapter is available and archive execution remains hard-disabled.

#### Scenario: Scheduler dry-run

- **WHEN** the archive job runs through the scheduled runner with dry-run enabled
- **THEN** it may report backlog and operational run status but performs zero external calls and zero archive business writes.

### Requirement: Archive rollout and rollback protect already deleted R2 content

The system SHALL support separate copy, verification, R2-delete and proxy-read enablement controls, SHALL require shadow-copy and proxy-read acceptance before deletion, and SHALL provide Manifest-verified Drive-to-R2 rehydration before any rollback to an R2-only Worker.

#### Scenario: Shadow rollout

- **WHEN** archive copying is enabled but R2 deletion is disabled
- **THEN** verified Drive copies may accumulate while all original R2 reads remain available.

#### Scenario: Rollback after R2 deletion

- **WHEN** an operator must run code that cannot proxy Drive after any R2 object was deleted
- **THEN** every affected file is first rehydrated and hash-verified in R2 or the rollback is blocked.

### Requirement: Owner rehydration is idempotent, auditable and recoverable

The system SHALL expose an owner-only rehydration command using expected archive version and request-hash idempotency, SHALL write STARTED/FAILED/COMPLETED audit facts, SHALL read Drive and verify the immutable Manifest before R2 PUT, SHALL HEAD-verify R2 before final D1 completion, and SHALL recover safely when an external R2 write succeeds before D1 finalization. Rehydration SHALL never delete the permanent Drive copy.

#### Scenario: Concurrent or conflicting retry

- **WHEN** the same idempotency key is in progress, replayed, or reused with a different file/version request
- **THEN** the command returns in-progress, replay, or idempotency-conflict semantics without duplicating an unsafe external write.

#### Scenario: R2 was written before D1 completion failed

- **WHEN** a retry finds the original R2 key already matching byte size, MIME and SHA-256
- **THEN** it skips duplicate PUT, HEAD-verifies the object and conditionally completes the audited D1 fact.

### Requirement: Cold archive production preparation is locally fail-closed

The repository SHALL provide a machine-executable Google Drive cold-archive preflight that reads only explicitly supplied, private, repository-external local evidence. It SHALL make zero network, Provider, D1, R2, deployment, Secret, or resource-mutating calls. Missing, malformed, in-repository, non-private, or contradictory evidence SHALL produce a blocking outcome without exposing evidence values.

#### Scenario: Configuration is absent

- **WHEN** an operator runs the preflight without an external rendered configuration and evidence files
- **THEN** it returns `LOCAL_NO_GO`, reports zero external calls and preserves every capability as unapproved.

#### Scenario: Evidence is unsafe

- **WHEN** an evidence path is inside the repository, is not owner-private, or contains a token, Drive identifier, owner identifier, session URL, object key, or customer content
- **THEN** the preflight returns `BLOCKED` before any external action.

### Requirement: Initial Drive activation is shadow-copy only

The preflight SHALL accept a rendered configuration only when the archive scheduler, archive capability and copy flags are enabled while proxy read and R2 deletion are disabled; it SHALL require the D1 controls to be `copy_enabled=1`, `proxy_read_enabled=0`, `r2_delete_enabled=0`. Proxy read and R2 delete SHALL remain independent later approvals.

#### Scenario: R2 delete is requested during initial activation

- **WHEN** either the rendered `DRIVE_ARCHIVE_R2_DELETE_ENABLED` flag or the D1 `r2_delete_enabled` control is enabled
- **THEN** the preflight returns `BLOCKED` and does not treat hash verification as deletion authorization.

### Requirement: Drive and recovery evidence is independently attestable

The preflight SHALL require a redacted receipt proving the exact `https://www.googleapis.com/auth/drive.file` scope, no token persistence, owner-only private permissions, and anonymous upload/read-back SHA-256 evidence. It SHALL also require a redacted encrypted D1 backup attestation with bounded schema/release metadata and SHA-256 values for encrypted bundle and manifest.

#### Scenario: OAuth scope or private permission proof differs

- **WHEN** the receipt returns a broader scope, reports token persistence, or does not prove owner-only folder/file permissions
- **THEN** the preflight returns `BLOCKED` and leaves copy, proxy and delete unapproved.

#### Scenario: Encrypted backup evidence is incomplete

- **WHEN** the backup attestation is missing either SHA-256 value or declares plaintext content
- **THEN** the preflight returns `BLOCKED` and reports the recovery evidence as invalid.

