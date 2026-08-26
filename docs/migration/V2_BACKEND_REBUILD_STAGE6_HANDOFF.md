# 后端重建阶段 6 交接（历史订单及图片无损导入）

日期：2026-08-26。分支 `feature/staging-workflow-rate-ux`，基线 = 阶段 5 的 `292d87ef` + 阶段 6 本地提交（未 push）。依据：D-054（约 20,000 真实历史订单无损导入义务）、`V2_BASELINE_HISTORICAL_ORDER_FIELD_MAPPING.md`（30/30 列归宿）、`HISTORICAL_ORDER_DATA_REQUIREMENTS.md`（30 列契约）、OpenSpec `backend-clean-baseline-rebuild`。

## 0. 承载结论（与阶段 3 清单一致）

历史订单**不进活模型**：`formal_orders` 强制携带现行证据链（reservation/submission/version/demand_batch），历史表格行没有该链，强行写入必然伪造事实。阶段 6 以 migration `0025`（schema 24 → 25）前向追加 5 张导入事实表，全部快照语义、append-only：

- `historical_import_batches`：run 溯源（source_system、files JSON、combined SHA-256、parser/mapping 版本、mode、status、行数守恒 CHECK、`UNIQUE(source_system, source_files_sha256, parser_version, mapping_version, mode)` 幂等键、checkpoint_row_key 断点续传位）。
- `historical_orders`：30 列来源快照（整数最小单位金额、E8 整数汇率、日期 TEXT 原值），`UNIQUE(import_batch_id, source_row_key)` 与 `UNIQUE(import_batch_id, source_order_id)`；no_update/no_delete 触发器（快照不可变）。
- `historical_order_files`：图片计划行（purpose/audience/source_column/source_ref、content_sha256/mime/byte_size、classification、physical_dedup_key）；no_delete 触发器 + `trg_historical_file_insert_guard`（COLD_ARCHIVE_ELIGIBLE 要求 review_approved_on/refunded_on/settled_on 全非空——closure 完整才能标 cold，fail-closed）。
- `historical_import_quarantine`：HOLD 行 + exception_code + detail JSON；no_delete 触发器。
- `historical_import_identity_overrides`：人工身份裁定（source_system+source_key 唯一；overridden_by_staff_id FK + 理由必填）——身份冲突的唯一解法，绝不按姓名模糊合并。

当前 inventory：195 表 / 581 索引 / 374 触发器 / 12 视图（`db:verify` SHA-256 锚定 `b13ebbb361534445d14d6f2090e188eb74d9d5bf44d2a3c30bcd0207787e6`）。

## 1. 来源格式与字段映射（30/30 列）

- **CSV**：30 列冻结表头（`HISTORICAL_CSV_HEADERS`，名称与顺序严格一致；表头漂移 = `SOURCE_HEADER_MISMATCH` 立即失败）。支持引号转义。
- **JSONL**：Python manifest 工具的 `raw_fields` 形态（每行 `{row_key, raw_fields:{<30 列>}}`）。
- 逐列归宿见 `V2_BASELINE_HISTORICAL_ORDER_FIELD_MAPPING.md` §1（30/30：18 列数据快照 + 8 列图片计划登记 + 1 列明确忽略 + 3 列派生显示不落库）。要点：到货图（第 11 列）按契约永久忽略；利润（第 30 列）仅快照 + 预览摘要，永不进活模型（Phase 3F 禁字段）；汇率差导入时校验 = 买 − 卖（E8 整数，不匹配 → `RATE_SPREAD_MISMATCH` quarantine），保存原值不落活模型。

## 2. Marketplace 映射规则

- 订单号 `^\d{3}-\d{7}-\d{7}$` → `AMAZON_JP`（canonical）；17 位无分隔紧凑形态归一化为标准形状（note= NORMALIZED_MISSING_SEPARATOR）。
- Rakuten（`^\d{6}-\d{8}-\d{10}$`）与 TikTok JP（`585` 开头 17 位）形状 → 识别出 marketplace 但 **quarantine（UNKNOWN_MARKETPLACE，critical）**，绝不伪装成 AMAZON_JP；其余无法识别形状同样 UNKNOWN_MARKETPLACE。
- 运行时不写历史 'JP' 短码：`historical_orders.marketplace_code` CHECK 仅接受 `AMAZON_JP`（registry 无 Rakuten/TikTok 行，结构性 fail-closed）。

## 3. 身份匹配规则

