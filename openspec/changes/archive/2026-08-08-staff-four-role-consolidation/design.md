# Design: Staff Four-Role Consolidation

## Canonical Roles

最终可激活角色为：

- `owner`：总管理员；保留 system owner 与 Seller Organization OWNER 的严格区分。
- `pre_sales`：售前；承接买家获客、注册、预约和正式订单前链路。
- `seller_ops`：卖家对接；承接 Seller、产品、需求、协议和卖家结算链路。
- `buyer_refund`：买家返款；承接原 `after_sales` 的评论审核、返款和必要买家资料能力。

每名 ACTIVE Staff 恰有一个 ACTIVE 角色，不计算多角色权限并集；个人授权/禁用、负责人权限包、Personal DENY、hard deny 和数据范围顺序不变。

## Historical Mapping

目标职责映射为 `owner→owner`、`pre_sales→pre_sales`、`seller_ops→seller_ops`、`after_sales→buyer_refund`、`buyer_support→pre_sales`、`seller_support→seller_ops`。前三项和 `after_sales` 是职责同义迁移；两个 support 角色可能增加正式写能力，因此不能静默自动生效。

迁移工具先输出每名 Staff 的旧角色、唯一目标角色、旧有效权限、新有效权限、新增/减少权限和 Scope 摘要。owner 以版本化映射清单批准具体 Staff；未批准 support 映射不得激活新角色。存在多条旧 ACTIVE 角色时不得自动合并，必须由 owner 明确选择唯一目标。旧分配改为 REVOKED 并保留时间、操作者和原因，不能删除。

业务所有者在 2026-08-07 确认暂无已知旧员工需要迁移。切换前仍必须查询真实数据库；若结果非空，则停止切换并走逐员工映射和权限差异审批，不得把本确认当作数据断言。

## Database and Contract

Migration 重建所有持久化 role-code CHECK、每名 ACTIVE Staff 唯一 ACTIVE 角色约束和角色默认权限投影，允许历史旧代码只以 REVOKED/审计形式存在，ACTIVE 只允许四个新代码。`buyer_refund` 默认权限以旧 `after_sales` 为基线；support 合并后的新增正式写权限只来自 owner 批准的新角色，不由兼容层偷偷授予。

共享合同、Staff Auth 解析、分派候选、任务工作台、测试 Fixture 和静态 verifier 必须一次同步。未知 ACTIVE role、无角色 Staff、无批准映射或权限目录漂移均 fail closed。

## Cutover and Rollback

1. 冻结 Staff 角色写入并取得 schema-34 可恢复备份。
2. 应用 Migration 和兼容 Worker，验证历史/新角色读取。
3. 生成权限差异；owner 批准逐 Staff 映射。
4. 原子切换唯一 ACTIVE 分配、递增 authorization version、撤销既有 Staff Session。
5. 验证四角色登录、路由、分派和 DENY，再解除冻结。

切换前可回旧 Worker/备份；任何新 `buyer_refund` 事实或映射提交后不得用旧 Worker 隐藏新代码，必须前向修复或从已验证切换点恢复。
