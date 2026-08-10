# Change Proposal: Seller Principal Rate Production Bootstrap Preflight

## Why

`origin/main=513b9402faeb5da3a452315ad08f32cfec778e5d` 已包含 Migration 0040–0043、卖家本金汇率策略、Staff 管理入口、两条正式订单确认快照链和默认关闭的生产开关。当前剩余风险不是缺少策略实现，而是生产初始化前没有一个机器可执行、默认零写入的预检来区分“生产没有默认策略行”“已有正确待确认策略”“已有正确生效策略”和“存在冲突事实”，也没有统一输出预期行数守恒、审计、回滚和开关前置条件。

## What Changes

- 新增只读取本地恢复 SQLite 副本的卖家本金汇率激活 preflight；数据库以 read-only 和 `query_only` 打开，不包含远程/生产连接或写入模式。
- 修复现有 Staff 工作台把全局默认策略读取错误绑定到 ACTIVE 卖家组织的问题：GLOBAL Owner 可在尚无组织主数据时读取/提交币种对默认策略；组织覆盖仍必须提供已授权 ACTIVE 组织，Seller Ops 仍只能操作其分配组织。
- 预检固定 JPY→CNY 默认绝对加点 `+0.004`（E8 为 `400000/100000000`），不得假定生产已有策略行，并区分未设置、明确 0、正确待确认、正确未来已确认和当前已生效。
- 复核 schema 43、integrity/FK、策略/事件/Audit/Outbox/Idempotency 守恒、默认关闭开关，以及 enablement 阶段指定平台下单日的精确权威日汇率；任一缺失或冲突均 fail closed。
- 安全初始化复用受控 Staff Web/API：Owner/GLOBAL 提交默认策略，Owner + `FINANCIAL_CORRECT` 确认；不生成直写生产 SQL，不创建卖家专属覆盖，不导入组织、店铺、订单、产品、编号或图片。
- 新增生产激活 runbook、匿名本地 fixture 测试和范围内 package scripts，明确预期行数增量、并发、权限、回滚与外部授权边界。

## Non-Goals

- 不修改卖家本金公式、买家返款、服务费、退款、评论、结算或历史财务口径。
- 不重算或回填历史订单、旧快照、既有 payable，也不导入卖家编号、店铺、历史订单、产品库或 R2 历史图片。
- 不执行生产 Migration、生产 D1/R2/Drive/Feishu/MCP 读写、部署、Secret 写入、真实账号操作、GitHub push/PR/merge 或其他外部写入。
- 不为尚未完成的卖家组织主数据创建专属覆盖；组织覆盖继续由将来的受控 Staff 操作按实际组织逐项配置。

## Migration and Rollback

Migration 决策为 **NONE**。0041 已提供版本、事件和不可变快照，0043 已提供 future-effective、事件 fidelity 和快照金额/确认时点保护；本 Change 不制造 0044 空 Migration。

Preflight 本身只读，回滚等于移除脚本/文档。生产初始化在开关仍为 `false` 时可通过拒绝尚未确认的错误 pending 版本停止；已经确认的版本不可删除或覆盖，只能保持开关关闭并通过新的未来版本纠正。任何已形成的正式订单快照均不得重算。

## Risks and Privacy

本地恢复副本可能包含生产敏感数据，因此 preflight 只输出 schema、聚合行数、版本号、日期和汇率整数，不输出 Staff、Seller Organization、policy、Audit、Outbox 或 idempotency 标识。恢复副本的获取、保管和销毁沿用生产备份恢复治理，且不属于本 Change 的执行范围。
