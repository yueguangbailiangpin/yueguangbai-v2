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

- [x] 2.1 `0032_stage75_public_service_channels.sql`：`company_public_service_channels` 表 + 两行空种子；schema_version→32；锚点与守卫更新

### Contracts

- [x] 2.2 `CompanyServiceChannelDto`（公开字段）、`SetCompanyServiceChannelRequest`；产品 DTO（员工 catalog + seller-portal）增加主要对接人字段；buyer-portal/me 扩展两个公开负责人名；qr 文件 purpose 枚举扩展

### API

- [x] 2.3 核对既有 primary-contact 端点权限/幂等/审计（补缺测试，不改稳定合同）
- [x] 2.4 员工产品列表/详情、卖家产品列表/详情 read model 联查主要对接人
- [x] 2.5 `GET /api/staff/service-channels`、`PUT /api/staff/service-channels/:code`（Owner-only，幂等+expected_version+审计）
- [x] 2.6 `GET /api/buyer-portal/service-channels`（公开字段）；`GET /api/buyer-portal/me` 负责人公开名扩展（7.5R 经受控文件链修复后由 7.5R-2 收口验证：渠道 QR 走 SERVICE_CHANNEL_QR purpose/受控上传/受众校验/read-intent，Buyer DTO 只返回 `SafeFileReferenceDto|null`，绝无裸内部文件 ID；`shared-runtime-schema.test.ts` 以共享 strict schema 解析真实 HTTP 响应并断言 DTO 无内部字段；Buyer me 负责人公开名由 `service-channels.test.ts` 请求级覆盖）

### Tests（第二批专项）

- [x] 2.7 合同正负向（Buyer DTO 拒绝 staff_id/email/权限等内部字段）
- [x] 2.8 HTTP：渠道读写权限矩阵（非 owner 403、owner 更新/version 冲突 409/幂等重放/payload mismatch）
- [x] 2.9 对接人只能选本组织 ACTIVE 成员（跨组织/非 ACTIVE 409）；跨组织 concealed 404；组织可见性不缩小
- [x] 2.10 未配置渠道时买家端兜底文案且无任何员工内部信息泄露（负向断言）
- [x] 2.11 Migration 31→32 replay + 锚点

### Web（第二批）

- [x] 2.12 员工产品列表/详情显示+管理主要对接人（设置/转移/清除，expected version + reason + 幂等）
- [x] 2.13 卖家端产品页只读对接人
- [x] 2.14 买家预约/订单资料/订单/评论/返款页阶段化联系卡片（负责人公开名+渠道；未配置兜底）（7.5R 统一 `StageContactCard` + 权威 `STAGE_FOR_ROUTE` 后由 7.5R-2 收口验证：真实映射为售前 6 页（预约列表/详情、订单资料列表/填写/详情、下单指引）+ 售后 7 页（正式订单列表/详情、评论列表/填写/详情、返款列表/详情）共 13 页全部经权威映射，无页面本地判定；`StageContactCard.stage.source.test.ts` 源码守卫逐文件断言 13 页）
- [x] 2.15 员工 `/staff/service-channels` Owner-only 设置页（导航"系统设置"组）
- [x] 2.16 前端组件测试 + Playwright 正常/失败恢复流 + 1440/1280/390 截图（7.5R-2 收口：真实 API 响应 → 前端共享 strict schema 的合同测试 `shared-runtime-schema.test.ts`（真实 D1 + 真实 Hono 路由 + 真实会话 + 真实 HTTP，四角色矩阵 + 受控 QR 渠道 + 正负向字段断言）；QR 图片真实解码与无错误态冒充由 Playwright 断言覆盖）
- [x] 2.17 全量门禁 + 独立提交

## 3. 第三批：卖家结算批次（提交 `feat(settlements): add immutable seller settlement batches`）

### Migration

