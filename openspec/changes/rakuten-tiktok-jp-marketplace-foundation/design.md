# Design: Rakuten and TikTok Japan Marketplace Foundation

## Authority Model

`marketplace_registry` 是平台/站点/币种/adapter 状态的唯一可变权威；`seller_stores` 与 `seller_store_marketplaces` 是店铺隔离边界；Seller Organization 保持全局主体。`RAKUTEN_JP`、`TIKTOK_JP` 的 `status` 为 `ACTIVE` 仅表示可建模，`adapter_status` 为 `UNAVAILABLE` 表示真实 provider 尚未接入，任何需要 provider 的动作必须 fail closed。因旧 child FK 保留的 `marketplace_registry_legacy_0029` 只含 0029 的三行并由 INSERT/UPDATE/DELETE trigger 全冻结，不能参与新 registry 解析或新增事实。

订单和产品身份的权威键分别是 `(marketplace_code, platform_order_identifier)` 与 `(marketplace_code, platform_product_identifier)`。Amazon legacy `amazon_order_number_*`/`asin_*` 继续作为兼容投影，不得成为 Rakuten/TikTok 的输入字段。

## Contract and Adapter Boundary

Contract 提供 `MarketplaceCode`、平台中文 DTO、`PlatformIdentifierKind`、`PlatformIdentifierProfile` 和 importer 输入/输出。通用 validator 规范化 NFKC、去首尾空格并拒绝控制字符、空值与超长值；之后按平台选择 profile：

- Amazon：复用已有 Amazon order/ASIN validator。
- Rakuten：订单 profile 校验 `^[0-9]{6}-[0-9]{8}-[0-9]{10}$`；产品只要求平台中性 identifier。
- TikTok：订单默认使用通用 profile；历史 fixture 可显式选择 `TIKTOK_JP_HISTORICAL_585_18_DIGIT`，校验 `^585[0-9]{15}$`；产品使用通用 profile，允许 `tiktokDLP2555Q`。

Validator 只产生本地值对象和稳定错误，不调用 provider。当前唯一真实运行门禁是 registry 的 `adapter_status=UNAVAILABLE`；本 Change 不声明未被生产路径消费的伪 feature flag。独立 provider runtime flag 留给真实 adapter 接入 Change。

## Database and Transaction Boundary

0042 在 `marketplace_registry` 追加两行，并创建：

- `platform_product_identities`：平台产品身份、marketplace、display name、seller organization/store 可选绑定、status、source trace；同平台同标识唯一，跨平台同字符串允许并存。
- `platform_order_identities`：平台订单身份、marketplace、seller organization/store 可选绑定、产品身份可选引用、status、source trace；同平台同标识唯一，跨平台同字符串允许并存。
- `platform_identity_events`：不可变审计事件，禁止 UPDATE/DELETE。
- `platform_order_evidence_records`：非 Amazon 平台订单证据的不可变正式承载，只保存受控身份、scope、`ORDER_FACT`/`ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 证据类别与状态，不保存 R2 key 或永久 URL。
- `platform_formal_orders`：非 Amazon 正式订单的不可变正式承载，强制引用同 marketplace、同 organization/store 的订单身份、产品身份与已验证 `ORDER_FACT` 证据；不要求或伪造 legacy `formal_orders` 的 Amazon 订单号、ASIN、预约或产品行。
- `platform_order_evidence_internal_files`：平台正式订单专用、不可变、单槽位的聊天截图关联，强制同时引用同一订单/scope 的 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` evidence、verified image `file_object`、`EXPLICIT_AUDIENCES` file link 与当前 seller organization grant。现有 `file_entity_links` 的 `ORDER_EVIDENCE_SUBMISSION` entity type 继续表示订单证据实体，其 `entity_id` 对平台链指向该 communication evidence record；不增加 Purpose 或永久下载字段。

