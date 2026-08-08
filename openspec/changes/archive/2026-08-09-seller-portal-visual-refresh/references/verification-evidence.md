# Verification Evidence: Seller Portal Visual Refresh

## 1. Reproducible Baseline

- Worktree: `/Users/yueguangbai/Projects/yueguangbai-v2-worktrees/seller-portal-visual-refresh`
- Branch: `feature/seller-portal-visual-refresh`
- Starting `HEAD` and `origin/main`: `e9c76e14eee681f94d80b03b7d02344f1a40d94e`
- Starting state: clean
- Node: `v24.18.1`; npm: `11.16.0`
- Lockfile SHA-256: `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`
- Approved direction: `/Users/yueguangbai/.codex/generated_images/019fdc86-c749-7d53-9b82-e77dad8bd8a7/exec-a271cae1-aa1e-4d8e-92da-82a0b701f6f1.png`
- `NO_SCHEMA_CHANGE`; no API/Contract/Domain/Migration/dependency/permission/session/cache/file/Buyer/Staff change is authorized.

Initial baseline build history:

1. `npm run build --workspace @ygb/web` failed before dependency restore because `tsc` was unavailable.
2. `npm ci --cache /tmp/ygb-seller-visual-refresh-npm-cache` restored 225 packages from the committed lockfile with 0 vulnerabilities and no manifest/lockfile change.
3. The repeated production build passed.

Exact `gzip -9` baseline:

| Asset boundary | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Initial entry | 245,642 | 74,310 |
| CSS | 59,641 | 10,781 |
| Seller route | 33,697 | 9,060 |

## 2. Frozen Scope

- Seller presentation routes: login, forced password, protected shell/dashboard, products/applications/form/detail, demands/form, orders, reviews, settlements, and account.
- Seller-only visual tests and OpenSpec screenshot/performance evidence.
- No Buyer/Staff render change, no runtime dependency, no second tokens, no external font, no glass/blur.
- No Migration, Contract, Domain, API, DTO, request, state, permission, Personal DENY, identity, session, cache, idempotency, Audit, Outbox, file, production, or external-resource change.

## 3. Screenshot Matrix and Review

The Contract-valid deterministic fixture in `apps/web/e2e/seller-visual-refresh.spec.ts` fixes the clock, Session, Seller organization/member/access, authorized Stores, products/applications, demand batches, formal orders, reviews, and settlement facts. It makes no production or external request.

- Before: `references/visuals/before`, 39 PNGs, 2,235,147 bytes, aggregate manifest SHA-256 `01ed55270ab448362a292c48edc5e72dcc140f0f8d6a543225e4214adce9adcf`.
- After: `references/visuals/after`, 39 PNGs, 3,277,446 bytes, aggregate manifest SHA-256 `5c5f8ef9716f87e3e98af3dc6bacc98fd902c5de91068ab363565bde77a2a8d7`.
- The matrix covers login, forced password, dashboard, products/applications/form/detail, demands/form, orders, reviews, settlements, and account at 390x844 and 1440x900, plus dashboard/products/demand form/orders/settlements at 320x800, 768x1024, and 1600x1000.
- Every image was reviewed in the generated contact sheets; representative originals were also opened at full resolution. The review confirmed clear desktop hierarchy and Store context, fixed mobile clearance, Chinese wrapping, readable money/status facts, visible primary actions, no horizontal overflow, no duplicate/internal frozen copy, no invented business data/action, and no Buyer/Staff/internal-file disclosure.
- The before set shows the previous sparse equal-card layout, always-bottom navigation, weak desktop hierarchy, and repeated Seller headings. The after set shows the approved dense business layout, desktop rail, mobile bottom navigation, persistent organization/Store context, and permission-projected `提交需求` entry.

## 4. Accessibility, Chinese, Time, Money, and Authority

- Touched status, task, Marketplace, role, loading, empty, error, and action copy is Chinese. Returned epoch timestamps use `Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' })` and display `（北京时间）`; date-only Contract values remain date-only.
- CNY fen, arbitrary returned currency exponents, and agreement rates use integer/`BigInt` presentation. `卖家本金` and `卖家服务费` remain independent in order completion and settlement facts.
- Store scope comes only from existing `me`/`stores`/route query authority. Both submission entries disappear when the corresponding returned access flags are false; direct form routes retain their existing permission-denied behavior.
- Existing path-bound Seller identity, Customer Session reread/mismatch cleanup, forced-password flow, logout, mutation version/idempotency/recovery, Personal DENY, cache keys, protected-file reads, and DTO isolation were not changed. Reviews render only safe returned metadata and issue no file-read intent.
- Browser assertions passed for 320/390/768/1440/1600 widths, 200% text, keyboard focus, 44px targets, reduced motion, route-aware navigation, fixed-navigation clearance, semantic record facts, and horizontal overflow.
- Cold `/seller/orders` loading fetched no Buyer or Staff protected route chunk. Existing route-isolation tests also passed.

