# 月光白 V2 当前系统状态

本文件只提供当前入口和已知发布边界，不定义新的业务规则。发生冲突时严格遵循仓库根目录 `AGENTS.md` 的权威顺序：用户最新决定 → Decision Register → Product Rules → Contracts → Architecture → 当前验收文件。

## 当前基线

- 唯一正式开发基线：最新 `main`
- 历史产品冻结点：`feature/frozen-portals-staff-acquisition-core@8cb39ed870df1fc5c6874dd4e5b86e12e22c39d2`
- 历史最终稳定化点：`chore/final-stabilization-cleanup@4106bc0668eaacf5bff34cb8e5ad174dcc356d77`
- 2026-08-12：上述稳定化历史通过 PR #46 正常合入 `main`，未改写 388 个提交的历史
- 当前目标 Schema：70；迁移链 0001–0070 全部应用（db:verify 实测：70 migrations / 212 tables / 604 indexes / 401 triggers / 12 views / FK 0）；0001–0064 保持既有历史，0065 前向删除未使用的飞书 Schema / 旧清理任务，0066 advance-cash 完整性、0067 advance V1 全款、0068 客户安全 DENY + 密码限流、0069 卖家协议费率运行时退役、0070 买家发起的返款提醒（T7）
- 发布状态：`LOCAL_RELEASE_CANDIDATE / PRODUCTION_REQUIRES_SEPARATE_APPROVAL`
- 本地证明不能替代真实 Cloudflare Access、生产 D1/R2、恢复演练或员工试用结果

历史 frozen / cleanup 分支和对应 SHA 用于追溯，不再作为新开发入口。新任务必须从最新 `main` 开始。

## 当前生产状态（2026-08-20）

- 生产状态：**NO-GO**（G1 已获 Owner 直接批准；`PRODUCTION_GO=NO`，尚未完成生产放行；`LOCAL_RELEASE_CANDIDATE` 不等于生产放行）
- Owner 决策（2026-08-18）：① 开始推进 Production Gates（G1/G7/G8/G9 不依赖部署的事项优先，
  执行清单见 `docs/acceptance/PRODUCTION_GATE_OWNER_ACTIONS.md`）；② `app.yueguangbai.net`
  未文档化部署决定**清理**（程序见 `docs/runbooks/PRODUCTION_CLEANUP_APP_YUEGUANGBAI_NET.md`）；
  2026-08-20 已完成清理；③ GitHub Actions billing 维持 $0（Remote CI 保持 NOT VERIFIED）
- Authoritative Production Gate：`docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md`（仓库唯一最终 GO/NO-GO 判断入口；其他 checklist/runbook 均为 supporting evidence）
- STAGING acceptance（T9 register：62 PASS / 3 CONFLICT / 2 BLOCKED，2026-08-16/17）≠ PRODUCTION acceptance；staging PASS 不构成生产放行证据
- 当前缺失（未执行；不因本地 / staging 通过而视为完成）：
  - 生产 D1/R2/Worker/Access/Secrets/DNS 配置证据与受管清单
  - 生产 Migration ledger 只读核验、迁移窗口与 release-bound 备份 / 恢复证据
  - 中国大陆主要网络 / 微信内置浏览器实测（T9 H05，BLOCKED）
  - 历史数据导入 PREVIEW 与人工批准、reconciliation（dry-run 工具已实测失败关闭/0 写入；
    真实 PREVIEW 待 Owner 提供源文件并批准范围）
  - 正式 production 上线前补齐 G1 五个责任角色的姓名/邮箱；Owner 已于 2026-08-20 直接批准 G1（签名豁免）
  - 远程 CI 证据（GitHub-hosted CI 已于 2026-08-21 恢复可用；此前 #103–#109 期间的合并依据为 owner 豁免 + 本地完整证据，见下）
  - Google Drive 冷归档 / Staff MCP 生产激活（M10 P0-02 / P0-03 未执行）
- `app.yueguangbai.net`：未文档化部署已按 Owner 决定于 2026-08-20 清理完成。
  Worker `yueguangbai-v2-production`、生产 D1/R2 和自定义域名绑定均已删除；DNS 无解析，
  staging 资源未触碰。该域名不再是运行中的部署；本记录不代表正式 production 已上线。

## 当前 CI 状态（2026-08-21）

- GitHub-hosted CI：**AVAILABLE**（billing 阻断已解除；2026-08-21 起 job 正常启动）
- 当前远端 `main` = `f7d321c`（Merge PR #112，2026-08-21）。近三日主线合并：PR #110（gate 收口 docs）、PR #111（feat: import current reservable seller mapping，squash `5a186d4`）、PR #112（staging 产品/卖家变更 + live manifest 归档 + tools/imports typecheck 修复）
- PR #112 的远端 CI 三项全部 `success`（run 32466985887：browser-e2e 3m10s / static-governance 2m2s / tests-and-build 8m17s，2026-08-21）；这是 billing 恢复后 main 上的最新全绿证据
- 历史备注（2026-08-18）：GitHub Actions billing 阻断期间的 6 个 closure PR（#103/#102/#104/#105/#106/#107）按 owner 豁免合并，代码验证树 `ace731918f2e29d7ff1f60e6095d549eba43c4c2` 上的本地证据为 0 TypeScript 错误、1746/1746 单元测试、187/187 browser e2e、check:ci:static / build / release:check 全 PASS（LOCAL_RELEASE_EVIDENCE=COMPLETE）
- 本地 PASS ≠ Remote CI PASS 的原则继续有效；billing 阻断期（2026-08-16 13:42 – 2026-08-21）合入的提交没有对应时点的远端 CI 证据，追溯依据是上述本地验证树
- billing 恢复前最后一次远端全绿 CI：2026-08-16 09:51 UTC（run 31940127005，main `e02682f`）

