# Rakuten and TikTok Japan Marketplace Foundation

## Why

月光白 V2 当前 canonical marketplace registry 只有 `AMAZON_JP`、`AMAZON_US` 和禁用的 `COUPANG_KR`。后续乐天与 TikTok 日本站的历史订单、产品和聊天证据没有正式的平台、店铺、产品身份与权限承载，若继续复用 Amazon 订单号或 ASIN，会把平台事实混淆并产生跨平台碰撞风险。

## What Changes

- 注册 `RAKUTEN_JP` 与 `TIKTOK_JP`，均为 JP/JPY、中文显示，并保持 provider adapter 初始不可用。
- 增加平台中性的订单/产品身份合同与 fail-closed validator：Amazon 继续使用现有规则；Rakuten 接受 `6位店铺号-8位日期-10位流水号`；TikTok 只对已确认历史 585 开头 18 位订单提供可选历史 profile，不把该 profile 变成未来通用格式限制；TikTok 产品 `tiktokDLP2555Q` 作为普通平台产品标识处理。
- 通过 `(marketplace_code, platform_*_identifier)` 的正式唯一边界承载订单、证据与产品身份；为无法进入 Amazon-only `formal_orders`/`order_evidence_versions` 的非 Amazon 事实建立不可变的 `platform_formal_orders` 与 `platform_order_evidence_records` 正式承载，并由 Seller API 以 nullable Amazon legacy projection 诚实展示。
- Buyer invitation/registration 本阶段只支持既有 Amazon/Coupang 白名单；Rakuten/TikTok 邀请在 Contract、路由和 service 三层受控拒绝且零部分写入。
- 提供后续 importer 可复用的本地 contract/validator；本 Change 不读取或导入真实 Excel，不提取图片，不写 D1/R2。
- 保持 `ORDER_EVIDENCE_INTERNAL_COMMUNICATION`、短 read intent、Seller 懒加载和 Personal DENY/权限撤销约束；为平台正式订单增加受控的 communication evidence/file/link/grant 关联，使 Staff attach、Seller 列表状态与短读链同时支持 legacy/platform 两类订单，但不暴露 object key 或永久 URL。

## Non-Goals

- 不接入 Rakuten/TikTok 真实 provider、API、账号、OAuth、webhook、域名或第三方资源。
- 不导入 Philips 店铺或 `ygbceping:ls381048211` 的真实生产 seller/store 数据；该组织键仅作为 validator/fixture 语义。
- 不重写历史 Amazon 订单、ASIN、金额或证据，不改变 Amazon 既有业务行为。
- 不执行生产 Migration、部署、提交、推送、PR、合并或任何外部资源写入。

## Migration and Rollback

需要连续 Migration `0042_rakuten_tiktok_jp_marketplace_foundation.sql`，前置基线为已核验的 `origin/main=904c154b...` 与 `0041_seller_principal_rate_policy.sql`。Migration 仅在本地建立新 registry 行、平台产品/订单身份、平台证据、非 Amazon 正式订单承载及其受控聊天截图关联表、唯一键、权限/归属触发器和事务断言；不得插入真实业务 seller/store/order/file 数据。旧 FK 继续引用的 `marketplace_registry_legacy_0029` 仅是冻结的兼容父表，禁止增删改，不是第二权威。Migration 必须支持 fresh、sequential upgrade、重复执行和错序回滚（事务失败后无部分 DDL/状态变化）。

上线前回滚边界为停用新代码并保留空闲 schema；已写入新平台正式事实后禁止 down-migrate，必须前向修复或从隔离备份恢复。

## Risks and Privacy

平台标识规则若过宽会接受错误导入，若过窄会丢失未来合法 TikTok 订单；因此通用 validator 只检查非空/长度/控制字符，平台 profile 负责可选历史样本校验。Seller 查询继续以 organization + store scope 为权威，Personal DENY 最终优先。聊天截图只返回受控 read intent，不返回 R2 key/永久 URL。所有外部写入计数必须保持为零。
