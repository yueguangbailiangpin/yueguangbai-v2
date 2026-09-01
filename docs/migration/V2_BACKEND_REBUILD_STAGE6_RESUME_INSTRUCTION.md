# 阶段 6 续做指令（历史订单及图片无损导入 · 收尾轮）

> 本文件是给新对话的直接指令。生成时间：2026-08-26。
> 上一轮已完成阶段 5 并提交；阶段 6 已完成约一半，剩余工作树有未提交成果，本指令要求**在此基础上续做，不要重做已完成部分**。

## 项目与基线

- 项目目录：`/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller`
- 分支：`feature/staging-workflow-rate-ux`
- 当前 HEAD：`292d87ef`（= 阶段 5 提交 `feat(archive): add verified cold archive and temporary restore pipeline (stage 5)`）
- 本地领先远程 12 个提交，未 push。必须保留现有提交，不得 reset/rebase/squash/drop。
- Schema 版本：**25**（阶段 5 加了 0024，工作树中未提交的 0025 已把链推进到 25）。
- 工作树**不干净**，包含以下未提交的阶段 6 部分成果（全部保留、在此基础上继续）：
  - `migrations/0025_historical_order_import.sql`（5 张表 + 触发器/索引，已通过 25 链空库重放 + integrity/FK 验证）
  - `tools/imports/historical-order-importer/index.ts`（30 列 CSV/JSONL 解析、marketplace 映射、整数金额换算、身份解析、图片分类）
  - `tools/imports/historical-order-importer/pipeline.ts`（dry-run/apply-local/resume/reconcile 编排）
  - `tools/imports/historical-order-importer/historical-order-importer.test.ts`（**11/11 已通过**）
  - `vitest.import-capacity.config.ts`（容量验证 vitest 配置骨架，指向尚不存在的 `import-capacity.verify.ts`）
  - `scripts/verify-migrations.mjs`（已更新到 0025：expectedLatestSchema=25、inventory 195 表/581 索引/374 触发器/12 视图、SHA `b13ebbb36f181534445d14d6f2090e188eb74b9d5bf44d2a3c30bcd0207787e6`、新增表加入 requiredTables）
- 阶段 5 关键事实（供依赖）：归档 bundle 模型（migration 0024）、`archive_bundles`/`archive_jobs` 等表、DriveArchiveClient 端口 + fake、流式 ZIP、`FILE_ARCHIVED` 410 占位、`npm run verify:archive-capacity` 已入 check 链。详见 `docs/migration/V2_BACKEND_REBUILD_STAGE5_HANDOFF.md`。
- 开工前先读：`AGENTS.md`、`docs/migration/V2_BACKEND_REBUILD_STAGE5_HANDOFF.md`、`docs/migration/V2_BASELINE_HISTORICAL_ORDER_FIELD_MAPPING.md`、`docs/migration/HISTORICAL_ORDER_DATA_REQUIREMENTS.md`、`openspec/changes/backend-clean-baseline-rebuild/tasks.md`、工作树中上述未提交文件。

## 本轮目标

只做**阶段 6 的剩余收尾 + 阶段 6 提交**。不要重复执行阶段 1–5，不要进入阶段 7–8。

## 剩余任务（按序）

### A. CLI 命令（6.6 的命令面）

新建 `tools/imports/historical-order-importer/cli.ts`（或 `scripts/historical-import.mjs` 包装，参考仓库现有 `scripts/dry-run-seller-partner-import.mjs` 的 esbuild 打包模式），至少提供：

- `inspect`：读源文件（本地路径），输出 header 校验、行数、源 SHA-256，不建 run。
- `dry-run`（默认模式）：跑 `runHistoricalImport` mode=DRY_RUN，打印完整报告 JSON（行数守恒、身份匹配、marketplace 映射、财务汇总、文件分类分布、quarantine by code、can_apply）。
- `apply-local`：显式参数 + 环境门禁（如 `HISTORICAL_IMPORT_APPLY_LOCAL=I_UNDERSTAND_THIS_WRITES_LOCAL_D1`），只允许写本地测试 D1。
- `resume --batch-id <id>`：续跑 RUNNING 批次。
- `reconcile --batch-id <id>`：输出 reconciliation JSON。

