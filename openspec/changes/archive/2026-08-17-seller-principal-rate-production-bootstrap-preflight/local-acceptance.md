# Local acceptance: Seller Principal Rate Production Bootstrap Preflight

Date: 2026-08-10 (Asia/Shanghai)

Status: `LOCAL_READY / PRODUCTION_BLOCKED`

## Baseline and isolation

- Repository: `yueguangbailiangpin/yueguangbai-v2`.
- Frozen and revalidated remote baseline: `origin/main = 513b9402faeb5da3a452315ad08f32cfec778e5d`.
- Branch: `feature/seller-principal-rate-bootstrap`.
- Worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/module3-seller-principal-rate-bootstrap`.
- The main worktree was not edited. Its four pre-existing untracked paths remain `packages/contracts/contracts`, `packages/domain/domain`, `packages/testkit/testkit`, and `packages/ui/ui`.

## Scope and decisions

- Migration decision: `NONE`. Migrations 0040–0043 are unchanged; no empty 0044 was created.
- Initialization reuses the trusted Staff submit and Owner-confirm flow; there is no direct SQL bootstrap or remote mutation mode.
- GLOBAL Owner can read and submit the default policy without Seller Organization master data. Seller Ops and organization overrides retain ACTIVE organization and Data Scope checks.
- The local preflight opens only an absolute local SQLite file using read-only plus `PRAGMA query_only=ON`, checks schema 43, integrity, foreign keys, policy state, exact-date base rates and fact conservation, and emits aggregate facts only.
- All financial rate comparisons use fixed integers/BigInt. Explicit zero remains distinct from unset.
- No buyer refund, service fee, refund, historical order, product, seller-number, store or R2-history path changed.

## Verification record

- `npm run preflight:seller-principal-rate`: PASS; `LOCAL_TEMPLATE_SAFE_PRODUCTION_BLOCKED`; external calls, database writes, policy mutations, deployments and resource mutations all 0.
- `npm run check:seller-principal-rate-bootstrap`: PASS; schema 43, Migration sequence/repeat guards, 60/60 initial focused tests and Contracts/Domain/API/Web typechecks passed.
- `npm run test:seller-principal-rate-bootstrap` after final conflict-state coverage: PASS; 8 files, 61/61 tests.
- `npm run verify:openspec:strict`: PASS; 58/58 items.
- `npm run verify:module1:buyer`: PASS after registering the exact Staff pricing workspace in the existing static allowlist; `unapproved_seller_staff_business_expansion=0`.
- Final `npm run check`: PASS; 227 files, 1491/1491 tests, all-workspace typecheck, secret/dependency/security checks, DB/Migration/marketplace/financial verifiers, Web static build, local Worker dry-run build and all workspace builds.

Truthful intermediate results:

- The first complete gate stopped because the cross-module static allowlist did not yet contain the changed Staff pricing workspace. The exact path was added; no pattern or verifier condition was weakened.
- A later complete-gate run had one Web lazy-route test exceed its one-second load wait. The isolated test immediately passed, and the subsequent complete gate passed 1491/1491. No product or timeout code was changed for that transient result.
- A new anonymous fixture initially reused an Idempotency-Key and correctly received `IDEMPOTENCY_CONFLICT`; the fixture key was made unique and the business idempotency rule was not changed.

## Production boundary

- Production Migration, D1/R2/Drive/Feishu/MCP reads and writes, deployment, Secrets, real-account operation, Git push/PR/merge: not executed.
- External writes: `0`.
- Production readiness remains blocked until the separately authorized steps in `docs/runbooks/SELLER_PRINCIPAL_RATE_PRODUCTION_ACTIVATION.md` are completed and revalidated against current production facts.

Handoff state: `待总控复核`.
