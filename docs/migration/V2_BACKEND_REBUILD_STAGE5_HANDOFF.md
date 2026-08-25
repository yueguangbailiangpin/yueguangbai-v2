# 后端重建阶段 5 交接（冷归档、异步恢复与容量验证）

日期：2026-08-26。分支 `feature/staging-workflow-rate-ux`，基线 = 阶段 4 的 `5bbb3bfe` + 阶段 5 本地提交（未 push）。依据：D-054/D-055、`V2_BACKEND_REBUILD_INVENTORY.md` §4.3、OpenSpec `backend-clean-baseline-rebuild`。

## 0. 与 D-055 措辞的一处有意差异

本轮业务所有者指令明确"业务完全关闭满 **6 个 UTC 日历月**"（且"不要简单使用 180 天"）。本阶段实现按最新指令以 UTC 日历月计算 bundle 资格（`bundleEligibilityAt`，`apps/api/src/cold-image-archive/time.ts`）；既有 `order_archive_closures.archive_due_at` 仍按上海自然月（`archiveDueAt`）记录关闭事实。两者都是日历月而非 180 天，差异最多 8 小时量级；测试同时断言两种语义（`time.test.ts`）。后续如需统一，一条决策即可。

## 1. 数据模型（migration 0024，schema 23 → 24）

前向追加 `0024_cold_archive_bundle_model.sql`（不改写 0001–0023）：

- **删除被 D-055 取代的单文件模型**：`drive_archive_controls`、`file_drive_archives`、`file_drive_archive_manifests`、`file_drive_archive_events`、`file_drive_archive_reconciliations`、`file_drive_rehydrations`（无生产数据，全部为空表）。
- **新增 7 张表**：
  - `archive_bundles`：bundle_type（ORDER / BUYER_REFUND_PAYMENT / SELLER_SETTLEMENT_PAYMENT）+ ref_id + formal_order_id；状态机列 state（阶段 4 六态合同）；eligibility_at / sealed_at；manifest_version / manifest_sha256 / file_count / total_bytes；zip_byte_size / zip_mime / zip_sha256 / temp_zip_object_key；drive_file_id / folder_id / session_key / uploaded_at / verified_at；hot_files_total / hot_files_deleted / hot_delete_completed_at；archived_at / shadow_completed_at / restore_expires_at / superseded_by_version；lease / retry / failure 列。触发器：单向事实（NULL→值后不可改）、合法状态转换（无任何回到 ONLINE 的路径）、ARCHIVED 必须存在同事务 SUCCEEDED 归档任务（fail-closed）、当前版本唯一部分索引。
  - `archive_bundle_files`：manifest 条目（file_object_id、entry_index、safe_name 不可猜测 hex 名、purpose/visibility/mime/size/sha256、source_etag、source_version、entity 关系、source_created_at）+ 热删除进度（PENDING→DELETED，删除仅当 bundle 已 Drive 验证）。封存前可修正、封存后不可变。
  - `archive_bundle_events`：不可变事件流（BUNDLE_CREATED → MANIFEST_SEALED → ZIP_STREAMED → DRIVE_UPLOADED → DRIVE_READBACK_VERIFIED → HOT_FILE_DELETED → HOT_DELETE_COMPLETED → ARCHIVE_FINALIZED / SHADOW_COPY_COMPLETED / RESTORE_* / SUPERSEDED）。
  - `archive_jobs`：队列任务（dedupe_key 唯一 = `job_type:bundle_id:bundle_version`；PENDING/LEASED/SUCCEEDED/FAILED_RETRYABLE/DEAD_LETTERED/CANCELLED；lease 过期自动可恢复；attempt/max_attempts/next_retry_at/error_category/error_summary（脱敏）；trace_id/queue_message_id）。
  - `archive_restores` + `archive_restore_members`：Staff 恢复记录（请求幂等 UNIQUE(staff,key)、restore_expires_at=+7 天、状态 REQUESTED→RESTORING→COMPLETED→EXPIRED→CLEANED；成员临时对象 key 与期望 sha）。
  - `archive_runtime_controls`（单例）：selector / drive_upload / hot_delete / restore_worker 四开关 + shadow_copy_only（默认 1）+ drive_max_concurrency（默认 3，1–10）+ queue_batch_size（默认 5，1–5）。种子全关。
