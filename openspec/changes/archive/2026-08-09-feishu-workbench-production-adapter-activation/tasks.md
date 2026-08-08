# Tasks: Feishu Workbench Production Adapter Activation

## 1. Migration

- [x] 1.1 Inventory 0033 mirrors/callback receipts, 0034 dead-letter categories, Staff identity mapping and current schema tail.
- [x] 1.2 Record `NO_SCHEMA_CHANGE`; do not create 0038 or modify historical migrations.

## 2. Contracts

- [x] 2.1 Freeze anonymous official tenant-token and Task v2 request/response schemas, stable client token and safe deep-link projection.
- [x] 2.2 Freeze official encrypted card callback/challenge normalization, signature, replay, tenant/app/token and Staff mapping boundaries.
- [x] 2.3 Freeze timeout, response limit, local rate limit, retry and redacted error classification.

## 3. Implementation

- [x] 3.1 Implement native-fetch production adapter with injectable transport/time/sleep, token cache/refresh coalescing and safe response parsing.
- [x] 3.2 Implement fail-closed factory/runtime assembly without coupling Staff Auth.
- [x] 3.3 Update sync to resolve configured-tenant assignee open_id before network and never send bare Staff ID.
- [x] 3.4 Implement official X-Lark verification, AES-CBC decryption, challenge and normalized callback handling.
- [x] 3.5 Add template fields, managed Secret names and zero-network Feishu activation preflight.
- [x] 3.6 Gate acquisition maintenance behind its own exact-true, default-off switch and require false for Feishu-only activation without reading its Secret.

## 4. Tests

- [x] 4.1 Test exact token/task requests, create/update/terminal projection, stable idempotency and no sensitive/raw internal fields.
- [x] 4.2 Test cache hit/expiry/concurrent refresh/401 refresh, timeout, body limit, 429 Retry-After, 5xx retry, contract rejection and local rate limit with fake time/responses.
- [x] 4.3 Test challenge, official signature/decryption, timestamp, nonce/event replay, tenant/app/token mismatch, inactive/unknown/Personal DENY and version reconciliation using local D1.
- [x] 4.4 Test runtime/preflight defaults, missing/conflicting configuration, separate Staff Auth switches, and zero network before complete activation.
- [x] 4.5 Run DTO/Secret/Provider-body scans, Migration guards, dependency/security gates, full `npm run check`, appropriate Chromium and strict OpenSpec validation once after targeted fixes.
- [x] 4.6 Prove the Feishu-only scheduler combination records only `feishu_sync`, creates no acquisition maintenance run and performs no acquisition Secret read.

## 5. Rollback and Acceptance

- [x] 5.1 Update contract and Chinese Runbooks with config/Secret names, staged kill switches, failure recovery and callback response timing.
- [x] 5.2 Produce final local evidence with `FEISHU_RESOURCES_TOUCHED=no`, external calls zero and `PRODUCTION_NO_GO`; do not claim anonymous mocks as real Feishu acceptance.
- [x] 5.3 After all gates and OpenSpec consistency pass, run Ponytail read-only diff review only; do not modify automatically.
- [x] 5.4 Document the independent acquisition kill switch in activation preflight, rollback, final NO-GO evidence and the acquisition contract without weakening retention validation.
