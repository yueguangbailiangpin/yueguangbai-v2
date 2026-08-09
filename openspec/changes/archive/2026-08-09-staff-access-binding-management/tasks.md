# Tasks: Staff Access and Feishu Binding Management

## 1. Governance and schema

- [x] 1.1 Inventory existing Staff provisioning, four-role, Staff Auth, Session and Feishu identity authority.
- [x] 1.2 Freeze Migration 0039, invite-first binding, owner-only permission and rollback boundaries.
- [x] 1.3 Add and verify invitation/binding-state tables, transition guards, hashes and schema version 39.

## 2. Contracts and API

- [x] 2.1 Add safe DTOs and exact request/response contracts without Provider identifiers or secrets.
- [x] 2.2 Implement owner-only list and invitation create/cancel endpoints with idempotency and audit.
- [x] 2.3 Implement binding start/callback by Provider verification and existing `provisionStaff` reuse.
- [x] 2.4 Implement versioned role and status commands with self/last-owner protection and Session invalidation.

## 3. Web

- [x] 3.1 Add owner-only lazy route, navigation and high-density responsive employee management workspace.
- [x] 3.2 Add invite creation/copy, pending invite cancellation, role change and enable/disable confirmation states.
- [x] 3.3 Add public employee binding page using the existing Feishu application and safe failure/retry messages.

## 4. Verification

- [x] 4.1 Test Migration fresh/upgrade, state transitions and no-delete/hash constraints.
- [x] 4.2 Test owner/Personal DENY, invite expiry/cancel/replay, ordinary unknown login rejection and provisioning idempotency.
- [x] 4.3 Test self/last-owner guards, one-role invariant, status/role version conflicts, audit/outbox and Session invalidation.
- [x] 4.4 Test Web runtime contracts, MSW states, responsive browser flow, lazy loading and direct-route backend denial.
- [x] 4.5 Run final full repository, Chromium, strict OpenSpec, dependency, Secret, Migration and Git scope gates once.

## 5. Closure

- [x] 5.1 Record local evidence with all external/production writes explicitly `no`.
- [x] 5.2 Complete controller review before archive/integration; real Migration/deploy/Feishu acceptance remains separately authorized.
