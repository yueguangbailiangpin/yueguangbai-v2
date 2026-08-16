# Change Proposal: Final Repository Stabilization

## Why

`feature/frozen-portals-staff-acquisition-core` 是当前最终产品基线，但仓库仍同时承载互相覆盖的交接文档、已经明确弃用的飞书历史实现、被运行时开关关闭却仍进入核心 Worker 的候选模块、放在在线 API 源码树下的一次性导入工具，以及大量依赖源码字面量的静态 verifier。这些问题不一定立即造成线上故障，却持续扩大事实歧义、发布图和验收维护成本。

用户已明确决定当前及未来架构不再使用飞书，并确认系统从未投入使用且没有业务/审计数据。该决定授权用前向 0065 删除飞书遗留，但不允许修改已存在的 Migration 字节。

## What Changes

- 恢复 `AGENTS.md` 规定的唯一权威顺序，新增一份薄的当前系统状态索引，并删除或降级互相循环引用的 FINAL/LATEST/LOCAL 交接文件。
- 删除当前源码、Contract、配置、脚本、测试和发布门禁中的飞书可执行路径；Cloudflare Access 与 Moonwhite D1 Staff 权限保持唯一 Staff 身份组合。
- 对 migrations 0001–0064 中的飞书历史对象做精确引用和升级兼容审计；在用户确认系统未使用且无数据后，新增连续、仅前向的 0065 清理飞书专属对象，绝不回写历史 Migration。
- 将未获准进入核心发布的 Staff MCP 从 Worker release graph 移除；Drive 冷归档因文件读取与调度共享核心运行边界，本轮保留并单独审计，不拿一个“关闭开关”就瞎判死刑。
- 将卖家伙伴导入、当前可预约商品卖家映射和历史订单迁移归入明确的离线工具边界，不让在线 API 源码目录承担一次性程序的认知成本。
- 删除无引用的 workspace 空壳，并把依赖源码字符串、组件名称或 marker 的 verifier 收缩为行为测试、类型检查、lint 或少量通用结构校验。
- 精简 OpenSpec 当前树中的重复视觉证据，并生成本地 branch/worktree 可达性清单；只清理干净且完全可恢复的本地对象，不删除远端分支。

## Non-Goals

- 不改变 Buyer、Seller、Staff 业务流程、角色、权限、状态机、财务口径、文件授权或 Marketplace 事实。
- 不删除或弱化 Migration、约束、Trigger、幂等、Audit、Outbox、Personal DENY、数据范围、财务不可变事实或文件动态授权。
- 不把 Staff MCP、Drive 冷归档或 Marketplace Adapter 判定为永久废弃；Staff MCP 当前只保留独立源码与测试，Drive 冷归档继续作为已接受的跨切面产品能力。
- 不访问或修改生产 D1/R2/Worker、Cloudflare Access、Secrets、飞书资源或 Provider；不部署，不 Push，不创建 PR，不合并。
- 不改写 Git 历史，不 force-push，不删除脏 worktree、无远端保护的独立提交或无法证明可恢复的目录。

## Migration and Rollback

0001–0064 保持字节不变。0065 先断言全部目标旧表与 Scheduler/告警表为空，再删除三张飞书命名表、五张旧登录/绑定专属表，并重建共享表去掉 `feishu_sync`、`staff_auth_cleanup` 和 `FEISHU_ADAPTER_FAILURE`。任一意外行都会使 Migration 整体回滚。0065 不远程执行；fresh、sequential、空系统升级 fixture、拒绝非空 fixture、integrity 和 Foreign Key 必须通过。

代码和文档改动可按提交组回退。一次性工具移动保留原入口脚本兼容期或同步更新所有调用。worktree 只删除干净且提交仍由保留分支可达的副本，因此可从 Git 重建。

## Risks and Privacy

- 历史飞书身份可能仍属于审计事实；“不再使用飞书”不能自动推导为可销毁历史记录。
- 从核心 Worker 排除关闭模块可能改变关闭状态下的路由表现；测试必须冻结明确的 unavailable/404 行为。
- 删除源码 marker verifier 可能暴露被其掩盖的测试缺口；每个删除项必须先绑定行为测试或平台级静态规则。
- worktree 和分支清理具有破坏性；必须先报告 dirty、unique commit、upstream 和 reachability，远端保持不变。