- **买家**（微信 claim）：`wechat_identity_claims.normalized_wechat` 确定性 JOIN `buyer_customers`——单命中 MATCHED、多命中 IDENTITY_CONFLICT（quarantine）、零命中 UNMATCHED（快照照常导入，不自动建客户）。绝不按姓名模糊合并。
- **卖家**（店铺名）：`seller_stores.normalized_name`（ACTIVE）唯一组织归属——单命中 MATCHED、跨组织同名 CONFLICT、无主 UNMATCHED。
- **人工 override 优先**：`historical_import_identity_overrides` 命中即按裁定解析（MATCHED），override 行自带 staff FK 与理由（审计）。
- 未匹配身份是 quarantine/报告事实，不是静默合并；`buyer_customers`/`formal_orders` 行数在导入前后不变（测试实证）。

## 4. 财务保真规则

- JPY 整数日元（订单价格）；CNY 元 → 分用**字符串算术**（≤2 位小数精确换算，禁止 JS 浮点）；汇率/汇率差 E8 整数比例（≤8 位小数字符串换算）。
- 三个 CNY 财务列（服务费、买家返金、卖家返金）要么全有要么全无：部分出现 → `MISSING_FINANCIAL_FIELDS` quarantine——不为导入成功填 0。
- 非整数/含公式痕迹金额 → `NON_INTEGER_AMOUNT`（critical）。一切金额是来源快照：不按当前政策重算、不覆盖、利润不持久化进活模型。

## 5. 文件映射与分类（5 图片列）

| 列 | purpose | audience |
|---|---|---|
| 聊天截图 / 订单截图 | ORDER_EVIDENCE | INTERNAL_ONLY |
| 评论通过截图 / 补fb截图 | REVIEW_EVIDENCE | INTERNAL_ONLY |
| 返款截图 | BUYER_REFUND_PROOF | INTERNAL_ONLY |

分类规则（fail-closed）：
- 提供物理图片 inventory 且 closure 完整（通过日期+返款时间+结算日期全非空）且最晚关闭 + 6 个 UTC 日历月已过 → `COLD_ARCHIVE_ELIGIBLE`（0025 触发器二次约束）；closure 完整但未满 6 月 → `HOT_R2`；closure 不完整 → `QUARANTINE`（closure_time_incomplete）。
- **无 inventory（当前仓库状态）**：cold 候选一律 `QUARANTINE`（cold_candidate_requires_byte_inspection）——元数据永不单独授权冷归档。
- inventory 中找不到引用 → `MISSING`；不可读/零字节 → `CORRUPT`；无订单上下文的引用 → `ORPHAN`。
- 物理去重：相同 content_sha256 共享 physical_dedup_key（保留全部逻辑行，字节层去重是后续独立 Change）。

## 6. quarantine 规则（全部 exception_code）

| code | 语义 | critical（阻断 apply） |
|---|---|---|
| UNKNOWN_MARKETPLACE | 订单号非 Amazon JP 形状（含 Rakuten/TikTok） | 是 |
| INVALID_ORDER_NUMBER | 订单号无法归一化 | 是 |
| MISSING_REQUIRED_COLUMN | 7 个必填列（下单日期/客户编号/买家微信/店铺/ASIN/订单号/订单价格）缺失 | 是 |
| NON_INTEGER_AMOUNT | 金额列非整数 | 是 |
| INVALID_DATE | 日期列无法解析 | 否 |
| IDENTITY_CONFLICT | 微信或店铺多命中 | 否 |
| IDENTITY_UNMATCHED | 身份零命中（报告事实） | 否 |
| DUPLICATE_SOURCE_ORDER | 重复订单号登记 | 否 |
| MISSING_FINANCIAL_FIELDS | CNY 财务三列部分出现 | 否 |
| RATE_SPREAD_MISMATCH | 汇率差 ≠ 买 − 卖（E8） | 是 |
| CONFLICTING_DUPLICATE_GROUP | 同订单号多行且事实不一致 | 是 |
| FILE_MISSING / FILE_CORRUPT / FILE_ORPHAN | 物理图片盘点异常 | 否 |
| MULTI_SELLER_AMBIGUOUS | 店铺跨卖家歧义 | 否 |

任一 critical quarantine 存在 → `can_apply=false`，APPLY_LOCAL 写入 0 行（批次 FAILED、error_code 记录计数）——测试在容量级实证。行数守恒恒成立：source_rows = valid_rows + quarantined_rows（批次 CHECK + 报告双保险）。

## 7. 重复订单组语义

