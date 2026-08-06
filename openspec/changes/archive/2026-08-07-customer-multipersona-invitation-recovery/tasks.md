# Tasks: Customer Multi-Persona, Invitation and Recovery

## 0. Governance

- [x] 0.1 Inventory Identity, Claim, Account, Buyer, Seller Membership, Auth and Session invariants/callers.
- [x] 0.2 Freeze invitation/reset TTL, issuer permission, Marketplace dependency and public error matrix.

## 1. Migration

- [x] 1.1 Allocate the next consecutive Migration as the sole Schema writer.
- [x] 1.2 Migrate Account authority to one credential plus Buyer/Seller Persona relations with uniqueness assertions.
- [x] 1.3 Add hashed invitation/reset facts, immutable events, cleanup indexes and DB guards.
- [x] 1.4 Add fresh/upgrade/dual-persona/rollback-manifest Migration verifiers.

## 2. Contracts and Domain

- [x] 2.1 Add issue/revoke/read/consume invitation and password reset contracts with exact-key validation.
- [x] 2.2 Add multi-Persona Session Projection without cross-role DTO leakage.
- [x] 2.3 Implement token hashing, TTL, consume/revoke state machines, password/session version changes and deterministic errors.

## 3. API and UI

- [x] 3.1 Add authorized Staff invitation/reset issue and revoke commands.
- [x] 3.2 Require valid invitation context on `/buyer/register`; keep root/login registration links absent.
- [x] 3.3 Add Customer reset-link form and preserve Buyer/Seller transport invalidation behavior.
- [x] 3.4 Resolve Buyer/Seller actors independently from the same authenticated Customer account.

## 4. Tests and Acceptance

- [x] 4.1 Test Buyer-only, Seller-only and dual-Persona login/navigation/data isolation.
- [x] 4.2 Test one-Seller-Organization invariant and concealed cross-Organization access.
- [x] 4.3 Test invite expiry, revoke, replay, concurrent consume, wrong WeChat/Marketplace and rate limits.
- [x] 4.4 Test reset replay, Staff never receiving passwords, password policy and all-session revocation.
- [x] 4.5 Run local D1, API/UI/browser, security, DTO, strict OpenSpec and formal Verify gates.

## 5. Rollback and Release

- [x] 5.1 Document pre-dual-persona rollback and post-dual-persona restore-only boundary.
- [x] 5.2 Keep production registration disabled until this Change is integrated and explicitly enabled.

## Formal Verification Result

- COMPLETE=5
- INCONSISTENT=0
- MISSING=0
- PARTIAL=0
- NOT_VERIFIED=0
- CRITICAL=0
- WARNING=0
- SUGGESTION=0
- Scenarios=11/11
- Migration=0030 fresh/0029-upgrade/guard/restore-only verified
- Browser=135/135 Chromium, including 320px, 200% reflow, keyboard and interactive Persona switch
- Dependency audit=2 existing high/0 critical with exact documented RSC-only exception; no downgrade retained
