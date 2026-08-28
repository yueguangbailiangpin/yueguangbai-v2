# Tasks: stage75-operational-completeness

三批严格串行；每批完成后运行该批专项测试与全量门禁并创建独立本地提交，未全绿不得进入下一批。

## 1. 第一批：员工订单列表与负责人（提交 `feat(ops): add staff order list and authoritative next actions`）

### Migration

- [x] 1.1 `0031_stage75_staff_order_list_indexes.sql`：formal_orders 游标/买家/卖家/买家编号/店铺/订单号前缀索引 + operational events 异常判定索引；schema_version→31；更新 `verify-migrations.mjs` inventory SHA-256 锚点与迁移守卫

### Contracts

- [x] 1.2 `StaffFormalOrderListItemDto`、列表查询参数类型、`stage`/`exception_state`/`next_action` 枚举（`packages/contracts/src/staff-order-list.ts` 或并入既有合同文件）；strict zod 正负向测试
- [x] 1.3 `StaffWorkItemDto` 扩展 `sla_due_at`/`is_overdue`/`overdue_since`/`next_action`/`responsible_role`/`responsible_staff`/`priority`；`StaffWorkbenchSummaryDto`

### Domain/API

- [x] 1.4 `staff-order-detail/responsibility.ts`：阶段/异常/负责人/下一步/截止权威 read model（列表与详情共用）
- [x] 1.5 `GET /api/staff/formal-orders` 列表模式：keyset cursor、筛选、limit 20/100、cursor filters_echo 一致性校验；查单模式行为不变（回归测试）
- [x] 1.6 统一详情 `responsibility` 分区 + 可见性收紧到固定分配（Owner 全局；pre_sales/buyer_refund 按买家分配；seller_ops 按卖家组织分配）；concealed 404
- [x] 1.7 `GET /api/staff/me/work-items/summary` 权威摘要（返款金额仅 owner/buyer_refund）
- [x] 1.8 work-items read model SLA/优先级/负责人联查扩展

### Tests（第一批专项）

- [x] 1.9 HTTP request-level：列表模式全参数组合、cursor 前后翻页无重复无遗漏、limit 边界、非法参数 400、查单模式回归
- [x] 1.10 权限矩阵：四角色可见范围、Personal DENY 403、concealed 404、无分配空列表
- [x] 1.11 详情 responsibility 随阶段切换（返款→结算→完成）；异常 OPEN/RESOLVED 切换
- [x] 1.12 摘要端点指标取后端权威值；非 buyer_refund 角色金额为 null
- [x] 1.13 容量 suite：20,000 单 + 200 增量；翻页/筛选组合；`EXPLAIN QUERY PLAN` 无全表扫描
- [x] 1.14 Migration fresh replay + guards + schema 30→31 全版本锚点更新

### Web（第一批）

- [x] 1.15 `/staff/orders` 列表页（筛选入 URL、表格/390 卡片、空态、错误恢复、游标翻页、点击进详情）；导航"订单"转正；`/staff/orders` 路由注册
- [x] 1.16 订单详情"当前负责人 / 下一步"区块（不重复标题/身份）
- [x] 1.17 工作台指标卡 + 最近工作项 + SLA 徽标；金额仅格式化后端字符串
- [x] 1.18 前端组件测试（MSW/jsdom）：列表渲染/翻页/筛选状态/错误恢复/权限入口
- [x] 1.19 Playwright：列表正常流（翻页/筛选/入详情）+ 失败恢复流；1440/1280/390 截图、无水平溢出、无错误态冒充正常截图、图片真实解码
- [x] 1.20 全量门禁（typecheck/test/build/check/openspec/db:verify/guards/api-contract/boundaries/static-build/css-duplicates）+ 独立提交

## 2. 第二批：业务对接人（提交 `feat(contacts): expose assigned business contacts safely`）

### Migration

- [ ] 2.1 `0032_stage75_public_service_channels.sql`：`company_public_service_channels` 表 + 两行空种子；schema_version→32；锚点与守卫更新

### Contracts

- [ ] 2.2 `CompanyServiceChannelDto`（公开字段）、`SetCompanyServiceChannelRequest`；产品 DTO（员工 catalog + seller-portal）增加主要对接人字段；buyer-portal/me 扩展两个公开负责人名；qr 文件 purpose 枚举扩展

### API

- [ ] 2.3 核对既有 primary-contact 端点权限/幂等/审计（补缺测试，不改稳定合同）
- [ ] 2.4 员工产品列表/详情、卖家产品列表/详情 read model 联查主要对接人
- [ ] 2.5 `GET /api/staff/service-channels`、`PUT /api/staff/service-channels/:code`（Owner-only，幂等+expected_version+审计）
- [ ] 2.6 `GET /api/buyer-portal/service-channels`（公开字段）；`GET /api/buyer-portal/me` 负责人公开名扩展

### Tests（第二批专项）

