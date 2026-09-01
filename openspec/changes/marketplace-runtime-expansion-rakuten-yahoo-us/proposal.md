## Why

Owner 2026-09-01 拍板：乐天、雅虎、美国亚马逊三平台全开，同日上午补充裁决追加 TEMU 日本站与 TikTok 日本站，共五个平台。当前运行时真实业务写路径仅 AMAZON_JP（AMAZON_US 在注册表本就 ACTIVE/AVAILABLE，缺的是 Seller 门户/业务层启用；COUPANG_KR 禁用预留，D-056），来源层数据已有乐天卖家与商品（R-1/S-1 归档认可+Richgo 6 型号）、3 个雅虎商品（13 位 JAN 条码）、若干美国站行、TEMU 6 编号与 TikTok 1 行。本草案把五平台纳入运行时，Codex 0901 已审六决策、预约资格 Owner 已裁（自动可约），实现待做。

## What Changes（草案）

- canonical 市场新增 `RAKUTEN_JP`、`YAHOO_JP`、`TEMU_JP`、`TIKTOK_JP`（循 `{BRAND}_{REGION}` 现有惯例），`AMAZON_US` 由"未启用"转为启用；COUPANG_KR 维持禁用预留。
- marketplace-runtime 定义补齐（币种 JPY×4/USD、时区）；市场注册表种子与相关 CHECK/触发器 allowlist 扩展（预计 0041 迁移：0040 已被别名通道种子占用）。
- 商品标识契约：乐天=RAKUTEN_PRODUCT_NUMBER（R-1/S-1 归档认可集之外按 IDENTIFIER_REVIEW_REQUIRED 隔离）；雅虎=13 位 JAN（带 EAN-13 校验位验证，合法才 FORMAT_VALID）；美国=ASIN 沿用现行规则；TEMU=TEMU_PRODUCT_ID（`^[A-Z]{2}\d{6}$`，现数据 6 条全过）；TikTok=暂无编号数据，契约待首批真实编号定稿。
- 导入器 adapter v2 支持五平台写入路径；预约资格与结算按市场注册表状态联动。
- D-056 市场分层条款修订记录（Owner 2026-09-01 新裁决优先级高于旧 Decision Register）。

## Capabilities

### Modified Capabilities

- marketplace-runtime：canonical 集合与启用状态。
- seller-partner-import：市场写入路径与标识校验。

## Impact

- contracts/schema/导入器/前端市场筛选四层联动；不影响既有 AMAZON_JP 行为与数据。
- 需要新迁移（编号顺延：别名通道种子预计占 0040，本 Change 为 0041）与锚点全套同步。
