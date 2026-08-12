# Design: Acquisition consultation authority and integrity

## Authority and scope

The business-owner adjudication and D-040 are authoritative. D-034 establishes five canonical roles but does not grant consultation write authority. D-026 keeps daily consultation record/correction owner-only. D-035 source declaration and D-038 canonical frontend evidence remain unchanged.

Historical Personal GRANT and Team/Leader rows remain readable for audit compatibility but do not enter current effective permission calculation. Current authority is the one canonical role's defaults minus Personal DENY and system prohibitions, followed by Marketplace and resource scope.

## Runtime boundary

`recordAcquisitionConsultation` requires the strict owner role plus `ACQUISITION_ADMIN` before acquiring idempotency. The channel must be ACTIVE and have one operational audience. `acquisition` retains Marketplace-scoped consultation list/history reads and Prospect/source operations; pre_sales, seller_ops and buyer_refund remain outside this operator surface. A history query joins consultation to channel and applies the actor's current Marketplace scope in the existence lookup; absent and cross-scope records both return `NOT_FOUND`.

## Transaction boundary

After idempotency acquisition, one D1 batch performs the conditional insert/update and immediately inserts a `transaction_assertions` result derived from `changes()=1`. Only then may it write the immutable consultation event, general Audit event, idempotency completion and completion assertion; the batch still ends by asserting the final consultation id/version/count. Any statement failure rolls back the batch. The catch path marks the idempotency claim failed so a retry is safe and no successful idempotency fact survives a failed business batch. Only explicit Acquisition OCC conditions become `VERSION_CONFLICT`; unknown D1/dependency errors are preserved and reach the existing route boundary as `DEPENDENCY_UNAVAILABLE`.

## UI and evidence

The canonical `AcquisitionCoreWorkbenchV4` continues loading scoped consultation rows for owner and acquisition. Owner read eligibility is separate from administration eligibility: forms and admin controls require both `role=owner` and the backend-projected `ACQUISITION_ADMIN`; an owner with Personal DENY remains on read surfaces without write controls. Acquisition sees the same scoped read summary without a write button. Acquisition fixtures carry `permissions=[]`, proving operator access is role/scoped and does not imply `ACQUISITION_ADMIN` or formal Buyer/Seller Lead permissions.

Behavior tests prove owner record/replay/hash/version behavior, deterministic same-version commit-window competition, non-owner denial before idempotency acquisition, immediate and final transaction assertions, unknown-error preservation, failed-batch cleanup, same/cross-scope history, exact HTTP body/origin/idempotency rules and canonical UI role projection. Route evidence runs the real Staff session middleware and D1 authorization recomputation for missing/revoked cookies, Personal DENY, historical GRANT/Team/Leader inputs and authorization-version drift.

## Rejected alternatives

- Granting consultation write to `acquisition` would contradict the owner-only authority.
- Checking only `ACQUISITION_ADMIN` would allow stale or forged effective-permission contexts to bypass the role boundary.
- Hiding the form without backend repair would leave the direct API vulnerability intact.
- Returning an empty cross-scope history would disclose record existence; concealed 404 is required.
- Adding a Migration is unnecessary because the schema already supports the required facts and assertions.
