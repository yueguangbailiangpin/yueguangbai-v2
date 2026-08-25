# 新 Baseline 历史订单字段级映射覆盖清单（阶段 3 交付）

日期：2026-08-25。基线：`migrations/0001`–`0019`（stage 3 clean baseline，schema_version=19）。
依据：D-054（新 baseline 必须证明可无损导入约 20,000 真实历史订单）、《历史订单数据要求》30 列契约、《历史订单导入闭环设计》、`docs/migration/V2_BACKEND_REBUILD_INVENTORY.md` §1.4。

本清单证明：30 列来源契约的每一列在新 baseline 形状中都有明确归宿与规则（覆盖、派生或 HOLD），不存在无处安放的字段。行数守恒与抽样核对证据属阶段 6 dry-run 交付（`npm run dry-run:historical-order-migration` 在新 baseline 上重建后执行）。

## 0. 承载模型结论

1. **活模型不可直入**：`formal_orders` 强制携带现行业务链（`order_evidence_submission_id`、`order_evidence_version_id`、`reservation_id`、`demand_batch_id`、`product_version_id` 均为 NOT NULL，且 `amazon_order_number_normalized` 有 19 位 Amazon 形状 CHECK）。历史表格行没有这条链，强行写入必然违反 NOT NULL/CHECK 或要求伪造事实——两者都违反"财务事实不可伪造"。
2. **历史导入事实表模型**（阶段 6 以 baseline 之上的前向 Migration 新增）：`historical_import_batches`（source_hash、批次标记、checkpoint、幂等）+ `historical_orders`（30 列来源快照，全部按原值保存）+ `historical_order_media_plans`（图片列登记）+ `historical_import_quarantine_rows`（HOLD 行与原因）。模式沿用已在 baseline 中的 0040 卖家总表导入模型（`seller_partner_import_batches` / `seller_partner_import_source_records`）。
3. **活模型列对齐已存在**：派生/晋升所需的全部目标列在 baseline 中就位——`formal_orders.amazon_order_date`、`formal_order_financial_snapshots`（整数金额/汇率列）、`formal_order_marketplace_money_snapshots`、`buyer_refund_payment_entries`（0075 收款账户/渠道列）、`seller_payments`/`seller_payment_proofs`。晋升（把历史行链接为正式订单事实）是独立人工决策（设计文档 §9.2 开放决策），默认只保存来源快照。
4. **Marketplace 路由**：阶段 2e/3 已删除 Rakuten/TikTok 平台模型与 registry 行。订单号匹配 Amazon 形状（`^\d{3}-\d{7}-\d{7}$`）→ 可导入集；匹配 Rakuten/TikTok 形状 → 行级 blocker 进 quarantine（与设计文档 §4 一致，结构上由 registry 缺失保证 fail-closed）。

## 1. 30 列 → baseline 字段映射