- 关键索引：`uq_archive_bundles_current`（(type,ref) WHERE is_current=1）、`idx_archive_bundles_scan`、`idx_archive_bundles_unit`（(type,ref,version,is_current)——容量扫描的索引化关键）、`idx_archive_bundle_files_file/pending_delete`、`idx_archive_jobs_ready/bundle`、`idx_archive_restores_expiry`、`idx_archive_restore_members_file`。
- 当前 inventory：190 表 / 565 索引 / 368 触发器 / 12 视图（`db:verify` 含 SHA-256 一致性 PASS）。

## 2. 归档资格与状态机（5.1）

- 三类 bundle：ORDER（订单截图 ORDER_EVIDENCE、评论截图 REVIEW_EVIDENCE、买家聊天、**卖家聊天 ORDER_EVIDENCE_INTERNAL_COMMUNICATION**——按 entity ORDER / ORDER_EVIDENCE_SUBMISSION / REVIEW 关联全部纳入）；BUYER_REFUND_PAYMENT（返款凭证，ref=obligation，要求余额 PAID）；SELLER_SETTLEMENT_PAYMENT（结算凭证，ref=payment，资格=支付/分配/冲正最晚事件）。
- 资格 fail closed：单元自身关闭事实完整 + **父订单 order_archive_closures 必须 CLOSED**；取所有必要关闭时间最晚值 + 6 个 UTC 日历月。
- 文件集变化：shadow 完成或 ARCHIVED 后出现新证据 → 旧版本 superseded（is_current=0, superseded_by_version），新版本 ONLINE 当前（未删除的热文件全部纳入，已删文件不重复归档）。已删除热文件后 order_archive_closures 不可 reopen（触发器级）。
- 公开状态即阶段 4 合同六态；内部步骤全部走 job phase（MANIFEST → ZIP_STREAMING → DRIVE_UPLOADING → DRIVE_READBACK_VERIFY → HOT_DELETING → ARCHIVE_FINALIZE；RESTORE_* 同理），未新增公开状态。

## 3. Manifest 与流式 ZIP（5.3）

- Manifest v1：manifest_version/bundle 标识/eligibility_at/created_at/file_count/total_bytes/files[]（file_object_id、entry_index、safe_name、purpose、audience visibility、mime、size、sha256、原始 R2 etag（封存时 head 快照）/file version、entity 关系、source_created_at）。稳定序列化 = canonicalJson（键排序紧凑）+ SHA-256；同一事实恒同哈希。不含姓名/手机号/微信号；ZIP 与 Drive 文件名均为不可猜测 id（`NNNN-<fnv1a64-hex16>.<ext>`，FNV-1a 双 64 位混合）。
- ZIP writer（`zip-writer.ts`）：store 模式（JPEG 等不重压缩）、manifest.json 为首成员（flags=0 完整头）+ 数据成员（flag 0x0008 数据描述符）；pull-based ReadableStream 逐块产出（背压由消费方控制）；增量 CRC-32 与增量 SHA-256（`packages/domain/src/crypto/`，纯 TS 无 Node API，与 WebCrypto 全量摘要全量对拍测试）；上限 5000 成员 / 单成员 64MiB / 总 1GiB（无 ZIP64 需求）；防 ZIP Slip（名严格 `[0-9a-zA-Z._-]`、禁 `/`、`..`、控制字符）、重复名拒绝；成员流不可得或尺寸不符 fail closed；取消路径显式 cancel。
- 写入临时 R2：`ObjectStorageAdapter.putObjectStream`（R2 真实适配器 `bucket.put(stream)`；Mock 同步实现）；写后从 R2 重新开流哈希回读校验，通过才记录 zip_sha256。

## 4. DriveArchiveClient 端口与 fake（5.4）

- `packages/contracts/src/cold-image-archive.ts` 定义可替换端口：`createUploadSession`（resumable）、`uploadChunk`（offset 分块，中断返回部分接受字节）、`queryUploadSession`（断点续传查询）、`readFileMetadata`、`openFileStream`（流式回读）。`DriveArchiveClientError` 仅携带类别（token/secret 绝不进 message；retryable 分类由类别驱动）。
- `FakeDriveArchiveClient`（`fake-drive-client.ts`）：会话/分块/中断（interruptNextUpload 模拟 308 半块接受）/限流/不可用/篡改注入；上传完成存内存文件并支持流式回读。**本轮未实现真实 Google Drive HTTP 客户端**（凭据与远程操作均被禁止）；生产适配器留待后续独立变更（见风险）。
- 上传循环：临时 ZIP 为不可变 R2 对象，中断后按已接受字节重开流续传，单 pass 无进展则 retryable 失败；256KiB 固定窗口。

