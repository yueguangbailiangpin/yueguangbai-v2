# 管理员经营看板合同

## 权限边界

三个 `/api/staff/admin-business-dashboard/*` 读取接口只接受 Active Staff 的 system `owner`，同时要求有效权限包含 `FINANCIAL_VIEW`。Personal `DENY` 最终优先。Web 端的菜单隐藏和查询开关只用于体验，后端授权结果是唯一真值。

响应不包含微信原文、客户姓名、电话、地址、内部备注、附件或文件标识。受控明细仅返回不可用于展示客户隐私的业务引用编号、北京时间业务日期和中文界面可映射的状态。

## 接口

| 方法与路径 | 查询参数 | 返回主体 |
|---|---|---|
| `GET /api/staff/admin-business-dashboard/summary` | `window=TODAY\|WEEK\|MONTH`，缺省为 `TODAY` | 卡片、Buyer/Seller cohort 漏斗、员工/渠道来源业绩、预计/已完成利润 |
| `GET /api/staff/admin-business-dashboard/trends` | 必填 `from_date`、`to_date`、`granularity=DAY\|WEEK\|MONTH` | 服务端按北京时间分桶的有界趋势 |
| `GET /api/staff/admin-business-dashboard/drill-down` | 必填 `metric`、`from_date`、`to_date`；可选 `limit` 1–100、opaque `cursor` | 最多 100 条受控明细与下一页 cursor |

查询拒绝未知参数、重复参数、无效日期、反向日期和超过 366 个自然日的范围。成功响应包含 `Cache-Control: no-store`，并声明 `timezone=Asia/Shanghai`、精确日期边界和 `data_as_of`。

## 指标与日期

- 新增买家：`buyer_customers.activated_at` 的北京时间自然日。
- 新增预约：`product_reservations.submitted_at` 的北京时间自然日；后续取消不改写历史新增数。
- 正式订单：`formal_orders.confirmed_business_date`。
- 业务完成：`order_archive_closures.status=CLOSED` 的 `business_closed_at` 北京时间自然日。
- 买家/卖家漏斗：以 ACTIVE 获客线索的不可变来源 cohort 为基准；跨期转化仍归回原 cohort。阶段分母为零时转换率为 `null`。
- 买家未参加：截至 `data_as_of` 从未出现预约链接的 Buyer lead，提交后不因后续状态重新计入。
- 员工/渠道业绩：使用线索的不可变 `origin_staff_id` / `origin_channel_id`；当前负责人工作量单列。

## 财务边界

看板只消费规范读模型 `internal_order_finance_positions`：预计利润使用 CONFIRMED 日期和 `projected_gross_profit_cny_fen`；已完成利润使用 APPROVED 日期和 `completed_gross_profit_cny_fen`。服务端以 BigInt 累加并输出十进制字符串，浏览器只格式化显示。

非有效财务状态作为冲突计数，缺失或冲突金额不按零计入。员工和渠道是同一订单的两个观察维度，不能相加为全局利润。