## 当前 Marketplace / Amazon US 状态（2026-08-17）

- canonical marketplace code（foundation / 注册表层）包含 `AMAZON_JP`、`AMAZON_US`、`COUPANG_KR`、`RAKUTEN_JP`、`TIKTOK_JP`；foundation / canonical code preparation 可以存在
- 业务写路径当前 **JP-only**；`AMAZON_US` 当前 **NOT ENABLED**（未开店、未发布产品）
- 非 JP 的 store / product 写请求失败关闭（409 `MARKETPLACE_NOT_SUPPORTED`，PR #99 修复后在 staging 验证，2026-08-17）；`MARKETPLACE_NOT_SUPPORTED` 守卫必须保留
- Provider Adapter（Rakuten/TikTok 等）的本地准备与 preflight 不代表 Provider 已可用

## 当前身份与权限

- Staff：Cloudflare Access 只证明邮箱；Moonwhite D1 Staff 状态、唯一角色、Marketplace 范围、PRIMARY/SUPPORT 和 Personal DENY 决定最终权限
- Buyer / Seller：共享 Customer Identity Subject 和受控凭证，但门户上下文、授权、DTO 与 Query Cache 严格隔离
- 飞书：已退出当前及计划运行架构；历史 Migration 和 archived Change 只保留升级 / 审计历史，不构成运行能力

## 当前发布组合

以下描述的是仓库内 release template，不是已核验的生产事实：

- 核心 Worker：Hono API、D1、R2 文件链、Staff / Buyer / Seller 门户 API、内部 Scheduler / Acquisition Maintenance
- Staff MCP：不属于核心发布模板或 Worker bundle；源码与独立测试保留，重新启用必须走新的代码和配置评审
- Google Drive 冷归档：模板写侧关闭，但文件读取、恢复和调度共享核心路径，因此保留在核心 bundle；不改变已冻结的归档产品规则
- Rakuten / TikTok Provider Adapter：未接入核心 Worker 运行入口；不得把本地 Adapter / preflight 当成 Provider 已可用
- `/review`：仅 Demo 数据，真实 API 必须由 `REVIEW_MODE_REAL_API_BLOCKED` 失败关闭

## 当前开发流程

```text
latest main
→ 短生命周期 feature/* / fix/* / chore/*
→ 单一任务与对应 OpenSpec / Acceptance
→ 本地真实验证
→ 普通 PR
→ main
```

- 不再从 `feature/frozen-*`、`chore/final-*` 或历史 V3/V4 分支开始新开发
- 不通过创建长期 `final`、`final-final`、`V3`、`V4` 分支表示产品阶段
- 历史审计里的旧 branch / SHA 必须保留原样作为证据，不要为了“看起来统一”篡改历史记录

## 必读权威入口

1. `AGENTS.md`
2. `PROJECT.md`
3. `docs/decisions/V2_DECISION_REGISTER.md`
4. `docs/product/V2_PRODUCT_RULES.md`
5. `docs/contracts/`
6. `docs/architecture/`
7. `docs/acceptance/V2_ACCEPTANCE_MATRIX.md`
8. 当前 active OpenSpec Change

飞书历史 Schema 的精确对象和 0065 前向清理结果见 `docs/audits/FEISHU_SCHEMA_RETIREMENT_AUDIT.md`。

历史本机 worktree、本地分支和恢复边界见 `docs/audits/LOCAL_GIT_HYGIENE_AUDIT.md`；其中数量和路径是当时快照，不代表当前远程 GitHub 状态。

稳定化阶段的代码、包体、OpenSpec、Schema 与验证前后指标见 `docs/audits/FINAL_REPOSITORY_STABILIZATION_AUDIT.md`。

名称包含 `FREEZE` 的文件只代表对应阶段的验收快照和实现说明，不得覆盖上述权威顺序；历史交接内容由 Git、audit 和 archived OpenSpec 保存。

## 默认外部安全边界

除非用户在当前会话明确授权具体动作：

- 不得 Push、创建 / 合并 PR 或修改 GitHub 远端
- 不得执行生产 Migration、远程 SQL、真实 D1/R2/Secrets 读写或部署
- 不得写入飞书、Google Drive、Marketplace Provider 或其他外部资源
- 不得导入真实数据或上传真实业务图片

所有 PASS / FAIL / SKIP 必须来自当前 checkout 的真实执行结果。
