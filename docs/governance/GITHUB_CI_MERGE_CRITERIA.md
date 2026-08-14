# GitHub CI 与人工合并准则

本页定义仓库的非生产 GitHub CI 入口和当前可确认的人工合并准则；不定义业务规则，也不授予部署、生产 D1/R2、Access、DNS、Secrets 或 Scheduler 的操作权限。

## CI 入口

`.github/workflows/ci.yml` 在 Pull Request 和 `main` push 上运行三个互不重复的 job：

- `static-governance`：OpenSpec 全量 strict、secret 扫描、`npm audit --include=dev --audit-level=high`、lockfile 生命周期批准、Node safety、workspace typecheck、本地 schema/migration guards，以及 staging/production 模板的本地 dry-run。它没有非 dry-run Wrangler deploy、远程 D1/R2 操作或 Secrets 读取。
- `tests-and-build`：先运行纯领域 verifier/preflight，再只运行一次全量 Vitest、一次 workspace build，并在 build 后验证 web 静态产物；不运行 Playwright E2E。
- `browser-e2e`：在独立 runner 上安装 Chromium 及系统依赖，构建 Web 产物并运行 13 个仅访问 loopback `127.0.0.1` 的 Playwright spec；失败时上传受限保留期的报告和测试结果。该 job 不读取 Secrets、不访问 staging/production，也不与 `tests-and-build` 共享 runner 资源。

三个 job 都固定 Node `24.19.0`、使用 `npm ci` 和 npm cache，并把 `WRANGLER_LOG_PATH`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 指到 runner 临时目录。更关键的是，三个 job 都在 `npm ci` 之前直接以 Node 运行 lifecycle provenance verifier 及其 Node builtin self-test；未知 lifecycle package 不能先执行再审。CI token 只有 `contents: read`，因此不能写 GitHub 内容、创建 issue 或发布。

`npm run check` 是相同的 canonical 总门禁，由 `check:ci:static` 与 `check:ci:test-build` 串联；CI 为缩短反馈，把两段并行运行。`tests-and-build` 为避免重复，不调用带 Vitest/build 聚合的 `check:*` 脚本，而是只调用下面保留的 canonical 纯 verifier。`npm run release:check` 仍是更宽的本地 release 证据，不是 PR CI 的替代品。

| 原聚合入口（CI 不调用） | CI 保留的纯 verifier / preflight | 由统一阶段覆盖的旧嵌入步骤 |
| --- | --- | --- |
| `check:marketplace-adapters` | `verify:marketplace-adapters`、`preflight:marketplace-adapters` | `test:marketplace-adapters` 由一次 `npm test` 覆盖；其 API/contracts/domain typecheck 由 static job 的一次全 workspace `typecheck` 覆盖。 |
| `check:wave13` | `check:wave13:migration`、`staff-auth`、`dto`、`file`、`price-mismatch`、`buyer-refund` | `api-contract-baseline-alignment.test.ts` 由一次 `npm test` 覆盖。 |
| `check:wave14a` | `verify:web-source-boundaries` | `test:wave14a` 由一次 `npm test` 覆盖；web typecheck 由 static job 覆盖；web build 由最终一次 `npm run build` 覆盖；`verify:web-static-build` 在该统一 build 后执行。 |
| `check:module1:buyer` | `verify:module1:buyer` | `test:module1:buyer` 由一次 `npm test` 覆盖；web typecheck/build 分别由 static job 和统一 build 覆盖。 |

`verify:wave11`、`verify:wave12`、`verify:customer-security` 与 `verify:marketplace-money` 本身只串联 Node verifier，因此可以直接作为领域证据保留。由此 `tests-and-build` 的全量 Vitest 和 workspace build 均各只执行一次；别再拿旧聚合的“没有重复”说法糊弄人了。

## 依赖与 lifecycle gate

`audit:dependencies` 明确审计 production 和 dev dependencies。`verify:dependency-lifecycle` 只使用 Node builtin，离线读取 committed `package-lock.json` 的 `packages[*].hasInstallScript`，并逐项精确比较 [`scripts/dependency-lifecycle-allowlist.mjs`](../../scripts/dependency-lifecycle-allowlist.mjs) 的包名、版本、lock path、optional、resolved tarball URL 和 integrity；新包、缺失字段、路径/版本/provenance 漂移、失效批准都会失败。其 self-test 只在内存 fixture 上篡改字段，不会改真实 lockfile。lockfile 不记录精确脚本文本，所以 CI 不伪造这种信息；本地审计时才可读取已安装 package metadata 作为补充证据。

当前批准的最小集合为：`@fission-ai/openspec@1.8.0`（OpenSpec CLI）、`esbuild@0.28.1`（Vite/Vitest binary）、`fsevents@2.3.3` 与 `fsevents@2.3.2`（可选 macOS watcher）、`msw@2.15.0`（测试 mock runtime）、`workerd@1.20260730.1`（Wrangler local dry-run runtime）。当前六条都有 resolved 与 integrity；若将来的 optional 平台条目确实缺少任一字段，allowlist 必须显式写 `null` 并给出 `provenanceNote`，不是 wildcard。

这只是 committed lockfile 的 provenance 审批，不是供应链绝对证明，更不能替代 PR review；尤其是任何修改 allowlist 的 PR，都必须由审阅者单独判断新增信任是否合理。CI 的 `npm ci` 没有设置 `--ignore-scripts`，而 custom verifier 只负责在安装前对 committed lockfile 做批准和漂移检测，不假装接管 npm 的安装策略。

## 当前 GitHub 强制状态（2026-08-13，基线 `7e125a9bb53d8ffa6c1011a0dffd119596b62df2`）

- `CI_AVAILABLE`：workflow 已在仓库中定义；首次真实结论必须以推送分支后的 GitHub Actions run 为准。
- `REQUIRED_CHECKS_ENFORCEMENT_UNAVAILABLE`：对私有仓库查询 `branches/main/protection` 和 `rulesets` 均返回 GitHub 403（要求 GitHub Pro 或公开仓库）。因此本页不能断言 required checks、review 数或管理员绕过规则已强制。
- `AUTO_MERGE`：未启用；本 workflow 不调用 merge API。

## 人工合并准则（直到 GitHub 强制规则可验证）

只有负责人确认以下每项后，才可普通 PR 合并到 `main`：

1. PR 的 `static-governance`、`tests-and-build` 与 `browser-e2e` 对该 HEAD 均为真实 `success`；`none`、未触发、取消或过期 run 均不算通过。
2. PR 基于最新 `main`，范围、OpenSpec 状态和验收矩阵已被审阅；没有未授权的 migration、生产配置或资源变更。
3. 与变更相称的本地验收已如实记录；需要的浏览器、staging、Access、D1/R2 或生产验证由独立授权和对应 runbook 处理，不能被 CI 代替。
4. 使用普通、非强制合并；不启用 auto-merge，不重写共享历史。

当仓库套餐或权限允许后，负责人仍须在 GitHub 中单独配置并回读确认所需检查；仅添加 workflow 不会神奇地把 `main` 锁住，这种幻想没啥用。
