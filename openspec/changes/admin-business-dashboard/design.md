# Design: Admin Business Dashboard

## Authority and Access

所有看板 API 要求 Active Staff、system owner、`FINANCIAL_VIEW`，并继续应用 Personal DENY。客户端不提交 owner、Staff Scope 或财务权限。响应只包含看板所需聚合和受控 drill-down ID，不含微信原文、文件标识、内部备注或其他客户详情。

## Calendar Windows

时间事实保持 UTC 毫秒，分组边界转换为 `Asia/Shanghai`：今日为北京时间自然日；本周为周一 00:00 至当前/周日结束；本月为自然月。API 回传 `from_date`、`to_date`、`timezone` 和 `data_as_of`，避免浏览器猜测。

## Metric Definitions

- 新增买家：Buyer 首次成为 ACTIVE 的北京时间业务日期。
- 预约：Reservation 首次创建日期；状态分组另列，不能因后来取消而改写历史新增数。
- 正式订单：Formal Order `confirmed_business_date`。
- 业务完成：评论、买家返款、卖家本金、卖家服务费均 COMPLETED 或明确 NOT_APPLICABLE。
- 买家未参加：有效 Buyer lead 截至统计时点从未提交任何预约；提交过预约后不因拒绝、取消、过期或其他后续状态重新计入。
- 卖家合作：复用获客 Change 冻结的 ACTIVE Seller membership 口径。

每阶段同时返回 `count` 和相对上一阶段的有界转换率；分母为零时返回 `null`，不能伪造 0% 或 100%。漏斗按来源 cohort 展示，不能把某天咨询和同一天订单直接相除冒充真实转化。

## Performance Attribution

按获客线索不可变来源渠道/Staff 归因，并可另看当前负责人工作量。Buyer 来源贡献注册、预约、订单、业务完成、预计利润和已完成利润；Seller 来源贡献 Seller 合作漏斗。两个来源视图分开，不把同一订单利润相加两次。

## Profit

预计利润复用 `projected_gross_profit_cny_fen`，按 `CONFIRMED` 日期；已完成利润复用 `completed_gross_profit_cny_fen`，按 `APPROVED` 日期。两者分别显示订单数、冲突数和 CNY 整数分聚合。缺失/冲突事实不得按零计入；浏览器只格式化十进制字符串，不重新计算公式。

## API and UI

一个 bounded summary endpoint 返回卡片和漏斗，一个 bounded trend endpoint 返回 DAY/WEEK/MONTH 序列，一个 cursor endpoint 提供受控 drill-down。默认今日，允许明确窗口；拒绝未知/重复参数和过大范围。Web 使用真实 loading/empty/error/conflict 状态，不显示假 KPI。

## Performance and Cache

以 8 Staff、200 订单/日运行查询计划和容量测试；优先现有索引和有界聚合。React Query key 包含 Staff authorization version、窗口和粒度；Staff 401/权限变化清除 owner-only 缓存，绝不持久化到浏览器存储。
