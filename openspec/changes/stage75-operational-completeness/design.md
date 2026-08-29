# Design: stage75-operational-completeness

## 0. 总体约束

- 单写者串行：三批严格串行实施、验证、本地提交；公共合同（`packages/contracts`）、Migration、路由清单（`V2_API_ROUTE_INVENTORY.md`）每批只由一个执行流修改。
- 既有查单语义 100% 保留：`GET /api/staff/formal-orders?amazon_order_number=X`（且仅此一个参数）继续返回统一详情聚合响应，响应形状不变。
- 金额一律整数（CNY 分、JPY 元、E8 汇率），JSON 中以十进制字符串承载；禁止 REAL/FLOAT；前端不计算 SLA 与财务金额。

## 1. 员工正式订单列表

### 1.1 端点与判别

扩展 `apps/api/src/staff-order-detail/routes.ts` 的 `GET /api/staff/formal-orders`：

- 查询串恰好只含 `amazon_order_number`（单值）→ 现行精确查单（按 `amazon_order_number_normalized` 命中后重放统一详情聚合），行为、响应、状态码全部不变。
- 其余任何情况（无参数或携带列表参数）→ 列表模式。

列表模式参数（全部可选，重复键 400）：

| 参数 | 语义 | 校验 |
|---|---|---|
| `amazon_order_number_prefix` | 平台订单号前缀过滤 | 3–100 字符，去 NFKC/空白 |
| `buyer_customer_no` | 买家编号精确 | 3–120 字符 |
| `seller_organization_id` | 卖家组织精确 | 1–200 字符 |
| `store_id` | 店铺精确 | 1–200 字符 |
| `stage` | 业务阶段 | `BUYER_REFUND`/`SELLER_SETTLEMENT`/`COMPLETED`（§1.3） |
| `exception_state` | 异常状态 | `NONE`/`OPEN`（§1.3） |
| `responsible_staff_id` | 当前负责人 | 1–200 字符 |
| `confirmed_from`/`confirmed_to` | 确认时间范围 | epoch 毫秒整数 |
| `limit` | 每页条数 | 默认 20，1–100 |
| `cursor` | 游标 | §1.2 |

响应：`apiSuccess({ items: StaffFormalOrderListItemDto[], next_cursor: string | null })`。`next_cursor` 为 base64url(JSON{last_confirmed_at, last_id, filters_echo})；服务端对 cursor 内 filters_echo 与当前查询串做一致性校验，不一致 400 `VALIDATION_ERROR`（防止换筛选条件复用旧游标造成漏单/重单）。

### 1.2 Keyset 分页与排序

- 排序固定 `confirmed_at DESC, id DESC`（新单在前；`created_at=confirmed_at`，列上有 CHECK）。
- 游标条件：`confirmed_at < :last_confirmed_at OR (confirmed_at = :last_confirmed_at AND id < :last_id)`（SQLite 字符串 id 的排序稳定；同毫秒并发由 id 决胜）。
- 禁止 OFFSET；取 `limit+1` 判定 hasMore。
- Migration 0031 索引：
  - `idx_formal_orders_confirmed_id ON formal_orders (confirmed_at DESC, id DESC)`（游标主扫描）；
  - `idx_formal_orders_buyer_confirmed ON formal_orders (buyer_customer_id, confirmed_at DESC, id DESC)`；
  - `idx_formal_orders_seller_confirmed ON formal_orders (seller_organization_id, confirmed_at DESC, id DESC)`；
  - `idx_formal_orders_buyer_no ON formal_orders (buyer_customer_no)`；
  - `idx_formal_orders_store ON formal_orders (store_id)`；
  - `idx_formal_orders_amazon_prefix ON formal_orders (amazon_order_number_normalized)`（前缀 LIKE 'x%' 走范围扫描）；
  - `idx_formal_order_operational_events_order_type ON formal_order_operational_events (formal_order_id, event_type)`（异常状态 EXISTS 判定）。
- 容量验证：既有 `vitest.capacity.config.ts` 模式新增 suite，本地 D1 灌 20,000 单 + 200 增量，断言首页/翻页/各筛选组合在索引计划下执行（`EXPLAIN QUERY PLAN` 不出现 `SCAN formal_orders`）且结果正确。

### 1.3 权威业务阶段与异常状态（共享 read model）

新模块 `apps/api/src/staff-order-detail/responsibility.ts`，纯后端权威计算，列表与详情共用：