插入/更新 guard 必须验证 registry 行、organization/store 的一致归属和 marketplace 一致性。订单引用产品身份时采用 null-safe exact scope：scoped order 只能引用同 organization、同 store 的 scoped product；unscoped order 只能引用 unscoped product；scoped/unscoped 混搭与跨组织/跨店铺全部拒绝。`platform_formal_orders` 只允许 `RAKUTEN_JP`/`TIKTOK_JP`，并以同样 exact scope 绑定 evidence/order/product。Personal DENY 与 Staff/Seller 授权继续由现有 API scope 层执行，数据库不信任客户端 scope。该 Change 不创建真实组织、店铺、订单或文件行。

所有 Migration DDL 与 schema version 更新在一个事务内；最后写入 assertion 并要求 `schema_version=41`，重复或错序必须由既有 assertion guard 拒绝。

## API, UI and File Boundary

现有 registry resolver 返回中文平台名、JP/JPY 和 adapter 状态。Seller 正式订单 DTO 使用 `legacy_projection` discriminator：现有 Amazon 行为 `AMAZON` 且保留非空 `amazon_order_number`/`asin`/财务流程快照；非 Amazon 行为 `NONE`，上述 legacy 与尚未导入的财务/流程字段为 null，只返回权威 `canonical_marketplace_code`、`platform_*_identifier`、store/product name 和确认元数据。UI 对 null 显示“待后续导入”，不以 Amazon 文案或字段替代。中文 label 覆盖 Amazon、Rakuten、TikTok、Coupang，未知/不可用状态显示“未接入”，不提供第三方操作入口。

Buyer invitation 与 self-registration 使用共同的 `BUYER_SUPPORTED_MARKETPLACE_CODES`（本阶段仅 `AMAZON_JP`、`AMAZON_US`、`COUPANG_KR`）。Staff 路由和 service 在任何 token/idempotency 或业务写入前拒绝 Rakuten/TikTok，返回受控 400；不迁移 invitation FK，也不制造不可兑换邀请。

订单证据仍使用 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION` 与短 read intent；任何 read response 只返回受控版本/intent 元数据，不返回 object key、永久 URL。Staff attach 先解析 legacy/platform 正式订单，再对两类目标执行 `ORDER_CONFIRM`、当前 Staff data scope、活动组织/店铺、verified image、显式 seller audience 和幂等校验；平台目标在同一事务创建 communication evidence、file link/grant 和专用附件关联。Seller 列表根据当前有效 file/link/grant 动态投影 `AVAILABLE + file_version`，否则 `NONE`。Seller read intent 对两类附件复用同一路由和单次短 token，并在创建与消费时重新检查活动账号/成员/组织/店铺、OWNER 或当前 store scope、link/grant/file 状态；Personal、跨组织/跨店铺及任何撤销均防枚举拒绝。Seller 懒加载控件不变。

`listSellerFormalOrders` 对 legacy/platform 两个来源使用同一个全局排序键 `(confirmed_at DESC, formal_order_id DESC)`。每个来源都应用相同 keyset cursor 并最多取 `limit + 1`，合并排序后只截取一页；next cursor 取本页最后一行。混合时间戳和相同时间戳场景必须证明连续翻页不丢失、不重复。

## Verification and Rollback

本地测试覆盖 fresh/upgrade/duplicate/错序事务回滚、Amazon 回归、Rakuten/TikTok 标识、跨平台同标识、seller org/store exact-scope、非 Amazon 正式订单 DTO/read-model、平台截图 attach→AVAILABLE→短 read intent、跨组织/跨店铺/Personal DENY 与 member/store/link/grant/file 动态撤销、无截图、legacy/platform 混合分页、Buyer invitation 受控拒绝、validator profile/control-character 边界、legacy registry 不可变、中文 runtime/UI contract、adapter unavailable 和 evidence privacy。禁止调用 Cloudflare/R2/真实 provider。

Rejected alternatives:

- 不为 Rakuten/TikTok 复制 Amazon 表或把标识写入 `amazon_*`/`asin_*`，避免平台语义和碰撞错误。
- 不把 TikTok 的 585 历史样本写成全局未来格式约束，避免无证据拒绝未来订单。
- 不在 Migration 中创建 Philips/卖家组织生产数据，避免“fixture 等于生产事实”。
