## Context

See `proposal.md` for motivation. 预清理基线为当前 HEAD `ca5a166324e7f2a220f293aeb9e4cebd9d25281f`；工作树在核对时干净。候选逐项以静态引用、生产/测试消费者、动态 import、package script、文档和运行时入口交叉核对。历史迁移文档中的旧命令和旧模块名称不作为当前运行时消费者，也不在本次扩大清理范围。

## Goals / Non-Goals

**Goals:**

- 只移除当前 HEAD 可证明无生产消费者的候选，或修剪明确失效的脚本路径。
- 让保留的保护资源测试使用 buyer/seller/staff 的现行 client 和 runtime schema，消除独立漂移副本。
- 保留所有纵深防御、负向 preflight 检测、现行 API 路由和历史加密兼容。
- 以 focused tests、typecheck、build、check、OpenSpec strict 和 `git diff --check` 证明清理安全。

**Non-Goals:**

- 不改变业务行为、API 合约、数据库 schema/数据、权限模型、产品 UI 流程或 Cloudflare/staging/production 资源。
- 不清理 acquisition 历史文档、退役模块的历史归档记录、legacy CSS、权限单点化、游标共享或整数 schema 收敛。
- 不删除 acquisition 微信历史密文兼容所需旧 HMAC KDF 标签、`STAFF_MCP_*`/`FEISHU_*` preflight 墓碑、order-integrity events/financial-adjustments 端点或任何动态 import 模块。

## Decisions

### 1. Script and template cleanup

- 删除 `dry-run:staff-acquisition`，因为其唯一目标 `apps/api/src/acquisition/maintenance-dry-run.test.ts` 不存在，直接执行已返回 Vitest code 1；历史文档不算运行时消费者。
- 保留 `test:seller-principal-rate-bootstrap`，只删除其两个不存在的 `apps/api/src/pricing/migration-0043.test.ts` 与 `apps/web/src/staff/pricing/SellerPrincipalRatePolicyWorkspace.msw.test.tsx` 路径；其余五个 test files 可执行并当前直接执行通过。
- 删除 `apps/api/wrangler.keyword-generator.staging.template.jsonc`：它指向不存在的 `src/keyword-image-generator-worker.ts`，没有当前 wrangler template 选择、Worker 入口或生产引用。保留 preflight 对意外 keyword service binding 的负向检测。

### 2. Canonical protected-resource adapters

`apps/web/src/api/protected-resources.ts` 的 buyer、seller、staff schemas 与当前 contracts 漂移，且仅两份 session-invalidation 测试引用；无生产 import。删除该副本，测试改用现行 `buyerApi.me`、`sellerApi.me` 和新加入 staff client 的 `staffApi.assignments`。staff assignments runtime schema 放在现行 `apps/web/src/staff/contracts/runtime.ts`，以 `@ygb/contracts` 的 `StaffAssignmentDto` 形状约束 duty/source/status，确保测试仍验证现行 endpoint 而不是保留旧 adapter。

### 3. Old UI consumers

`StaffAccessManagementWorkspace.tsx` 只有一行 re-export，生产 route 直接使用 `StaffAccountsWorkspace`；测试改为 canonical import 后删除壳。`StaffCustomerSecurityPanel.tsx` 无生产 import，仅被同目录旧测试的两项 invitation/clipboard 场景引用；这些场景属于已退役面板，删除面板及对应两项测试，保留独立的当前 Customer password reset 测试。CSS 不在本 Change 内处理。

### 4. Retired path and debug output

`isApiRequestPath` 仅删除 `/mcp` 和 `/.well-known/oauth-protected-resource/mcp` 两个已退役白名单条件，保留 `/health`、`/ready`、`/api`、`/api/`。新增单元断言覆盖 retired path 不再被分类为 API，同时保留 `STAFF_MCP_*` fail-closed binding 检测。只删除 `expire-reservation.ts` 的 `VER` console error；版本不匹配仍抛出同一个 `VERSION_CONFLICT`。

## Evidence and protection boundaries

| Candidate | Pre-change evidence and action | Boundary preserved |
| --- | --- | --- |
| Broken scripts | `dry-run:staff-acquisition` points to missing file and exits 1; seller script has two missing paths, five valid files and exits 0 | Keep valid seller rate coverage; no acquisition compatibility code changed |
| Keyword template | main file absent; no current template selector or runtime import | Keep negative unexpected keyword service-binding preflight |
| protected-resources | exactly two test consumers; no non-test import; schemas omit current fields and contain retired duty/source values | Keep 401 cache invalidation tests through current clients; preserve buyer/seller DTO isolation and staff assignments endpoint |
| Access workspace shell | one-line re-export; route imports canonical workspace; one test consumer | Keep staff account management behavior and test coverage |
| Customer security panel | only old UI test imports it; current route uses CustomerIntakeWorkspace/current staff API | Keep current password reset test; do not alter CSS retirement scope |
| `/mcp` whitelist | no current `/mcp` route registration; path only classified by runtime whitelist | Keep API/health routing, Access security, and all `STAFF_MCP_*`/`FEISHU_*` tombstone checks |
| `VER` log | one debug console call in version-conflict branch | Keep exact error/status and reservation expiry semantics |

## Risks / Trade-offs

- [Risk] A historical document may still mention a deleted command or module. → Leave historical migration/archive records untouched and report them; no runtime consumer remains.
- [Risk] Removing the old protected adapter could weaken identity invalidation coverage. → Route both existing tests through canonical buyer/seller/staff clients and run focused tests plus full checks.
- [Risk] A dynamic route could be hidden from simple text search. → Explicitly preserve all current dynamic imports and check candidate names against production and dynamic import references before deletion.

## Migration Plan

No database or remote migration is required. Apply local code/test/docs artifacts, run the required local checks, inspect the final diff, and create one normal commit. Rollback is a normal revert of that commit; no deploy, push, OpenSpec archive, or remote resource access is performed.
