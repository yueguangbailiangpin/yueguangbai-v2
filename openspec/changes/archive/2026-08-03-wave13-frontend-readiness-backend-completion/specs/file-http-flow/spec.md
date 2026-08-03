# File HTTP Flow Capability

## ADDED Requirements

### Requirement: Upload intent endpoints are bound to trusted Actor and five active existing Purposes

The system SHALL expose purpose-specific `/api/*` upload-intent routes only for Buyer Order Evidence, Buyer Review Evidence, Seller Product Application Images, Staff Buyer Refund Proofs and Staff Seller Settlement Proofs. These routes SHALL map respectively to the existing `FilePurpose` constants `ORDER_EVIDENCE`, `REVIEW_EVIDENCE`, `PRODUCT_APPLICATION_IMAGE`, `BUYER_REFUND_PROOF` and `SELLER_SETTLEMENT_PROOF`; no FilePurpose Contract extension is required. Each route SHALL derive Actor, ownership, Purpose and fixed existing `FileVisibility` from the authenticated route family and business context, SHALL call the existing `createFileUploadIntent`, and SHALL reject client authority fields or arbitrary Purpose/Visibility selection.

The fixed Visibility mapping SHALL be: Buyer Order Evidence `BUYER_VISIBLE`; Buyer Review Evidence `SELLER_VISIBLE` with later explicit Buyer/Seller/Staff audiences; Seller Product Application Images `SELLER_VISIBLE`; both Staff proof routes `INTERNAL_ONLY`.

The global historical `FilePurpose` constant `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` SHALL remain available to existing schema and code, but Wave 13 SHALL NOT register its upload-intent route or include it in the active Staff upload mapping. This is an approved Wave 13 scope reduction assigned to Wave 15 because no entity-specific consume command, Link flow or Audience flow has been frozen. Wave 13 SHALL NOT create a generic Link/Grant route as a substitute.

#### Scenario: Allowed active purpose-bound intent

- **WHEN** an authenticated Actor invokes the `/api/*` route corresponding to one of the five active verified existing Purpose/Visibility pairs with a valid file manifest and Idempotency-Key
- **THEN** the existing File Service creates an owned ISSUED intent and returns only opaque upload references and the first-use upload token.

#### Scenario: Deferred internal communication purpose

- **WHEN** a caller attempts to use a Wave 13 upload-intent route for `ORDER_EVIDENCE_INTERNAL_COMMUNICATION`
- **THEN** no such active endpoint or Staff upload mapping exists, the global Purpose constant remains intact, and the future entity-specific workflow remains assigned to Wave 15.

### Requirement: Controlled HTTP upload reuses the existing object upload service

The system SHALL expose authenticated domain-bound `/api/*` upload routes that accept one bounded multipart `file` part, `X-Upload-Token` and Idempotency-Key, SHALL derive the Actor from the current Session, and SHALL invoke the existing `uploadFileObject`. The route SHALL NOT accept or return an R2 object key or permanent URL. No `/api/v2/*` alias SHALL exist.

#### Scenario: Valid object upload

- **WHEN** the owning Actor uploads bytes matching the reserved file descriptor and valid one-time upload token before expiry
- **THEN** the service validates file bytes, MIME, size and digest, stores the R2 object and conditionally marks the file object UPLOADED.

#### Scenario: Invalid upload token or owner

- **WHEN** the token is wrong or the current Actor does not own or cannot upload the reserved object
- **THEN** the upload is denied without storing a usable object or disclosing the expected owner.

### Requirement: File validation enforces existing Purpose policies

The HTTP flow SHALL reuse the existing `FilePurpose`, `FileVisibility`, supported MIME, extension, byte-size, file-count, digest and manifest policies. It SHALL validate trusted magic bytes and detected MIME rather than trusting client MIME. Order Evidence business submission SHALL remain stricter than generic file policy and require exactly one verified file at its business command boundary. Wave 13 SHALL NOT add upload endpoints for `PRODUCT_IMAGE`, `ORDER_INSTRUCTION_KEYWORD_IMAGE`, `SUPPORT_ATTACHMENT` or the deferred `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` Purpose.

#### Scenario: Matching file policy

- **WHEN** uploaded bytes, extension, declared MIME, detected MIME, byte size and the route-fixed active existing Purpose/Visibility satisfy the current policy
- **THEN** the file may advance through UPLOADED to VERIFIED without adding or renaming a Purpose enum.

#### Scenario: MIME, size, digest or purpose mismatch

- **WHEN** any trusted file inspection, receipt, SHA-256, size, detected MIME, Purpose or Visibility conflicts with the reserved descriptor or route policy
- **THEN** the flow rejects the file with a stable validation/storage error and cannot link it to a business entity.

### Requirement: Complete upload verifies R2 and conditionally commits D1

The system SHALL expose authenticated `/api/*` complete-intent routes that require `expected_version` and Idempotency-Key, derive the Actor from Session and invoke the existing `completeFileUploadIntent`. Completion SHALL require an ISSUED unexpired intent, every reserved object in UPLOADED state, successful R2 HEAD metadata verification and trusted prefix/MIME verification before marking intent and objects VERIFIED.

#### Scenario: Successful completion

- **WHEN** every object exists in R2 with matching byte size, content type, checksum and metadata and the expected intent version is current
- **THEN** one D1 batch marks the intent and objects VERIFIED and records file event, audit, outbox, idempotency completion and final assertion.

#### Scenario: Expired, stale or incomplete intent

- **WHEN** the intent is expired, not ISSUED, stale, missing an uploaded object or already consumed by an incompatible request
- **THEN** completion fails with the existing stable expiry, version or state error and creates no business link.