## 5. Production Build Comparison

Exact comparable `gzip -9` results:

| Asset boundary | Before raw | After raw | Raw delta | Before gzip | After gzip | Gzip delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial entry | 245,642 | 245,731 | +89 (+0.04%) | 74,310 | 74,341 | +31 (+0.04%) |
| CSS | 59,641 | 66,191 | +6,550 (+10.98%) | 10,781 | 11,556 | +775 (+7.19%) |
| Seller route | 33,697 | 40,941 | +7,244 (+21.50%) | 9,060 | 10,625 | +1,565 (+17.27%) |

The final Vite build transformed 2,120 modules. Every emitted JavaScript chunk remains below the frozen 500 kB raw threshold; the largest initial chunk is 245,731 bytes and the isolated Seller route is 40,941 bytes. No dependency, font, framework, token file, or eager Buyer/Staff route import was added.

## 6. Commands and Final Results

- `npm run build --workspace @ygb/web`: baseline and focused final builds passed after dependency restoration.
- `npx openspec validate seller-portal-visual-refresh --strict`: passed.
- `npx openspec validate --all --strict`: 44 passed, 0 failed.
- Focused Web typecheck/build and Seller Vitest/browser checks: passed; the updated Seller foundation browser selection passed 11/11 and the focused Vitest selection passed 4/4 across 2 files.
- `npm run check:wave14a`: static Wave 14A verifier passed; 37 Web test files / 445 tests passed; Web typecheck/build passed.
- `npm run check`: passed. Secret scan covered 1,317 project files; dependency risk reported 0 vulnerabilities; customer identity/security reported 11/11 scenarios; all workspace typechecks, DB/migration guards, money/finance/DTO/file/identity/module verifiers, 194 test files / 1,271 tests, dry-run API build, and all workspace builds passed.
- `npm run test:wave14a:browser`: final run passed 176, skipped 1 existing Buyer visual checkpoint, failed 0. The configured browser project is Chromium.
- `git diff --check`: passed.
- Git scope review: only Seller presentation, Seller-specific assertions/evidence, Seller branches of shared Customer auth presentation, obsolete Seller placeholder exposure/tests, and the Seller-specific Wave 14A static verifier were changed. `tokens.css`, Buyer render code, Staff render code, API, Contract, Domain, Migration, Schema, permission code, production configuration, package manifests, and lockfile are unchanged.
- Manual implementation-consistency review mapped every frozen Change requirement to the final source, tests, screenshots, and evidence without variance.
- Ponytail read-only current-diff review result: `Lean already. Ship.` No code was changed by the review.

## 7. Failure History and Residual Risk

- Baseline pre-install build failure is retained above.
- The first post-implementation typecheck failed because an obsolete browser test still imported the removed placeholder `SellerShell`; the obsolete placeholder tests/export were removed, then typecheck passed.
- The new Seller browser suite first failed on an unscoped duplicate `张三` text locator and then on an unscoped `店铺` label locator. Both were scoped/exact and the targeted checks passed.
- The first targeted existing Seller browser selection passed 7 and failed 4 because old placeholder selectors/headings no longer matched the real shell. Only Seller-specific selectors were updated; the rerun passed 11/11.
- The first full repository gate failed at the Wave 14A static verifier because it hard-coded the retired placeholder navigation/copy. Only its Seller assertions were updated to the frozen real routes/context/metrics/submission entry; `npm run check:wave14a` and the complete `npm run check` then passed.
- One complete browser run passed 174, skipped 1, and failed 2 because `业务进度` matched both the new `h1` and `订单业务进度`. The first targeted rerun exposed one further duplicate `店铺` label. Exact accessible locators fixed the test-only ambiguity; targeted reruns passed and the final complete browser run passed 176, skipped 1, failed 0.
- One repeated complete repository gate ended during a tool-session compaction and its result could not be recovered. It was not counted as passed; a fresh complete run produced the recorded green result.
- Residual risk: deterministic UI evidence uses Contract-valid mocks and the configured Chromium project, not live production data or additional browser engines. Production/external integration was intentionally not run. The measured CSS/Seller-route growth is the cost of the dense responsive presentation but remains well inside the frozen chunk budget.

## 8. External State and Rollback

Rollback is presentation/test/evidence-only. No schema, API, financial, data, permission, identity, session, cache, storage, or external rollback exists. No remote or production action is authorized.

Rollback consists of reverting the listed Seller presentation, Seller-specific tests/static verifier, and this unarchived Change. There is no Migration or forward-only data step. No deployment, production Cloudflare/D1/R2, Drive, Feishu, OpenAI/ChatGPT MCP, DNS/domain, secret, remote Git, PR, or external automation was accessed or changed.
