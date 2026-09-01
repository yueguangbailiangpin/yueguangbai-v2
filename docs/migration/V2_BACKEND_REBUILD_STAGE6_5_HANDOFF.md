# 后端重建阶段 6.5 交接（收口：Drive 适配器、图片盘点、身份边界、时间统一、多行订单）

日期：2026-08-26。分支 `feature/staging-workflow-rate-ux`，基线 = 阶段 6 的 `3181d6cc` + 阶段 6.5 本地提交（未 push）。依据：阶段 5/6 交接中已披露的五项遗留、OpenSpec `backend-clean-baseline-rebuild`（阶段 6.5 任务组）。本轮**零远程操作**：无真实 Google Drive 请求、无真实凭据、无 Cloudflare 写入、无 git push、未触碰任何外部历史源文件。

## 0. 范围与非目标

只收口阶段 5～6 报告中已明确披露的遗留：真实 Drive HTTP 客户端**代码**、历史图片字节盘点工具、未匹配身份的显式安全边界、6 个月时间语义统一、多商品多行订单合同。**不进入**阶段 7 前端视觉重构、阶段 8 部署准备、任何真实数据/远程操作。

## 1. 真实 Google Drive HTTP 适配器（阶段 5 风险 1 收口）

- **代码**（`apps/api/src/cold-image-archive/drive-http-client.ts`）：按官方 Drive v3 resumable 协议实现——`POST /upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true`（JSON metadata `{name,mimeType,parents}` + `X-Upload-Content-Type/-Length`）→ 200 + `Location` session URI；256KiB 倍数分块 PUT + `Content-Range: bytes start-end/total`；**308 Resume Incomplete** 解析 `Range: bytes=0-N`（无头=0 字节）；空 PUT（星号 range）查询状态，404=会话过期（约一周）→ 返回 null 由 pipeline 重建会话；完成响应 JSON 解析 file id；`GET files/<id>?supportsAllDrives=true&fields=size,mimeType` 读元数据（size 为字符串，规范解析）；`alt=media` 流式回读并校验 Content-Length 一致性。
- **token 抽象**：`DriveAccessTokenProvider`（`getAccessToken`/`invalidate`）。生产实现 = OAuth2 refresh-token provider（`POST https://oauth2.googleapis.com/token`，缓存至过期前 60s，`invalidate` 后强制刷新）；`createStaticAccessTokenProvider` 仅测试/受控手工用。
- **失败分类**：429/5xx/网络与超时 → 有限重试（指数退避，尊重 `Retry-After`，上限 120s）；401 → 刷新一次 token 后重试，持续失败 fail-closed（`authorization_failed`）；403 一律立即 fail-closed；缺 `Location`/坏 `Range`/坏 JSON → `invalid_response` 不可重试；上传会话 404 → `session_conflict`；读路径 404 → `not_found`。
- **脱敏**：session URI（内嵌 upload_id bearer）与 token 只存活于 isolate 内存注册表（冷启动后 `queryUploadSession` 返回 null → pipeline 以不可变临时 R2 ZIP 重开会话）；`drive_session_key`（不透明随机 id）可入 D1，URL 本身绝不入 D1/日志/错误；所有错误 detail 走封闭词表（`status=NNN` / 固定 reason token），单测断言 message+cause 不含 token、session URL、file id、`https://`。
- **边界**：无 permissions 调用（永不创建公开分享）、无 delete 调用（Drive 副本永久）、`supportsAllDrives=true` 常开 + 可选 `driveId`（Shared Drive 文件夹与普通文件夹同一 folderId 配置）。
- **接线**：`archiveRuntime()` 以 `ARCHIVE_DRIVE_CLIENT`（注入优先）→ `googleDriveArchiveClientFromEnv(env)`（`GOOGLE_DRIVE_FOLDER_ID` + refresh 三元组或静态 token；配置不完整 → null，不抛错不影响启动；按配置指纹 memoize 以复用会话注册表）解析客户端——"生产 adapter 未实现"分支不复存在。上传仍受 env `ARCHIVE_DRIVE_UPLOAD_ENABLED`（默认/保持 false）+ D1 `archive_runtime_controls` 双门控制；开关关闭时**零 HTTP 请求**（集成测试实证 `server.callCount()===0`）。
- **测试**（`drive-http-client.test.ts` 12 例 + `drive-http-integration.test.ts` 3 例，全部走本地 `test-support/fake-drive-http.ts` 假 Drive wire server）：会话创建请求形状、308 部分接受+断点续传、Shared Drive `driveId`、网络中断单次重试、429/5xx 退避与 Retry-After、401 刷新后成功/持续 401 恰好两次请求、403 零重试、metadata/流式回读哈希一致、未知/过期会话与 not_found 分类、非法响应脱敏、env 构造矩阵与 runtime 接入；集成侧：真适配器驱动完整 pipeline（两 bundle 全档、Drive 侧字节哈希 == `zip_sha256`、热文件删除仅在回读校验后）、**回读字节被篡改 → `drive_verification_failed` 且热文件一律不删**（bundle 保持 ONLINE、`drive_verified_at` 空）、上传开关关闭零 HTTP。
- **REAL_DRIVE_REQUESTS=0**：本轮从未对 `googleapis.com` 发起任何真实请求（全部验证走本地假 server；OAuth provider 的 token 端点调用也是假的）。生产激活仍属阶段 8（R-006 外部清单 + 双开关 + wrangler secret 置入——变量名见 `wrangler.example.jsonc` 注释，secret 值永不入库入文件）。

