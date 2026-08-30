# Proposal: seller-settlement-read-boundary

## Why

The Seller settlement read surface currently has two different authorization
boundaries. Summary and payable reads are limited to `OWNER` and `FINANCE`,
while payment list/detail reads resolve for every active Seller member. The
Seller frontend hides the payment history from `OPERATIONS` and `VIEWER`, so
the HTTP API and the UI do not describe the same boundary. The batch read
surface is intentionally broader, but its Buyer failure status and historical
permission text have drifted.

## Confirmed read matrix

| Seller endpoint | `OWNER` | `OPERATIONS` | `FINANCE` | `VIEWER` |
| --- | --- | --- | --- | --- |
| `summary` | read | no access, concealed 404 | read | no access, concealed 404 |
| `payables` | read | no access, concealed 404 | read | no access, concealed 404 |
| `payables/:id` | read | no access, concealed 404 | read | no access, concealed 404 |
| `payments` | read | no access, concealed 404 | read | no access, concealed 404 |
| `payments/:id` | read | no access, concealed 404 | read | no access, concealed 404 |
| `batches` | read Seller-safe visible batches | read Seller-safe visible batches | read Seller-safe visible batches | read Seller-safe visible batches |
| `batches/:id` | read Seller-safe visible batches | read Seller-safe visible batches | read Seller-safe visible batches | read Seller-safe visible batches |

An authenticated Buyer calling either Seller batch route receives concealed
`404`. Unauthenticated and invalid or inactive Seller memberships preserve the
existing `401` authentication/session behavior.

## What Changes

- Reuse the existing `canReadSellerSettlementFinancials` policy for payment
  list and payment detail, matching summary/payables and the current Seller
  frontend gate.
- Preserve the existing organization-derived scope, cursor token format,
  ordering, limits, and malformed-cursor behavior for payables and payments.
- Add request-level tests for payment roles, payment detail, organization
  isolation, concealed 404 responses, and real two-page payables/payments
  traversal without duplicates or omissions.
- Make the Seller batch boundary return concealed 404 for Buyer sessions while
  keeping four-role ACTIVE Seller read access and the existing batch state
  machine.
- Synchronize the permission matrix, Stage 7.5 handoff, and related OpenSpec
  text so the specific matrix is no longer contradicted by historical prose.

## Privacy and DTO boundary

This Change does not add or remove DTO fields. The existing legacy financial
DTOs remain separate from the dedicated Seller-safe batch DTO. No Seller
response may expose Buyer refund data, internal profit, internal notes, object
storage keys, or Staff-only fields. The role decision does not authorize
reusing the employee batch projection.

## Scope

Seller settlement read authorization, request-level coverage, Buyer batch
concealment, and the directly related local documentation.

## Non-Scope

- No migration, schema, D1 data, ledger, payment allocation, audit, or state
  machine change.
- No change to batch writes, automatic reservation review, Seller write
  authorization, shared cursor implementation, CSS, visual layout, or frontend
  design.
- No change to Staff authorization or to Buyer routes other than the Seller
  batch boundary.
- No deployment, push, remote CI, Cloudflare, R2, Queues, Google Drive,
  GitHub, Feishu, or production resource access.
- No OpenSpec archive.

## Migration

None.

## Rollback Boundary

Rollback is the normal revert of the single local Change commit. No reset,
rebase, stash, clean, squash, amend, push, or deployment is permitted.