- **exact 组**（同订单号且 30 列事实完全一致）= 同一逻辑订单的重复来源行：折叠为组首一条 `historical_orders`（后续成员不产生第二行/悬挂 FK）；行数守恒按行计、金额汇总按折叠后逻辑订单计（dry-run 报告与 reconcile 口径一致）。
- **conflicting 组**（同订单号且事实不一致，如多商品多行）→ 全组 `CONFLICTING_DUPLICATE_GROUP` quarantine（critical，阻断 apply）——多商品多行契约在当前一单一行模型下的承载需未来独立决策。

## 8. 命令用法（CLI，本地 only）

```text
node scripts/historical-import.mjs inspect   --source <file.csv|file.jsonl> [--source <more>...]
node scripts/historical-import.mjs dry-run   --source <file> [--database <d1-sqlite>]
HISTORICAL_IMPORT_APPLY_LOCAL=I_UNDERSTAND_THIS_WRITES_LOCAL_D1 \
node scripts/historical-import.mjs apply-local --source <file> --database <d1-sqlite>
node scripts/historical-import.mjs resume    --source <file> --batch-id <id> --database <d1-sqlite>
node scripts/historical-import.mjs reconcile --batch-id <id> --database <d1-sqlite>
```

- `inspect`：表头校验、行数、源 SHA-256；不建 run、零写入。
- `dry-run`（默认模式）：完整解析/校验/身份/分类报告 JSON（行数守恒、身份匹配、marketplace 映射、财务汇总、文件分类分布、quarantine by code、can_apply 门）；仅写批次溯源行。
- `apply-local`：双门禁 = 精确环境变量 + 数据库路径必须在仓库内；只写 `historical_*` 四表（**绝不写 formal_orders**）；每订单独立事务边界（中断可续）。
- `resume`：仅限 RUNNING 的 APPLY_LOCAL 批次；源文件当前 SHA-256 必须与批次记录一致（源变化 → 拒绝并要求新 run，CLI 与表约束双层保证）。
- `reconcile`：输出批次对账 JSON（订单/退款/结算汇总、文件分类分布、quarantine 计数）。
- 数据库默认自动发现本地 D1（`apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`，需先 `npm run db:migrate:local`）。

## 9. 20,000 单容量验证（真实数字，2026-08-26 本机实测）

`npm run verify:historical-import-capacity`（vitest.import-capacity.config.ts，已入 `check:ci:test-build` 链）：合成 20,000 行 CSV（多买家/店铺、4 组汇率对、5 档服务费、完整链 70% / 未满 6 月 20% / 链不完整 10%、354 坏行 = ~1.8%：8 类坏因 + exact×2 组 + conflicting×2 组）× 每单 5 图片引用 = 100,000 文件计划。

实测（单次运行）：**总计 15.8 秒**——dirty 源 DRY_RUN（守恒/quarantine by code/身份冲突 25+25/分类分布精确断言）→ dirty 源 APPLY 阻断（0 行）→ 净化源 APPLY 分批写库 6.7s（19,997 逻辑订单 + 99,985 文件行 + 0 quarantine）→ 同源重放（replayed、0 新行）→ reconcile 与输入预期完全一致（JPY/退款/本金/服务费汇总、COLD 69,985 / HOT 20,000 / QUARANTINE 10,000）→ 去重键 5 组每组 1,000 逻辑行共享 → 中断（第 10,000 行注入，前段 3.3s）+ resume（后段 3.9s，已填半库下处理同量行——resume < 15× 前段，无 O(N²)）→ 终态与一次成功完全等价（行数/金额/文件/quarantine 全等）→ 每表列数 < 100（D1 每语句 100 参数上限远离）。任务 6.3 的日增 200 单/1,000 图负载为该吞吐的 ~0.06%，≥1.5 倍余量充分满足。

## 10. REAL_HISTORICAL_IMPORT=NOT_RUN

仓库内无任何真实历史导出文件（源工作簿 `数据订单汇总.xlsx` 在仓库外且当前机器缺失）。本轮一切验证基于合成数据。真实导入前仍需：

1. 按母表 SHA `c7d0ae7a…`（既有交接锚点）取回源工作簿并只读校验（30 列表头 + 行数 + SHA 记录）。
2. 图片字节盘点（ref → sha/mime/size 的 inventory 文件；MISSING/CORRUPT/ORPHAN 分类依赖它）。
3. 业务所有者对 dry-run 报告（行数守恒、quarantine 明细、财务汇总、身份未匹配清单）的逐项批准。
4. 批准后才允许对**本地** D1 apply；晋升为正式订单事实（链接 formal_orders）是独立人工决策（设计文档 §9.2 开放决策），本轮不存在该路径。

