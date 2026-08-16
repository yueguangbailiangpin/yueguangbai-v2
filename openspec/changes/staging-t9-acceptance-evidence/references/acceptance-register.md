# T9 A-H Acceptance Register

Canonical count: 67. `PENDING` is a working state only; the final report must convert every row to `PASS`, `FAIL`, `BLOCKED`, `CONFLICT` or `NOT_APPLICABLE`.

| ID | Canonical entry | Initial status | Primary evidence | Dependency / boundary |
|---|---|---|---|---|
| A01 | 从空目录初始化全新 Git。 | CONFLICT | GOVERNANCE | Existing governed repository; do not replace it with a new Git history. |
| A02 | 无远程 origin。 | CONFLICT | GOVERNANCE | Current repository requires GitHub origin; do not remove it. |
| A03 | 无旧 Migration、资源 ID、Secrets 或真实数据。 | CONFLICT | GOVERNANCE | Historical migrations are immutable; staging IDs/Secrets remain Git-external and data must be synthetic. |
| A04 | TypeScript 严格检查通过。 | PENDING | LOCAL_FIXED_SHA | Run at final T9 head. |
| A05 | Secret/PII 扫描通过。 | PENDING | LOCAL_FIXED_SHA | Run at final T9 head and inspect managed evidence permissions separately. |
| A06 | Hono `/health` 本地通过。 | PENDING | LOCAL_FIXED_SHA | Local behavior plus authenticated staging probe. |
| A07 | 所有 Migration 从空库连续执行。 | PENDING | REMOTE_D1 | Reference real staging 0001-0070 ledger and fresh-chain verifier. |
| A08 | `PRAGMA integrity_check=ok`。 | PENDING | REMOTE_D1 | Use reconstructed staging export, not D1 quick_check. |
| A09 | `PRAGMA foreign_key_check` 为 0。 | PENDING | REMOTE_D1 | Use reconstructed staging export. |
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
| D01 | 产品申请与需求批次分表。 | PENDING | REMOTE_D1 | Formal Seller submission and Staff demand path. |
| D02 | 同店铺重复和跨店铺冲突正确。 | PENDING | REMOTE_HTTP | Minimal disclosure in conflict responses. |
| D03 | R2 上传失败无残留业务记录。 | PENDING | REMOTE_R2 | Isolated staging R2 compensation case. |
| D04 | 需求追加不覆盖旧批次。 | PENDING | REMOTE_D1 | Append and compare immutable prior batch/event. |
| D05 | 普通买家只看到公开需求。 | PENDING | REMOTE_HTTP | Public versus unpublished/closed synthetic demand. |
| D06 | 预约预检正确。 | PENDING | REMOTE_HTTP | Eligible/full/duplicate/ineligible cases. |
| D07 | 同一名额并发批准最多成功一次。 | PENDING | REMOTE_HTTP | Two Staff commands and final capacity. |
| D08 | 过期释放名额。 | PENDING | REMOTE_D1 | Scheduler is disabled; use governed manual command only. |
| D09 | 预约重开保留历史事件。 | PENDING | REMOTE_D1 | Append-only event/version readback. |
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
| G01 | D1 是任务权威源。 | PENDING | REMOTE_D1 | Page/API versus D1 final state. |
| G02 | 任务领取原子。 | PENDING | REMOTE_HTTP | Concurrent claim and final version. |
| G03 | 工作项命令重复请求保持幂等。 | PENDING | REMOTE_HTTP | Same-key replay and changed-request conflict. |
| G04 | 不存在飞书登录、绑定、同步、回调或告警运行入口。 | PENDING | LOCAL_FIXED_SHA | Runtime route probes plus current-source inventory. |
| G05 | 内部任务异常进入受控重试或人工处理。 | PENDING | REMOTE_D1 | Governed manual failure because scheduler is disabled. |
| G06 | 外部独立健康告警不包含完整敏感数据。 | PENDING | REMOTE_HTTP | Staging alert mode remains disabled; inspect safe health payload. |
| G07 | 正式动作必须打开受控 Web 页面。 | PENDING | REMOTE_HTTP | Execute formal actions from Staff Web; no external task authority. |
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
- Pending execution: 59
- Passed/failed: 0/0