## 5. Queue 与安全开关（5.5）

- 消息体仅 `{bundle_id, bundle_version, job_type, trace_id}`（`parseArchiveQueueMessage` 严格 4 键校验；多余键=毒消息→D1 DEAD_LETTERED + ack）。
- Worker `queue()` 消费者模板（`worker.ts`）：逐消息 ack / retry({delaySeconds=60·2^n+抖动，≤3600s})；DLQ 由 wrangler 模板（注释态）承载；无 floating promise。
- D1 `archive_jobs` 租约（90s）+ dedupe_key：重复投递不产生重复 ZIP/Drive 文件/删除/恢复（测试实证 uploads==1）。租约过期自动恢复；attempts 耗尽或不可重试类别 → DEAD_LETTERED（D1 记录，脱敏摘要）。
- 双层开关：env `ARCHIVE_*`（默认 false，release preflight 强制 false）+ D1 `archive_runtime_controls`（种子全关 + shadow_copy_only=1）。scheduled `drive_archive` 任务 = 发现（selector 分页扫描 + 断点 cursor_json）+ 过期恢复清理 + 本地 drain（无 Queue 绑定时的等效消费者，批量 ≤ queue_batch_size，ARCHIVE 任务需 drive_upload 开、RESTORE 需 restore_worker 开）；Queue producer 绑定时改发消息（`dispatchPendingArchiveJobs`，queue_message_id 去重）。
- 首扫 shadow-copy（默认）：完整走 manifest→临时 ZIP→fake Drive 上传→回读校验，**不删热文件、不标 ARCHIVED**，记录 shadow_completed_at 与预计释放 files/bytes（metrics 投影）。缺配置/非法/文件变化/校验失败一律不删（测试覆盖 readback 失败保留 R2、毒消息 DEAD、热对象消失 fail closed）。

## 6. Staff 恢复与占位（5.6）

- `POST /api/staff/operations/archive/bundles/:id/restore`：owner + SCHEDULED_OPERATIONS_RUN（与 close/reopen 同族）；ARCHIVED 或 RESTORE_FAILED（审计后重试）→ RESTORE_REQUESTED；幂等（acquireIdempotency + audit ARCHIVE_RESTORE_REQUESTED）；7 天时钟自请求起算。
- RESTORE_BUNDLE job：Drive 流式下载（边下边哈希，zip_sha256 校验）→ 临时 ZIP 落 R2 → 顺序解析 ZIP（自研流式 reader：LFH/数据描述符逐块、manifest.json 哈希对封存值校验、每成员 size+SHA-256 对 manifest 校验）→ 成员逐个流式写临时对象 `archive-restore/<hex>/` → RESTORED_TEMPORARILY。
- 读路径（`files/file-read-service.ts`）：per-file `hot_deleted` 判定（archive_bundle_files DELETED）——归档族状态下**任何受众（含 Staff）**读意图即 `FILE_ARCHIVED 410`（中文文案"文件已归档，请联系工作人员恢复"，不泄露 Drive ID/URL/object key；实时代理 Drive 路径已删除）；恢复有效期内经**原有授权链**（audience grants/ownership/scope/Personal DENY 全部前置）读临时副本；到期清理后回到 410。恢复不扩大可见范围（deny-all 授权在恢复后仍拒绝，测试覆盖）。
- 7 天清理（`runRestoreCleanupScan`，scheduled 每轮）：删成员+临时 ZIP → restore EXPIRED→CLEANED、bundle 回 ARCHIVED；**Drive 原包永不删除**（fake 计数断言不变）。
- 其余新路由：`GET /api/staff/operations/archive/bundles`（cursor 分页 + state/type 过滤）、`GET /api/staff/operations/archive/metrics`。清单从 246 → **248** 端点（-1 rehydrate，+3）；`V2_API_ROUTE_INVENTORY.md` 与 `app.routes` 双向一致。

