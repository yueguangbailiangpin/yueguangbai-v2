# Design: Acquisition source authority alignment

## Authority and scope

The latest business-owner decision is authoritative, followed by the Decision Register, Product Rules, Contracts and Architecture. D-035 narrowly supersedes the D-026 clause that required Staff-assignment-derived channel selection and forbade a channel in the request. It preserves D-026's remaining attribution, immutable-origin, correction, deduplication, role/Marketplace, Personal DENY and Staff-safe projection boundaries.

## Runtime adjudication

The current Lead route accepts the exact current DTO fields and uses same-origin middleware. `createAcquisitionLead` first checks trusted lead duty, then current Staff Marketplace scope, and then validates that the declared channel exists, is ACTIVE, matches the requested Marketplace and has the requested Buyer/Seller audience. A request with a Prospect must exactly match the Prospect's lead type, Marketplace and original channel before a Lead is written. Therefore `channel_id` is data submitted by the client, not authority supplied by the client.

The existing runtime also preserves the required fact boundary: the Lead stores its original source, original source Staff, Prospect ID and inherited origin metadata; the immutable-origin trigger rejects direct rewrites. Source correction is an existing controlled, append-only history with an Audit event, so a correction does not overwrite the original source. The safe Lead projection does not return protected origin Staff, raw WeChat, identity hash, ciphertext, IV, Prospect ID or source URL to ordinary customer-intake Staff.

## Evidence design

Behavior tests prove a legal direct Lead, rejection of disabled/wrong-audience/wrong-Marketplace/out-of-scope declarations, rejection of a Prospect mismatch, and exact Prospect-origin inheritance. `docs/contracts/STAFF_ACQUISITION_FUNNEL.md` carries the same current authority statement and retained Personal DENY, Beijing-date, attribution and dashboard-separation boundaries. The verifier checks current route registration, exact-field closure, contract fields, Contract document, middleware and compact security-guard anchors, then relies on named behavior tests and the owned dry-run/browser gates for semantics rather than obsolete full-body source markers.

## Rejected alternatives

- Restoring server-derived Staff assignments would contradict the explicit current decision and make legal direct Lead source confirmation impossible.
- Treating `channel_id` as authorization would let clients bypass role or Marketplace boundaries.
- Altering production runtime merely to make the verifier pass would add dead behavior and conceal the actual current contract.
- Rewriting D-026 or archived Changes would destroy historical audit continuity.
