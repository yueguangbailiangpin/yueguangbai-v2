# Tasks: seller-owner-operations-write-authorization

## 1. Inventory and contracts

- [x] 1.1 Verify the current branch, HEAD, worktree, AGENTS.md, current system
  state, Seller permission matrix, product rules, route inventory, architecture
  rules, decisions, and relevant existing OpenSpec context.
- [x] 1.2 Build the four-role matrix from current authoritative contracts and
  current tests, explicitly separating general operational writes from store,
  settlement-account, member-management, and financial-read exceptions.
- [x] 1.3 Record the current Seller payment list/detail read boundary without
  changing it or treating it as proof of a write rule.

## 2. Domain policy

- [x] 2.1 Add a dependency-safe, pure `@ygb/domain` Seller role capability
  policy with a frozen four-role matrix and fail-closed unknown-role behavior.
- [x] 2.2 Export the policy from the canonical domain package entrypoint.
- [x] 2.3 Add unit tests covering every role/capability cell and the unknown-role
  negative case.

## 3. API and command migration

- [x] 3.1 Migrate the Seller actor/access projection and product/demand command
  guards to the shared general operational-write capability.
- [x] 3.2 Migrate Seller product-application image upload authority to the same
  capability while preserving the existing purpose map and lifecycle checks.
- [x] 3.3 Route store creation, settlement-account update, member management,
  and financial summary/payables reads through their named exception helpers.
- [x] 3.4 Confirm no Staff lower-case role checks, file-read Owner special, or
  Seller payment-read behavior was accidentally migrated.

## 4. Regression tests

- [x] 4.1 Extend the Seller Portal HTTP suite with unauthenticated and
  no-membership session negatives.
- [x] 4.2 Add owner/non-owner member-management coverage for all four roles as
  applicable, including invitation-write denial.
- [x] 4.3 Preserve and run existing four-role operational-write negatives,
  cross-organization concealed 404, idempotent replay, Origin Guard, audit,
  and expected-version conflict tests.

## 5. Verification and delivery

- [x] 5.1 Run shared-policy and all affected Seller focused tests with direct
  command exit codes.
- [x] 5.2 Run `npm run typecheck`, `npm run build`, `npm test`, `npm run check`,
  current/all OpenSpec strict validation, and `git diff --check`.
- [ ] 5.3 Inspect the final diff/import/routing scope and create one normal
  non-amended local commit containing only this task's files; do not push,
  deploy, archive OpenSpec, or access remote/production resources.
