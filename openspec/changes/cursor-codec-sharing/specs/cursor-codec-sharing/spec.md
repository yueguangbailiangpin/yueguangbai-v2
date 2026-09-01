# cursor-codec-sharing Specification

## ADDED Requirements

### Requirement: Shared cursor byte primitives preserve encoding

The API SHALL expose one foundation-level set of base64url byte and JSON primitives for migrated cursor codecs. UTF-8 JSON codecs MUST emit the same unpadded base64url bytes as before, and legacy binary-string JSON codecs MUST retain their pre-existing binary-string byte behavior.

#### Scenario: UTF-8 round trip

- **WHEN** a migrated codec encodes a JSON object containing Unicode and safe boundary values
- **THEN** decoding returns the same JSON values and the emitted token uses the existing unpadded base64url format.

#### Scenario: Legacy token compatibility

- **WHEN** a fixed token emitted by the pre-change implementation is supplied to a migrated codec
- **THEN** it decodes to the same typed cursor, or retains the same validation failure, without changing its token bytes.

#### Scenario: Malformed primitive input

- **WHEN** the shared byte primitive receives empty, invalid-alphabet, invalid-padding or non-JSON bytes through a typed codec
- **THEN** the typed codec preserves its existing validation error and HTTP mapping.

### Requirement: Typed cursor contracts remain isolated

Every cursor family SHALL retain its existing payload keys, version/kind discriminator, field bounds, filter/status echo checks, empty-cursor handling, and domain-specific error class. A token from one family MUST NOT be accepted by another family merely because both use base64url JSON.

#### Scenario: Wrong family or version

- **WHEN** a valid token from another family, an unknown version, or an unknown kind is supplied
- **THEN** the receiving route returns its existing `400 VALIDATION_ERROR` behavior and no page query is executed.

#### Scenario: Filter-bound cursor

- **WHEN** a cursor containing status/work-type/filter echo is replayed under different filters
- **THEN** the existing validation response remains unchanged and no partial list is returned.

### Requirement: Pagination and access behavior remain unchanged

The Change MUST NOT alter SQL ordering, seek comparisons, tie-breakers, `limit+1`/`has_more`/`next_cursor` semantics, filter order, tenant/organization scope, DTO shape, concealed `404`, permission checks, idempotency, or version-bound behavior.

#### Scenario: Two-page traversal

- **WHEN** a caller follows `next_cursor` through two or more pages for every migrated API family
- **THEN** the visible union has no duplicates or omissions and remains in the pre-change stable order.

#### Scenario: Security and business regression

- **WHEN** cross-organization, permission-denied, concealed-resource, idempotency, or version-bound cases are exercised
- **THEN** their existing response status, error code, and business facts remain unchanged.

### Requirement: Non-token cursor consumers stay outside the codec

Raw archive, scheduler, reconciliation, in-process report, internal route bridge, and frontend pass-through cursors SHALL remain in their current data shape and SHALL NOT be converted into the shared public token codec.

#### Scenario: Raw continuation

- **WHEN** an internal job or raw-key API resumes from its continuation value
- **THEN** it uses the existing raw key/state semantics and does not require a public cursor codec.
