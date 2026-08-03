# Pre-Wave 13 Requirement Traceability Matrix

## 1. Scope

本矩阵保留 Pre-Wave 13 的历史追踪结论，并增加 Wave 13 Feature 的 `REMOTE_IMPLEMENTATION_EVIDENCE`。历史 formal main 为 `f28c52a36e9498c37453a4a12755d9ad8459ae65`，历史 audit branch 为 `5a72fd5d13204a6603ebfe3b39254915972390f8`。

当前 Feature 的源码证据只能标记 `IMPLEMENTED_AWAITING_LOCAL_VALIDATION`。本次没有运行 npm、Vitest、D1、R2、Wrangler、OpenSpec CLI、Verify 或 Ponytail，因此总体为 `NO_GO_PENDING_LOCAL_VALIDATION`。

## 2. Evidence Catalog

### Authority

- `AGENTS.md`
- `docs/AI_ENGINEERING_GOVERNANCE.md`
- `docs/decisions/V2_DECISION_REGISTER.md`
- `docs/product/V2_PRODUCT_RULES.md`
- `docs/contracts/**`
- `docs/architecture/**`
- `docs/migration/**`
- `openspec/changes/wave13-frontend-readiness-backend-completion/**`

### Implementation

- Staff Auth：`apps/api/src/staff-auth/**`
- Staff Middleware：`apps/api/src/middleware/staff-auth.ts`
- Default App：`apps/api/src/index.ts`、`apps/api/src/app.ts`
- File HTTP：`apps/api/src/files/routes.ts`、`route-authorization.ts`
- Order Evidence：`apps/api/src/order-evidence/staff-routes.ts`、`approve-order-evidence.ts`
- Buyer Refund：`apps/api/src/buyer-refunds/staff-routes.ts` 与既有 ledger services
- Foundation：Audit、Outbox、Idempotency、Transaction Assertions

### Contracts and Database

- `packages/contracts/src/staff-auth.ts`
- `packages/contracts/src/file-http.ts`
- `packages/contracts/src/staff-order-evidence.ts`
- `packages/contracts/src/staff-buyer-refund.ts`
- `packages/contracts/src/errors.ts`
- `migrations/0027_staff_auth_sessions.sql`

### Test and Verifier Source

- Staff Auth 与 logout-all replay tests
- Default App runtime boundary test
- D1 migration/runtime/service rollback tests
- R2 runtime fault/compensation test
- recursive DTO runtime test
- Wave 13 security/architecture/mismatch/refund/migration verifier scripts

以上测试与 verifier 均为源码证据，不是本次运行结果。

## 3. Historical Baseline Classification

Pre-Wave 13 审计的 115 项历史分类为：

| Result | Count |
|---|---:|
| COMPLETE | 99 |
| PARTIAL | 13 |
| MISSING | 1 |
| INCONSISTENT | 1 |
| NOT_VERIFIED | 1 |
| Total | 115 |

历史关键项：

- `MISSING`：正式 Staff Auth 与 File/Order Evidence/Buyer Refund HTTP surfaces；
- `INCONSISTENT`：Staff identity 与飞书边界；
- `NOT_VERIFIED`：真实 D1 与 test-double parity。

Wave 13 没有删除这些历史结果，只追加修复证据。

## 4. Wave 13 Requirement Classification

Wave 13 Change 保持 52 Requirements / 104 Scenarios：

| Classification | Requirements | Scenarios |
|---|---:|---:|
| `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | 37 | 74 |
| `PARTIAL` | 5 | 10 |
| `APPROVED_WAVE13_SCOPE_REDUCTION` | 1 | 2 |
| `LOCAL_VALIDATION_REQUIRED` | 9 | 18 |
| Total | 52 | 104 |

## 5. Current Traceability by Capability

| Capability | Authority / requirement | Remote implementation evidence | Test/verifier source | Current classification |
|---|---|---|---|---|
| Staff authority | D1 Staff/roles/permissions/scope authoritative; Feishu provider-only | D-014、Provider Adapter、internal Session、Middleware | Staff Auth tests、Default App test | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Login state | 10-minute hashed single use | `staff_login_states`、atomic consume | state concurrent consume source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Internal Session | opaque hash, 12h absolute TTL, no idle | `staff_sessions`、Cookie helpers | Session/Cookie tests | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Logout-all | version bump, all-session revoke, replay safe | atomic command + constrained COMMITTED replay | first/retry/key/reason/expiry/forged/concurrent source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Authorization | current D1 Role/GRANT/DENY/Team/Department/Scope | unified Middleware | nine-family Default App matrix source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| File HTTP | five active purpose-bound routes; no authority injection | intent/upload/complete/read HTTP | five-purpose/R2/DTO sources | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Internal communication file | global Purpose retained; no frozen consumer/link/audience workflow | active route/mapping removed | architecture verifier requires absence | `APPROVED_WAVE13_SCOPE_REDUCTION` |
| One screenshot | exact one file at Buyer HTTP + Domain | HTTP guard + existing Domain rule | route/source guard tests | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Order Evidence read | `ORDER_VIEW` + SQL Scope | list/detail routes/read models | Default App/route test source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Request changes | existing 2h flow | Staff route reuses service | route test source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Atomic approve | one Actor/Key/hash/response/batch | approve orchestrator | mismatch and service rollback source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| PRICE_MISMATCH | 409 unless valid ack+reason | contract/error/route/orchestrator | mismatch verifier/test source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Formal Order finance | final paid amount drives snapshot/payable | existing builders in atomic batch | rollback and source-policy tests | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Buyer Refund read | `BUYER_REFUND_VIEW` + Scope | list/detail | route/default app source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Buyer Refund Payment | append-only, proof audience, OVERPAID | existing service + Staff route | payment/fault/DTO source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| Buyer Refund Reversal | append-only correction | existing service + Staff route | reversal/fault source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` |
| R2 compensation | put/receipt/HEAD/D1/delete-pending/retry | existing compensation reused | shared R2 failure source | `LOCAL_VALIDATION_REQUIRED` |
| D1 migration | 0001–0027, 26→27, FK/integrity | Migration 0027 | `apps/api/src/wave13-migration-0027.test.ts` and runtime test source | `LOCAL_VALIDATION_REQUIRED` |
| Runtime DTO isolation | no secrets/storage authority/cross-domain finance | safe projections | recursive actual-response test source | `LOCAL_VALIDATION_REQUIRED` |
| OpenSpec validation | 52/104 structure after semantic update | files updated | CLI not rerun | `LOCAL_VALIDATION_REQUIRED` |
| OpenSpec Verify | implementation/requirement reconciliation | not executed | none | `LOCAL_VALIDATION_REQUIRED` |
| Ponytail | gated read-only review | not executed | none | `LOCAL_VALIDATION_REQUIRED` |
| Integration/main/deploy | only after gates | not created | none | `LOCAL_VALIDATION_REQUIRED` |

