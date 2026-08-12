## Authority and scope

The current Staff specification, D-024, D-025 and D-034 are authoritative. Seller Settlement is a mandatory internal Staff workflow. The production route is `StaffRouteModule` → `FrozenStaffWorkbenchV2` → `FrozenStaffWorkbench`, while the only pre-change Seller Settlement frontend implementation is the retired `StaffWorkbench` fallback panel. This Change performs an equivalent ownership transfer; it does not redesign the settlement domain or change a backend contract.

## Legacy behavior inventory

| Boundary | Pre-change behavior to preserve or classify |
| --- | --- |
| Route and context | The panel is reached from a selected Staff work item with `seller_organization_id`; the organization ID owns the three settlement reads. |
| Visibility and scope | The legacy component performs no client role/permission check and relies on backend denial. This conflicts with the current five-role/effective-permission contract and is a pre-existing UI bug, not takeover behavior to preserve. |
| Reads | `GET /api/staff/seller-settlements/:organizationId/summary`, `/payables?limit=25`, and `/payments?limit=25` load independently through strict runtime schemas. |
| Loading, error and empty | Summary shows loading text until available. Each read fails independently with sanitized concealed-404 or generic recovery text, request ID and retry. Payments has an explicit empty fact; payables renders no invented row when empty. |
| Financial display | Outstanding Seller principal and Seller service fee stay separate. Payables retain type, status and outstanding amount. Payments retain amount, Shanghai timestamp, status, allocation state and protected proof. |
| Record | A verified `staffSellerSettlementProof` upload enables `{amount_cny_fen, paid_at, proof_file:{file_object_id,expected_file_version}}`. The legacy chooser also offers PDF although backend validation accepts only JPEG/PNG/WebP; that MIME conflict is a pre-existing UI bug to correct. |
| Allocate | An active payment with non-zero unallocated amount submits `{payable_id, amount_cny_fen, expected_payment_version}`. |
| Reverse | An active payment with zero allocated amount submits `{expected_version, reason}`. The takeover preserves that conservative UI restriction even though backend rules remain authoritative. |
| Disabled and confirmation | Financial buttons are disabled while the single mutation authority is pending; record is disabled until proof verification. The settlement workflow has no separate confirmation dialog, so takeover does not add one. |
| Retry and refresh | One `StaffMutationAuthority` preserves exact ambiguous retry. A successful mutation refetches summary, payables and payments; other panel data remains usable. A deterministic failure is never rendered as success. |
| Proof and audit | Proof opens only through `StaffProtectedFileButton`. Backend read-intent authorization, immutable audit, outbox, transaction and final assertions are unchanged; the client does not invent an audit result. |
| Backend fail-closed | ACTIVE Staff, effective permission including Personal DENY, Marketplace/Seller Organization scope and proof audience are recalculated on the server. Out-of-scope access remains concealed as 404. |

## Canonical ownership

`SellerSettlementPanel.tsx` becomes the single reusable implementation. `FrozenStaffWorkbench` mounts it only in the existing generic work-item fallback when the selected item carries Seller Organization context and the current session passes the view gate. Known demand, order-evidence, review and Buyer-refund work types keep their existing panels. The settlement component owns its three queries, upload state and one mutation authority, so no parent duplicates settlement data or commands.

The panel returns the canonical detail and action columns. Organization, summary, payables and payments remain facts in the detail column; record and permitted financial controls remain actions. Successful writes refetch the same three authoritative reads.

## Role and permission mirror

Client visibility is deliberately narrower than “the queue returned this item”:

- `owner` or `seller_ops` plus `SELLER_SETTLEMENT_VIEW`: view facts and protected proof.
- additionally `SELLER_SETTLEMENT_RECORD`: record a payment and allocate it.
- additionally `FINANCIAL_CORRECT`: offer whole-payment reversal.
- `acquisition`, `pre_sales`, `buyer_refund`, or a missing effective view permission: do not mount and do not issue settlement requests.

This mirror prevents pointless probing and misleading controls; it is not authorization. All routes continue to call the existing backend authorization and Seller Organization scope logic. A permission or scope change after render therefore still fails closed, and the UI must show the returned failure instead of optimistic completion.

## Evidence migration and retirement

Canonical MSW evidence is split by concern: settlement contract/display/mutation behavior, role/permission non-probing, and Frozen workbench queue/detail/demand integration. Package targets and the Staff/scheduling verifier point to these production files and tests. Static verification checks composition ownership and the absence of legacy files; request DTOs and role behavior are proven by runtime contract/behavior tests rather than fragile exact source-copy markers.

After those consumers move, delete only `apps/web/src/staff/StaffWorkbench.tsx`, `apps/web/src/staff/StaffWorkbench.msw.test.tsx`, and any helper/CSS proven to have zero other consumer. `AcquisitionWorkbench` and `AdminBusinessDashboard` remain untouched.

## Safety and rollback

No API route, service, runtime response schema, financial formula, command, state machine, authorization policy, D1 schema, Migration, audit or outbox code changes. No production resource or real data is touched. The local uncommitted frontend/evidence/governance diff can be reverted before release without creating a financial reversal.

## Rejected alternatives

- Keeping the legacy panel beside a new panel would create two authorities and drifting financial behavior.
- Mounting settlement globally for every Staff role would disclose workflow existence and generate avoidable denied requests.
- Adding a new organization search, settlement route or backend API would be a product/domain redesign outside this takeover.
- Copying the legacy PDF chooser or role-blind mount would preserve known contract bugs, not equivalent behavior.
