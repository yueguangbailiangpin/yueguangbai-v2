# Design: Customer Security DENY And Password Rate Limit

## Authorization boundary

The trusted Staff authorization resolver already applies canonical role defaults and then removes Personal DENY permissions. The affected routes must consume both the required role and the resulting effective permission. The login-identifier command checks `owner + BUYER_IDENTITY_HIGH_RISK_MANAGE`; Seller invitation issue/read/revoke checks `(owner | seller_ops) + SELLER_MANAGE`. Existing Marketplace scope checks remain unchanged and follow the permission gate.

## Password-change limiter

The request already has a verified Customer Session, so the primary rate-limit dimension is the server-derived account ID rather than a client identifier. The limiter additionally hashes the normalized network source and bounded device ID with the existing Customer security secret. It consumes a 15-minute fixed window before current-password verification and before the idempotency claim. Account, network and device dimensions use bounded independent thresholds; any blocked dimension returns the same `RATE_LIMITED` response with `Retry-After`.

Blocked requests append only `PASSWORD_CHANGE_RATE_LIMITED`, account ID, hashed network source, request ID, outcome and time. They create no credential, Session-version, idempotency or business mutation. Login and password-reset/invitation counters remain separate because the operation is part of the storage key.

## Migration

SQLite cannot alter CHECK constraints in place. Migration 0068 therefore creates replacement tables with the extended enums, copies all existing rows exactly, swaps the tables, recreates indexes and immutability triggers, verifies counts and allowed schema objects, then advances `app_schema_state` from 67 to 68 with `changes()=1`. Any incompatible existing row fails the transaction; the migration never repairs or drops facts selectively.

## Verification

Behavior tests cover Personal DENY with zero Customer-security reads/writes, independent hashed password-change dimensions, stable 429/Retry-After, sanitized blocked events, no idempotency/credential mutation, preserved successful password change and migration row preservation. Full migration continuity, recovery/readiness anchors, strict OpenSpec and repository checks remain required.