## 2. 历史图片盘点 CLI（阶段 6 风险 4 收口）

迁移 `0026` 三张表 + `tools/imports/historical-order-importer/image-inventory.ts` + CLI 四命令（并入既有 `scripts/historical-import.mjs`，不建第二套 importer）：

```text
node scripts/historical-import.mjs inspect-images  --source-dir <dir>
HISTORICAL_IMPORT_APPLY_LOCAL=I_UNDERSTAND_THIS_WRITES_LOCAL_D1 \
node scripts/historical-import.mjs inventory-images --source-dir <dir> --database <d1-sqlite>
node scripts/historical-import.mjs resume-image-inventory --source-dir <dir> --batch-id <id> --database <d1-sqlite>
node scripts/historical-import.mjs reconcile-images --batch-id <id> --output-dir <dir> [--import-batch-id <id>] --database <d1-sqlite>
```

- **源目录绝对只读**：文件仅以 `r` 打开、64KiB 流式读取（增量 SHA-256 + 魔数嗅探 MIME——扩展名只做交叉校验）；不移动/改名/删除/覆盖，不写临时文件；symlink/非常规条目记 `UNSAFE_ENTRY` finding 且绝不跟随。单测以源目录前后全树内容摘要 + mtime 断言字节级未变。
- **事实表**：`historical_image_inventory_files` 记录安全相对路径（禁绝对路径/`..`/反斜杠）、`logical_file_id = histimg-<sha256(path)>`、大小/hash/MIME/扩展名/读取状态/扩展名-MIME 一致性；字节事实列触发器级不可变，仅 reconciliation 拥有的 `business_*` 列可更新；findings 表 9 类码（READ_FAILED / UNRECOGNIZED_MIME / EXTENSION_MIME_MISMATCH / DUPLICATE_CONTENT / ORPHAN_FILE / REFERENCED_MISSING / UNRESOLVED_BUSINESS_RELATION / UNRESOLVED_AUDIENCE / UNSAFE_ENTRY）。
- **checkpoint/resume**：按排序相对路径处理，每 `checkpointEvery`（默认 200）文件一事务 + checkpoint 更新；中断恢复幂等（INSERT OR IGNORE + 越过 checkpoint），listing 摘要变化 → `SOURCE_CHANGED_SINCE_BATCH`。
- **reconcile**：SQL 侧 keyset 分页——重复内容按 sha256 GROUP BY（规范副本=字典序最小路径，其余 DUPLICATE_CONTENT）；业务映射规则 = inventory 路径或 basename 精确匹配给定导入批次的 `historical_order_files.source_ref`（唯一命中 LINKED 并落 order/purpose/audience，零命中 ORPHAN，多义命中 QUARANTINE，未给导入批次一律 QUARANTINE，audience 缺失 QUARANTINE）；引用无实体 → REFERENCED_MISSING。输出 `inventory.jsonl` / `findings.jsonl` / `inventory.csv` / `summary.json` / `inventory-map.jsonl`（直接可作阶段 6 importer 的 `imageInventory` Map 输入）到**调用者显式指定的输出目录**（与源目录互相包含即拒绝）；输出避免客户 PII（无姓名/微信，仅路径/哈希/尺寸/业务 id）。
- **容量**（`image-inventory-capacity.verify.ts`，已并入 `verify:historical-import-capacity`）：100,000 个合成文件（100 目录×1000，PNG 魔数、19,000 个内容指纹 ≈5% 重复率）——中断（43,000 处）+ resume == 一次成型；19,000 重复组 SQL 分组命中；181,000 findings；`buildImageInventoryMap` 全量摘要；堆增量 282MB（<512MB 界，无全量内存聚合）；resume 无 O(N²)；表列数远离 D1 100 参数上限。总 30.6s。
- **REAL_IMAGE_INVENTORY=NOT_RUN**：仓库无真实图片源，一切为 synthetic。真实执行所需材料与示例命令：Owner 提供图片源目录（仓库外、只读挂载），然后 `inspect-images` 预览 → `inventory-images`（本地 D1）→ 逐项核对 findings → `reconcile-images --import-batch-id <历史导入批次>` → 以 `inventory-map.jsonl` 重跑 `dry-run` 使分类获得真实字节事实。

