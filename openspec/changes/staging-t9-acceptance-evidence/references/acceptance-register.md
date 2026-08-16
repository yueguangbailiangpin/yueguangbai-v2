# T9 A-H Acceptance Register

Canonical count: 67. `PENDING` is a working state only; the final report must convert every row to `PASS`, `FAIL`, `BLOCKED`, `CONFLICT` or `NOT_APPLICABLE`.

| ID | Canonical entry | Initial status | Primary evidence | Dependency / boundary |
|---|---|---|---|---|
| A01 | 从空目录初始化全新 Git。 | CONFLICT | GOVERNANCE | Existing governed repository; do not replace it with a new Git history. |
| A02 | 无远程 origin。 | CONFLICT | GOVERNANCE | Current repository requires GitHub origin; do not remove it. |
| A03 | 无旧 Migration、资源 ID、Secrets 或真实数据。 | CONFLICT | GOVERNANCE | Historical migrations are immutable; staging IDs/Secrets remain Git-external and data must be synthetic. |
| A04 | TypeScript 严格检查通过。 | PASS | LOCAL_FIXED_SHA | typecheck exit 0 at 9cd4a113 rebased T9 head (2026-08-16). |
| A05 | Secret/PII 扫描通过。 | PASS | LOCAL_FIXED_SHA | security:scan passed 1712 files at 9cd4a113; managed evidence dirs 0600. |
| A06 | Hono `/health` 本地通过。 | PASS | LOCAL_FIXED_SHA | Local app.test.ts 3/3 (200 + x-request-id + security headers). Authenticated staging probe pending. |
| A07 | 所有 Migration 从空库连续执行。 | PASS | REMOTE_D1 | db:verify PASS (70 migrations, schema 70, fresh sequential match); staging ledger 70/70; remote business tables == local chain (diff empty). |
| A08 | `PRAGMA integrity_check=ok`。 | PASS | REMOTE_D1 | Reconstructed from wrangler d1 export: integrity_check=ok. |
| A09 | `PRAGMA foreign_key_check` 为 0。 | PASS | REMOTE_D1 | Reconstructed from wrangler d1 export: foreign_key_check returns 0 rows. |
| B01 | Cloudflare Access 邮箱唯一映射到 ACTIVE Staff。 | PENDING | REMOTE_HTTP | Five synthetic Staff identities. |
| B02 | Role 权限与 Marketplace 可见范围正确组合。 | PENDING | REMOTE_HTTP | Five canonical Staff roles. |
| B03 | 个人 deny 优先。 | PENDING | REMOTE_HTTP | Server rejection plus no-side-effect readback. |
| B04 | Owner 全局；PRIMARY 负责 OPEN 队列；SUPPORT 不竞争 OPEN 队列。 | PENDING | GOVERNANCE | Validate current assignment semantics; mark conflict if wording is stale. |
| B05 | 五岗位字段与入口隔离。 | PENDING | REMOTE_HTTP | UI and API response projection. |
| B06 | 卖家成员四角色正确。 | PENDING | REMOTE_HTTP | Synthetic Seller organization with four member roles. |
| B07 | 非 OWNER 不能导出财务。 | PENDING | REMOTE_HTTP | Exercise the actual export endpoint, not button visibility. |
| B08 | 越权资源返回 404。 | PENDING | REMOTE_HTTP | Cross-Buyer/Seller/Marketplace known-resource probes. |
| B09 | 客户停用后 Session 立即失效。 | PENDING | REMOTE_HTTP | Formal disable and old-session read/write probes. |
| B10 | 微信号冲突进入人工审核。 | PENDING | REMOTE_HTTP | Formal onboarding conflict; no direct SQL. |
| C01 | 买家编号只在第一张正式订单生成。 | PENDING | REMOTE_D1 | Full synthetic order chain. |
| C02 | 渠道序号原子递增。 | PENDING | REMOTE_D1 | Concurrent synthetic Buyer creation. |
| C03 | 序号不复用。 | PENDING | REMOTE_D1 | Preserve consumed sequence facts. |
| C04 | 历史编号保持原样。 | PENDING | GOVERNANCE | Likely not applicable on empty staging unless historical synthetic import exists. |
| C05 | 卖家渠道序号独立。 | PENDING | REMOTE_D1 | Formal Seller onboarding across channels. |
| C06 | ASIN Marketplace 唯一。 | PENDING | REMOTE_HTTP | Same-Marketplace duplicate and cross-Marketplace scope. |
| C07 | 订单号 Claim 并发测试通过。 | PENDING | REMOTE_HTTP | Concurrent requests plus final D1 claim state. |
| D01 | 产品申请与需求批次分表。 | PASS | REMOTE_D1 | Product application full lifecycle verified 2026-08-16 (submit->queue->approve->product ACTIVE); demand batch submission path PASS. Evidence T9-D01-PRODUCT-APPLICATION-PASS.md. |
| D02 | 同店铺重复和跨店铺冲突正确。 | PASS | REMOTE_HTTP | Same-store duplicate 409 DUPLICATE_PRODUCT; cross-store 409 ASIN_STORE_CONFLICT; in-flight resubmit 409 PRODUCT_APPLICATION_CONFLICT; minimal disclosure. Evidence T9-D02-STORE-CONFLICT-PASS.md. |
| D03 | R2 上传失败无残留业务记录。 | PASS | REMOTE_R2 | Wrong-token upload 403: file_object stays RESERVED, zero links, zero idempotency residue; correct-token retry succeeds to VERIFIED. Evidence T9-D03-UPLOAD-FAILURE-NO-RESIDUE-PASS.md. |
| D04 | 需求追加不覆盖旧批次。 | PASS | REMOTE_D1 | Two demand batches (10 and 20) coexist; prior batch unchanged. Evidence T9-D04-DEMAND-APPEND-PASS.md. |
| D05 | 普通买家只看到公开需求。 | PASS | REMOTE_HTTP | Public open demand visible; unpublished (SUBMITTED) and not-yet-open (PUBLISHED open_at future) demands return uniform 404. Evidence T9-D05-BUYER-PUBLIC-DEMANDS-PASS.md. |
| D06 | 预约预检正确。 | PASS | REMOTE_HTTP | Eligible x5 (201 PENDING_REVIEW incl. approve->order-instruction chain), full (6th buyer 409 CAPACITY_FULL), duplicate (409 RESERVATION_ALREADY_EXISTS), ineligible (404 concealment). Evidence T9-D06-RESERVATION-PRECHECK-PASS.md. |
| D07 | 同一名额并发批准最多成功一次。 | PASS | REMOTE_HTTP | Two concurrent APPROVE commands: one 200 (v2), other 503; final reservation APPROVED once, capacity decremented once. Evidence T9-D07-CONCURRENT-APPROVAL-PASS.md. |
| D08 | 过期释放名额。 | PASS | REMOTE_D1 | Scheduler disabled; governed manual command POST /api/staff/operations/jobs/reservation_expiry/retry (OPERATOR_RETRY) expired hold and released one slot. Evidence T9-D08-EXPIRY-RELEASE-PASS.md. |
| D09 | 预约重开保留历史事件。 | PASS | REMOTE_D1 | Gap found: reopenReservation had no HTTP route. Fixed PR #98 (POST /api/staff/reservations/:id/reopen + work item rebuild). Append-only events SUBMITTED->REJECTED/EXPIRED->REOPENED, version 1->2->3, reopened_count 1. Evidence T9-D09-REOPEN-EVENT-HISTORY-PASS.md. |
| E01 | 买家提交先进入待核对。 | PENDING | REMOTE_HTTP | Buyer evidence submission plus Staff queue. |
| E02 | 售前确认才生成正式订单。 | PENDING | REMOTE_D1 | Pre/post-confirmation readback. |
| E03 | 无对应日期汇率时拒绝确认。 | PENDING | REMOTE_HTTP | Missing-date failure with zero partial facts. |
| E04 | 正式订单保存完整快照。 | PENDING | REMOTE_D1 | Snapshot before/after authority changes. |
| E05 | 重复请求返回相同结果。 | PENDING | REMOTE_HTTP | Same idempotency key and request. |
| E06 | 同 Key 不同请求返回冲突。 | PENDING | REMOTE_HTTP | Same key with changed canonical request. |
| E07 | 图片上传失败补偿。 | PENDING | REMOTE_R2 | Verified object/link failure compensation. |
| E08 | 客户不能伪造 buyer/seller/product 等主体字段。 | PENDING | REMOTE_HTTP | Adversarial payload with trusted-session readback. |
| F01 | 评论状态只能通过工作流。 | PENDING | REMOTE_HTTP | Legal transitions and illegal write rejection. |
| F02 | 审核命令要求 Idempotency-Key 和 expected_version。 | PENDING | REMOTE_HTTP | Missing, stale and replay cases. |
| F03 | 评论通过产生返款应付和服务费应收。 | PENDING | REMOTE_D1 | Minimal synthetic financial facts. |
| F04 | 重放不重复产生财务事实。 | PENDING | REMOTE_D1 | Compare ledger/event/audit counts. |
| F05 | 已完成返款不可直接编辑。 | PENDING | REMOTE_HTTP | Correction must use reversal flow. |
| F06 | 卖家本金和服务费独立。 | PENDING | REMOTE_D1 | Separate sources and balances. |
| F07 | 冲正、更正和重新入账完整。 | PENDING | REMOTE_D1 | Append-only payment/reversal chain. |
| F08 | 差额由系统计算。 | PENDING | REMOTE_HTTP | Reject client authority and inspect computed delta. |
| F09 | 多口径利润可追溯到事实。 | PENDING | REMOTE_D1 | Owner-only synthetic financial projection. |
| F10 | 卖家 DTO 不含买家返款或内部利润。 | PENDING | REMOTE_HTTP | Inspect actual Seller responses/exports. |
| G01 | D1 是任务权威源。 | PASS | REMOTE_D1 | Queue showed 1 product-application item then 2 demand items, matching D1 state. |
| G02 | 任务领取原子。 | PENDING | REMOTE_HTTP | Concurrent claim and final version. |
| G03 | 工作项命令重复请求保持幂等。 | PENDING | REMOTE_HTTP | Same-key replay and changed-request conflict. |
| G04 | 不存在飞书登录、绑定、同步、回调或告警运行入口。 | PASS | LOCAL_FIXED_SHA | Source-level: zero feishu/lark imports or routes in index.ts; no non-test refs in apps/packages. Runtime probes pending. |
| G05 | 内部任务异常进入受控重试或人工处理。 | PENDING | REMOTE_D1 | Governed manual failure because scheduler is disabled. |
| G06 | 外部独立健康告警不包含完整敏感数据。 | PENDING | REMOTE_HTTP | Staging alert mode remains disabled; inspect safe health payload. |
| G07 | 正式动作必须打开受控 Web 页面。 | PASS | REMOTE_HTTP | Product application approved from Staff Web (2026-08-16). |
| H01 | D1 完整备份生成哈希和 Manifest。 | BLOCKED | T10_LINK | Independent T10 recovery Change. |
| H02 | 隔离恢复演练通过。 | BLOCKED | T10_LINK | Independent T10 recovery Change. |
| H03 | R2 Manifest 可核对。 | BLOCKED | T10_LINK | Independent T10 recovery Change. |
| H04 | Staging 全流程通过。 | PENDING | GOVERNANCE | Depends on all executable T9 rows and linked T10 rows. |
| H05 | 中国大陆主要网络实测门户可用。 | BLOCKED | EXTERNAL_OPERATOR | Requires real mainland carrier/WeChat-network evidence. |
| H06 | 真实导入先 PREVIEW、再人工审批。 | PENDING | REMOTE_HTTP | Use staging-only fixture and explicit approval evidence. |
| H07 | 生产部署有显式授权和回滚方案。 | BLOCKED | GOVERNANCE | Production remains NO_GO and out of scope. |

## Totals

- Total: 67
- Initial terminal conflicts: 3
- Initial external/dependency blockers: 5
- Pending execution: 51
- Passed/failed: 9/0
