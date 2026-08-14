# Change: Customer Security DENY And Password Rate Limit

## Why

Two Customer-security route families still authorize only from Staff role names. An owner with a final Personal DENY can therefore change a Customer login identifier, and an owner or seller operator with a final DENY can still issue, read or revoke Seller registration invitations. Authenticated password change also verifies the current password without an independent account/network/device rate limit.

## What Changes

- Require ACTIVE owner plus effective `BUYER_IDENTITY_HIGH_RISK_MANAGE` for Customer login-identifier changes.
- Require ACTIVE owner or seller operator plus effective `SELLER_MANAGE` for Staff Seller-invitation issue/read/revoke operations.
- Apply an independent fixed-window password-change limiter by authenticated account, normalized network source and device before current-password verification and before idempotency acquisition.
- Store only keyed hashes for rate-limit dimensions and append a sanitized `PASSWORD_CHANGE_RATE_LIMITED` security event on blocking.
- Add forward-only Migration 0068 to extend the existing Customer security rate-limit and auth security-event constraints while preserving all existing rows.
- Advance current schema, recovery and staging governance anchors to Schema 68.

## Non-goals

- No change to the rule that all ACTIVE Staff can issue password-reset links.
- No new Staff permission, role default, Customer password policy, Seller Organization authority or frontend workflow.
- No modification of historical migrations 0001-0067 or archived OpenSpec evidence.
- No production/staging deploy, remote D1/R2 write, Secret, DNS, Access or Scheduler mutation.

## Migration Decision

`FORWARD_MIGRATION_REQUIRED`. Migration 0068 advances Schema 67 to 68, preserving existing rate-limit and immutable security-event rows while allowing the new `PASSWORD_CHANGE` operation, `ACCOUNT_ID` scope and `PASSWORD_CHANGE_RATE_LIMITED` event.

## Rollback

Before remote application, revert this branch as one unit. After 0068 is applied, do not edit/delete the migration or immutable security events; rollback requires a new forward migration that preserves the stronger abuse boundary and all prior facts.
