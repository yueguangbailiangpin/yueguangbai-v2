# 卖家/客户表格「字段规范 + XLSX/CSV 适配」文档

> 用途：卖家合作表格（腾讯文档四个目录中的「产品信息」分表等）从内部 Manifest 走向用户可上传的 XLSX/CSV 适配层时的字段规范。
> 状态：**规范草案**。现有代码只吃内部 `SellerPartnerSourceManifest`（`tools/imports/seller-partner/index.ts`），尚无 XLSX/CSV 解析入口；`dry-run:seller-partner-import` 只覆盖内部结构。本文定义上传表格的字段契约与适配规则，实现须另开 Change。
> 重要边界：**不要把腾讯文档当第二套权威库**——腾讯文档只是上传/读取入口，权威事实仍在 D1。

## 1. 现状与差距

| 项 | 现状 | 目标 |
|---|---|---|
| 输入 | 内部 `SellerPartnerSourceManifest`（JSON 记录数组） | 用户上传 XLSX/CSV 表格 |
| 解析 | 无文件解析（`previewSellerPartnerImport` 直接吃 manifest） | 只读解析 XLSX/CSV → 内部记录 → 同一 normalize 管线 |
| 预览 | 已有 `previewSellerPartnerImport`（幂等、分组、quarantine） | 复用；解析层前置于此 |
| 提交 | 已有 `commitSellerPartnerImport` | 复用（HOLD/确认后提交） |
| 回滚 | 已有 `rollbackSellerPartnerImport` | 复用 |

## 2. 腾讯文档目录与渠道映射（已冻结）

四个卖家表格目录 → 渠道代码（`FROZEN_SOURCE_FOLDERS`）：

| 目录 ID | 渠道代码 | 说明 |
|---|---|---|
| `dJwldHrckeFY` | `ido-mango` | 卖家客户文件夹 1 |
| `dDUYsBOrYoEk` | `ygbceping` | 卖家客户文件夹 2 |
| `davLDVdZLoPV` | `yinghua1942` | 卖家客户文件夹 3 |
| `dhtkJdpmZEgh` | `yueguangbaiai` | 卖家客户文件夹 4 |

- 渠道别名表（`CHANNEL_ALIASES`）：`ido/ido-mango/dio` → `ido-mango`；`ygb/ygbceping` → `ygbceping`；`yueguangbai/yueguangbaiai` → `yueguangbaiai`；`yinghua1942/yinghua1942ai` → `yinghua1942`；`queshengai/quesheng520ai` → `queshengai`。
- 文件夹默认渠道与行内别名冲突（`FOLDER_CHANNEL_CONFLICT`）→ quarantine，除非别名是 `queshengai`。

## 3. 上传表格字段契约（目标 XLSX/CSV 列）

以下列名是适配层期望的**表头**（大小写/空白容错，NFKC 归一化后匹配）：

| # | 列名 | 必填 | 校验/归一化 | 对应内部字段 |
|---|---|---|---|---|
| 1 | 卖家微信 | ✅ | `normalizeWechatId`（小写归一） | `sellerWechat` / `sellerWechatNormalized` |
| 2 | ASIN | ✅ | `normalizeAsin`（大写归一） | `asin` / `asinNormalized` |
| 3 | 产品名 | ✅ | 非空、≤200 字符 | `productName` |
| 4 | 产品链接 | 否 | URL 格式（宽松） | `productUrl` |
| 5 | 合作状态 | 否 | 枚举：当前合作 / 历史合作 / 未知（`CURRENT`/`HISTORICAL`/`UNKNOWN`） | `cooperationStatus` |
| 6 | 当前可预约 | 否 | 布尔（是/否、true/false、1/0） | `currentReservable` |
| 7 | 渠道别名 | 否 | 命中 `CHANNEL_ALIASES`，否则 quarantine | `channelAlias` |
| 8 | 来源卖家编号 | 否 | 文本 | `sourceSellerCode` |

适配层自动附加（不来自表格）：

- `sourceFolderId`：由上传入口（哪个腾讯目录 / 上传会话）决定；不在冻结目录 → `UNKNOWN_SOURCE_FOLDER` quarantine。
- `sourceRecordId`：稳定来源行键（`<folder>:<row>` 或腾讯文档记录 ID），用于幂等与重复检测。
- `sourceLocator`：来源定位串（目录/文件/行），供审计追溯。

## 4. 归一化与 quarantine 规则（沿用现有逻辑）

- `normalizeWechatId` / `normalizeAsin` 失败 → `INVALID_SELLER_OR_ASIN`。
- 产品名为空或超长 → `INVALID_PRODUCT_NAME`。
- 合作状态非法 → `INVALID_COOPERATION_STATUS`。
- 渠道别名未知 → `UNKNOWN_CHANNEL_ALIAS`。
- 行内渠道与文件夹默认渠道冲突 → `FOLDER_CHANNEL_CONFLICT`（`queshengai` 例外）。
- 重复 `sourceRecordId` → `DUPLICATE_SOURCE_RECORD_ID`；重复 `rowHash` → `DUPLICATE_SOURCE_ROW`。
- 所有 quarantine 记录保留原始值 + 异常码，进入预览报告，不自动修正。

## 5. 预览 → 确认 → 提交 → 回滚（复用既有管线）

1. 解析 XLSX/CSV（只读，不写远程）→ 内部 `SellerPartnerSourceManifest`。
2. `previewSellerPartnerImport` → 计划：分组（按 `folder:sellerWechat`）、标准产品（按 ASIN）、计数、quarantine 明细、`manifestHash`。
3. 人工确认（敏感数据提交前明确确认）→ `commitSellerPartnerImport`（幂等键 + 批次标记 + 审计）。
4. `rollbackSellerPartnerImport`：按批次回滚，保留来源痕迹，检查下游事实。

## 6. 实现要求（未来 Change）

- XLSX 解析用只读库（如 `xlsx`/`exceljs` 的 sheet 读取，或纯 ZIP+XML 只读），**不执行单元格公式**，**不读取嵌入图片**（与历史订单 manifest 生成器同策略）。
- CSV 解析处理 BOM / 分隔符 / 引号；日期与数字不做隐式类型猜测（金额/比例保持文本快照或明确整数契约）。
- 解析层输出必须能通过现有 `previewSellerPartnerImport` 全量校验；解析层单测 + 权限/越权测试 + 幂等重放测试（沿用仓库测试要求）。
- staging canary 验证后才可发布；禁止直连生产。
- 腾讯文档读取接入（skill/MCP）确认后，入口读取逻辑独立实现，不改变本文字段契约。

## 7. 命名规则参考（用户提供的示例）

- 表格命名示例：「咖啡秤-Johnwen7-idomango」= 产品名-卖家客户微信-对接渠道；文件夹内「产品信息」分表 = 该卖家客户合作的产品信息。
- 适配层应以「产品名 + 卖家微信 + 渠道」为展示键，但**唯一性判定仍以 ASIN 归一化 + 卖家微信归一化**为准（同 ASIN 多卖家来源允许存在，分属不同组织）。