- [ ] 2.7 合同正负向（Buyer DTO 拒绝 staff_id/email/权限等内部字段）
- [ ] 2.8 HTTP：渠道读写权限矩阵（非 owner 403、owner 更新/version 冲突 409/幂等重放/payload mismatch）
- [ ] 2.9 对接人只能选本组织 ACTIVE 成员（跨组织/非 ACTIVE 409）；跨组织 concealed 404；组织可见性不缩小
- [ ] 2.10 未配置渠道时买家端兜底文案且无任何员工内部信息泄露（负向断言）
- [ ] 2.11 Migration 31→32 replay + 锚点

### Web（第二批）

- [ ] 2.12 员工产品列表/详情显示+管理主要对接人（设置/转移/清除，expected version + reason + 幂等）
- [ ] 2.13 卖家端产品页只读对接人
- [ ] 2.14 买家预约/订单资料/订单/评论/返款页阶段化联系卡片（负责人公开名+渠道；未配置兜底）
- [ ] 2.15 员工 `/staff/service-channels` Owner-only 设置页（导航"系统设置"组）
- [ ] 2.16 前端组件测试 + Playwright 正常/失败恢复流 + 1440/1280/390 截图
- [ ] 2.17 全量门禁 + 独立提交

## 3. 第三批：卖家结算批次（提交 `feat(settlements): add immutable seller settlement batches`）

### Migration

- [ ] 3.1 `0033_stage75_seller_settlement_batches.sql`：批次三表 + `uq_active_batch_payable` 部分唯一索引 + 状态机/组织一致性/冻结列防改触发器；schema_version→33；锚点与守卫更新

### Contracts

- [ ] 3.2 `SellerSettlementBatchDto`（员工/卖家两投影）、列表 DTO、成员 DTO、请求类型（建/增删/确认/取消）、`EXPORT_TOO_LARGE` 错误码；strict 正负向

### Domain/API

- [ ] 3.3 批次命令层：创建/增成员/移除/确认（冻结）/取消（释放）/导出，全部幂等+请求哈希+expected_version+状态机+transaction_assertions+审计（audit_events + batch_events 双写）
- [ ] 3.4 批次 read model：状态权威计算（PARTIALLY_PAID/PAID 实时推导）、组织 scope concealed 404
- [ ] 3.5 员工 8 路由（list/create/detail/members add/remove/confirm/cancel/export）挂 `/api/staff/seller-settlements/:organizationId/`
- [ ] 3.6 卖家 2 路由（只读、DRAFT/CANCELLED 不可见、卖家安全字段）
- [ ] 3.7 CSV 流式导出：白名单列、公式注入转义、稳定文件名、5,000 行/2 MiB 上限、流式分页拉取、导出幂等收据

### Tests（第三批专项）

- [ ] 3.8 同一 payable 不能进入两个有效批次（唯一索引 + 并发双插断言）
- [ ] 3.9 确认后成员/金额不可静默修改（触发器拒绝 + 负向 SQL 测试）；取消释放后可再入新批次
- [ ] 3.10 幂等重放、payload mismatch、expected_version 冲突、状态机非法迁移
- [ ] 3.11 权限矩阵（Owner 全局/seller_ops 限分配组织/Seller 门户只读本组织/Buyer 完全不可见 404）
- [ ] 3.12 CSV 公式注入（=,+,-,@,TAB,CR 前缀）转义、限额 409、Seller 视图无利润/买家/内部 ID/对象 key
- [ ] 3.13 Migration 32→33 replay + 锚点

### Web（第三批）

- [ ] 3.14 员工财务工作区"结算批次"面板：列表/建草稿/选应付/确认/取消/导出（390 可用）
- [ ] 3.15 卖家端 `/seller/settlements` 批次只读列表+详情
- [ ] 3.16 前端组件测试 + Playwright 正常/失败恢复流 + 1440/1280/390 截图
- [ ] 3.17 全量门禁 + 独立提交

## 4. 收口

- [ ] 4.1 `V2_API_ROUTE_INVENTORY.md`、`V2_PERMISSION_MATRIX.md`、`docs/CURRENT_SYSTEM_STATE.md`、Decision Register（必要时新增 Decision）同步
- [ ] 4.2 新建 `docs/migration/V2_STAGE75_OPERATIONAL_COMPLETENESS_HANDOFF.md`（六项完成情况/新路由/Migration/权限矩阵/容量结果/截图路径/未完成与 NOT_RUN/非 GO 声明）
- [ ] 4.3 全仓残留扫描（公共池/抢单/待认领/获客中心/双聊天截图入口/旧订单完整性页面）
- [ ] 4.4 本地 D1 `0001`→最新空库完整重放 + `PRAGMA integrity_check` + `PRAGMA foreign_key_check`
- [ ] 4.5 全部验证命令真实退出码记录；OpenSpec tasks 全部真实完成；不归档任何 Change
