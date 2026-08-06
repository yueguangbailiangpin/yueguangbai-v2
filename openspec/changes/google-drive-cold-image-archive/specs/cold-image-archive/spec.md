# Cold Image Archive Capability

## ADDED Requirements

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

### Requirement: Archive rollout and rollback protect already deleted R2 content

The system SHALL support separate copy, verification, R2-delete and proxy-read enablement controls, SHALL require shadow-copy and proxy-read acceptance before deletion, and SHALL provide Manifest-verified Drive-to-R2 rehydration before any rollback to an R2-only Worker.

#### Scenario: Shadow rollout

- **WHEN** archive copying is enabled but R2 deletion is disabled
- **THEN** verified Drive copies may accumulate while all original R2 reads remain available.

#### Scenario: Rollback after R2 deletion

- **WHEN** an operator must run code that cannot proxy Drive after any R2 object was deleted
- **THEN** every affected file is first rehydrated and hash-verified in R2 or the rollback is blocked.
