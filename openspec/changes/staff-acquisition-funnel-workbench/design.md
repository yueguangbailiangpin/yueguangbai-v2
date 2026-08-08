# Design: Staff Acquisition Funnel Workbench

## Fact Model

- `acquisition_channels`：管理员维护的渠道/账号，含类型、显示名、状态和版本。
- `acquisition_staff_channel_assignments`：Staff、线索类型、渠道和生效区间；同一 Staff/类型/时间最多一个有效渠道。
- `acquisition_daily_consultations`：渠道 + 北京业务日期的咨询人数、版本和操作者。
- `acquisition_leads`：BUYER/SELLER 单人线索、规范化微信身份保护值、可选显示名/备注、不可变来源渠道、创建 Staff、状态和版本。
- `acquisition_lead_links/events`：与 Customer/Buyer/Seller、预约、正式订单的受控关联及更正历史。

原始微信号属于敏感身份字段；按既有 Customer Identity 规范化并加密/受控存储，日志、Outbox、飞书摘要和列表 DTO 只返回最小掩码或业务 ID。

## Roles and Authority

owner 管理渠道、Staff 渠道有效期、每日咨询汇总、全局查看和更正。pre_sales 只创建/查看本人或授权范围内 BUYER lead；seller_ops 对 SELLER lead 同理；buyer_refund 没有登记权限。Staff 创建请求不包含 channel_id，服务端以可信 Staff、lead type 和 created_at 解析唯一有效渠道；缺失或多条匹配均失败关闭。

## Counting and Attribution

“咨询人数”是管理员按渠道、北京时间自然日录入的去重人数：同一人在同一渠道同一天计一次；同一人咨询不同渠道时，各渠道分别计一次。由于只保存汇总，系统不声称可在渠道之间合并人数。“添加微信人数”是该来源日内创建的有效单人线索数，重复/作废线索从当前漏斗排除但保留审计。

同一规范化微信身份在 BUYER、SELLER 各自类型内最多一条有效线索；首次有效线索冻结来源渠道和创建 Staff，重复录入返回既有/冲突结果。同一人可以在严格分离的类型下各有一条 Buyer lead 和 Seller lead。

Buyer lead 使用规范化微信身份自动关联邀请注册/Buyer，之后关联预约和正式订单。有效 Buyer lead 截至统计时点从未提交任何预约时计为未参加；首次提交预约后永久退出未参加指标，不因拒绝、取消、过期或其他后续状态重新计入。Seller lead 以“关联身份首次成为有效 Seller Organization 的 ACTIVE 成员”认定合作确认。

订单和利润归因到 Buyer lead 的不可变来源渠道与创建 Staff；Seller lead 单独统计咨询、加微信和合作，不把同一订单利润再次计入 Seller 漏斗总和。负责人转移保留 current owner，但来源业绩不被覆盖。

未转化线索以最后一次跟进时间起算十二个月；到期 Job 清除私人微信身份和非必要个人信息，保留匿名化事件及最小审计事实。已形成注册、预约、订单、合作或财务事实的线索，以及安全事件、争议、法定留存中的记录，不进入该自动匿名化路径，按对应正式政策处理。

## Commands and Corrections

渠道、有效期、日汇总、线索创建/作废/合并均使用 Idempotency-Key、请求哈希、expected_version、事务断言和 Audit。日汇总可由 owner 版本化修正；线索来源若因配置错误需更正，写 replacement/correction event 并保留原值，不直接覆盖审计历史。

## Navigation

员工工作台提供“获客登记”，另有稳定同源 `/staff/acquisition` 路径可收藏。页面按后端权限显示 Buyer/Seller/Admin 面板；直接访问仍由后端权限保护。

## Rejected Alternatives

- 不只保存每日漏斗所有阶段的汇总数字；跨日转化会失真。
- 不要求普通员工选择渠道；会产生错填和伪造来源。
- 不接入私人微信或小红书自动化；第一阶段只记录正式最小事实。