- 阶段 `stage`：
  - `BUYER_REFUND`——存在未结清买家返款义务（`buyer_refund_obligations` due 金额 − 净付款 > 0）或存在未冲销垫付待后续抵扣判断按义务口径为准；
  - `SELLER_SETTLEMENT`——买家侧已结清（或无义务）且存在未结清 `seller_payables`（outstanding > 0）；
  - `COMPLETED`——买家侧结清且卖家 payable 全部结清。
  - 判定 SQL 一律走聚合 EXISTS 子查询（`buyer_refund_payment_entries` 净额、`seller_payment_allocations` − reversals 净额），只读既有事实，不新增写路径。
- `exception_state`：`OPEN`——最新异常事件（`formal_order_operational_events` 中 `PLATFORM_CANCELLED/RETURN_REFUND/BUSINESS_VOID/MANUAL_INVESTIGATION`）之后没有 `RESOLVED`；`NONE`——其余。`exception_reason` 取最新异常事件 reason。
- 负责人映射（阶段 → 固定分配）：
  - `BUYER_REFUND` → 角色 `buyer_refund`，员工 = 买家 `buyer_staff_assignments` 的 ACTIVE `BUYER_REFUND_OWNER`（缺失 → `responsible_staff_id: null`，`next_action` 提示 owner 到分配管理设置）；
  - `SELLER_SETTLEMENT` → 角色 `seller_ops`，员工 = `seller_staff_assignments` 的 ACTIVE `SELLER_ACCOUNT_MANAGER`；
  - `COMPLETED` → `owner`（结清订单的终态核阅由 Owner 负责）。
  - 请求者是 Owner 时 `responsible_staff` 仍按上述规则显示业务负责人（不是 Owner 自己），Owner 的可执行动作另行叠加。
- `next_action_due_at`：`BUYER_REFUND` → 未结清义务中最小 `due_at`；`SELLER_SETTLEMENT` → 未结清 payable 中最小 `due_at`；`COMPLETED` → null。
- `is_overdue` = due_at 非 null 且 < now；`overdue_since` = 恒为 due_at（逾期起点即截止时间，权威且可重算，不落库）。
- `next_action`：有限枚举文案（如 `PROCESS_BUYER_REFUND`/`FOLLOW_SELLER_SETTLEMENT`/`REVIEW_COMPLETED_ORDER`/`RESOLVE_EXCEPTION`[异常 OPEN 时优先]），DTO 携带 code，前端映射文案。
- `available_actions`：按请求者角色+权限计算（如 buyer_refund → `record_refund_payment`；seller_ops → `record_seller_payment`；owner → 全部 + 财务调整），仅作 UI 入口收敛，服务端操作端点各自重新鉴权（现行模式不变）。

### 1.4 可见性（列表 + 详情同步收紧）

- `owner`：全局。
- `pre_sales`：`formal_orders.buyer_customer_id IN (SELECT buyer_customer_id FROM buyer_staff_assignments WHERE staff_id=? AND duty_code='BUYER_PRE_SALES_OWNER' AND status='ACTIVE')`。
- `buyer_refund`：同上，duty=`BUYER_REFUND_OWNER`。
- `seller_ops`：`formal_orders.seller_organization_id IN (SELECT seller_organization_id FROM seller_staff_assignments WHERE staff_id=? AND duty_code='SELLER_ACCOUNT_MANAGER' AND status='ACTIVE')`。
- 以上与 marketplace scope（`scopeAllowsMarketplace`）取交集；无分配 → 空列表（列表）/404（详情）。
- `ORDER_VIEW` 被 Personal DENY → 403（不变）。越权对象一律 concealed 404（详情）或不可见（列表过滤）。
- 统一详情 `GET /api/staff/formal-orders/:id` 从 marketplace 宽范围同步收紧到同一规则（这是任务要求的"权限沿用既有固定分配和组织范围"；既有依赖宽范围的测试按新合同修正）。
- 禁止公共池/抢单/轮转/兜底/认领：无任何"认领"端点或按钮，列表只读 + 既有操作端点。

### 1.5 列表 DTO（轻量）

`StaffFormalOrderListItemDto`：formal_order_id、amazon_order_number、marketplace_code、amazon_order_date、confirmed_at、buyer_customer_no、buyer_display_name、seller_organization_id、store_display_name、product_name_snapshot、review_type、stage、exception_state、exception_reason（可空）、responsible_staff_id（可空）、responsible_staff_name（可空）、responsible_role、next_action、next_action_due_at（可空）、is_overdue、buyer_expected_principal_cny_fen（快照权威值，字符串，可空=无快照）、seller_expected_principal_cny_fen（同前）。不含截图、运营事件、财务调整、内部利润。

