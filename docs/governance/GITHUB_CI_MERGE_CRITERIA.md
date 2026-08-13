# GitHub CI 与人工合并准则

本页定义仓库的非生产 GitHub CI 入口和当前可确认的人工合并准则；不定义业务规则，也不授予部署、生产 D1/R2、Access、DNS、Secrets 或 Scheduler 的操作权限。

## CI 入口

`.github/workflows/ci.yml` 在 Pull Request 和 `main` push 上运行两个互不重复的 job：

- `static-governance`：OpenSpec 全量 strict、secret/dependency 风险、Node safety、workspace typecheck、本地 schema/migration guards，以及 staging/production 模板的本地 dry-run。它没有非 dry-run Wrangler deploy、远程 D1/R2 操作或 Secrets 读取。
- `tests-and-build`：现有业务 verifier、Vitest 和 workspace build；不运行 Playwright E2E。

两个 job 都固定 Node `24.19.0`、使用 `npm ci` 和 npm cache，并把 `WRANGLER_LOG_PATH`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` 指到 runner 临时目录。CI token 只有 `contents: read`，因此不能写 GitHub 内容、创建 issue 或发布。

`npm run check` 是相同的 canonical 总门禁，由 `check:ci:static` 与 `check:ci:test-build` 串联；CI 为缩短反馈，把两段并行运行，未重复执行任何测试。`npm run release:check` 仍是更宽的本地 release 证据，不是 PR CI 的替代品。

## 当前 GitHub 强制状态（2026-08-13，基线 `7e125a9bb53d8ffa6c1011a0dffd119596b62df2`）

- `CI_AVAILABLE`：workflow 已在仓库中定义；首次真实结论必须以推送分支后的 GitHub Actions run 为准。
- `REQUIRED_CHECKS_ENFORCEMENT_UNAVAILABLE`：对私有仓库查询 `branches/main/protection` 和 `rulesets` 均返回 GitHub 403（要求 GitHub Pro 或公开仓库）。因此本页不能断言 required checks、review 数或管理员绕过规则已强制。
- `AUTO_MERGE`：未启用；本 workflow 不调用 merge API。

## 人工合并准则（直到 GitHub 强制规则可验证）

只有负责人确认以下每项后，才可普通 PR 合并到 `main`：

1. PR 的 `static-governance` 与 `tests-and-build` 对该 HEAD 均为真实 `success`；`none`、未触发、取消或过期 run 均不算通过。
2. PR 基于最新 `main`，范围、OpenSpec 状态和验收矩阵已被审阅；没有未授权的 migration、生产配置或资源变更。
3. 与变更相称的本地验收已如实记录；需要的浏览器、staging、Access、D1/R2 或生产验证由独立授权和对应 runbook 处理，不能被 CI 代替。
4. 使用普通、非强制合并；不启用 auto-merge，不重写共享历史。

当仓库套餐或权限允许后，负责人仍须在 GitHub 中单独配置并回读确认所需检查；仅添加 workflow 不会神奇地把 `main` 锁住，这种幻想没啥用。