## 6. P1 Traceability

| Historical P1 | Remote remediation | Current status | Required evidence before closure |
|---|---|---|---|
| P1-01 Staff Auth missing | Migration、Provider、Session、Cookie、Middleware、Default App test source | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | current Feature tests, D1, Provider/browser and all route-family E2E run |
| P1-02 HTTP surfaces missing | File HTTP、Staff Order Evidence、Staff Buyer Refund | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | Route/D1/R2/Scope/DTO runtime evidence |
| P1-03 identity boundary conflict | D-014 + matching implementation | `IMPLEMENTED_AWAITING_LOCAL_VALIDATION` | strict validation、Verify、总控审查 |

P1 不得在仅有远程源码时正式关闭。

## 7. Static Route Count

| Item | Count |
|---|---:|
| Pre-Wave 13 formal routes | 108 |
| Staff Auth additions | 5 |
| Active purpose intent additions | 5 |
| File lifecycle additions | 12 |
| Staff Order Evidence additions | 4 |
| Staff Buyer Refund additions | 4 |
| Wave 13 active additions | 30 |
| Static expected total | 138 |

`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 的活动 Intent Route 已批准延期到 Wave 15，不计入 30。

## 8. Remaining Evidence Gaps

- 当前 Feature 的 npm/Vitest/typecheck/build 未运行；
- 真实 D1 migration、transaction、STRICT、Trigger、FK、integrity 未运行；
- 真实 R2 failure/compensation/cleanup 未运行；
- 当前语义更新后的 OpenSpec strict validation 未运行；
- OpenSpec Verify 未运行；
- Ponytail 未运行；
- PR、Integration、部署、main 推进均未发生。

## 9. Traceability Conclusion

# NO_GO_PENDING_LOCAL_VALIDATION

远程源码把历史缺口推进到 `IMPLEMENTED_AWAITING_LOCAL_VALIDATION`，但运行证据和治理门禁尚未满足。

## 10. LOCAL_REMEDIATION_VALIDATION（2026-08-03）

| Evidence area | Local result | Traceability effect |
|---|---|---|
| Full repository gate | `npm run check` passed；111 files / 571 tests；typecheck/build passed | 本地回归证据已满足，不等同于正式 P1 closure |
| Wave 13 gates | 6 verifiers passed；12 files / 60 tests passed | Staff Auth、File、Evidence、Refund、DTO 和 migration 源码门禁已运行 |
| Empty Local D1 | 0001–0027；Schema 27；117 app tables；221 triggers；10 views；FK 0；integrity ok | 空库迁移与当前 Schema 运行证据已满足 |
| Local D1 26→27 | only 0027 applied；Staff/Customer seed preserved；session_version=1；Customer Auth schema unchanged | 升级兼容与既有认证边界证据已满足 |
| Staff Auth cleanup | 24h、100 rows/table/batch、continuation、retention、fail-closed tests passed | Task 5.3 本地行为证据已满足；无 Cron/Scheduled Handler |
| R2 boundaries | Mock 2 files / 11 tests passed | fault/compensation 本地 Mock 证据已满足；真实/生产 R2 未验证 |
| Default App / DTO / replay | 3 files / 8 tests passed | 运行时装配、递归泄漏与 replay 边界已验证 |
| OpenSpec CLI | 52 Requirements / 104 Scenarios；target 1/1、all 2/2 strict passed | 结构与 CLI strict gate 已满足 |
| OpenSpec Verify | `NOT_AVAILABLE` | 正式 reconciliation 仍开放，25.x 不勾选 |

环境只出现两类非致命告警：npm allow-scripts 覆盖提示，以及 Wrangler 无法写用户 Preferences 日志；命令本身均成功。Ponytail、浏览器/真实飞书、生产 R2、PR、Integration、部署、main 推进均未运行。

## 11. Updated Traceability Conclusion

# NO_GO_PENDING_OPENSPEC_VERIFY

本地验证项可以进入总控复核，但正式 OpenSpec Verify 仍不可用；52/104 不作“全部正式核对完成”声明，P1 保持未正式关闭。
