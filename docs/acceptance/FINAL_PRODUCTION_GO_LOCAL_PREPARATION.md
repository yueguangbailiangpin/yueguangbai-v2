# 最终 Production GO 本地准备证据审计

审计日期：2026-08-09（Asia/Shanghai）

当前补充 Change：`production-cloudflare-web-r2-release-configuration`
结论：`LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO-GO`

## 1. 基线与证据语义

- `origin`：`https://github.com/yueguangbailiangpin/yueguangbai-v2.git`
- 2026-08-09 再次 fetch 后 `origin/main`：`b74a029876301a4f8bbb6ebd305ead13a6f2cd59`。
- 本地分支：`feature/production-cloudflare-web-r2-release-configuration`，从上述远程 SHA 建立独立 worktree。
- 当前工作不提交、不推送、不建 PR、不归档，也不把 `b74a029` 当作最终可部署 SHA；总控后续审查、提交与 Integration 完成后必须重新冻结唯一 release SHA。
- `LOCAL_PASS` 只表示匿名、本地、隔离或 mock 证据；不表示线上 Migration、部署、真实 Provider、生产数据、真实网络或老板批准。

## 2. M10 真实历史状态

| 项目 | Git/仓库证据 | 当前结论 |
| --- | --- | --- |
| Change | `openspec/changes/archive/2026-08-07-production-readiness-backup-validation` 存在，canonical `openspec/specs/production-readiness/spec.md` 已同步 | 已归档、已同步 |
| Git 主线 | M10 修正提交 `8c4fdaa382fd1e2c56d76aa23bb6b960c4f6f72c` 被 `main` 与 `origin/main` 后代包含 | 已合入 |
| GitHub | PR #13 `M10: production readiness backup validation` 于 2026-08-07 合并，head 为 `8c4fdaa...` | 已合并 |
| 本地能力 | 加密 D1 备份、release-bound attestation、隔离恢复、离线 R2/Drive 对账、容量 dry-run、告警/kill-switch 合同、回滚边界与本地测试 | 仓库有实现和历史本地证据；本 Change 重新运行后再冻结当前结果 |
| 外部能力 | M10 acceptance 明确列出 8 个 P0：飞书、Drive、MCP、Cloudflare、真实网络、隐私、历史数据与最终 GO | 从未被 M10 标为完成 |
| 历史治理 | `pre-wave13-baseline-conformance-audit` 仍 active，任务为 28/40 | 未归档，不能声称全部 Change 完成 |

M10 的历史 Migration 结论“当时不创建 0035”是当时事实，不是当前 schema。后续 Change 已合法推进到 `0037`。本次发现并修复当前 M10 formal verifier 仍硬编码 `0001`–`0036` 的静态漂移；没有修改 M10 的历史证据语义。统一门禁还发现并修复 Drive archive verifier 把 `0036` 当成链尾的同类静态漂移；归档 Migration 本身仍固定为 `0032`。

## 3. React Router 两个 high 债务

历史 `npm audit` 的两个 high 节点来自 `react-router-dom` 与其 `react-router` 传递节点，底层对应同一个 `GHSA-qwww-vcr4-c8h2`。

当前实测证据：

- `apps/web/package.json` 精确锁定 `react-router: 8.3.0`，无 `react-router-dom`。
- `package-lock.json` 实际解析 `apps/web/node_modules/react-router@8.3.0`，registry tarball integrity 为 `sha512-qyPM...PVOL7xQ==`。
- 隔离 `npm ci` 后，`npm ls react-router react-router-dom --all` 只显示 `react-router@8.3.0`。
- 全量与 `--omit=dev` 的当前 `npm audit --json` 均为 0 info/low/moderate/high/critical。
- 当前 GitHub Advisory 把受影响范围分为 `>=7.12.0 <7.18.2` 与 `>=8.0.0 <8.3.0`，首个修复版分别为 `7.18.2` 和 `8.3.0`；已安装 8.3.0 不在范围内。
- 源码没有 `react-router-dom` import。

结论：这两个历史 high 债务已由真实依赖解析和当前扫描关闭，不是 Production GO 阻断。任何未来锁文件变化必须重新 audit，不能沿用本结论。

## 4. Migration、权限、金额、时间和中文

### Migration 与回滚

