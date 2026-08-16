# Design: Final Repository Stabilization

## Canonical Knowledge Boundary

长期业务事实只存在于 `docs/decisions/V2_DECISION_REGISTER.md`、`docs/product/V2_PRODUCT_RULES.md`、Contracts 和 Architecture。`docs/CURRENT_SYSTEM_STATE.md` 只索引当前 Schema、身份组合、启用/关闭模块、发布阻塞和权威链接，不重复业务规则。历史 Handoff 留在 Git 历史或 archived Change 中，不再作为当前权威正文。

## Feishu Retirement

当前 Worker、Web、Contracts、release templates、package scripts 和 active OpenSpec specs 不得包含飞书登录、绑定、同步、回调、任务镜像或告警激活路径。历史 Migration 与 archived evidence 允许包含 Feishu 名称，因为它们是不可改写的升级和审计历史。

Schema 审计分为三类：

1. 只服务 POC 且没有权威业务事实的对象可由 0065 删除。
2. 历史身份或安全审计事实必须先明确保留期与替代归档，再决定删除、脱敏保留或迁移到中性历史表。
3. 共享表中的历史 CHECK 枚举只有在 D1 表重建可保持全部约束、索引、Trigger 和数据时才移除；否则保留为不可执行的历史值。

用户确认系统从未投入使用且无业务/审计数据，因此 0065 删除第 1、2 类旧对象，并通过表重建移除第 3 类共享飞书枚举。`docs/audits/FEISHU_SCHEMA_RETIREMENT_AUDIT.md` 保存精确对象和验证结果。

## Core Worker Composition

核心 Worker 入口只静态导入当前启用能力。未获准进入核心发布的独立模块不得依赖运行时环境变量才从请求路径退出，因为这仍把完整实现打入发布图。Staff MCP 保留源码和独立测试，但重新启用必须通过明确入口改动、配置审查和完整门禁。Drive 冷归档继续保留：它与文件读取、恢复和调度共享核心路径，不能因为写侧开关默认关闭就冒充“零依赖插件”。

## Offline Tool Boundary

一次性导入与历史迁移工具放在 `tools/` 下，并通过根 package scripts 调用。工具不得被 Worker 或 Web workspace 依赖。源 manifest、hash、守恒计数、quarantine、dry-run 和回滚证据继续保留；目录移动不得把 fixture 伪装成完整数据证据。

## Verifier Reduction

Verifier 分为行为、平台静态规则和源码 marker 三类。行为 verifier 保留；可由 TypeScript、ESLint、构建 metafile、OpenSpec strict 或数据库执行证明的规则使用相应平台能力；检查组件名、函数名、文案或源码片段存在性的 marker verifier 删除。每次删除先证明对应真实测试会在负例下失败。

## Repository Hygiene

OpenSpec 当前文本保留，258 张 archived PNG 只保留 10 张终态代表图；原始矩阵的路径、数量、哈希、验收结论继续由文本 manifest 保存，其余 248 张仍可从清理基线 commit 恢复。Git 历史不改写。worktree 清单记录路径、branch、HEAD、dirty、upstream、是否包含于最终分支以及 unique commit 数；自动清理只允许 `clean && reachable && reconstructible`。

## Verification Order

按文档权威、飞书运行时、Worker composition、离线工具、verifier、Schema、仓库卫生分批实施。每批运行 focused tests 和 `git diff --check`，最终运行 OpenSpec strict、fresh/upgrade D1、migration guards、typecheck、Vitest、Web build、Wrangler dry-run bundle、Playwright 和完整 repository gate。未执行项目必须报告 SKIP，不能推断 PASS。当前目标 Schema 为 65。
