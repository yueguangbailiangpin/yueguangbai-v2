# Proposal: stage75-operational-completeness

## Why

阶段 7R 收口（`V2_FRONTEND_REBUILD_STAGE7R_HANDOFF.md` §6）确认了六个真实后端合同缺口：员工无正式订单列表端点、统一订单详情无权威负责人/下一步分区、work-items API 不暴露 SLA/逾期/今日返款指标、产品主要对接人未接入任何产品 DTO 与页面、卖家结算无批次化确认/导出、买家端无分阶段联系人投影。业务闭环（员工找到订单 → 知道谁负责下一步 → 买家知道找谁 → 卖家按批次对账）因此断裂。本 Change 按三批严格串行补齐这六项能力。

## What Changes

按三批实施（每批独立本地提交，全绿后才进入下一批）：

### 第一批：员工订单与工作台

1. **员工正式订单游标列表**：扩展 `GET /api/staff/formal-orders`——当且仅当查询串只含 `amazon_order_number` 时保持现行订单号精确查单语义（返回统一详情聚合，兼容不变）；其余情况进入列表模式，keyset/cursor 分页（默认 20、最大 100、禁止 OFFSET），支持 Amazon 订单号前缀、买家编号、卖家组织/店铺、阶段状态、异常状态、负责人、日期范围筛选；URL 保存筛选与 cursor；返回列表专用轻量 DTO（金额只取后端权威整数快照值）；为筛选与游标追加必要索引并做 20,000 单容量验证。权限沿用固定分配：Owner 全局；pre_sales/buyer_refund 仅其固定分配买家的订单；seller_ops 仅其固定分配卖家组织的订单；Personal DENY 优先；越权 concealed 404；统一详情端点同步收紧到同一可见性模型。
2. **订单详情权威负责人/下一步**：统一订单详情新增 `responsibility` 分区（当前业务阶段、负责员工、负责角色、下一步动作、截止时间、是否逾期、异常原因、可执行动作），由后端权威计算，前端只渲染。
3. **工作台 SLA 指标**：work-item DTO/read model 扩展 `sla_due_at`、`is_overdue`、`overdue_since`、`next_action`、`responsible_role`、`responsible_staff`、`priority`；新增权威工作台摘要端点（我的待处理、今日到期、已逾期、异常订单、今日应处理返款金额[仅 owner/buyer_refund]、最近工作项）；工作台前端渲染指标并链接到新订单列表。

### 第二批：业务对接人

4. **产品主要对接人接线**：核对既有 `POST /api/staff/products/:id/primary-contact` 实现与权限；员工产品列表/详情与卖家端产品 DTO/页面接入主要对接人；一产品同时仅一个主要对接人、仅可选本组织 ACTIVE 成员、支持设置/转移/清除；幂等键 + expected version + 审计事件保持；组织可见性不因对接人缩小；跨组织 concealed 404。
5. **买家分阶段对接人**：复用既有 `pre_sales_owner`/`refund_owner` 固定分配，不建第二套分配模型。新建公司公开客服渠道配置（`BUYER_PRE_SALES`/`BUYER_AFTER_SALES` 两渠道，公开名称/微信号/可选二维码文件引用；初始值全空，不得编造真实微信号；仅 Owner 可改）。买家端按业务阶段显示当前负责人公开名称与对应客服渠道；未配置时显示"请联系工作人员"且不泄露员工登录邮箱、内部 ID、个人微信或任何内部字段；Seller/Staff 内部字段不进入 Buyer DTO。员工端新增 Owner-only 客服渠道设置页。

### 第三批：卖家结算批次

6. **结算批次、确认与导出**：新增 append-only 批次模型（Migration 0031+，schema 31+）：DRAFT → 确认时冻结成员/金额/关键订单快照 → CONFIRMED/PARTIALLY_PAID/PAID（后端按既有付款事实权威计算）或 CANCELLED（取消/冲正事件表达，不静默修改）；一个 payable 不能进入两个有效批次（数据库部分唯一索引）；付款继续走既有付款事件与账本，不回写历史财务事实；CSV 导出白名单字段、防公式注入、稳定文件名、行数/大小上限、流式生成；审计覆盖创建/增删成员/确认/取消/导出。权限：Owner 全局创建/确认/取消/导出；负责该组织的 seller_ops 同权（限其范围）；Seller 门户只读本组织允许展示的批次；Buyer 完全不可见；不暴露利润、买家返款与内部备注。员工端与卖家端批次列表/详情/操作页面（Material 3、390px 可用）。

## Migration

需要，只追加不改写历史：批次一追加 formal_orders 筛选/游标索引（0031）；批次二追加公司公开客服渠道表（0032）；批次三追加结算批次三表与部分唯一索引（0033）。schema version 逐批推进并同步迁移守卫、空库重放测试与版本锚点。

## 权限、隐私影响

- 员工订单可见性从 marketplace 宽范围收紧为固定分配范围（Owner 全局）——统一详情与列表一致，越权 concealed 404；Personal DENY 始终优先。
- Buyer DTO 只新增公开字段：负责人公开显示名（可空）与公司客服渠道公开信息；员工登录邮箱、staff_id、个人微信、权限码不出现在任何 Buyer/Seller DTO。
- 结算批次对 Seller 仅暴露其组织被允许字段；利润、买家返款、内部员工 ID、对象存储 key 不进入批次 DTO 与 CSV。
- 客服渠道为独立公司公开配置，不复用员工登录身份；二维码文件走既有受控文件链。

## 非范围

- 不进入阶段 8、不开发营销获客网页、不部署、不 push、不触碰 Cloudflare/Google Drive/真实数据。
- 不归档任何 OpenSpec Change（含 `stage7-three-portal-remediation`）。
- 不创建第二套订单详情、产品联系人、买家分配或财务台账模型。
- 不建立公共池、抢单、轮转、自动兜底或认领交互。

## 回滚边界

三批各自独立本地提交；Migration 只追加，回滚以新 Migration 或 revert 提交表达。列表模式仅在既有查单语义 100% 保留后启用；详情可见性收紧与列表同批，出现回归时整批 revert。