## 11. 验证命令与真实结果（2026-08-26，阶段 6 提交前）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误（含 tools/imports workspace） |
| `npm test` | 254 文件 / 1,698 用例全部通过、0 unhandled（新增 historical-order-importer 15 + archive-integration 2 + portal-isolation 2） |
| `npm run build` | 通过 |
| `npm run check` | exit 0（含 verify:historical-import-capacity 与 verify:archive-capacity、全部命名 verifier、web 边界、build、静态构建） |
| `openspec validate --all --strict` | 63/63 |
| `npm run db:verify` | PASS（195 表/581 索引/374 触发器/12 视图，SHA-256 一致 + 负向 DML） |
| `npm run verify:migration-guards` | PASS（wrong-order 24 拒绝、repeat 25 拒绝、失败快照不变、FK/integrity） |
| `npm run verify:api-contract` | PASS（248 端点双向一致，不变） |
| `npm run verify:archive-capacity` | PASS（阶段 5 用例回归） |
| `npm run verify:historical-import-capacity` | PASS（§9 数字） |
| `npm run db:migrate:local` | 25/25 空库一次重放，schema_version=25 |

## 12. 本轮同步修复（阶段 5 遗留漏更新）

0025 加入后以下停在 24 的锚点统一推进到 25（均为常量/文档，无行为弱化）：`apps/api` 各测试与 operational-readiness/recovery-attestation/first-owner 的 TARGET_SCHEMA 与 SQL 断言（first-owner 的 emptyStagingAssertion 曾因此把 bootstrap 断言打成 0——已修）；`verify-migration-version-guards.mjs` 常量；四份生产文档的 `0001`–`0025` 链声明；`final-production-go-workflow-governance` 的 vitest 白名单**精确新增** `vitest.capacity.config.ts` 与 `vitest.import-capacity.config.ts` 两个 `--config` 形态（其余 `--config` 仍拒绝——阶段 5 引入 capacity 脚本时漏更新治理，本轮如实修复）；zip-writer 三个负向用例补 await `result` rejection（消除 unhandled rejection，断言不弱化）。

## 13. 远程边界声明

本阶段零远程操作：无 git push/PR/Issue、无 Cloudflare（D1/R2/Worker/Queue/DLQ/部署）操作、无 Google Drive 操作、无飞书操作、无真实数据导入或图片上传、未触碰任何外部历史来源文件（仓库外源从未被读取或修改）。全部验证基于本地 checkout、本地空库与本地 wrangler D1。synthetic 数据始终标记 synthetic，未在任何输出中伪装为真实导入。

## 14. 阶段 7 可依赖的最终后端合同

- **Schema**：连续 `0001`–`0025`，`app_schema_state.schema_version=25`；历史导入五表为内部 staff 工具事实（无任何门户路由暴露，api-contract 248 端点不变， Buyer/Seller/Staff 端权限面零新增）。
- **活模型边界**：`formal_orders` 及全部财务账本（返款/结算/汇率中心）不被导入路径写入；历史晋升是未来独立决策。
- **归档合同**：阶段 5 六态 bundle 模型不变；`historical_order_files.classification='COLD_ARCHIVE_ELIGIBLE'` 只是计划语义（0025 触发器保证 closure 完整），不进入阶段 5 selector 的热归档路径（结构性：无 file_object_id/file_entity_links；测试实证 manifest 恒等于活文件事实）。
- **幂等/审计**：导入 run 以 (source_system, files_sha, parser, mapping, mode) 唯一；重复源重放 0 新行；源内容变化 = 新 run；快照表 append-only（触发器级）。
- **命令面**：`scripts/historical-import.mjs` 五命令（本地 only、apply 双门禁）。
- **check 链**：`verify:historical-import-capacity` 与 `verify:archive-capacity` 并列在 `check:ci:test-build`。
- 阶段 7（前端三端界面与交互重构）可直接以 248 端点 + 本合同为 API 基线开工；阶段 8（部署准备）前仍需真实 Drive 客户端（阶段 5 风险 1）与本 §10 的真实导入材料清单。

## 15. 未解决风险

1. 真实历史导入未执行（§10 材料清单）；CLI 已就绪但从未接触真实源。
2. conflicting 重复组（多商品多行）一律 quarantine——真实母表若含合法多商品行，将全部进 HOLD 待业务决策承载方式。
3. 身份未匹配行在 apply 时照常写快照（非阻断）——真实导入后需人工批量裁定 override（表已就绪）。
4. 图片字节盘点工具（inventory 生成器）尚未建设（本轮接受任意 Map 输入；真实盘点脚本属真实导入准备项）。
5. UTC/上海月语义并存（阶段 5 §0）与导入 6 个 UTC 日历月 cold 门槛的统一仍待业务所有者一句话。