源格式支持 CSV（30 列冻结表头）与 JSONL（Python manifest 工具的 `raw_fields` 形态，已有测试覆盖）。真实源文件不在仓库（`数据订单汇总.xlsx` 在仓库外且当前机器缺失）——CLI 必须能接受任意路径参数，但本轮不得对任何真实历史文件执行 apply。

### B. 20,000 单 / 100,000 文件容量验证（6.7）

新建 `tools/imports/historical-order-importer/import-capacity.verify.ts`（`vitest.import-capacity.config.ts` 已指向它），要求：

- 合成生成 20,000 行 CSV（多种买家微信/店铺、三名员工无关紧要——身份解析走 D1、不同汇率与服务费值、评论/返款/结算链完整与不完整混合、约 2% 坏行：未知 marketplace/缺列/非整数金额/汇率差不匹配、少量重复订单号组：exact 与 conflicting）。
- 每单 5 个图片引用（5 列图片列），约 100,000 文件计划。
- 真实走 DRY_RUN（含身份解析、分类、报告）→ APPLY_LOCAL（分批写库）→ 重复运行（幂等：0 新行）→ 中断后 resume（与一次成功一致）→ reconcile（订单/退款/结算汇总与输入预期一致）。
- 断言：行数守恒（source = valid + quarantined）、第二次导入不新增事实、单批语句数有上限（不触 D1 100 参数限制）、无 O(N²)（可用首/末批耗时比佐证，参考阶段 5 capacity.verify 的做法）。
- 在 package.json 注册 `verify:historical-import-capacity`，并加入 `check:ci:test-build` 链（在 `verify:archive-capacity` 旁边）。
- 真实执行并记录结果到交接文档。

### C. 剩余测试补齐（6.8 清单中对齐）

已有 11 个用例覆盖：表头漂移、marketplace 映射（含 Rakuten/TikTok quarantine）、金额精度（字符串算术）、汇率差 mismatch、部分财务字段、身份 match/conflict/unmatched/override、图片分类 fail-closed（cold 需完整关闭+字节核验）、dry-run 默认不写库、can_apply=false 阻断 apply、apply+重放幂等+快照不可变、中断 resume 等价、不静默合并身份且不触 formal_orders、JSONL 适配器。

仍需补（可并入现有文件或新建）：

1. **源 hash 变化测试**：同一 batch 身份下源文件内容改变 → 必须 NEW run 而非续跑旧 run（现有 UNIQUE(source_system, files_sha, ...) 语义测试化：不同 sha 各自成批，互不干扰）。
2. **阶段 5 归档集成测试**：导入产生的 `historical_order_files.classification='COLD_ARCHIVE_ELIGIBLE'` 行在语义上受 0025 触发器约束（closure 完整才能标 cold）；再写一个用例把一条历史订单计划与阶段 5 的 archive_bundles 管线串起来（可选：对 historical_order_files 行走 selector 语义断言其不进入热归档路径，或至少断言分类稳定）。
3. **Buyer/Seller/Staff 权限回归**：断言历史导入表无任何门户路由暴露（grep 路由注册 + api-contract 清单计数不变 248）。
4. **本地 D1 全 migration 空库重放**：`npm run db:migrate:local` 25/25。

### D. 验证与提交（6.8）

