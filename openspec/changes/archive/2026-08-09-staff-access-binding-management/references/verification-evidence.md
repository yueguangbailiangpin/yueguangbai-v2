# Verification Evidence: Staff Access and Feishu Binding Management

## Scope and authority

- Worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/staff-access-binding-management`
- Branch: `feat/staff-access-binding-management`
- Starting commit: `6baf736`
- One existing Feishu application remains the identity-verification Provider; no second application, arbitrary permission editor, Provider identifier input or HR facts were added.
- Management requires the sole `owner` role plus effective `STAFF_MANAGE` and `PERMISSION_MANAGE`; Personal DENY remains final.
- Non-owner invitations require exactly one explicitly selected ACTIVE Team. Invitation and OAuth state values are persisted as SHA-256 hashes only.

## Functional evidence

- Added owner-only employee overview, one-time invitation creation/cancellation, role change, enable/disable and responsive Web workspace.
- Added public `/staff/bind` flow. Provider verification reuses the existing Staff provisioning command; ordinary unknown-identity login remains rejected.
- Role/status changes require version and idempotency authority, preserve exactly one ACTIVE role, revoke prior Sessions, record authorization/audit/outbox facts, protect self/final owner and assert that at least one ACTIVE owner remains after the transaction.
- Current projections expose no Feishu `open_id`, `user_id`, tenant key, token/state hashes, Provider token, claims, Cookie/session hash or permission internals.
- Migration `0039_staff_access_binding_management.sql` advances the continuous local chain to schema 39 with 172 tables, 319 triggers, integrity `ok` and zero foreign-key errors.

## Final verification

- Focused API/Web tests: 4 files, 11/11 passed.
- Complete `npm run check`: passed; 213 files and 1,365/1,365 repository tests, 39 files and 449/449 Web tests, every workspace typecheck/build, Worker dry-run build, Secret scan, dependency audit, Migration guards and prior module gates passed.
- Complete Chromium: 184 passed, 1 pre-existing manual Buyer visual checkpoint skipped, 0 failed. The new owner mobile, non-owner direct-route and malformed public-binding cases passed 3/3.
- Strict OpenSpec: target valid; all 49/49 items passed.
- Production Web build: initial entry 247.78 kB raw; lazy Staff access-management chunk 10.26 kB raw. No new UI framework, external font or eager identity bundle was added.
- `git diff --check`: passed.

The first all-repository confirmation encountered one existing Staff MCP concurrency test exceeding its 5-second budget under aggregate load. The exact test passed immediately in 207 ms, and the subsequent complete `npm run check` passed without changing that test or its production logic.

## External state and remaining boundary

- Production deployment: no.
- Online Migration: no.
- Cloudflare/D1/R2/domain/DNS: no.
- Feishu real configuration/API/data: no.
- Drive, OpenAI/ChatGPT MCP or real secrets: no.
- Remote Git, push, PR or merge: no.

Archive, Git integration, online Migration, deployment and real Feishu acceptance remain separately authorized steps.