### Requirement: Verified file references are safe and non-authoritative

File HTTP responses SHALL expose only opaque file object IDs, upload/read intent IDs, slot numbers, status, version, expiry, verified manifest metadata and one-time token availability. They SHALL NOT expose R2 keys, permanent URLs, storage credentials, internal owner authority or reusable access tokens. A file ID alone SHALL confer no read or link authority.

#### Scenario: Safe verified manifest response

- **WHEN** upload completion succeeds
- **THEN** the response contains verified file references needed by a later business command and omits object keys and permanent URLs.

#### Scenario: File ID guessing

- **WHEN** a caller submits another tenant's file object ID without ownership, entity authorization or an explicit audience grant
- **THEN** the system returns a concealed not-found/forbidden result according to the identity domain and does not disclose file metadata.

### Requirement: Business commands own entity link and audience grant creation

Entity links and explicit audience grants SHALL be created inside the authorized business command that knows the target entity, using the existing file link and authorization services. Customer routes SHALL NOT expose a generic operation accepting arbitrary file ID, entity type, entity ID, Audience, permission or scope. Any future Staff link/grant route SHALL be entity-specific, permission-bound, scoped and added to its owning Change before implementation.

#### Scenario: Business command links a verified file

- **WHEN** an authorized Order Evidence, Review, Buyer Refund or Seller Settlement command accepts an eligible verified file owned for that Purpose
- **THEN** the command creates the required entity link/audience grant in the same business transaction and records audit/idempotency evidence.

#### Scenario: Generic link attempt

- **WHEN** a client attempts to bind a file to an arbitrary entity or grant an arbitrary Buyer, Seller or Staff audience
- **THEN** no generic route accepts the request and no link or audience grant is created.

### Requirement: Short read intents provide authorized single-use reads

The system SHALL expose domain-bound `/api/*` create-read-intent and consume-read-intent routes that call the existing file read service. Create SHALL require the current Actor, current entity authorization, expected file version and Idempotency-Key. Consume SHALL require `X-File-Read-Token`, the same Actor, an unexpired ISSUED read intent and fresh entity/file authorization, and SHALL consume the intent once.

#### Scenario: Authorized safe read

- **WHEN** an Actor with current entity scope and explicit or legacy read authorization creates and consumes a read intent before expiry
- **THEN** the Worker streams verified bytes with the detected content type and marks the read intent CONSUMED.

#### Scenario: Expired, replayed or revoked read

- **WHEN** a read intent is expired, already consumed, revoked, presented by a different Actor or its entity grant is no longer valid
- **THEN** no bytes are returned and the object key remains undisclosed.

### Requirement: Ownership and tenant authority are always server-derived

For create, upload, complete, link, grant and read operations, owner Actor type/ID, Buyer Customer, Seller Organization, Staff, Team, Department and Data Scope SHALL be derived from trusted Customer or Staff Session and current D1 records. The server SHALL recalculate Staff Permission, Personal DENY and scope before Staff file operations.

#### Scenario: Same-tenant Actor

- **WHEN** the current Session and D1 business resource prove the Actor owns or is authorized for the file Purpose and entity
- **THEN** the operation proceeds using server-derived authority without requiring client authority fields.

#### Scenario: Cross-tenant or Personal DENY

- **WHEN** a customer crosses tenant boundaries or a Staff Permission is absent/denied or the resource is outside current Data Scope
- **THEN** the operation fails closed, with cross-tenant/scope resources concealed as 404.

### Requirement: R2 and D1 failures use existing compensation, error code and cleanup

After any successful R2 put, if receipt verification, R2 HEAD/prefix validation or final D1 commit fails, the system SHALL call the existing compensation flow. Successful compensation SHALL delete the object and terminate its usable lifecycle. Failed deletion SHALL mark delete-pending state, increment attempts, calculate retry time and return the existing formal 503 error code `FILE_COMPENSATION_REQUIRED`; cleanup SHALL be safe to retry. No Contract extension is required for this code.

#### Scenario: Compensation deletion succeeds

- **WHEN** R2 put succeeded but later verification or D1 commit fails and the compensation delete succeeds
- **THEN** the object cannot be completed or linked and the caller receives the normalized original failure.

#### Scenario: Compensation deletion fails

- **WHEN** the compensating R2 delete is unavailable or fails
- **THEN** D1 records a cleanup plan/delete-pending object, the route returns 503 `FILE_COMPENSATION_REQUIRED` and a later cleanup retry can complete without duplicating business state.

### Requirement: File HTTP contracts are bounded, idempotent and leak-tested

Every file mutation SHALL enforce bounded body/part size, exact allowed fields/parts, bounded identifiers, Idempotency-Key and request hash semantics. Unknown fields, duplicate query parameters and malformed versions SHALL be rejected. Route, D1 behavior and R2 failure test source SHALL cover all five active Purpose/Visibility mappings, the formally deferred Purpose with no route, intent replay, upload replay, complete replay, HEAD failure, D1 commit failure, cleanup retry, cross-tenant denial, Purpose mismatch and recursive DTO leakage.

#### Scenario: Idempotent replay

- **WHEN** the same Actor repeats a file mutation with the same Idempotency-Key and canonical request hash
- **THEN** the system returns the committed response without reissuing a usable one-time token or duplicating R2/D1 facts.

#### Scenario: Contract or leakage violation

- **WHEN** a request contains unknown fields/parts, a duplicate query, a mismatched active Purpose/Visibility or a response projection contains `object_key` or permanent URL
- **THEN** validation or the dedicated verifier fails and the route is not considered frontend-ready.