全部完成后依次真实运行并全绿：

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run check`（含 verify:historical-import-capacity 与 verify:archive-capacity）
- `openspec validate --all --strict`
- `npm run db:verify`（25 链）
- `npm run verify:migration-guards`
- `npm run verify:api-contract`（248 端点不变）
- `npm run verify:archive-capacity`
- `npm run verify:historical-import-capacity`
- `npm run db:migrate:local`（25/25）

然后：

1. 勾选 `openspec/changes/backend-clean-baseline-rebuild/tasks.md` 阶段 6 实际完成项（阶段 7–8 保持未勾）。
2. 创建 `docs/migration/V2_BACKEND_REBUILD_STAGE6_HANDOFF.md`，必须写明：
   - 支持的来源格式（CSV 30 列冻结表头 / JSONL raw_fields）与字段映射（对照 `V2_BASELINE_HISTORICAL_ORDER_FIELD_MAPPING.md` 30/30 列归宿）
   - marketplace 映射规则（Amazon JP canonical、紧凑形态归一化、Rakuten/TikTok → quarantine 不伪装 AMAZON_JP；运行时不写 'JP'）
   - 身份匹配规则（微信 claim 确定性匹配 / 多命中 conflict / 人工 override 表 + 审计；绝不按姓名模糊合并）
   - 财务保真规则（JPY 整数日元、CNY 元→分字符串算术、汇率 E8、缺关键财务字段 quarantine、不为导入成功填 0、不重算不覆盖）
   - 文件映射与分类（5 图片列 purpose/audience；到货图忽略；HOT_R2/COLD_ARCHIVE_ELIGIBLE/QUARANTINE/MISSING/CORRUPT/ORPHAN 规则；物理去重保留逻辑关系）
   - quarantine 规则（全部 exception_code 语义）
   - dry-run/apply/resume/reconcile 命令用法
   - 20,000 单容量结果（真实数字）
   - **REAL_HISTORICAL_IMPORT=NOT_RUN**（仓库内无真实历史导出文件；真实导入尚需：源工作簿按 SHA `c7d0ae7a...` 取回、图片字节盘点、业务方批准；明确列出仍需的材料清单）
   - 所有远程边界声明
   - 阶段 7 可依赖的最终后端合同
3. 更新 `docs/CURRENT_SYSTEM_STATE.md` 的 schema 叙述（25）与导入合同要点。
3. 创建本地提交：`feat(import): add resumable historical order import and reconciliation (stage 6)`。提交后确认工作树干净。

## 全局禁止事项

- git push、GitHub PR/Issue 修改
- Cloudflare deploy、创建真实 Queue/DLQ、写远程 D1/R2
- 真实 Google Drive 操作、飞书操作
- 删除/修改/移动任何外部历史订单来源、图片目录、CSV/Excel/JSON 原始文件（只读）
- 伪造真实历史导入成功（synthetic 就是 synthetic，报告必须写 NOT_RUN）
- 阶段 7 前端视觉重构、阶段 8 部署准备
- 为通过测试 skip/删除/弱化阶段 1–5 的安全断言
- 对真实历史文件执行 apply（本轮 apply 只允许本地测试 D1 + synthetic 数据）

## 最终停止条件与报告

完成后确认：阶段 5 已有独立提交、阶段 6 有独立提交、阶段 7–8 未勾、工作树干净、本地继续领先远程、零远程写入、未触碰历史原始来源、未把 synthetic 写成真实导入。

最终报告格式：

```text
TASK=
STAGE6_LOCAL_COMMIT=
FINAL_HEAD=
SCHEMA_VERSION=
FILES_CHANGED=
IMPORT_SOURCE_FORMATS=
REAL_HISTORICAL_IMPORT=
IMPORT_CAPACITY_RESULT=
IDEMPOTENCY_RESULT=
RESUME_EQUIVALENCE_RESULT=
RECONCILIATION_RESULT=
QUARANTINE_SUMMARY=
COMMANDS_RUN=
TESTS_PASSED=
TESTS_FAILED=
REMOTE_WRITES=no
CLOUDFLARE_RESOURCES_TOUCHED=no
GOOGLE_DRIVE_RESOURCES_TOUCHED=no
FEISHU_RESOURCES_TOUCHED=no
GITHUB_REMOTE_TOUCHED=no
EXTERNAL_SOURCE_FILES_MODIFIED=no
OPEN_RISKS=
NEXT_SAFE_STEP=阶段 7：前端员工端、买家端和卖家端的界面与交互重构；等待下一条指令后再执行
```