## 3. 未匹配身份的显式 unresolved 边界（阶段 6 风险 3 收口）

- 规则落码：身份零命中的行在 apply 时**照常无损写入快照**（raw/staging 语义不变），但现在**必须**同时落一条 DURABLE `IDENTITY_UNMATCHED` quarantine 行（detail `kinds:[BUYER_CUSTOMER/SELLER_ORGANIZATION]`；非 critical 不阻断 apply）——从"报告计数器"升级为"显式 unresolved 状态"。exact 重复组的折叠成员由组首代表，不重复落 quarantine。
- 人工 override（唯一晋升路径）：`historical_import_identity_overrides` 增 `import_batch_id`（0026）——现完整记录**原值（source_key）、新值（resolved_id）、操作者（overridden_by_staff_id FK）、原因（override_reason 必填）、时间（created_at）、import_run_id（import_batch_id）**。确定性映射或带审计的 override 命中前，行保持 unresolved。
- 门户隔离（测试实证）：`portal-isolation.test.ts` 新增 D1 级用例——导入全未匹配行后 `formal_orders`/`buyer_customers`/`seller_organizations`/`order_evidence_submissions` 计数不变；结构性断言：**没有任何视图读 historical 表、formal_orders 无任何指向 historical 的外键**——Buyer/Seller 门户查询（select 自 formal_orders 及其视图链）构造上无法带出 unresolved 数据；API 源码 grep 扩展到 `historical_image_inventory_*`；248 端点不变。Staff 读取面同理：无任何 historical 路由/表引用（grep 实证），角色/Marketplace scope/Personal DENY 由既有授权链承载（阶段 7/8 权限矩阵不变）。raw snapshot 永不删除（追溯）。

## 4. 统一 6 个月时间语义（阶段 5 风险 5 收口）

- 单一规则（`time.ts`）：**存储 UTC 毫秒；热保留资格 = 完整业务关闭时间 + 6 个 UTC 日历月；月底截断到目标月最后一天**（1 月 31 日 → 7 月 31 日；8 月 31 日 → 次年 2 月 28/29 日；闰年 2 月 29 日 → 8 月 29 日）；不使用固定 180 天；不使用 Asia/Shanghai 本地月计算资格；`formatShanghaiTimestamp` 仅展示，不改变存储值。
- `archiveDueAt`（closure DTO `archive_due_at`）与 `bundleEligibilityAt`（selector 门槛）收敛为同一实现（原差异最多 8 小时边界）；`addShanghaiCalendarMonths` 删除。
- 测试：`time.test.ts` 重写为统一断言（两者恒等 + 1/31、2/29 闰年、8/31、UTC 跨日 20:00 边界 + 永不为 180 天 + 展示不漂移）；归档容量验证的 183 天播种近似替换为逐行 `bundleEligibilityAt` 精确计数；导入器 `addMonthsUtc`（date-only）本就同规则，文档明确。

## 5. 多商品多行订单合同（阶段 6 风险 2 收口）

- **完全相同的重复行**（30 列事实一致）：确定性折叠为组首一条逻辑订单（既有行为不变）。
- **同一 `source_order_id` 下"行定义列"不同**（`HISTORICAL_LINE_DEFINING_COLUMNS`：ASIN、订单价格、服务费金额、买家/卖家返金金额、利润、买家/卖家汇率、汇率差——契约无数量列，若未来增加则入列）：`MULTI_LINE_ORDER_REQUIRES_MAPPING`（0026 扩展 quarantine CHECK，新增第 16 个 exception_code），**critical** → `can_apply=false`、APPLY 写 0 行；保留全部原始行与 source row 等待显式 mapping——**绝不取首行/末行/自动求和**。
- **仅非行定义列不同**（如买家微信）：仍 `CONFLICTING_DUPLICATE_GROUP`（critical）。两个方向各有独立单测 + 20k 容量夹具 C/D 两组分别覆盖。
- 未来由业务方提供显式 mapping/override 规则（真实源工作簿到位后裁定其为多商品订单/拆单/重复录入）。

