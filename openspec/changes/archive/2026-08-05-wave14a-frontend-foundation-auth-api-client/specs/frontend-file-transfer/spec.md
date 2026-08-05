# Frontend File Transfer Capability

## ADDED Requirements

### Requirement: Upload starts from a purpose-bound intent

The file client SHALL create an upload intent through one of the five registered purpose-specific routes, SHALL accept Purpose/Visibility only from the selected endpoint adapter, SHALL keep returned upload tokens only in active operation memory, and SHALL NOT offer the deferred internal-communication purpose or arbitrary Purpose/Visibility selection.

#### Scenario: Valid purpose-bound intent

- **WHEN** an authenticated identity selects an allowed file workflow and valid descriptor
- **THEN** the client calls the exact route with an operation Idempotency-Key and records only safe intent/slot metadata plus the one-time token in memory.

#### Scenario: Expired, replayed, or unsupported intent

- **WHEN** the intent/token expires, a replay returns no usable token, or code selects an unsupported/deferred purpose
- **THEN** the client discards transient token state and requires a new purpose-bound intent without inventing a generic route.

### Requirement: Upload content is single-file, progressive, cancelable, and safely retryable

The client SHALL send exactly one multipart `file` part with `X-Upload-Token`, Idempotency-Key, credentials, and AbortSignal; SHALL expose byte/progress state when the chosen browser transport can measure it; and SHALL distinguish cancel from failure. A safe identical retry SHALL reuse the logical operation key/token only while the server contract permits it.

#### Scenario: Successful upload or explicit cancel

- **WHEN** valid bytes upload or the user cancels
- **THEN** progress reaches uploaded state or transport aborts into CANCELLED, with no false VERIFIED/business-consumed claim.

#### Scenario: Invalid multipart or ambiguous retry

- **WHEN** additional parts/authority fields are proposed or retry safety cannot be established after an ambiguous failure
- **THEN** the client refuses the unsafe request and restarts from a new intent when required.

### Requirement: Completion yields a validated VERIFIED manifest for business consumption

The client SHALL call the matching complete route with the latest intent `expected_version`, SHALL runtime-validate VERIFIED safe file references, and SHALL pass only File ID/version into the later identity-specific business command. It SHALL NOT treat upload success as completion or create an entity Link/Audience Grant.

#### Scenario: Verified completion

- **WHEN** upload succeeds and complete returns a valid VERIFIED manifest
- **THEN** the transfer exposes safe File IDs/versions/digest metadata for the owning business workflow.

#### Scenario: Version, validation, or compensation failure

- **WHEN** complete returns conflict, 422, or `FILE_COMPENSATION_REQUIRED`
- **THEN** the client does not expose a consumable file, shows distinct refresh/restart/support action and request ID, and never claims cleanup succeeded.

### Requirement: Read intents protect one-time byte consumption

The client SHALL create a read intent from an authorized File ID and latest expected file version, keep its access token only in active memory, consume bytes through the matching domain route, and revoke local object URLs after use. It SHALL NOT store permanent URLs or expose storage keys.

#### Scenario: Authorized byte read

- **WHEN** a valid read intent and token are consumed before expiry
- **THEN** the client returns bounded bytes/object URL to the authorized view and removes token/object URL state when no longer needed.

#### Scenario: Expired, replayed, canceled, or unauthorized read

- **WHEN** the token is expired/replayed, scope changes, or the request is canceled/denied
- **THEN** no bytes remain exposed, transient state is discarded, and a fresh intent is required when user action permits.

### Requirement: File client never owns link, audience, or storage authority

The general file client SHALL NOT call/create a generic entity link or audience grant, SHALL NOT accept/return `object_key`, permanent URL, owner actor, organization scope, or storage credential, and SHALL leave all business consumption to registered business commands. `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` remains a historical global Purpose only; Wave 14A SHALL expose no upload intent or active Staff consume/Link/Grant HTTP capability, and its complete workflow SHALL remain deferred to Wave 15.

#### Scenario: Business command consumes verified file

- **WHEN** a later approved workflow submits a validated File ID/version
- **THEN** only that business endpoint may create its server-side link/audience and the general file client remains authority-free.

#### Scenario: Generic authority or deferred-purpose attempt

- **WHEN** code attempts a Link/Grant endpoint, permanent URL/object key handling, arbitrary audience, or deferred internal-communication upload
- **THEN** static/MSW/security tests fail and no request is sent.
