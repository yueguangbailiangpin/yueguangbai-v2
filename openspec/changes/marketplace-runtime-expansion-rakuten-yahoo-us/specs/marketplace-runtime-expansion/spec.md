## Purpose

Owner 2026-09-01 裁决扩展运行时市场；本能力定义 canonical 集合、启用状态与标识契约。

## ADDED Requirements

### Requirement: Canonical marketplace set includes Rakuten, Yahoo and enabled US Amazon

运行时 canonical 市场 MUST 包含 AMAZON_JP、AMAZON_US（启用）、RAKUTEN_JP、YAHOO_JP、TEMU_JP、TIKTOK_JP，并保留 COUPANG_KR 禁用预留；来源平台代码（JP_AMAZON/JP_RAKUTEN 等）到 canonical 的映射 MUST 只存在于导入 adapter 层。

#### Scenario: Registry seeds the expanded set fail-closed

- **WHEN** 迁移全量应用于空库并读取市场注册表
- **THEN** 六个 canonical 市场为启用且不可变写入，COUPANG_KR 保持禁用 fail-closed

### Requirement: Per-marketplace product identifier contract

乐天商品标识 MUST 为 RAKUTEN_PRODUCT_NUMBER，仅归档认可集通过校验，其余隔离为 IDENTIFIER_REVIEW_REQUIRED；雅虎商品标识 MUST 为 13 位 JAN 且通过 EAN-13 校验位，失败隔离；AMAZON_US 沿用现行 ASIN 规则。

#### Scenario: Yahoo JAN passes only with valid check digit

- **WHEN** 导入 13 位 JAN 标识且校验位合法/非法
- **THEN** 合法者 FORMAT_VALID，非法者 quarantine 为 IDENTIFIER_REVIEW_REQUIRED 且不写入 offerings