| # | 来源列 | 归宿（阶段 6 事实表列） | baseline 对齐列/约束 | 规则 |
|---|---|---|---|---|
| 1 | 下单日期 | `historical_orders.ordered_on`（DATE 原文） | `formal_orders.amazon_order_date`（TEXT，`date()=` 自校验，来源守卫触发器绑定证据日期） | 覆盖；UTC 毫秒与 Asia/Shanghai 业务日仅派生显示，不落库 |
| 2 | 更新状态 | `historical_orders.status_snapshot_raw` | —（快照不进活模型） | 覆盖；原值保留，推断规则（2026-01-01 前视为已返款）只作展示 |
| 3 | 客户编号 | `historical_orders.buyer_customer_no_ref` | `buyer_customers.buyer_customer_no`（唯一） | 覆盖；解析归属，失败 → HOLD |
| 4 | 买家微信 | `historical_orders.buyer_wechat_ref`（脱敏） | `wechat_identity_claims.normalized_wechat` | 覆盖；只作归属辅助，不自动建客户 |
| 5 | 店铺名字 | `historical_orders.store_name_ref` | `seller_stores.normalized_name` / `display_name` | 覆盖；唯一归属当前 Seller Organization，多/零匹配 → HOLD |
| 6 | ASIN | `historical_orders.platform_product_identifier` | `standard_products.asin_normalized` / `products.asin_normalized`（10 位 CHECK） | 覆盖；非 10 位标识（Rakuten/TikTok 商品号）随行 blocker |
| 7 | 订单价格 | `historical_orders.order_amount_source_minor`（INTEGER） | `formal_orders.final_paid_jpy`（INTEGER，0..2^53-1） | 覆盖；JPY 整数日元快照，禁推算 |
| 8 | 聊天截图 | `historical_order_media_plans`（purpose=ORDER_EVIDENCE_INTERNAL_COMMUNICATION 计划行） | `file_objects.purpose` 枚举已含该值；媒体字节导入属独立 Change | 登记覆盖；不读内容 |
| 9 | 订单截图 | 同上（purpose=ORDER_EVIDENCE） | `file_entity_links.purpose` 枚举已含 | 登记覆盖 |
| 10 | 订单号 | `historical_orders.platform_order_number_raw` + `_normalized` | `formal_orders.amazon_order_number_normalized`（19 位形状 CHECK；`formal_order_number_claims` 活跃唯一索引，`formal_order_number_conflicts` 历史冲突表） | 覆盖；形状路由 Amazon/其余 → quarantine；跨卖家冲突拒绝 |
| 11 | 到货图 | 忽略列（契约声明永久忽略） | — | 明确忽略，计入预览报告 |
| 12 | 提交评论日期 | `historical_orders.review_submitted_on` | `review_evidence_versions` 日期语义 | 覆盖；可空 |
| 13 | 通过日期 | `historical_orders.review_approved_on` | `review_cases`/`review_events` 审核事实 | 覆盖；可空 |
| 14 | 评论通过截图 | `historical_order_media_plans`（purpose=REVIEW_EVIDENCE 计划行） | `file_objects.purpose` 枚举已含 REVIEW_EVIDENCE | 登记覆盖 |
| 15 | 补fb日期 | `historical_orders.replenishment_submitted_on` | —（快照） | 覆盖；可空 |
| 16 | 补fb截图 | `historical_order_media_plans` | — | 登记覆盖 |
| 17 | 评论状态 | `historical_orders.review_status_raw` | `review_cases` 状态机（活模型语义，不回写） | 覆盖；原值保留 |
| 18 | 订单详情 | `historical_orders.order_detail_note` | — | 覆盖；自由文本长度上限与来源一致 |
| 19 | 评论链接 | `historical_orders.review_url_raw` | `review_evidence_versions.review_url`（https 校验守卫触发器） | 覆盖；导入时不校验活模型守卫（快照），晋升时校验 |
| 20 | 返款状态 | `historical_orders.refund_status_raw` | `buyer_refund_ledger_balances` 视图（状态由账本推导，禁止持久化 status） | 覆盖；仅快照，不生成账本行 |
| 21 | 返款汇率 | `historical_orders.buyer_rate_source`（INTEGER 比例） | `buyer_daily_currency_rate_versions.rate_value/rate_scale`（INTEGER/INTEGER） | 覆盖；快照，不写入汇率中心 |
| 22 | 返款时间 | `historical_orders.refunded_on` | `buyer_refund_payment_entries` 时间列 | 覆盖；可空 |
| 23 | 返款截图 | `historical_order_media_plans`（purpose=BUYER_REFUND_PROOF） | `file_objects.purpose` 枚举已含 BUYER_REFUND_PROOF | 登记覆盖 |
| 24 | 服务费金额 | `historical_orders.service_fee_source_minor` | `formal_order_financial_snapshots.service_fee_cny_fen`（INTEGER） | 覆盖；CNY 整数分快照，禁推算 |
| 25 | 卖家返金汇率 | `historical_orders.seller_rate_source`（INTEGER，E8 比例） | `seller_principal_rate_snapshots.final_rate_value/scale`（INTEGER） | 覆盖；快照，不建立汇率版本 |
| 26 | 结算日期 | `historical_orders.settled_on` | `seller_payments` 支付事实时间 | 覆盖；可空 |
| 27 | 买家返金金额 | `historical_orders.buyer_refund_amount_source_minor` | `buyer_refund_payment_entries.amount_cny_fen`（INTEGER，append-only 触发器） | 覆盖；快照，不产生账本分录 |
| 28 | 卖家返金金额 | `historical_orders.seller_principal_amount_source_minor` | `seller_payables`（amount，append-only + 双唯一约束） | 覆盖；同上 |
| 29 | 汇率差 | `historical_orders.rate_spread_source`（INTEGER） | 由买卖两侧快照派生核对，不落活模型 | 覆盖；导入时校验 = 买-卖（不匹配 → HOLD），保存原值 |
| 30 | 利润 | `historical_orders.profit_source_minor` | 活模型禁止持久化利润（`formal_orders`/快照无 profit 列，Phase 3F 禁字段；利润只由内部财务视图推导） | 覆盖；仅快照 + 预览摘要，永不进活模型 |

## 2. 批次/幂等/审计基础设施（baseline 已就位部分）

| 能力 | baseline 对象 | 状态 |
|---|---|---|
| 幂等 | `command_idempotency_records`（actor+key+action+request_hash，lease） | 已存在 |
| 审计 | `audit_events`（no_update/no_delete 触发器） | 已存在 |
| Outbox | `integration_outbox`（dedup_key 唯一） | 已存在 |
| 事务断言 | `transaction_assertions` + guard/cleanup 触发器 | 已存在 |
| 导入批次模式 | `seller_partner_import_batches` / `seller_partner_import_source_records`（0040 模型） | 已存在（订单侧同构表阶段 6 新增） |
| 图片用途枚举 | `file_upload_intents`/`file_objects`/`file_entity_links` purpose 枚举 | 已存在（含全部四类订单证据用途） |
| 订单号认领/冲突 | `formal_order_number_claims`（活跃唯一）+ `formal_order_number_conflicts` | 已存在 |

## 3. 覆盖结论

- 30/30 列全部有归宿：27 列进历史事实表快照（其中 8 列图片类为登记计划、1 列明确忽略、18 列数据快照），无任何列被静默丢弃。
- 财务列（7/21/24/25/27/28/29/30）全部按"来源快照 + 整数 + 禁推算"处理，与 D-011/D-016 整数金额约束和 Phase 3F 禁字段约束一致。
- 结构性 fail-closed：Rakuten/TikTok 订单号与商品标识因 registry 与平台模型退役自动进 quarantine，待未来独立 OpenSpec Change 重新引入 marketplace 后放行。
- 阶段 6 在此清单之上重建 dry-run 工具并输出行数守恒（来源行 = 导入行 + quarantine 行 + 忽略登记行）与抽样核对证据；本清单本身即"schema 形状可承载"的字段级证明。
