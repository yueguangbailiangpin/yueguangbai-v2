# Tasks: Feishu Production App and Operational Alert Readiness

## 1. Inventory and Migration

- [x] 1.1 Inventory current Staff OAuth, Task v2 adapter/callback, Scheduler, Outbox, alert state, failure and dead-letter evidence.
- [x] 1.2 Record `NO_SCHEMA_CHANGE`; reuse 0031/0033/0034 and do not create 0044.

## 2. Contract and Runtime

- [x] 2.1 Add default-off Feishu operational alert bindings and production runtime validation.
- [x] 2.2 Map the strict alert DTO to a fixed Chinese text message with stable Provider UUID and controlled `/staff` link.
- [x] 2.3 Reuse tenant token/retry/response bounds, add conservative alert rate limit, and classify sink failure as `FEISHU_ADAPTER_FAILURE`.
- [x] 2.4 Keep Staff Auth, Workbench, formal business actions and independent primary alert authority unchanged.

## 3. Preflight and Runbook

- [x] 3.1 Add a zero-network combined formal-app preflight for one App ID/Tenant, exact callbacks, managed Secret names and frozen unrelated switches.
- [x] 3.2 Add Chinese administrator instructions for exact scopes, web entry, redirect/callback, availability, bot group, version publication/approval, staged acceptance and rollback.
- [x] 3.3 Document formal/test/future-AI app isolation and external owner blockers without operational identifiers.

## 4. Tests and Verification

- [x] 4.1 Test exact message API request, safe text, stable UUID, token cache/refresh, timeout, rate limit, retry and strict response handling with anonymous transport.
- [x] 4.2 Test runtime/preflight incomplete-config zero-network behavior, same-app matching, Secret-name-only output and template defaults.
- [x] 4.3 Test alert dedupe/cooldown plus Feishu-specific durable failure evidence and existing Task v2 dead-letter regression.
- [x] 4.4 Run targeted tests, typechecks, Migration guards, strict OpenSpec and full repository gates; record real PASS/FAIL/SKIP.

## 5. Closeout

- [x] 5.1 Review the final diff for customer/Staff/provider identifier leakage and unrelated changes.
- [x] 5.2 Commit locally only and report branch/worktree/commit, external owner actions, `PRODUCTION_NO_GO` and external write counts to total control.