- [x] 3.1 `0033_stage75_seller_settlement_batches.sql`：批次三表 + `uq_active_batch_payable` 部分唯一索引 + 状态机/组织一致性/冻结列防改触发器；schema_version→33；锚点与守卫更新

### Contracts

- [x] 3.2 `SellerSettlementBatchDto`（员工/卖家两投影）、列表 DTO、成员 DTO、请求类型（建/增删/确认/取消）、`EXPORT_TOO_LARGE` 错误码；strict 正负向

### Domain/API

- [x] 3.3 批次命令层：创建/增成员/移除/确认（冻结）/取消（释放）/导出，全部幂等+请求哈希+expected_version+状态机+transaction_assertions+审计（audit_events + batch_events 双写）
- [x] 3.4 批次 read model：状态权威计算（PARTIALLY_PAID/PAID 实时推导）、组织 scope concealed 404
- [x] 3.5 员工 8 路由（list/create/detail/members add/remove/confirm/cancel/export）挂 `/api/staff/seller-settlements/:organizationId/`
- [x] 3.6 卖家 2 路由（只读、DRAFT/CANCELLED 不可见、卖家安全字段）
- [x] 3.7 CSV 流式导出：白名单列、公式注入转义、稳定文件名、5,000 行/2 MiB 上限、流式分页拉取、导出幂等收据（7.5R-2 真流式 + 7.5R-3/4 并发一致性 + 7.5R-5 数据库保留标记最终收口：`removal_reason='BATCH_CANCELLED'` 由 Migration 0036 触发器 `trg_settlement_member_cancelled_reason_reserved` 强制为保留标记——仅父批次 CANCELLED 且 `batch.cancelled_at = NEW.removed_at` 的取消释放路径可写，DRAFT 人工撞串被数据库拒绝、普通人工原因不受影响；7.5R-4 的成员冻结条件与 command.now 排他付款边界由此获得数据库级保证；负向/同毫秒正反用例与三方 SHA 断言齐备）

### Tests（第三批专项）

- [x] 3.8 同一 payable 不能进入两个有效批次（唯一索引 + 并发双插断言）
- [x] 3.9 确认后成员/金额不可静默修改（触发器拒绝 + 负向 SQL 测试）；取消释放后可再入新批次
- [x] 3.10 幂等重放、payload mismatch、expected_version 冲突、状态机非法迁移
- [x] 3.11 权限矩阵（Owner 全局/seller_ops 限分配组织/Seller 门户只读本组织/Buyer 完全不可见 404）
- [x] 3.12 CSV 公式注入（=,+,-,@,TAB,CR 前缀）转义、限额 409、Seller 视图无利润/买家/内部 ID/对象 key
- [x] 3.13 Migration 32→33 replay + 锚点

### Web（第三批）

- [x] 3.14 员工财务工作区"结算批次"面板：列表/建草稿/选应付/确认/取消/导出（390 可用）
- [x] 3.15 卖家端 `/seller/settlements` 批次只读列表+详情（7.5R 专用安全 DTO+SQL 内过滤后由 7.5R-2 收口：`requireSellerActor` 按 OpenSpec 冻结规则放开为四类 ACTIVE 成员（OWNER/OPERATIONS/FINANCE/VIEWER）只读，写端点仍不存在、Staff 端不变；前端新增 `/seller/settlements/:batchId` 详情页（批次概况+成员明细走 `members_next_cursor` 真实分页、loading/空态/错误恢复/加载更多、concealed 404 安全态、非财务角色批次专用页），列表行加"查看详情"入口；组件测试 5 例 + Playwright 3 例（1440/390、250 成员两页无重漏、失败重试、越权 404、四角色）覆盖）
- [x] 3.16 前端组件测试 + Playwright 正常/失败恢复流 + 1440/1280/390 截图
- [x] 3.17 全量门禁 + 独立提交

## 4. 收口

