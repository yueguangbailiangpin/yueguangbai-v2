# Change Proposal: Acquisition source authority alignment

## Why

D-026 preserved attribution, immutable origin, audit, deduplication and Staff privacy boundaries, but its historical rule that Lead channels are server-derived from Staff assignment conflicts with the approved current product rule. The current model accepts a client-declared `channel_id` only as a controlled source declaration; it never grants authorization.

## What Changes

- Record D-035 as the narrow superseding Decision without changing D-026's historical text.
- Modify the current `staff-acquisition-funnel` capability from server-derived channel selection to an explicit controlled source declaration.
- Record and test the existing runtime boundary: direct Lead requires a legal active source; Prospect-to-Lead requires an exact origin match; channel status, audience, Marketplace and current Staff scope are server-authoritative and fail closed.
- Align the Acquisition verifier with the current lead DTO/command, registered route, origin middleware, decision/OpenSpec evidence and behavior tests. It no longer treats an obsolete no-`channel_id` request body as a passing condition.

## Non-Goals

- No production runtime or contract behavior change: the audited runtime already implements the approved guards.
- No Migration creation, modification or execution.
- No Scheduling, Node-safety, Buyer/Staff/Admin cleanup, canonical-product-evidence closeout, remote action, deployment or Production-data operation.
- No archived Change or D-026 historical-text rewrite.

## Migration and rollback

No Migration is required or changed. The work is a governance, behavior-evidence and verifier alignment. Rollback is limited to reverting this uncommitted local diff; it creates no external or production fact.

## Acceptance boundary

Acceptance requires the minimal Acquisition behavior tests, the Acquisition verifier, `check:staff-acquisition`, target and all strict OpenSpec validation, and `git diff --check`. Formal OpenSpec Verify, sync and archive remain unavailable/controller-gated and are not substituted by CLI strict validation.
