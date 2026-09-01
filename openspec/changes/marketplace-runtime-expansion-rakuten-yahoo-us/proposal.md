## Why

Owner 2026-09-01 拍板：乐天、雅虎、美国亚马逊三平台全开。当前运行时 canonical 仅 AMAZON_JP 可写（AMAZON_US 未启用、COUPANG_KR 禁用预留，D-056），来源层数据已有 8 个乐天卖家（标识 R-1/S-1 归档认可）、3 个雅虎商品（13 位 JAN 条码）与若干美国站行。本草案把三平台纳入运行时，先经 Codex 只读审查再实现。

## What Changes（草案）

- canonical 市场新增 `RAKUTEN_JP`、`YAHOO_JP`（循 `{BRAND}_{REGION}` 现有惯例），`AMAZON_US` 由"未启用"转为启用；COUPANG_KR 维持禁用预留。
- marketplace-runtime 定义补齐（币种 JPY/JPY/USD、时区）；市场注册表种子与相关 CHECK/触发器 allowlist 扩展（0039 迁移）。
- 商品标识契约：乐天=RAKUTEN_PRODUCT_NUMBER（R-1/S-1 归档认可集之外按 IDENTIFIER_REVIEW_REQUIRED 隔离）；雅虎=13 位 JAN（带 EAN-13 校验位验证，合法才 FORMAT_VALID）；美国=ASIN 沿用现行规则。
- 导入器 adapter v2 支持三平台写入路径；预约资格与结算按市场注册表状态联动。
- D-056 市场分层条款修订记录（Owner 2026-09-01 新裁决优先级高于旧 Decision Register）。

## Capabilities

### Modified Capabilities

- marketplace-runtime：canonical 集合与启用状态。
- seller-partner-import：市场写入路径与标识校验。

## Impact

- contracts/schema/导入器/前端市场筛选四层联动；不影响既有 AMAZON_JP 行为与数据。
- 需要新迁移 0039（schema 39）与锚点全套同步。