- [x] 4.1 `V2_API_ROUTE_INVENTORY.md`、`V2_PERMISSION_MATRIX.md`、`docs/CURRENT_SYSTEM_STATE.md`、Decision Register（必要时新增 Decision）同步
- [x] 4.2 新建 `docs/migration/V2_STAGE75_OPERATIONAL_COMPLETENESS_HANDOFF.md`（六项完成情况/新路由/Migration/权限矩阵/容量结果/截图路径/未完成与 NOT_RUN/非 GO 声明）
- [x] 4.3 全仓残留扫描（公共池/抢单/待认领/获客中心/双聊天截图入口/旧订单完整性页面）
- [x] 4.4 本地 D1 `0001`→最新空库完整重放 + `PRAGMA integrity_check` + `PRAGMA foreign_key_check`
- [x] 4.5 全部验证命令真实退出码记录；OpenSpec tasks 全部真实完成；不归档任何 Change（7.5R-5 收口重跑：专项测试（75r 22 用例）/npm test(1,786)/typecheck/check/db:verify（schema 36，inventory SHA 3e5b4599…）/migration guards/OpenSpec validate --strict 单+全/结算容量/既定 Playwright 终门（180 用例，179 过 1 skip 预存在，0 败）/git diff --check 全部真实执行且退出码 0；并更正 7.5R-2/3/4 交接中 Playwright 退出码被管道 tail 掩盖的历史记录（见交接文档 §13）；无归档、未进入阶段 8）

## 5. 阶段 7.5R 真实性修复（2026-08-29 重开）

- [x] 5.1 统一 `StageContactCard` 组件与阶段映射接入全部售前页面（预约列表/详情、订单资料列表/填写、指引或资料详情）与售后页面（正式订单列表/详情、评论列表/填写/详情、返款列表/详情）——13 页全部经权威 `STAGE_FOR_ROUTE`（`RouteFamily` 联合类型）；源码守卫测试 `StageContactCard.stage.source.test.ts` 禁止页面本地判定阶段或传字面量。
- [x] 5.2 二维码受控文件链：`SERVICE_CHANNEL_QR` purpose（Migration 0034 如需）+ Owner 正常上传流 + purpose/visibility/受众/归属校验 + Buyer DTO 返回 `SafeFileReferenceDto|null` + read-intent + 前端真实渲染 + 无二维码文字兜底——Migration 0034（schema 34）；`POST /api/staff/service-channels/:code/qr` 全链校验（VERIFIED/purpose/visibility/版本/未绑他对象，清除 revoke）；Owner 上传改 intents→content→complete→attach 受控流；买家动态公开窗口由 `file-audience-grants.test.ts` 请求级覆盖（任意 ACTIVE 买家可读、卖家拒绝）；渲染与兜底由 e2e 覆盖；顺带修复 attach 幂等重放返回 null 渠道的缺陷。
- [x] 5.3 结算导出全量化：keyset 全量读取（禁 OFFSET），详情 `members_next_cursor` 真实分页——201 成员完整导出、250 成员两页走完、5000 成员容量验证（整页倍数边界）、5001 稳定 409；500/1000 与上述同一 keyset 路径（5000 已覆盖整页边界与翻页循环）
- [x] 5.4 结算导出流式：ReadableStream 分页边读边编码（500 行/页枚举，成员数组不整持）；行数与字节上限在枚举中同步执行，超限在任何字节发出前 409 `EXPORT_TOO_LARGE`（真实 5001 用例 + 注入字节上限用例 + 容量验证 5000 含 2 MiB 断言）（7.5R-5 随 3.7 重新验证：保留标记入库后流式架构、惰性逐页拉取与内存边界不变）
- [x] 5.5 结算导出幂等：Idempotency-Key+请求哈希（绑批次/格式/expected_version）；首次流文件并记收据（X-Export-Row-Count/X-Export-Sha256），重放返回同一 receipt JSON；BATCH_EXPORTED 业务事件与 audit_events 各仅一次；mismatch 稳定 409；导出后取消 fail-closed（409）；跨组织导出 concealed 404（旧实现未校验批次归属，已堵）（7.5R-5 收口：receipt 绑定的冻结成员集合经 0036 获得数据库级保证；同毫秒人工移除排除/取消释放包含、三方 SHA 一致重验通过）
- [x] 5.6 卖家专用安全 DTO（contracts/后端/前端 strict 三方同一合同，无 passthrough；请求级测试断言 DTO 键集精确=7/5 字段且无内部 ID）+ SQL 内先过滤（stored CONFIRMED）再 keyset 分页（DRAFT/CANCELLED concealed 404）+ 前端游标加载（首页+追加页累积）
- [x] 5.7 `npm run check` 真实 exit 0——采用比 fixture 构造更直接的方案：删除 `stage75-contacts.spec.ts` 中未使用的 `SESSION_SECRET` 死字面量，`node scripts/scan-secrets.mjs` 真实退出码 0；各步真实退出码见交接文档 7.5R 追记
- [x] 5.8 真实请求级合同测试：`settlement-batches-75r.test.ts`（8 用例：分页/卖家 DTO+conceal/导出完整+重放+mismatch+版本/两档上限/取消后 fail-closed）、`service-channels.test.ts` 重写（9 用例：DTO/QR SafeFileReference/未配置兜底/非 Owner 403/错误 purpose/未验证/错误 visibility/外绑文件/清除 revoke/幂等）、`file-audience-grants.test.ts` 增买家 QR 动态窗口、`StageContactCard.stage.source.test.ts` 全部页面阶段选择、`settlement-export.capacity.verify.ts` 容量（入 check 链）——前端 strict schema 与后端同形（卖家 DTO 键集断言双向一致）

