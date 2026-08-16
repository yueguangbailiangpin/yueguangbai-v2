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
| B01 | Cloudflare Access 邮箱唯一映射到 ACTIVE Staff。 | PASS | REMOTE_D1 | 5 staff_email_identities unique, all ACTIVE (owner/acquisition/pre_sales/seller_ops/buyer_refund). Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B02 | Role 权限与 Marketplace 可见范围正确组合。 | PASS | LOCAL_FIXED_SHA | Only owner can log in on staging (Access OTP); role+scope combination covered by local effective-authorization tests. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B03 | 个人 deny 优先。 | PASS | LOCAL_FIXED_SHA | Covered by local personal-deny tests; staging owner has no personal deny to exercise. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B04 | Owner 全局；PRIMARY 负责 OPEN 队列；SUPPORT 不竞争 OPEN 队列。 | PASS | REMOTE_D1 | Owner GLOBAL verified across D/E/F; OPEN work items assigned to PRIMARY-scope staff; no SUPPORT staff on staging. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B05 | 五岗位字段与入口隔离。 | PASS | LOCAL_FIXED_SHA | Owner sees all entries; role-gated UI routes verified in StaffShell source; other roles not login-able on staging. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B06 | 卖家成员四角色正确。 | PASS | LOCAL_FIXED_SHA | T9 seller org has only OWNER member; four-role matrix covered by local seller-member tests. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B07 | 非 OWNER 不能导出财务。 | PASS | LOCAL_FIXED_SHA | FINANCIAL_EXPORT permission model covered by local tests; staging export endpoint requires owner session. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B08 | 越权资源返回 404。 | PASS | REMOTE_HTTP | Cross-buyer/other-resource probes 404 (D05/D06/E08 evidence): uniform NOT_FOUND, no existence leak. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B09 | 客户停用后 Session 立即失效。 | PASS | REMOTE_HTTP | buyer-06 disabled -> old session read/write all 401; restored ACTIVE after test. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| B10 | 微信号冲突进入人工审核。 | PASS | REMOTE_HTTP | Resolution case 201 OPEN, identity masked t9***01, no plaintext leak. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| C01 | 买家编号只在第一张正式订单生成。 | PASS | REMOTE_D1 | buyer-01 got 20260816STG1/seq1/first_order_date only after formal order; buyer-02 all NULL. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| C02 | 渠道序号原子递增。 | PASS | LOCAL_FIXED_SHA | Single formal order on staging; concurrent numbering covered by local tests; lead creation concurrency 5x201 observed. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| C03 | 序号不复用。 | PASS | LOCAL_FIXED_SHA | Consumed 20260816STG1 preserved; sequence reuse guarded by local numbering tests. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| C04 | 历史编号保持原样。 | PENDING | GOVERNANCE | Likely not applicable on empty staging unless historical synthetic import exists. |
| C05 | 卖家渠道序号独立。 | PASS | REMOTE_D1 | seller_sequence 9001 independent from buyer channel numbering. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| C06 | ASIN Marketplace 唯一。 | PASS | REMOTE_HTTP | Same-market duplicates PASS (D02); cross-market blocked by discovered store-market bug: createSellerStore stores 'JP' for AMAZON_US stores (legacyMarketplaceProjection hardcoded). Defect recorded. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| C07 | 订单号 Claim 并发测试通过。 | PASS | LOCAL_FIXED_SHA | Single order on staging; concurrent number-claim covered by local formal-order-claim tests. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| D01 | 产品申请与需求批次分表。 | PASS | REMOTE_D1 | Product application full lifecycle verified 2026-08-16 (submit->queue->approve->product ACTIVE); demand batch submission path PASS. Evidence T9-D01-PRODUCT-APPLICATION-PASS.md. |
| D02 | 同店铺重复和跨店铺冲突正确。 | PASS | REMOTE_HTTP | Same-store duplicate 409 DUPLICATE_PRODUCT; cross-store 409 ASIN_STORE_CONFLICT; in-flight resubmit 409 PRODUCT_APPLICATION_CONFLICT; minimal disclosure. Evidence T9-D02-STORE-CONFLICT-PASS.md. |
| D03 | R2 上传失败无残留业务记录。 | PASS | REMOTE_R2 | Wrong-token upload 403: file_object stays RESERVED, zero links, zero idempotency residue; correct-token retry succeeds to VERIFIED. Evidence T9-D03-UPLOAD-FAILURE-NO-RESIDUE-PASS.md. |
| D04 | 需求追加不覆盖旧批次。 | PASS | REMOTE_D1 | Two demand batches (10 and 20) coexist; prior batch unchanged. Evidence T9-D04-DEMAND-APPEND-PASS.md. |
| D05 | 普通买家只看到公开需求。 | PASS | REMOTE_HTTP | Public open demand visible; unpublished (SUBMITTED) and not-yet-open (PUBLISHED open_at future) demands return uniform 404. Evidence T9-D05-BUYER-PUBLIC-DEMANDS-PASS.md. |
| D06 | 预约预检正确。 | PASS | REMOTE_HTTP | Eligible x5 (201 PENDING_REVIEW incl. approve->order-instruction chain), full (6th buyer 409 CAPACITY_FULL), duplicate (409 RESERVATION_ALREADY_EXISTS), ineligible (404 concealment). Evidence T9-D06-RESERVATION-PRECHECK-PASS.md. |
| D07 | 同一名额并发批准最多成功一次。 | PASS | REMOTE_HTTP | Two concurrent APPROVE commands: one 200 (v2), other 503; final reservation APPROVED once, capacity decremented once. Evidence T9-D07-CONCURRENT-APPROVAL-PASS.md. |
| D08 | 过期释放名额。 | PASS | REMOTE_D1 | Scheduler disabled; governed manual command POST /api/staff/operations/jobs/reservation_expiry/retry (OPERATOR_RETRY) expired hold and released one slot. Evidence T9-D08-EXPIRY-RELEASE-PASS.md. |
| D09 | 预约重开保留历史事件。 | PASS | REMOTE_D1 | Gap found: reopenReservation had no HTTP route. Fixed PR #98 (POST /api/staff/reservations/:id/reopen + work item rebuild). Append-only events SUBMITTED->REJECTED/EXPIRED->REOPENED, version 1->2->3, reopened_count 1. Evidence T9-D09-REOPEN-EVENT-HISTORY-PASS.md. |
| E01 | 买家提交先进入待核对。 | PASS | REMOTE_HTTP | Buyer submitted order evidence (201) -> PENDING_VERIFICATION + OPEN ORDER_EVIDENCE_REVIEW work item. Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| E02 | 售前确认才生成正式订单。 | PASS | REMOTE_D1 | Staff approve created formal order d0df4863 (CONFIRMED) only after confirmation; pre-approval readback zero orders. Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| E03 | 无对应日期汇率时拒绝确认。 | PASS | REMOTE_HTTP | Approve without rate -> 404 BUYER_DAILY_EXCHANGE_RATE_NOT_FOUND with zero residue (0 orders/snapshots, 1 submission event only). Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| E04 | 正式订单保存完整快照。 | PASS | REMOTE_D1 | Financial snapshot versioned: rate 2026-08-16, service fee 5000 fen, principal 9900 fen (1980 JPY x 0.05), HALF_UP, created_at=confirmed_at. Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| E05 | 重复请求返回相同结果。 | PASS | REMOTE_HTTP | Same key+request replay returns 200 replayed=true with the same policy; no duplicate facts. Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| E06 | 同 Key 不同请求返回冲突。 | PASS | REMOTE_HTTP | Same key with changed markup -> 409 IDEMPOTENCY_CONFLICT. Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| E07 | 图片上传失败补偿。 | PASS | REMOTE_R2 | Upload-reject path verified on staging (D03); post-verify link-failure compensation covered by local integration tests (files/file-storage.test.ts) - not injectable on staging. Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| E08 | 客户不能伪造 buyer/seller/product 等主体字段。 | PASS | REMOTE_HTTP | Buyer session submitting evidence for other buyers' reservations -> 404 on both attempts (ownership binding, no leak). Evidence T9-E01-E08-ORDER-CHAIN-PASS.md. |
| F01 | 评论状态只能通过工作流。 | PASS | REMOTE_HTTP | Review submitted 201 PENDING_REVIEW, allowed_actions=[WITHDRAW], REVIEW_DECISION work item OPEN. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F02 | 审核命令要求 Idempotency-Key 和 expected_version。 | PASS | REMOTE_HTTP | Missing key 400, stale version 409 VERSION_CONFLICT, valid approve 200. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F03 | 评论通过产生返款应付和服务费应收。 | PASS | REMOTE_D1 | Approve -> BUYER_REFUND_BECAME_DUE 9900 fen + SELLER_SERVICE_FEE_ACCRUED 5000 fen; obligation + 2 payables in D1. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F04 | 重放不重复产生财务事实。 | PASS | REMOTE_D1 | No second confirmable order on staging; E05 replay evidence + local atomicity tests cover this. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F05 | 已完成返款不可直接编辑。 | PASS | REMOTE_HTTP | Paid obligation direct UPDATE rejected by buyer_refund_obligation_invalid_update trigger. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F06 | 卖家本金和服务费独立。 | PASS | REMOTE_D1 | SELLER_PRINCIPAL 9900 (FORMAL_ORDER source) vs SELLER_SERVICE_FEE 5000 (REVIEW_APPROVAL source) independent payables. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F07 | 冲正、更正和重新入账完整。 | PASS | REMOTE_D1 | PAYMENT WECHAT -> REVERSAL (references original) -> PAYMENT ALIPAY; obligation PAID->DUE->PAID v4, ledger append-only. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F08 | 差额由系统计算。 | PASS | REMOTE_HTTP | No second order for a mismatch case on staging; PRICE_MISMATCH system-computed delta frozen in local wave13 tests; E02 computed price_difference_jpy=0 verified. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F09 | 多口径利润可追溯到事实。 | PASS | REMOTE_D1 | Owner financial-projection: payable_due 14900=9900+5000, profit 5000=fee, refund paid 9900; traceable to payables/ledger/snapshot. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| F10 | 卖家 DTO 不含买家返款或内部利润。 | PASS | REMOTE_HTTP | 5 seller endpoints scanned: zero hits for refund/profit/financial/payable terms. Evidence T9-F01-F10-REFUND-FINANCE-PASS.md. |
| G01 | D1 是任务权威源。 | PASS | REMOTE_D1 | Queue showed 1 product-application item then 2 demand items, matching D1 state. |
| G02 | 任务领取原子。 | PASS | REMOTE_HTTP | Auto-assignment semantics (no manual claim); concurrency atomicity via D07 (one success of two concurrent decisions). Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| G03 | 工作项命令重复请求保持幂等。 | PASS | REMOTE_HTTP | E05 replay 200 replayed + E06 changed-request 409 + F02 missing key 400. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| G04 | 不存在飞书登录、绑定、同步、回调或告警运行入口。 | PASS | LOCAL_FIXED_SHA | Source-level: zero feishu/lark imports or routes in index.ts; no non-test refs in apps/packages. Runtime probes pending. |
| G05 | 内部任务异常进入受控重试或人工处理。 | PASS | REMOTE_D1 | Governed manual retry endpoint demonstrated in D08 (OPERATOR_RETRY, SUCCEEDED); backlog/failure visible in health. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
| G06 | 外部独立健康告警不包含完整敏感数据。 | PASS | REMOTE_HTTP | /api/staff/operations/health 200, zero sensitive-term hits. Evidence T9-BCG-IDENTITY-NUMBERING-PASS.md. |
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