## 7. 容量与指标（5.7）

- `npm run verify:archive-capacity`（vitest.capacity.config.ts，已入 `check` 链）：20,000 合成订单（真实夹具克隆链：buyer/reservation/submission/version/order/closure 全触发器通过）+ 100,000 文件元数据（5/单）。实测（2026-08-26，M 系本地）：**13.8 秒**完成 100 页扫描 → 19,502 bundles + 19,502 jobs；二次全量扫描 0 新建（幂等）；重复投递单 Drive 文件；毒 bundle DEAD_LETTER 不阻塞邻居；首/末页 42ms/85ms（无 O(N²)——曾出现的 file_objects.status 驱动计划已用 UNION 索引化查询与 `idx_archive_bundles_unit` 消除）；所有插入单行式，远低于 D1 每查询 100 绑定参数上限。
- `computeArchiveMetrics`（无 PII，staff 路由）：eligible backlog bundles/files/bytes（files/bytes 为已封存投影）、最老积压年龄、pending/processing/retry/failed/dead 任务、归档与恢复成功/失败总数、最近成功时间、活跃临时恢复数、清理积压、shadow-copy 预计释放 files/bytes、DLQ 计数。

## 8. 验证命令与真实结果（2026-08-26，阶段 5 提交前）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test` | 251 文件 / 1681 用例全部通过（新增 cold-image-archive 33 用例：资格边界/状态机/影子/全档/校验失败保序/毒消息/队列幂等与租约恢复/退避/supersede/Staff-only 恢复/7 天清理/占位/受众不扩大/settlement 独立/runner 集成/开关关闭；zip-writer 5；crypto 17；contracts 6；time 11） |
| `npm run build` | 通过 |
| `npm run check` | exit 0（含 verify:archive-capacity、全部命名 verifier、web 边界、build、静态构建） |
| `openspec validate --all --strict` | 63/63 |
| `npm run db:verify` | PASS（fresh/sequential inventory SHA-256 一致 + 负向 DML；190/565/368/12） |
| `npm run verify:migration-guards` | PASS（wrong-order 23 拒绝、repeat 24 拒绝、失败快照不变、FK/integrity） |
| `npm run verify:api-contract` | PASS（248 端点双向一致） |
| `npm run verify:archive-capacity` | PASS（13.8s，见 §7） |
| `npm run db:migrate:local` | 24/24 全链空库一次通过 |

## 9. 未解决风险

1. **真实 Google Drive HTTP 客户端未实现**（本轮禁止凭据/远程操作）：端口与 fake 已就绪并被全链测试驱动；生产适配器（OAuth refresh、resumable session URL、分块 PUT、元数据/流读）需独立变更 + R-006 外部激活清单，完成前 `ARCHIVE_DRIVE_UPLOAD_ENABLED` 保持 false。
2. **指标语义**：`eligible_backlog_files/bytes` 只统计已封存 manifest（未封存 bundle 不计）——20k 容量运行显示 0 属预期；如需"潜在文件积压"需加 facts 计数视图（阶段 6 顺手可做）。
3. **容量验证为本地 node:sqlite**：不冒充远程 Workers 压测；生产容量（D1/R2/Queue 真实吞吐 ≥ 日增到期量 1.5 倍）在阶段 8 预检完成。
4. **Shadow-copy 后的重复全流程**：切换真实删除前建议至少一轮完整 shadow + 人工抽检（metrics 投影 vs 实际）。
5. UTC/上海双月语义并存（§0），待业务所有者一句话统一。

## 10. 远程操作声明

本阶段未执行任何远程操作：无 push/PR、无 Cloudflare（D1/R2/Worker/Queue/DLQ/部署）操作、无 Google Drive 操作、无飞书操作、无真实数据导入。全部验证基于本地 checkout 与本地空库。

## 11. 下一阶段

阶段 6（历史订单及图片无损导入）：基于本阶段已提交实现重建导入工具（`tools/imports` 复用 + `historical_import_*` 前向迁移）、dry-run 默认、apply/resume/reconcile、20,000 单合成容量与 reconciliation；仓库内无真实历史导出文件（源工作簿在仓库外且当前机器缺失），REAL_HISTORICAL_IMPORT=NOT_RUN 将如实声明。等待下一条指令后再执行。
