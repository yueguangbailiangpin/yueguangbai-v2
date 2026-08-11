# 月光白 V2 当前系统状态

本文件只提供当前入口，不定义新的业务规则。发生冲突时严格遵循仓库根目录 `AGENTS.md` 的权威顺序：用户最新决定 → Decision Register → Product Rules → Contracts → Architecture → 当前验收文件。

## 当前基线

- 最终产品分支：`feature/frozen-portals-staff-acquisition-core`
- 本次收敛起点：`8cb39ed870df1fc5c6874dd4e5b86e12e22c39d2`
- 当前目标 Schema：65；0001–0064 字节不变，0065 前向删除未使用的飞书 Schema/旧清理任务
- 发布状态：`LOCAL_RELEASE_CANDIDATE / PRODUCTION_REQUIRES_SEPARATE_APPROVAL`
- 本地证明不能替代真实 Cloudflare Access、D1/R2、恢复演练或员工试用结果

## 当前身份与权限

- Staff：Cloudflare Access 只证明邮箱；Moonwhite D1 Staff 状态、唯一角色、Marketplace 范围、PRIMARY/SUPPORT 和 Personal DENY 决定最终权限
- Buyer/Seller：共享 Customer Identity Subject 和受控凭证，但门户上下文、授权、DTO 与 Query Cache 严格隔离
- 飞书：已退出当前及计划运行架构；历史 Migration 和 archived Change 只保留升级/审计历史，不构成运行能力

## 当前发布组合

以下描述的是仓库内 release template，不是已核验的生产事实：

- 核心 Worker：Hono API、D1、R2 文件链、Staff/Buyer/Seller 门户 API、内部 Scheduler/Acquisition Maintenance
- Staff MCP：不属于核心发布模板或 Worker bundle；源码与独立测试保留，重新启用必须走新的代码和配置评审
- Google Drive 冷归档：模板写侧关闭，但文件读取、恢复和调度共享核心路径，因此保留在核心 bundle；不改变已冻结的归档产品规则
- Rakuten/TikTok Provider Adapter：未接入核心 Worker 运行入口；不得把本地 Adapter/preflight 当成 Provider 已可用
- `/review`：仅 Demo 数据，真实 API 必须由 `REVIEW_MODE_REAL_API_BLOCKED` 失败关闭

## 必读权威入口

1. `AGENTS.md`
2. `docs/decisions/V2_DECISION_REGISTER.md`
3. `docs/product/V2_PRODUCT_RULES.md`
4. `docs/contracts/`
5. `docs/architecture/`
6. `docs/acceptance/V2_ACCEPTANCE_MATRIX.md`
7. 当前 active OpenSpec Change

飞书历史 Schema 的精确对象和 0065 前向清理结果见 `docs/audits/FEISHU_SCHEMA_RETIREMENT_AUDIT.md`。

本机 worktree、本地分支和历史交付目录的清理边界与可恢复位置见 `docs/audits/LOCAL_GIT_HYGIENE_AUDIT.md`。

本次收敛的代码、包体、OpenSpec、Schema 与验证前后指标见 `docs/audits/FINAL_REPOSITORY_STABILIZATION_AUDIT.md`。

名称包含 `FREEZE` 的文件是对应阶段的验收快照和实现说明，不得覆盖上述权威顺序；历史交接内容由 Git 和 archived OpenSpec 保存。

## 当前外部边界

- 未授权 Push、PR、Merge 或部署
- 未授权生产 Migration、远程 SQL、真实 D1/R2/Secrets 读写
- 未授权任何飞书、Google Drive、Marketplace Provider 或其他外部资源写入
- 所有 PASS/FAIL/SKIP 必须来自当前 checkout 的真实执行结果