- 仓库有且仅有连续 `0001`–`0037`，末号为 `0037_product_reservation_order_scheduling.sql`；本 Change 不创建 Migration。
- 迁移守卫覆盖 fresh、顺序升级、错序、重复和部分 DDL 失败关闭；当前最终门禁结果完成后写入第 8 节。
- 0029 多站点/多币种、0030 Customer 多 Persona、0031 调度、0032 Drive、0035 四角色、0036 获客、0037 排期均有恢复或前向修复边界。
- 仓库 Migration 连续不证明生产 D1 ledger。上线前必须由老板授权只读核验；不得执行 down migration 或删除不可变业务/财务/Audit 事实。

### 权限和 Personal DENY

- canonical 规则为每名 ACTIVE Staff 恰有一个 ACTIVE 四角色；零角色、多角色、旧角色或未知角色失败关闭。
- 有效权限为角色默认、个人授权、负责人包合并后扣除 Personal DENY 和系统硬禁止，再应用 Team/Department/Customer/Seller/Store/资源 Scope 与字段投影。
- 内部财务查看必须是 ACTIVE system owner + `FINANCIAL_VIEW`；导出还需 `FINANCIAL_EXPORT`；Personal DENY 最终优先。Seller OWNER 不因此获得内部财务。
- 生产真实员工角色数据从未在本任务读取。0035 切换前真实只读预检和逐员工批准仍是阻断项。

### 金额、时区、中文

- 权威金额为整数最小单位，财务计算用 BigInt；禁止 REAL/FLOAT/parseFloat/toFixed 进入财务事实。
- 事实时间为 UTC 毫秒；业务日期和员工/客户显示为 `Asia/Shanghai`，客户文案使用“北京时间”。
- Buyer/Seller/Staff 正式前端为中文；本地 Chromium 可以验证 UI 合同，但不能替代移动/联通/电信、微信内置浏览器和真实飞书移动端。

## 5. GitHub、Cloudflare 与部署自动化现状

GitHub 只读快照：

- 当前无 open PR；本地最终准备分支在 GitHub 不存在。
- `origin/main` 当前没有 commit status，当前 SHA 没有 workflow run。
- 仓库当前 `.github/workflows` 只有 `.gitkeep`，没有 CI 或部署 workflow。
- Actions 仓库权限为 enabled、`allowed_actions=all`、`sha_pinning_required=false`；历史仅见一次 2026-08-02 的失败 run，不是当前主线门禁。
- 私有仓库当前计划的 branch-protection API 返回 403，无法证明或启用 main 保护。

这意味着没有自动生产部署，降低了误触部署概率；同时也没有远端 CI、SHA pinning、受保护 main 或自动发布/回滚证据。老板必须在上线前批准并留存独立的人工双人发布控制，或先完成独立的 CI/release-control Change。

Cloudflare/部署静态审计更新：

- 仓库已有独立 staging/production Wrangler 模板；模板故意使用 `REQUIRED_*`，真实 account、Worker、域名、D1/R2、Cron 和 Secret 仍不存在于 Git，也没有可部署的 owner-rendered config。
- 本地 preflight 会拒绝 placeholder、缺失/默认资源、错误环境、origin/domain 不一致、Secret in vars 和任何已打开的外部/破坏性开关；命令没有 deploy 模式，不调用 Cloudflare。
- Web 已冻结为同一 Worker Static Assets：SPA deep-link fallback、Worker-first security headers、同源 `/api/*`、跨源拒绝和 exact Custom Domain/HTTPS 合同已有本地实现与匿名测试路径。
- Cloudflare `FILE_OBJECT_STORAGE_R2` 已通过 production adapter/factory 接入现有 `FILE_OBJECT_STORAGE` 应用端口；没有公有 bucket、list、裸 key、签名 URL 或永久 URL。
- 总控复核提出的三项缺口已在本 Change 内收口：ambiguous/post-put R2 failure 通过通用端口进入既有补偿/`DELETION_PENDING`；`--config` 同时执行绝对词法路径与 `realpath` 的 Git 外强制；Web 已移除全部 JSX inline style 并由完整 Web gate 保持 `style-src 'self'` 兼容。
- Staff Auth/Feishu、Drive、Feishu workbench、Staff MCP、Scheduler 和外部告警在模板中保持 disabled；飞书工作台仍只有 mock adapter，Staff MCP 仍 `productionActivationSupported=false` 且没有公开 `/mcp` route。