## 2. 订单详情 responsibility 分区

统一详情响应新增 `responsibility` 对象（§1.3 全字段 + `available_actions: string[]`），对所有能看见该订单的角色返回（金额分区权限不变）；前端订单详情页在标题区下方渲染"当前负责人 / 下一步"卡片区，不重复现有标题与身份信息。

## 3. 工作台 SLA 与指标

### 3.1 work-item DTO 扩展

`StaffWorkItemDto` 追加（read-model SQL 联查，非落库）：

- `sla_due_at`：按 work_type 权威规则——
  - `BUYER_REFUND_PROCESSING` → 义务 `due_at`；
  - `ORDER_INSTRUCTION_PUBLISH` → 指引 expiry scan 既有到期语义不适用，按 SLA 表；
  - 其余类型 → `created_at + SLA_HOURS[type]`（`@ygb/domain` 常量表：产品审核 48h、需求审核 48h、预约决策 24h、指引发布 24h、订单资料审核 48h、评论审核 48h、返款处理到义务 due_at）。
- `is_overdue`/`overdue_since`（= sla_due_at）。
- `next_action`（每类型固定枚举 code）。
- `responsible_role`（duty_code → 角色映射：BUYER_PRE_SALES_OWNER→pre_sales、BUYER_REFUND_OWNER→buyer_refund、SELLER_ACCOUNT_MANAGER→seller_ops）。
- `responsible_staff`（assigned_staff_id + display_name 联查）。
- `priority`（`OVERDUE`/`DUE_TODAY`/`NORMAL` 后端计算）。

### 3.2 工作台摘要端点

`GET /api/staff/me/work-items/summary`：`{ open_count, due_today_count, overdue_count, exception_order_count, refund_due_today_cny_fen: string|null, recent: StaffWorkItemDto[] }`。

- 前四项与 recent 对所有角色按其可见 work-item 集合计算；
- `refund_due_today_cny_fen` 仅 `owner` 与 `buyer_refund` 返回（其余角色 null），= 该员工可见范围内 `due` 日期为今日（Asia/Shanghai）的未结清返款义务 due 金额合计，后端整数求和；
- `exception_order_count` = 可见范围内 exception_state=OPEN 的正式订单数（复用 §1.3 SQL）。

### 3.3 前端

- `/staff/orders` 列表页：筛选栏（订单号前缀/买家编号/卖家组织/阶段/异常/负责人/日期范围，状态入 URL searchParams）、桌面表格 + 390px 紧凑卡片、空状态、错误恢复（retry）、"加载更多"游标翻页；点击行进入 `/staff/orders/:id`。导航"订单"从 upcoming 转正。
- 工作台：摘要指标卡 + 最近工作项（含 SLA 徽标），点击跳转；金额仅显示后端字符串格式化。
- 不创建旧"订单完整性"页面，不出现公共池/抢单/待认领/获客中心。

## 4. 产品主要对接人

- 后端已存在 `POST /api/staff/products/:id/primary-contact`（幂等+expected version+审计+transaction_assertion+org scope），本轮核对权限矩阵（owner/seller_ops + SELLER_MANAGE；卖家组织 scope 内）并保持不变。
- DTO 接线：员工 `catalog` 产品列表/详情 DTO 与卖家 `seller-portal` 产品列表/详情 DTO 增加 `primary_contact_member_id`/`primary_contact_member_name`（可空）；不新增端点（读取随产品 DTO，写入走既有端点）。
- 前端：员工产品列表列 + 详情卡显示对接人；owner/seller_ops 可在产品详情设置/转移/清除（复用既有端点，expected version + 幂等键 + reason）；卖家端产品页只读显示。
- 约束保持：一产品一个主要对接人（列存储天然唯一）；只可选本组织 ACTIVE 成员（后端已校验 409）；组织可见性不缩小（成员仍见组织内全部产品）；跨组织 concealed 404（既有 `requireCatalogOrganizationScope`）。

## 5. 买家分阶段对接人

### 5.1 公司公开客服渠道（新表，Migration 0032）

`company_public_service_channels`：`code TEXT PK CHECK(code IN ('BUYER_PRE_SALES','BUYER_AFTER_SALES'))`、`display_name TEXT NOT NULL`（默认 '售前客服'/'售后客服'）、`wechat_id TEXT NULL`（初始 NULL，不编造）、`qr_file_object_id TEXT NULL REFERENCES file_objects(id)`（初始 NULL）、`version INTEGER>=1`、`updated_by_staff_id TEXT NULL`、`updated_at INTEGER`。两行种子在 Migration 内插入（version=1，wechat/qr 全空）。

