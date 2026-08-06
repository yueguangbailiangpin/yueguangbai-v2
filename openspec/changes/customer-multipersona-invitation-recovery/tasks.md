# Tasks: Customer Multi-Persona, Invitation and Recovery

## 0. Governance

- [ ] 0.1 Inventory Identity, Claim, Account, Buyer, Seller Membership, Auth and Session invariants/callers.
- [ ] 0.2 Freeze invitation/reset TTL, issuer permission, Marketplace dependency and public error matrix.

## 1. Migration

- [ ] 1.1 Allocate the next consecutive Migration as the sole Schema writer.
- [ ] 1.2 Migrate Account authority to one credential plus Buyer/Seller Persona relations with uniqueness assertions.
- [ ] 1.3 Add hashed invitation/reset facts, immutable events, cleanup indexes and DB guards.
- [ ] 1.4 Add fresh/upgrade/dual-persona/rollback-manifest Migration verifiers.

## 2. Contracts and Domain

- [ ] 2.1 Add issue/revoke/read/consume invitation and password reset contracts with exact-key validation.
- [ ] 2.2 Add multi-Persona Session Projection without cross-role DTO leakage.
- [ ] 2.3 Implement token hashing, TTL, consume/revoke state machines, password/session version changes and deterministic errors.

## 3. API and UI

- [ ] 3.1 Add authorized Staff invitation/reset issue and revoke commands.
- [ ] 3.2 Require valid invitation context on `/buyer/register`; keep root/login registration links absent.
- [ ] 3.3 Add Customer reset-link form and preserve Buyer/Seller transport invalidation behavior.
- [ ] 3.4 Resolve Buyer/Seller actors independently from the same authenticated Customer account.

## 4. Tests and Acceptance

- [ ] 4.1 Test Buyer-only, Seller-only and dual-Persona login/navigation/data isolation.
- [ ] 4.2 Test one-Seller-Organization invariant and concealed cross-Organization access.
- [ ] 4.3 Test invite expiry, revoke, replay, concurrent consume, wrong WeChat/Marketplace and rate limits.
- [ ] 4.4 Test reset replay, Staff never receiving passwords, password policy and all-session revocation.
- [ ] 4.5 Run local D1, API/UI/browser, security, DTO, strict OpenSpec and formal Verify gates.

## 5. Rollback and Release

- [ ] 5.1 Document pre-dual-persona rollback and post-dual-persona restore-only boundary.
- [ ] 5.2 Keep production registration disabled until this Change is integrated and explicitly enabled.