这只关闭“production config/adapter 完全缺失”的本地实现缺口。真实资源存在性、Git 外渲染配置、Secret 注入、Cloudflare 校验/部署、Custom Domain/HTTPS、真实 R2、独立告警和网络仍没有证据，不能标为 staging/production 验收。

## 6. 发现分类

### 已由仓库证据完成

- origin/main 基线与 M10 archive/main/PR 历史已核实。
- React Router 历史 high 已真实解析到 8.3.0，当前 audit 为 0。
- 0001–0037 在仓库中连续；本 Change 无 Migration。
- 本地备份/恢复、离线文件对账、Drive/Feishu/MCP mock、权限/财务/时区/中文测试能力存在。
- Drive、Feishu、MCP 与 Scheduler 默认 hard-disabled；本任务未激活任何外部能力。
- staging/production 配置模板、R2 adapter、同源 Web/SPA/security headers 与纯本地 preflight 已具备；模板仍不可部署，真实值未进入 Git。

### 可由总控继续本地修复

- 本 Change 已修复 M10 formal verifier 和 Drive archive verifier 的 schema 36 静态漂移，以及 current runbook 的旧 schema/归档措辞。
- `backup-d1.mjs` / `restore-d1.mjs` 仍有历史默认 schema 34，但当前 runbook 强制显式传入重新核验的 schema 37；默认值会安全失败而不会假通过。是否另行移除默认值可由总控建立小型安全工具 Change。
- canonical `staff-internal-operations-workbench` 仍保留历史“两项 React Router high 不增加”的兼容性措辞；它是历史基线规则，不应当作当前漏洞库存。总控可在独立治理 Change 中决定是否增加“当前已关闭”的新 Scenario，不能改写历史。
- `production-cloudflare-web-r2-release-configuration` 当前仍是未提交、未归档 Change；总控必须先审查 diff 和最终门禁，不能把本地实现存在写成外部 Gate 2 已完成。

### 必须老板本人授权

- Cloudflare 账号、域名/DNS、Worker、D1、R2、bindings、vars、Secrets 与生产/staging 分离。
- 线上 D1 ledger 只读核验、Migration 窗口、部署、Scheduler/Job、告警接收方及回滚切换。
- Google Drive owner 账号、MFA/恢复、OAuth、专用目录、真实上传/回读/代理/回灌与首次 R2 删除。
- 飞书应用、管理员 scope、OAuth、回调、机器人/通知、深链接、移动端和额度 PoC。
- OpenAI/ChatGPT workspace、OAuth、MCP 注册、隐私和生产安全审核。
- 隐私、跨境、保存/删除/注销、平台政策与历史数据导入批准。
- 最终绑定唯一 release SHA 的 Production GO 签字。

### Production GO 阻断

1. 本地 Cloudflare/Web/R2 adapter、模板和 preflight 已具备，但缺少老板填充并保管的真实配置、实际 D1/R2/Worker/域名/Secret、Cloudflare 部署与真实 R2/HTTPS/网络验收。
2. 缺少真实 D1 备份、隔离恢复、生产 ledger 和 Migration 证据。
3. 缺少真实 R2/Drive Manifest 对账、Drive read-back 和恢复证据。
4. 缺少飞书真实应用/回调/工作台 adapter/独立告警证据。
5. Staff MCP 仍是 local-only，无生产 HTTPS/OAuth/持久化安全边界或 ChatGPT 注册。
6. 缺少移动/联通/电信、微信内置浏览器、飞书移动端的真实网络矩阵。
7. 缺少生产 Staff/Buyer/Seller 权限隔离、Personal DENY、文件 Audience、财务和安全渗透验收。
8. 缺少隐私、AI 处理、跨境、保留/删除/注销与平台政策批准。
9. `pre-wave13-baseline-conformance-audit` 仍 active 28/40；GitHub CI/branch/release control 尚无批准处置。
10. 最终老板 Production GO 未签发。

## 7. Change 状态与仍需独立建立的后续 Change

