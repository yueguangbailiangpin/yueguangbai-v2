## 1. Governance and Scope Lock

- [x] 1.1 Append D-045 without editing D-031 or any historical Decision, Migration, or archived evidence.
- [x] 1.2 Validate the proposal, design, and three modified capability deltas with strict OpenSpec validation.

## 2. Migration 0069

- [x] 2.1 Add forward-only Migration 0069 with Schema 68, empty legacy-stock, and dependent-formal-fact preconditions.
- [x] 2.2 Rebuild retained financial and marketplace-money snapshot tables without Seller Agreement Rate columns, FKs, triggers, or indexes and prove row conservation.
- [x] 2.3 Drop legacy agreement-rate tables and dependent objects in order, assert the Schema 69 inventory, and guard the 68-to-69 update with `changes() = 1`.
- [x] 2.4 Add focused fresh/sequential, wrong-order, repeat, dirty-stock rollback, integrity, and foreign-key migration tests.

## 3. Contracts and Domain

- [x] 3.1 Require Seller Principal Rate Policy snapshots in current Amazon formal-order results and remove legacy Seller Agreement Rate projections from shared Contracts.
- [x] 3.2 Remove test-only marketplace snapshot authority types while preserving generic Buyer currency conversion contracts.
- [x] 3.3 Verify all retained financial calculations use integer strings, BigInt, explicit currency/exponent, and HALF_UP rules.

## 4. API Runtime Authority

- [x] 4.1 Make principal-policy resolution unconditional in Staff evidence approval and preserve zero-partial-mutation failure behavior.
- [x] 4.2 Insert financial, principal-policy, and marketplace-money snapshots explicitly in the canonical D1 batch and strengthen final assertions.
- [x] 4.3 Remove the duplicate formal-order confirmation service, test-only marketplace snapshot locker, legacy agreement-rate pricing modules/exports, and compatibility flag.
- [x] 4.4 Migrate permission, idempotency, concurrency, immutability, Audit, Outbox, payable, review, refund, archive, and rollback tests to the canonical authority.

## 5. Seller Contract and UI

- [x] 5.1 Remove the legacy Seller agreement-rate DTO/read-model projection and require principal-policy facts for Amazon orders without changing organization/store scope or pagination.
- [x] 5.2 Remove the legacy Seller UI fallback and update runtime schemas, fixtures, MSW tests, and browser evidence.
- [x] 5.3 Verify Buyer/Seller DTO isolation, concealed cross-organization reads, and file dynamic-authorization behavior remain unchanged.

## 6. Schema 69 Governance

- [x] 6.1 Advance runtime readiness, recovery attestation, staging bootstrap, release templates/preflights, and current active release contracts/runbooks to Schema 69.
- [x] 6.2 Update migration and schema inventory verifiers to require 0069 and forbid legacy Seller Agreement Rate tables, columns, triggers, modules, DTO fields, and config flags.
- [x] 6.3 Preserve migrations 0001-0068, historical Decisions, archived Changes, and dated historical evidence byte-for-byte.

## 7. Verification and Handoff

- [x] 7.1 Run focused API/web/migration tests, database verification, migration guards, type/build/check, strict OpenSpec, and `git diff --check`.
- [x] 7.2 Run Formal Verify against the fixed implementation SHA and record exact tasks, requirements, scenarios, and executed evidence without remote claims.
- [x] 7.3 Sync the delta specs, archive the Change, validate the post-archive tree, and commit the governance completion.
- [x] 7.4 Push only the feature branch, open a Draft PR, lock base/head/CI/worktree, and prepare a fixed-SHA read-only review handoff without touching production or staging resources.
