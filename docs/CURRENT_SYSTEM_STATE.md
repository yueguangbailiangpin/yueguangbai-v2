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

## 当前生产状态（2026-08-17）

- 生产状态：**NO-GO**（`PRODUCTION_GO=NO`，owner 尚未批准；`LOCAL_RELEASE_CANDIDATE` 不等于生产放行）
- Authoritative Production Gate：`docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md`（仓库唯一最终 GO/NO-GO 判断入口；其他 checklist/runbook 均为 supporting evidence）
- STAGING acceptance（T9 register：62 PASS / 3 CONFLICT / 2 BLOCKED，2026-08-16/17）≠ PRODUCTION acceptance；staging PASS 不构成生产放行证据
- 当前缺失（未执行；不因本地 / staging 通过而视为完成）：
  - 生产 D1/R2/Worker/Access/Secrets/DNS 配置证据与受管清单
  - 生产 Migration ledger 只读核验、迁移窗口与 release-bound 备份 / 恢复证据
  - 中国大陆主要网络 / 微信内置浏览器实测（T9 H05，BLOCKED）
  - 历史数据导入 PREVIEW 与人工批准、reconciliation
  - 生产 owner 逐项批准与 `PRODUCTION_GO=APPROVED` 书面签字
  - 远程 CI 证据（当前 GitHub-hosted CI 不可用，见下）
  - Google Drive 冷归档 / Staff MCP 生产激活（M10 P0-02 / P0-03 未执行）
- 已检测到 `app.yueguangbai.net` 存在运行中的部署：**Detected running deployment requiring ownership/inventory confirmation.** 尚未确认其 Worker/Pages binding、D1/R2 binding、真实数据状态与部署 owner；在确认前不得称其为正式 production、production incident 或废弃部署，也不得请求、修改或删除该部署。

## 当前 CI 状态（2026-08-18）

- GitHub-hosted CI：**BLOCKED_BY_BILLING_POLICY**（job annotation：The job was not started because recent account payments have failed or your spending limit needs to be increased；GitHub Actions budget 有意保持 $0）
- 因此 Remote CI：**NOT VERIFIED**（job 未启动；不是代码失败，也不得写为 CI PASS）
- 2026-08-18：6 个 closure PR 已按 owner 豁免合并进入 `main`（PR #103 TS 基线修复、#102 verifier archive 路径、#104 文档收口、#105/#106/#107 三个性能修复），当前 main = `ace7319`
- 合并依据：owner 豁免（本地完整证据）；合并后 main 树与 Phase 8A 本地验证过的集成树完全一致（git diff 为空）；本地验证：0 TypeScript 错误、1746/1746 单元测试、187/187 browser e2e、check:ci:static PASS、build PASS、release:check PASS（LOCAL_RELEASE_EVIDENCE=COMPLETE）
- 本地 PASS ≠ Remote CI PASS；远程 CI 恢复前 Remote CI 保持 NOT VERIFIED
- 最后一次远端全绿 CI：2026-08-16 09:51 UTC（run 31940127005，main `e02682f`）

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
