# TypeScript noUnused Findings

Date: 2026-08-09 (Asia/Shanghai)

Before enabling shared enforcement, every workspace was compiled with both `noUnusedLocals` and `noUnusedParameters`. Contracts, domain, testkit, and UI were already clean. The complete compiler-proven removal inventory below contains 11 API production declarations/parameters, 9 API test import bindings, and 5 Web import bindings/types. Counts reported by overlapping API production/test compilations are not added together because the test config also compiles production sources.

Removed API production declarations/parameters:

- `nullableTimestamp`
- `ColdArchivePurpose`
- `requireUpdate`
- `canonicalJson`
- `PasswordCredential`
- two unused idempotency claim parameters in Buyer-number assertion builders
- `PricingReviewType`
- `IdempotencyClaim`
- the unused `DirectWorkItemInput` parameter of `subjectType`
- `getStaffAvailability`

Removed API test imports:

- `AcquisitionError`
- `COLD_ARCHIVE_CONFIRMED_AT`
- `FileAuthorizationResource`
- `readFileSync` / `path` in two test modules
- `readStaffOrderEvidence`
- `ProvisionStaffError`

Removed Web imports/types:

- `userEvent`
- `Review`
- `vi` in two files
- `StaffBuyerRefund`

No implementation was replaced with a stub or underscore parameter. After removal, API production/test, Web, contracts, domain, testkit, and UI all passed with both flags; the options were then enabled in `tsconfig.base.json`. No lint dependency was added.