## 6. 验证命令与真实结果（2026-08-26，阶段 6.5 提交前）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误（含 tools/imports workspace） |
| `npm test` | PASS：257 个测试文件、1725 个测试全部通过（含新增：drive-http-client 12、drive-http-integration 3、image-inventory 6、导入器 15、portal-isolation 3；容量配置外的常规套件） |
| `npm run build` | 通过 |
| `npm run check` | exit 0 |
| `openspec validate --all --strict` | 全部通过 |
| `npm run db:verify` | PASS（198 表/591 索引/378 触发器/12 视图，SHA-256 一致 + 负向 DML） |
| `npm run verify:migration-guards` | PASS（fresh schema 26、wrong-order/repeat 拒绝、失败快照不变） |
| `npm run verify:api-contract` | PASS（248 端点不变） |
| `npm run verify:archive-capacity` | PASS（阶段 5 用例回归 + 统一时间语义精确计数） |
| `npm run verify:historical-import-capacity` | PASS（20k 单 18.7s：19,330 条 IDENTITY_UNMATCHED 落库、MULTI_LINE/conflicting 分组拆分；100k 图片 30.6s：中断+resume 等价、19,000 重复组、堆 282MB） |
| 本地 D1 空库重放 | `wrangler d1 migrations apply --local --persist-to <temp>` 0001→0026 全部通过；`schema_version=26`，201 表/592 索引/378 触发器/12 视图（含 Wrangler 内部对象），`integrity_check=ok` |

（以上均为 2026-08-26 提交前最终本地运行的真实结果；`npm run check` 直接取进程退出码，未使用会掩盖退出码的日志管道。）

## 7. Schema 与治理锚点（0026）

- 前向追加 `0026_stage65_archive_import_closeout.sql`（schema 25 → 26）：quarantine 表同形重建（CHECK 增 `MULTI_LINE_ORDER_REQUIRES_MAPPING`；旧索引名显式 DROP 后重建；行原样搬运）；identity override 表 `ALTER ADD COLUMN import_batch_id`（nullable FK）；图片盘点三表 + 索引 + 触发器（批次/文件/findings no_delete；文件字节事实 update guard）。
- 同步推进的锚点：`verify-migration-version-guards.mjs`（26 / `0026_...`）、`verify-migrations.mjs`（26、inventory 198/591/378/12 + SHA `d9ccc921…`、required tables +3）、`first-owner.ts` / `operational-readiness/routes.ts` / `recovery-attestation-routes.ts` 的 `TARGET_SCHEMA=26`、四份生产文档链声明（`0001`–`0026`）。
- CLI 顺手修复：`historical-import.mjs help` 在阶段 6 因 USAGE 常量 TDZ 未定义即崩溃——移至首次使用前（无行为弱化）。

## 8. 远程边界声明

零远程操作：无 git push/PR/Issue、无 Cloudflare（D1/R2/Worker/Queue/DLQ/部署）操作、无 Google Drive 请求（REAL_DRIVE_REQUESTS=0）、无真实凭据读写、无真实数据导入或图片上传、未触碰任何外部历史源文件。synthetic 数据始终标记 synthetic（`real_image_inventory: NOT_RUN_SYNTHETIC_ONLY`、`real_historical_import: NOT_RUN_SYNTHETIC_ONLY`）。

## 9. 未解决风险

1. 真实历史导入仍未执行（材料清单见阶段 6 交接 §10；CLI 全链就绪）。
2. Drive 适配器代码就绪但未在真实 Google Drive 上运行过（协议按官方文档实现并由假 server 全链驱动；生产激活属阶段 8，需 R-006 清单 + secret 置入 + 双开关 + 首轮 shadow-copy 人工抽检）。
3. 图片盘点业务映射规则当前为"路径/basename 精确匹配 source_ref"——真实源命名若不同（如 URL 形态或带前缀），需在真实目录上跑 `inspect-images` 后由业务确认映射规则再扩展（规则失败方向 = QUARANTINE，不会误 LINKED）。
4. `IDENTITY_UNMATCHED` 现在使大多数合成行落入 quarantine 桶——dry-run 报告的 valid/quarantined 比例语义已随合同更新（容量夹具已按新口径重建并断言）。

## 10. 下一阶段

阶段 7（前端三端界面与交互重构）未开始；阶段 8（部署准备）未开始。等待下一条指令。