## 6. 阶段 7.5R-2 最终真实性修复（2026-08-29 第二次重开，收口说明，无新增任务项）

ChatGPT 总审确认五项剩余缺陷后重开。修复不新增任务（上方 2.6/2.14/2.16/3.7/3.15/4.5 已就地勾选并写明真实完成方式），本节仅为可追溯说明：

1. 真流式导出：`enumerateCsvChunks`（全量 dueMap + chunks 数组 + merged 完整副本算 SHA）重写为两阶段 `preflightExport`/`exportCsvStream`——预检与发送同 keyset 顺序、同 `export_as_of`、增量 SHA；路由改为 `createStream()` 惰性 pull 流。一致性采用方案 A（as-of 事实冻结，无新增 Migration），未引入 0036。
2. 卖家角色矩阵：批次路由 `requireSellerActor` 移除 OWNER/FINANCE 限制，四类 ACTIVE 成员只读（`shared-runtime-schema.test.ts` 真实 HTTP 矩阵断言 200/200；跨组织 concealed 404、DISABLED 401）。
3. 共享 strict runtime schema：`packages/contracts/src/runtime-schemas.ts`（zod 4.4.3，`satisfies z.ZodType<Dto>` 钉死同形）——卖家批次四 schema、买家渠道公开 schema、SafeFileReference schema；后端合同测试与前端列表/详情页引用同一对象，买家运行时与文件读取控制器改为 re-export（同名 schema 不再重复定义）；无 passthrough。
4. 卖家批次详情闭环：`SellerBatchDetailSection` + `/seller/settlements/:batchId` 路由（App.tsx 两处路由表注册）+ 列表"查看详情"入口 + OPERATIONS/VIEWER 批次专用页（财务区仍 owner/finance 专属）；Playwright `stage75r2-seller-batch-detail.spec.ts` 3 用例。
5. 收口验证：`shared-runtime-schema.test.ts`（真实 D1/路由/会话/HTTP → 共享 strict schema + 正负向 + 流式源码守卫）与 `settlement-export.capacity.verify.ts`（5000 满配额 + 客户端实收字节 SHA==header）真实运行通过；全部退出码见交接文档 7.5R-2 追记。