- 员工端点：`GET /api/staff/service-channels`（任意 ACTIVE staff 可读，供页面显示）；`PUT /api/staff/service-channels/:code`（仅 owner + `STAFF_MANAGE`；body: display_name/wechat_id/qr_file_object_id+expected_file_version（可空）/expected_version/reason；幂等键 + 请求哈希 + 审计事件 `SERVICE_CHANNEL_UPDATED`；expected_version 并发冲突 409）。qr 走既有受控文件链（purpose=`SERVICE_CHANNEL_QR`，visibility=`PUBLIC`——新增 purpose 枚举值随本批合同更新；未配置时买家端不显示二维码）。
- 买家端点：`GET /api/buyer-portal/service-channels`（登录买家可读两渠道公开字段：code/display_name/wechat_id/qr SafeFileReference|null；不含任何员工字段）。
- `GET /api/buyer-portal/me` 扩展：`pre_sales_owner_display_name: string|null`、`refund_owner_display_name: string|null`（仅公开显示名；无分配 → null）。
- 买家页面：预约/订单资料页显示售前负责人公开名 + `BUYER_PRE_SALES` 渠道卡；订单/评论/返款页显示售后负责人公开名 + `BUYER_AFTER_SALES` 渠道卡；渠道未配置（wechat 空）时显示"请联系工作人员"，绝不显示员工邮箱/ID/个人微信。
- 员工端新增 `/staff/service-channels` Owner-only 设置页（导航挂"系统设置"组）。

### 5.2 隐私边界

- Buyer DTO 不含 staff_id、email、权限、marketplace scope 等内部字段（合同 schema 负向测试断言拒绝）。
- Seller 与 Buyer DTO 隔离不因本批变化；渠道配置对 Seller 门户不暴露（Seller 不需要）。

## 6. 卖家结算批次

### 6.1 模型（Migration 0033，schema 33）

```sql
seller_settlement_batches (
  id TEXT PK, seller_organization_id NOT NULL REFERENCES seller_organizations(id),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
  frozen_total_cny_fen INTEGER NOT NULL DEFAULT 0,   -- 确认时冻结；DRAFT=0
  frozen_payable_count INTEGER NOT NULL DEFAULT 0,
  frozen_at INTEGER NULL, cancelled_at INTEGER NULL, cancel_reason TEXT NULL,
  version INTEGER NOT NULL CHECK(version>=1),
  created_by_staff_id NOT NULL REFERENCES staff_users(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
seller_settlement_batch_members (
  id TEXT PK, batch_id NOT NULL REFERENCES seller_settlement_batches(id),
  payable_id NOT NULL REFERENCES seller_payables(id),
  seller_organization_id NOT NULL,  -- 冗余防跨组织混批（触发器校验=批次组织）
  formal_order_id NOT NULL, amazon_order_number_normalized TEXT NOT NULL,
  payable_type TEXT NOT NULL, financial_snapshot_id TEXT NOT NULL,
  frozen_amount_cny_fen INTEGER NOT NULL,   -- 加入时冻结 payable 应付额
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  added_by_staff_id NOT NULL, added_at INTEGER NOT NULL,
  removed_at INTEGER NULL, removal_reason TEXT NULL,
  UNIQUE (payable_id, batch_id)
) STRICT;
CREATE UNIQUE INDEX uq_active_batch_payable
  ON seller_settlement_batch_members(payable_id) WHERE active=1;   -- 一个 payable 只进一个有效批次
seller_settlement_batch_events (
  id TEXT PK, batch_id NOT NULL, event_type TEXT CHECK IN
    ('BATCH_CREATED','MEMBER_ADDED','MEMBER_REMOVED','BATCH_CONFIRMED','BATCH_CANCELLED','BATCH_EXPORTED'),
  actor_staff_id NOT NULL, detail_json TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
```

- 触发器：member 插入校验 payable 组织=批次组织、payable 未结清且未入其他有效批次（双保险，唯一索引兜底并发）；DRAFT 之外禁增删成员；CONFIRMED/CANCELLED 之外禁确认/取消（状态机）。
- `PARTIALLY_PAID`/`PAID` 不落库，读取时由成员 payables 的实时 outstanding 权威计算（付款走既有账本，批次绝不复制付款事实）。对外 `status = stored_status ∈ {DRAFT, CANCELLED} ? stored : (成员应付全部结清 ? 'PAID' : 任一已付 ? 'PARTIALLY_PAID' : 'CONFIRMED')`。