- `production-cloudflare-web-r2-release-configuration`：本地实现已在当前未提交 Change 中具备；真实资源、配置、Secret、部署和网络验收不在本地交付内，Gate 2 仍未通过。
- `feishu-workbench-production-adapter-activation`：真实 API adapter、scope、callback、机器人/通知、深链接、限流和 Provider 告警。
- `staff-mcp-production-transport-oauth`：HTTPS MCP resource、OAuth 2.1 metadata/PKCE、durable replay/rate/kill switch、ChatGPT 注册和安全审核。
- `production-alerting-ci-release-controls`：独立告警接收器、CI pinning、人工/自动发布准入、不可变 release evidence 与受限回滚。

其余 Change 不得混入当前 Cloudflare/Web/R2 Change。

## 8. 本 Change 最终本地门禁

以下命令均在独立 worktree、本地匿名/隔离环境运行；没有 `--remote`、生产凭据或外部 Provider 调用：

| 门禁 | 当前结果 |
| --- | --- |
| `npx openspec validate production-cloudflare-web-r2-release-configuration --strict --no-interactive`、`npx openspec validate --all --strict --no-interactive` | Change 通过；全库 48 passed，0 failed |
| `npm ci`（独立临时 npm cache） | 225 packages installed；232 packages audited；0 vulnerabilities |
| `npm run verify:dependency-risk` | 各级漏洞均为 0 |
| `npm run security:scan` | 1410 个项目文件通过 |
| `npm run db:verify`、`npm run verify:migration-guards`、本地 Wrangler Migration | 37 个 Migration；schema 37；165 tables；311 triggers；integrity ok；FK errors 0；fresh/顺序/错序/重复/部分 DDL 守卫通过；仅本地假 D1 |
| M10、Drive、Feishu、Staff MCP、四角色、获客、排期、Dashboard 的 formal/static/dry-run | 全部通过；外部调用/生产写入为 0；Feishu 为 mock-only；MCP 为 local-only；Production GO 明确 blocked |
| `npx vitest run scripts/preflight-cloudflare-release.test.mjs`、`npm run dry-run:cloudflare-release`、`npm run verify:cloudflare-release`、`npm run verify:web-static-build` | Preflight 9/9；相对/仓库内/双向 symlink 路径拒绝且值不泄露；模板均为 `BLOCKED_NEEDS_OPERATOR_INPUT`；`jsx_inline_styles=0`；外部调用/部署/资源修改为 0 |
| `npm run check` | 通过；197 个 Vitest 文件、1291 项测试全部通过；类型检查、全仓构建、Web 静态 verifier 与 Worker 本地 dry-run 通过 |
| `npm run test:wave14a:browser` | Chromium 180 passed、1 skipped、0 failed；含中文、响应式、键盘、权限失败关闭和北京时间 UI 合同 |
| `npm run verify:final-production-go:local` | 通过；`LOCAL_IMPLEMENTATION_PRESENT_EXTERNAL_UNVERIFIED`；Production GO 为 `NO_GO` |

收口过程中严格 OpenSpec 首次发现 delta 标题缺少 `ADDED`，完整门禁首次发现 Staff Auth 业务源超出既有静态 allowlist。前者按 OpenSpec 格式修正；后者将 fail-closed 权限剥离移至 Cloudflare 组合边界，保留业务模块不变。随后 target/all OpenSpec、对应模块测试与完整 `npm run check` 均从头通过。最终未解决失败数为 0。

总控复核后的第二轮收口补充验证：实际落盘后返回不完整 R2 回执会触发删除并记录 `DELETED`；删除注入失败时记录 `DELETION_PENDING`、响应不含 key，cleanup 可重试至 `DELETED`。PUT 后 Provider rejection 同样标记为对象可能存在。Preflight 测试现已正式加入根 Vitest include，不再是未执行的游离测试；绝对外部文件可通过，仓库内路径、仓库内 symlink、仓库外 symlink 指回仓库和相对路径均失败关闭。Web 全源零 JSX inline style，CSP 仍无 `unsafe-inline`。复核后完整门禁与 Chromium 均重新执行，最终未解决失败数仍为 0。

本地门禁证明的是当前仓库候选的静态、单元、隔离 D1 和 Chromium 合同性，不证明生产 Cloudflare、真实网络、Drive、飞书、ChatGPT、真实身份或恢复演练。

## 9. 当前决定

`NO-GO`。当前本地实现不授权也不证明任何 Cloudflare staging/production 状态。允许的下一步只有：完成当前 Change 的统一本地门禁并由总控审查未提交 diff；之后由老板在独立授权下准备 Git 外配置与真实资源验收。不得使用本报告或模板执行部署。