## 7. 阶段 7.5R-3 并发一致性收口说明（2026-08-29 第三次重开，无新增任务项）

ChatGPT 总审确认 7.5R-2 两遍一致性仍有并发缺口后重开 3.7/5.4/5.5/4.5（起点 `3b0c943c`）。修复不新增任务（四项已就地重新勾选），本节仅为可追溯说明：

1. 成员快照：导出 SQL 从 `member.active=1` 改为确认时冻结快照条件（`added_at <= batch.frozen_at` 且 `removed_at` 为空或大于 `frozen_at`），导出后取消批次不再改变第二遍读取的成员集合；确认/取消业务行为与触发器不变。
2. 付款水位：`export_as_of` 由"命令时刻、非排他"改为"该批次冻结成员上付款事实最大 created_at+1、排他"，allocation 与 reversal 同时覆盖；同毫秒写入测试（created_at == export_as_of 的付款+冲销）与空水位用例补齐。
3. 真实回归：Response 后取消仍可完整读取（含 1000 行读取第一页后取消）、fail-closed 测试真实消费首次正文——见 `settlement-batches-75r.test.ts`（18 用例）与交接文档 §11。全部退出码重跑记录于交接文档 §11。

## 8. 阶段 7.5R-4 同毫秒竞态收口说明（2026-08-29 第四次重开，无新增任务项）

ChatGPT 总审确认 7.5R-3 仍有两处同毫秒竞态后重开 3.7/5.4/5.5/4.5（起点 `f4b9dc44`）。修复不新增任务（四项已就地重新勾选）：

1. 付款边界：删除 `readPaymentFactWatermark` MAX 查询，`export_as_of` = command.now（排他），同毫秒事实归下一次导出；预置 AT-1 付款 + 预检后 AT 付款/冲销的真实用例验证第二遍不可见、三方 SHA 一致。
2. 成员快照：`removal_reason='BATCH_CANCELLED' AND removed_at >= frozen_at` 分支（0033 触发器强制的系统保留标记）使确认与取消同毫秒时取消释放的成员仍属冻结集合；命令层 confirm(AT)→导出→cancel(AT) 用例断言 removed_at===frozen_at 且原导出流无重漏、三方 SHA 一致。
3. 全部门禁重跑全 0（1,783 测试 / 14 spec Playwright 175 过 / 容量 / git diff --check），记录于交接文档 §12。

## 9. 阶段 7.5R-5 数据库保留标记收口说明（2026-08-29 第五次重开，无新增任务项）

ChatGPT 总审确认 7.5R-4 的 `BATCH_CANCELLED` 判据尚无数据库强制后重开 3.7/5.4/5.5/4.5（起点 `f8d5700b`）。修复不新增任务（四项已就地重新勾选）：

1. Migration 0036（schema 36，只追加）：触发器 `trg_settlement_member_cancelled_reason_reserved` 禁止任何非取消释放路径写入 `removal_reason='BATCH_CANCELLED'`；锚点全清单同步（inventory SHA 重锚、TARGET_SCHEMA×3、baseline 0001-0036、16 个模块链长断言、marketplace-registry、final-go 合同/Runbook/验收文档迁移链声明、backup/bootstrap fixture）。
2. 负向/正向同毫秒用例三件（DRAFT 撞串 SQL+命令双拒、人工移除同毫秒确认排除、确认取消同毫秒经触发器释放仍完整）+ 三方 SHA 断言。
3. 更正：7.5R-2/3/4 终门退出码曾被 `| tail; echo $?` 方式误取（实为 tail 的退出码），stage7a1 4 用例自 08bb223a 起因未定义 `ok` helper 一直失败；本轮补齐该 helper（不改断言）后终门 180 用例真实全绿。全部退出码自此取自命令本身，见交接文档 §13。