### 6.2 员工端点（挂既有 `/api/staff/seller-settlements/:organizationId/` 前缀）

- `GET .../batches`（游标列表：status 筛选、轻量 DTO）；
- `POST .../batches`（建草稿；幂等键+请求哈希+审计；reason 可选）；
- `GET .../batches/:batchId`（详情：冻结汇总+成员分页+付款进度）；
- `POST .../batches/:batchId/members`（body: payable_ids[]；仅 DRAFT；expected_version；每成员冻结金额=当前 due 金额；幂等）；
- `POST .../batches/:batchId/members/:payableId/remove`（仅 DRAFT；reason；expected_version；幂等）；
- `POST .../batches/:batchId/confirm`（仅 DRAFT 且成员≥1；冻结 total/count/snapshots；expected_version；幂等；事务断言冻结值=成员合计）；
- `POST .../batches/:batchId/cancel`（DRAFT/CONFIRMED 可取消；reason 必填；expected_version；取消时成员全部 active=0 释放 payable；幂等）；
- `POST .../batches/:batchId/export`（生成 CSV；见 §6.4；审计 BATCH_EXPORTED；幂等重放返回同一次导出收据而非重复文件流）。

权限：`authorizeSellerSettlement` 既有模式——读 `SELLER_SETTLEMENT_VIEW`，写（建/增删/确认/取消/导出）`SELLER_SETTLEMENT_RECORD` + 组织 scope（Owner GLOBAL，seller_ops 限分配组织）；Personal DENY 优先；跨组织 concealed 404。

### 6.3 卖家端点

7.5R-2 追记：批次只读路由按冻结规则对全部四类 ACTIVE 卖家成员开放（OWNER/OPERATIONS/FINANCE/VIEWER 均可读本组织非草稿批次），结算摘要/应付/打款等财务端点仍限 OWNER/FINANCE；卖家门户不提供批次写端点，Staff 端权限不变。

原设计要点：

- `GET /api/seller-portal/settlement/batches`（本组织；仅 CONFIRMED/PARTIALLY_PAID/PAID，DRAFT/CANCELLED 不可见）；
- `GET /api/seller-portal/settlement/batches/:id`（同可见性；详情仅暴露卖家安全字段）。
- 卖家可见字段：batch 编号、状态、冻结总额/笔数、确认时间、每成员（订单号、类型、冻结金额、已付/未付进度）、导出禁止（Seller 无导出权限）。不含内部员工 ID、利润、买家返款、备注。

### 6.4 CSV 导出安全

7.5R-2 追记（真流式与两遍一致性）：导出为两阶段实现。第一阶段预检按 keyset 500 行/页枚举（due date 直接 JOIN 当前页查询），逐页编码并折叠进增量 SHA-256（`IncrementalSha256`），行/字节超限在发出任何字节前 409 `EXPORT_TOO_LARGE`，内存仅持当前页；第二阶段以 `ReadableStream` 的 `pull()` 背压按相同顺序逐页读取、逐页编码 enqueue（每次 pull 至多一页），全程不持有 chunk 数组、完整 merged buffer 或全批次成员数组。两遍读取一致性采用"导出事实冻结"方案：命令开始时冻结 `export_as_of`，两遍的付款/冲销事实均读 `created_at <= export_as_of`（付款 = allocations−reversals，未付 = 应付额−已付），`export_as_of` 写入收据、BATCH_EXPORTED 事件与审计 nextState；同键重放返回原始收据，客户端实收字节的 SHA-256 与 header/receipt 一致。不新增快照表（无需 Migration 0036）。

原设计要点：

- 白名单列：`amazon_order_number,payable_type,frozen_amount_cny_fen,paid_amount_cny_fen,outstanding_amount_cny_fen,confirmed_at(ISO),due_at(ISO)`；金额十进制字符串原样输出。
- 公式注入：单元格以 `=`,`+`,`-`,`@`,TAB,CR 开头时前缀 `'`（对全部字段统一处理，含订单号）。
- 文件名：`seller-settlement-batch-{batchId}.csv`（稳定，batchId 为服务端生成 UUID）。
- 限额：成员 > 5,000 行或预估 > 2 MiB → 409 `EXPORT_TOO_LARGE`（提示拆分批次）；实现上限校验在流式枚举中同步执行，超限即中断。
- 流式：`ReadableStream` 按页（500 行）从 D1 拉取成员并逐块 `TextEncoder` 输出；Worker 全程不持有全量成员数组；`Content-Type: text/csv; charset=utf-8`、`Content-Disposition: attachment`、`Cache-Control: no-store`。
- 幂等：导出以幂等键记录收据（行数、sha256、导出时间）；同键重放返回同收据 JSON 而非再次流文件（避免重复副作用歧义）；audit 事件只写一次。

