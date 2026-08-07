# Tasks: Google Drive Cold Image Archive

## 0. Governance and Provider PoC

- [x] 0.1 Freeze exact business-close terminal matrix, natural-month calculation and four eligible file purposes.
- [ ] 0.2 Run an anonymous Google Drive OAuth/upload/download/delete PoC with the owner account and no real files.
- [ ] 0.3 Record approved OAuth scope, dedicated folder, MFA/recovery, capacity and token-rotation runbook.

## 1. Migration and Contracts

- [x] 1.1 Allocate the next consecutive Migration as the sole Schema writer.
- [x] 1.2 Add business-close/archive due facts, file archive states, Drive Manifest, retries, events and cleanup guards.
- [x] 1.3 Keep external DTOs free of Drive IDs/URLs and extend only safe archive status/dependency errors.
- [x] 1.4 Add fresh/upgrade/state/trigger/index Migration verifiers.

## 2. Archive Adapter and Job

- [x] 2.1 Implement owner-account OAuth token refresh and a testable Drive Adapter.
- [x] 2.2 Implement resumable upload, D1 lease/idempotency, read-back SHA-256/MIME/size verification and retry.
- [x] 2.3 Enable R2 deletion only after conditional `DRIVE_VERIFIED`; record immutable archive events.
- [x] 2.4 Add Manifest reconciliation and owner-only Drive-to-R2 rehydration.

## 3. Controlled Read

- [x] 3.1 Reuse the existing Read Intent/Content endpoint and authorization pipeline for both storage locations.
- [x] 3.2 Stream Drive bytes with safe headers and no ID/token/URL disclosure.
- [x] 3.3 Preserve Buyer/Seller/Staff Audience, version, concealment and replay protections.

## 4. Tests and Acceptance

- [x] 4.1 Test all business-close terminal combinations, reopen behavior and six-natural-month end-of-month cases.
- [x] 4.2 Test upload interruption/resume, duplicate job, Drive 4xx/5xx, token revoke, mismatch and R2 delete failure.
- [x] 4.3 Test four eligible and all ineligible purposes plus archive read authorization/DTO isolation.
- [ ] 4.4 Complete shadow-copy, proxy-read, R2-delete and rehydration acceptance stages with anonymous files.
- [x] 4.5 Run local D1/R2, Provider adapter, security, full workspace, strict OpenSpec and formal Verify gates.

## 5. Rollback and Release

- [x] 5.1 Verify global archive/copy/delete/read kill switches.
- [x] 5.2 Prohibit old R2-only Worker rollback after first R2 deletion unless all affected files are rehydrated.
- [x] 5.3 Keep real owner-account authorization and production deletion separately approved.
