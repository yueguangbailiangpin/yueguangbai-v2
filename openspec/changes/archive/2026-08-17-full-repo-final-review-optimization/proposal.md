# Change Proposal: Full Repository Final Review and Optimization

## Why

月光白 V2 已在本地 `main=384873ac3c5c6f83d73e6dd8e1788992081b78e7` 汇合至 Migration 0042、Rakuten/TikTok 日本站基础、历史订单只读 dry-run、卖家本金汇率策略和受控聊天截图读取链。进入任何最终生产判断前，需要一次独立、证据驱动的全仓复核，确认安全、迁移、数据守恒、跨平台、财务、Contract/API/UI 和仓库治理不是只靠静态计数或旧报告声称通过，并直接修复能够在既有权威规则下确定、不引入新业务语义的问题。

## What Changes

- 从精确本地提交创建隔离审查分支与 worktree，保留主工作树既有未跟踪路径，不从落后的 `origin/main` 开工。
- 建立覆盖身份/权限、文件动态授权、既有 Migration 0001–0042 与本次前向修复 0043、历史订单 dry-run、跨平台正式事实链、卖家本金财务、Contract/API/UI、分页/缓存/懒加载、重复/死代码、测试与静态 verifier 的可回读证据矩阵。
- 对有代码、SQL 或测试直接证明、保持现有业务语义且继续 fail closed 的缺陷、重复实现和必要性能问题，在本 worktree 内直接修复，并同步本 Change、测试和回滚证据。
- 对需要新业务决定、生产 Migration/部署、真实 D1/R2/Secrets/账号/Provider、Cloudflare、Feishu、Drive、腾讯文档、MCP、GitHub push/PR 或其他外部写入的事项，只记录为“需老板单独授权”，不执行。
- 完成 focused tests、历史订单完整 dry-run、数据库与 Migration guards、OpenSpec strict、完整 `npm run check`、`git diff --check` 和实际 diff 复核；所有 PASS/FAIL/SKIP 按真实执行结果报告。
- 完整门禁和 OpenSpec 一致性通过后，才运行 Ponytail 全仓只读复杂度审查；Ponytail 不自动修改代码，建议仍以人工证据和回归测试决定是否采纳。

## Non-Goals

- 不新增未经确认的平台业务、Provider 能力、导出、角色、财务口径、状态机、客户流程或文件 Purpose。
- 不重算历史订单、历史卖家本金、返款、服务费或任何既有财务事实。
- 不执行生产 Migration、生产/远程 D1 或 R2 读写、部署、真实账号/Secret/Provider 调用、GitHub push/PR/merge 或任何外部资源写入。
- 不删除或弱化 Migration、数据库约束、幂等、Audit、Outbox、Personal DENY、Staff Data Scope、Buyer/Seller/Staff 隔离、文件动态授权、不可变财务事实或回滚保护来换取简化。
- 不把本地 mock、fixture、dry-run、静态 verifier 或 Production-capable 配置描述成生产验收完成。

## Migration and Rollback

首先把现有 0001–0042 固定为提交 `384873ac3c5c6f83d73e6dd8e1788992081b78e7` 的字节级不可变基线，并验证 fresh、sequential、repeat、wrong-order、no-partial-DDL、FK 与 integrity 边界。审查已用本地 schema 42 复现卖家本金策略事件身份/时间可伪造、同事件可重复、策略可绕过 future-effective、主快照可晚于订单确认且可与既有财务快照金额分叉，因此新增连续、仅前向的 `0043_seller_principal_rate_integrity_hardening.sql`。0043 先拒绝不满足既定不变量的既有数据，再增加约束并把 schema 42 提升到 43；不得借此回填、删除或重算历史事实，也不得远程执行。代码、Contract、UI 和 verifier 修复必须可按本 Change 的实际 diff 反向撤销；0043 一旦承载新的不可变事实便没有安全 down-migration，应用回滚边界是保持附加约束并回滚为 schema 43 兼容代码。0043 及后续版本只允许追加新的连续 Migration，不回写已经集成的历史文件。

## Risks and Privacy

全仓审查可能暴露既有逻辑缺陷，但不能以扩大读取范围或读取真实生产数据来证明。所有权限结论使用匿名 fixture、本地 D1 和实际路由/服务测试；无权资源继续 concealed 404，Staff 范围外写入保持受控拒绝，文件读取在 intent 创建和消费时重新授权。历史源工作簿只允许按已冻结 SHA 的本地只读 dry-run 使用，不提取图片字节、不调用外部服务。