### 6.5 并发与不变量

- 所有写操作：`Idempotency-Key` + 请求哈希（payload mismatch → 409）+ `expected_version`（不匹配 → 409 VERSION_CONFLICT）+ 状态机校验 + `transaction_assertions` 最终断言 + 审计事件（audit_events 与 batch_events 双写）。
- 确认后成员/金额不可静默变化：数据库触发器拒绝 DRAFT 之外的成员增删与 frozen 列 UPDATE；变更一律取消/重建批次（冲正语义）。
- 不回写 `seller_payables`/`seller_payments`/快照任何历史事实；批次只读引用。

## 7. 前端（第三批）

- 员工端：`/staff/finance` 卖家结算面板扩展"结算批次"区（组织维度下：列表、建草稿、选应付（未结清且未入有效批次）、确认/取消（带原因与版本冲突恢复）、导出按钮（流下载））；导航"卖家结算"从 upcoming 保持不动（入口在财务工作区，避免重复信息架构）。
- 卖家端：`/seller/settlements` 增"结算批次"只读列表+详情。
- 390px 移动端卡片式；Material 3 tokens 复用既有三端设计系统；无水平溢出。

## 8. 测试与验收（每批）

- 合同 schema 正向/负向（zod strict：多余字段/内部字段拒绝）；
- HTTP request-level（Hono app.fetch 直打：200/400/401/403/404/409 路径）；
- 权限矩阵 × 四角色 + Personal DENY + concealed 404；
- 幂等重放（同键同 body 重放、payload mismatch 409）、expected_version 并发冲突 409；
- DTO 隔离（Buyer 不见卖家批次/内部字段；Seller 不见利润/买家返款；负向 schema）；
- 审计事件断言（audit_events + 业务事件表）；
- Migration fresh replay（db:verify fresh/sequential + guards）；
- 前端组件（MSW/jsdom）+ Playwright 正常流程与失败恢复（列表翻页、筛选入 URL、负责人区块、联系人卡片、未配置渠道兜底、批次确认/取消/导出、CSV 转义）；
- 截图 1440/1280/390 + `assertNoUnexpectedErrorState` + `awaitAllImagesDecoded` 模式复用；
- 残留扫描：公共池/抢单/待认领/获客中心/双聊天截图入口/旧订单完整性页面零出现。

## 9. 被拒绝的替代方案

- **OFFSET 分页**：20k 单深翻页全表扫描，被 keyset 拒绝。
- **新建 `/api/staff/formal-orders/list` 端点**：与既有查单端点形成两个入口、两套参数合同；选择扩展现有端点并以"仅含 amazon_order_number"作为查单模式判别，兼容与单一入口兼得。
- **批次状态全部落库**：付款进度落库会复制账本事实并引入双写漂移；PARTIALLY_PAID/PAID 由既有付款事实实时权威计算。
- **负责人姓名进 Buyer 订单 DTO 逐单嵌入**：负责人是买家级固定分配而非订单级事实，随 `me` 一次投影 + 阶段由页面上下文决定，避免每单重复联查。
- **客服渠道复用员工记录**：会把员工身份/状态与公司公开渠道耦合（员工离职影响渠道）；独立配置表 + 空初值是唯一不编造数据的方案。
- **导出用 JSON/xlsx**：对账场景 CSV 足够且流式实现最简单；xlsx 引入依赖与内存风险。

## 10. 性能与容量

- 列表：20,000 历史订单 + 日增 200 的容量 suite（索引计划断言 + 翻页完整性 + 筛选组合）；责任人子查询走 `idx_buyer_staff_assignment_staff_status`（0028 已建）。
- 工作台摘要：计数走 work-item 既有索引 + 返款义务索引；recent 限 5 条。
- 批次导出：流式分页拉取；5,000 行/2 MiB 上限。
- 所有新查询在容量 suite 中以 `EXPLAIN QUERY PLAN` 断言无 `SCAN <表>` 全表扫描（带 WHERE 的覆盖索引扫描除外，按 SQLite 术语为 `SEARCH ... USING INDEX`）。
