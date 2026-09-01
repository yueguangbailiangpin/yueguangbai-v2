# 月光白 V2 当前系统状态

本文件只提供当前入口和已知发布边界，不定义新的业务规则。发生冲突时严格遵循仓库根目录 `AGENTS.md` 的权威顺序：用户最新决定 → Decision Register → Product Rules → Contracts → Architecture → 当前验收文件。

## 当前基线

- 唯一正式开发基线：最新 `main`
- 历史产品冻结点：`feature/frozen-portals-staff-acquisition-core@8cb39ed870df1fc5c6874dd4e5b86e12e22c39d2`
- 历史最终稳定化点：`chore/final-stabilization-cleanup@4106bc0668eaacf5bff34cb8e5ad174dcc356d77`
- 2026-08-12：上述稳定化历史通过 PR #46 正常合入 `main`，未改写 388 个提交的历史
- 当前 Schema：42（阶段 7.5 追加 0031 员工订单列表索引、0032 公司公开客服渠道、0033 卖家结算批次；阶段 7.5R 追加 0034 `SERVICE_CHANNEL_QR` 受控文件链、0035 结算批次取消修复、0036 `BATCH_CANCELLED` 保留标记；0037 多市场 Staff 订单列表性能准备索引；`owner-zero-consumer-object-cleanup` 追加 0038 Owner 授权零消费者对象清理——删除买家注册三件套+状态视图、恒空游标断言表与 `formal_order_effective_dates` 视图；`owner-zero-consumer-object-cleanup-bd` 追加 0039 B+D 组实证收窄清理——删除邀请线索表与权限目录声明表；分配权限守卫链（defaults 表+生效权限视图+守卫触发器）经触发器体实证审计确认承重，保留并断言存活；`owner-seed-yueguangbai-channel` 追加 0040 补种 yueguangbai 通道后，`owner-alias-yueguangbai-ygbceping` 追加 0041 按同日终裁"月光白=ygbceping"收口该种子（引用组织改指 ygbceping、通道行 DISABLED 墓碑保留）并归并别名——均为数据级变更，对象计数不变，六 ACTIVE 通道+一墓碑；`marketplace-runtime-expansion-rakuten-yahoo-us` 追加 0042 五平台扩容——注册表七行（+RAKUTEN_JP/YAHOO_JP/TEMU_JP/TIKTOK_JP）、五处 CHECK 扩七码、contracts/runtime 同步七码）
- **当前 API inventory（2026-08-30，本地运行时核验）：241 个唯一端点 = 239 个 `/api/*` + `/health` + `/ready`。** 历史数字保留其原有阶段语义：阶段 6.6 为 219 个端点，阶段 6.6E 为 224 个端点；阶段 7.5 在 224 的基础上新增 14 个（第一批员工工作台摘要 1 个、第二批公司公开客服渠道 3 个、第三批卖家结算批次 10 个），形成 238 个；阶段 7.5R 再新增客服二维码受控文件链的上传意图与挂载/清除 2 个端点，形成 240 个；本轮新增已发布需求关闭端点 `POST /api/staff/demand-batches/:id/close`，形成当前 241 个。`npm run verify:api-contract` 由现有 verifier 直接统计并由运行时 `app.routes` 双向断言，当前退出码为 0。
- **Seller 结算读取端点级边界（2026-08-30，本地代码与测试核验）：** `summary`、`payables`、`payables/:id`、`payments`、`payments/:id` 仅允许 ACTIVE Seller `OWNER`/`FINANCE`；`OPERATIONS`/`VIEWER` 为 concealed `404`。`batches`、`batches/:id` 允许四类 ACTIVE Seller 成员读取本组织非草稿批次，使用 Seller-safe DTO；Seller 批次边界的 Buyer 为 concealed `404`。未认证、无效会话和 DISABLED Seller 成员保持 `401`；跨组织列表为空或详情 concealed `404`。本次不新增 Migration、不改变 DTO、结算写端点、批次状态机、共享游标或预约自动审核。
- 前一轮目标 Schema：29（阶段 3 建立 0001–0019 干净 baseline；阶段 4 追加 0020–0023 marketplace canonical 统一与机器获客字段删除；阶段 5 追加 `0024_cold_archive_bundle_model.sql`（ZIP Bundle 冷归档，schema 24）；阶段 6 追加 `0025_historical_order_import.sql`（历史导入 5 张事实表，schema 25）；阶段 6.5 追加 `0026_stage65_archive_import_closeout.sql`（schema 26：quarantine CHECK 扩展 `MULTI_LINE_ORDER_REQUIRES_MAPPING`、identity override 增 `import_batch_id` 审计列、图片盘点三表）；阶段 6.6A 追加 `0027_stage66_single_source_convergence.sql`（schema 27：Marketplace Registry 单一来源、买家编号建档即分配、汇率/加点/服务费单版本即时生效、财务快照合并单一不可变表）；阶段 6.6B 追加 `0028_stage66b_fixed_assignment_and_files.sql`（schema 28：四角色固定分配、组织架构/轮转/兜底/排班/重分配表退役、卖家组织全量可见（store grants/scopes 退役）、产品主要对接人、预约一次性例外表、订单沟通截图统一为 `ORDER_COMMUNICATION_SCREENSHOT`、付款截图每版本唯一）；阶段 6.6C 追加 `0029_stage66c_retire_acquisition_outbox.sql`（schema 29：获客 CRM 18 表、Integration Outbox 与 dead-letter 表、outbox_delivery 任务退役；两张邀请表去 acquisition FK）；阶段 6.6E 追加 `0030_stage66e_invitation_binding_and_permission_cleanup.sql`（schema 30：买家邀请绑定既有 `buyer_customer_id` 列、`ACQUISITION_ADMIN`/`ACQUISITION_BUYER_LEAD`/`ACQUISITION_SELLER_LEAD` 从 staff_permission_overrides 白名单删除并收紧 CHECK、`staff_effective_assignment_permissions` 视图与两个 staff_guard 触发器按 0028 同模式重建））。当前 inventory：155 表 / 488 索引 / 305 触发器 / 10 视图（SHA-256 由 `db:verify` 锚定；0037 仅追加索引；0038 删除 4 表 8 触发器 2 视图；0039 删 2 表——161→157→155 表、494→490→488 索引、313→305 触发器、12→10 视图）
- 验证边界：`db:verify`（fresh/sequential/两库 inventory SHA-256 一致 + 负向 DML）与 `verify:migration-guards`（fresh/sequential/wrong-order/repeat 拒绝/失败快照不变）对 42 链通过。阶段 4 完成 §7 映射的 verifier 等价迁移：7 个新命名 verifier（buyer-portal-contract、dto-isolation、secret-dto-hygiene、finance-security、staff-auth-composition、marketplace-registry、admin-dashboard-simplified）真实执行通过后，21 个旧 wave/phase3/module1 verifier 脚本与 npm 条目删除；`verify:api-contract` 不再依赖 origin/main diff，改以提交产物自身 + vitest 运行时 app.routes 双向断言（本地领先远程时既不漏报也不误报）
- 历史阶段记录（D-054/D-055；以下阶段数字与说明保留追溯语义）：阶段 2 删除自动获客机器、Staff MCP、关键词图片生成与 Rakuten/TikTok adapter 预备层；阶段 3 完成数据库 baseline 重建与 platform_* 统一模型改造；阶段 4（2026-08-26）完成合同、API、路由与权限边界重建（242 端点）；阶段 5（2026-08-26）完成冷归档 ZIP Bundle/Queue/恢复/容量验证（`docs/migration/V2_BACKEND_REBUILD_STAGE5_HANDOFF.md`）；阶段 6（2026-08-26）完成历史订单及图片无损导入工具链：30 列 CSV/JSONL 冻结契约、AMAZON_JP canonical 映射（Rakuten/TikTok quarantine fail-closed）、微信 claim/店铺名确定性身份解析 + 人工 override 表（绝不模糊合并）、整数金额/E8 汇率快照（禁推算禁填 0）、exact 重复组折叠 + conflicting 组 quarantine、15 类 exception_code、dry-run 默认零写入、apply-local 双门禁（env + 仓库内路径，只写 historical_* 快照表绝不写 formal_orders）、按 (source_system, files_sha, parser, mapping, mode) 幂等、断点续传与 reconcile；20,000 单/100,000 文件计划容量验证 15.8s 全链（`verify:historical-import-capacity` 已入 check 链）；CLI `scripts/historical-import.mjs`（inspect/dry-run/apply-local/resume/reconcile + inspect-images/inventory-images/resume-image-inventory/reconcile-images，本地 only）；REAL_HISTORICAL_IMPORT=NOT_RUN（真实源在仓库外，见 `docs/migration/V2_BACKEND_REBUILD_STAGE6_HANDOFF.md` §10 材料清单）。阶段 6.5（2026-08-26）完成收口：真实 Google Drive HTTP 适配器代码实现并接入 runtime（默认关闭，REAL_DRIVE_REQUESTS=0，从未执行真实 Drive 请求）、100k 图片盘点容量验证（REAL_IMAGE_INVENTORY=NOT_RUN）、未匹配身份显式 IDENTITY_UNMATCHED 隔离 + override 全审计字段、归档时间统一为 6 个 UTC 日历月（月底截断）、多商品多行订单 MULTI_LINE_ORDER_REQUIRES_MAPPING 合同（见 `docs/migration/V2_BACKEND_REBUILD_STAGE6_5_HANDOFF.md`）。阶段 6.6 全部完成（6.6A–6.6D，含 Stage 7 安全验收与后端 Stage 8 全量验证，见 `V2_BACKEND_REBUILD_STAGE6_6_HANDOFF.md`）：获客 CRM 与 Integration Outbox 运行能力退役、四角色固定分配、订单沟通/付款截图统一、预约永久限制、唯一员工订单详情聚合端点；API 基线 219 端点。阶段 6.6E（2026-08-28）完成后端业务合同缺口收口（见 `V2_BACKEND_REBUILD_STAGE6_6E_HANDOFF.md`）：员工买家建档 HTTP 端点（建档即分配 B/C 编号）、邀请签发绑定既有买家、邀请注册只认领激活既有档案（fail closed）、订单沟通截图返回上传人/上传时间、统一订单详情向 Owner/Buyer Refund 返回权威垫付分区（`buyer_advance`，Buyer Refund 不见利润与卖家敏感财务）、Owner-only 售前/售后负责人管理与 Personal DENY 管理端点、获客权限码运行时清除；API 基线 224 端点。历史前端 7A-1R-B → 7A-2 路线已走完；Stage 8 部署准备仍待总控授权。历史订单字段级映射覆盖清单见 `docs/migration/V2_BASELINE_HISTORICAL_ORDER_FIELD_MAPPING.md`
- 当前实现与未完成边界：后端干净基线重建已完成；当前 Schema、API inventory 和 Seller 结算读取边界以上方条目为准。独立 Change `staff-order-list-multimarket-index-preparation` 的 0037 只为未来多市场上线前性能准备，不改变当前可见性、市场启用或 API 合同。真实历史订单导入与真实图片盘点仍未运行（`REAL_HISTORICAL_IMPORT=NOT_RUN`、`REAL_IMAGE_INVENTORY=NOT_RUN`）；Stage 8 部署准备仍待总控授权。
- 历史前端 7A-1R-B → 7A-2 路线已走完；独立 OpenSpec Change `stage7f4-legacy-css-retirement` 已完成（13/13 tasks）但尚未归档；其父 Change `stage7f-frontend-complete-rebuild` 也已完成（42/42 tasks，`isComplete=true`）但尚未归档。完成状态与 archive 状态分别记录，不能互相替代。
- 发布状态：`LOCAL_RELEASE_CANDIDATE / PRODUCTION_REQUIRES_SEPARATE_APPROVAL`
- 本地证明不能替代真实 Cloudflare Access、生产 D1/R2、恢复演练或员工试用结果

历史 frozen / cleanup 分支和对应 SHA 用于追溯，不再作为新开发入口。新任务必须从最新 `main` 开始。

## 当前生产状态（2026-08-20）

- 生产状态：**NO-GO**（G1 已获 Owner 直接批准；`PRODUCTION_GO=NO`，尚未完成生产放行；`LOCAL_RELEASE_CANDIDATE` 不等于生产放行）
- Owner 决策（2026-08-18）：① 开始推进 Production Gates（G1/G7/G8/G9 不依赖部署的事项优先，
  执行清单见 `docs/acceptance/PRODUCTION_GATE_OWNER_ACTIONS.md`）；② `app.yueguangbai.net`
  未文档化部署决定**清理**（程序见 `docs/runbooks/PRODUCTION_CLEANUP_APP_YUEGUANGBAI_NET.md`）；
  2026-08-20 已完成清理；③ 2026-08-20 的 GitHub Actions billing 维持 $0 记录已被 2026-08-21 billing 恢复记录取代，不再作为当前阻断
- Authoritative Production Gate：`docs/runbooks/FINAL_PRODUCTION_GO_OWNER_CHECKLIST.md`（仓库唯一最终 GO/NO-GO 判断入口；其他 checklist/runbook 均为 supporting evidence）
- STAGING acceptance（T9 register：62 PASS / 3 CONFLICT / 2 BLOCKED，2026-08-16/17）≠ PRODUCTION acceptance；staging PASS 不构成生产放行证据
- 当前缺失（未执行；不因本地 / staging 通过而视为完成）：
  - 生产 D1/R2/Worker/Access/Secrets/DNS 配置证据与受管清单
  - 生产 Migration ledger 只读核验、迁移窗口与 release-bound 备份 / 恢复证据
  - 中国大陆主要网络 / 微信内置浏览器实测（T9 H05，BLOCKED）
  - 历史数据导入真实执行与人工批准（阶段 6 工具链已就绪：CLI inspect/dry-run/apply-local/resume/reconcile
    + 20k 容量验证通过；真实 PREVIEW 待 Owner 提供源工作簿（SHA c7d0ae7a…）、图片字节盘点与逐项批准——
    REAL_HISTORICAL_IMPORT=NOT_RUN）
  - 正式 production 上线前补齐 G1 五个责任角色的姓名/邮箱；Owner 已于 2026-08-20 直接批准 G1（签名豁免）
  - 远程 CI 证据（GitHub-hosted CI 已于 2026-08-21 恢复可用；此前 #103–#109 期间的合并依据为 owner 豁免 + 本地完整证据，见下）
  - Google Drive 冷归档仍属阶段 8 部署准备；Staff MCP 运行能力已删除，发布侧仅保留禁 `STAFF_MCP_*` 绑定/变量的防复活墓碑。历史 M10 P0-03 激活材料仅作审计记录，不能作为当前恢复入口
- `app.yueguangbai.net`：未文档化部署已按 Owner 决定于 2026-08-20 清理完成。
  Worker `yueguangbai-v2-production`、生产 D1/R2 和自定义域名绑定均已删除；DNS 无解析，
  staging 资源未触碰。该域名不再是运行中的部署；本记录不代表正式 production 已上线。

## 当前 CI 状态（2026-08-21）

- GitHub-hosted CI：**AVAILABLE**（billing 阻断已解除；2026-08-21 起 job 正常启动）
- 当前远端 `main` = `f7d321c`（Merge PR #112，2026-08-21）。近三日主线合并：PR #110（gate 收口 docs）、PR #111（feat: import current reservable seller mapping，squash `5a186d4`）、PR #112（staging 产品/卖家变更 + live manifest 归档 + tools/imports typecheck 修复）
- PR #112 的远端 CI 三项全部 `success`（run 32466985887：browser-e2e 3m10s / static-governance 2m2s / tests-and-build 8m17s，2026-08-21）；这是 billing 恢复后 main 上的最新全绿证据
- 历史备注（2026-08-18）：GitHub Actions billing 阻断期间的 6 个 closure PR（#103/#102/#104/#105/#106/#107）按 owner 豁免合并，代码验证树 `ace731918f2e29d7ff1f60e6095d549eba43c4c2` 上的本地证据为 0 TypeScript 错误、1746/1746 单元测试、187/187 browser e2e、check:ci:static / build / release:check 全 PASS（LOCAL_RELEASE_EVIDENCE=COMPLETE）
- 本地 PASS ≠ Remote CI PASS 的原则继续有效；billing 阻断期（2026-08-16 13:42 – 2026-08-21）合入的提交没有对应时点的远端 CI 证据，追溯依据是上述本地验证树
- billing 恢复前最后一次远端全绿 CI：2026-08-16 09:51 UTC（run 31940127005，main `e02682f`）

## 当前 Marketplace / Amazon US 状态（2026-08-26 阶段 4 修订）

- canonical marketplace registry（baseline 种子）收敛为三行：`AMAZON_JP`（ACTIVE/AVAILABLE，唯一写路径）、`AMAZON_US`（ACTIVE/AVAILABLE）、`COUPANG_KR`（DISABLED/UNAVAILABLE，fail-closed 预留）；`RAKUTEN_JP`/`TIKTOK_JP` 种子行与运行时定义、DB CHECK、视图分支已随阶段 2e/3/4 全部移除，未来需要时按新 OpenSpec Change 重新引入
- 阶段 4 起 marketplace 合同（API DTO 与 DB 存储）统一使用 canonical 三码；'JP' 短码及其别名层（表、类型、投影、runtime legacy_order_code）已原子移除，仅阶段 6 历史导入映射层允许出现历史短码
- 业务写路径当前 **AMAZON_JP-only**；`AMAZON_US` 当前 **NOT ENABLED**（未开店、未发布产品）
- 0037 的多市场合成 EQP/容量回归只复用 canonical code 构造临时本地测试行，不写 marketplace registry 或 business enablement config；它不改变上述 `AMAZON_US NOT ENABLED` 状态。
- 非 JP 的 store / product 写请求失败关闭（409 `MARKETPLACE_NOT_SUPPORTED`）；`MARKETPLACE_NOT_SUPPORTED` 守卫必须保留
- Rakuten/TikTok platform_* 平行订单模型（六张表与运行时分支）已按业务所有者确认删除；订单沟通截图现行唯一路径为正式订单上的 `ORDER_COMMUNICATION_SCREENSHOT` 文件（0028 起统一；买家聊天与卖家订单沟通两套旧模块及 `order_evidence_internal_files` 表退役）

## 当前身份与权限

- Staff：Cloudflare Access 只证明邮箱；Moonwhite D1 Staff 状态、唯一角色、Marketplace 范围、PRIMARY/SUPPORT 和 Personal DENY 决定最终权限
- Buyer / Seller：共享 Customer Identity Subject 和受控凭证，但门户上下文、授权、DTO 与 Query Cache 严格隔离
- 飞书：已退出当前及计划运行架构；历史 Migration 和 archived Change 只保留升级 / 审计历史，不构成运行能力

## 当前发布组合

以下描述的是仓库内 release template，不是已核验的生产事实：

- 核心 Worker：Hono API、D1、R2 文件链、Staff / Buyer / Seller 门户 API、内部 Scheduler / Acquisition Maintenance
- Staff MCP：源码、传输与五张表已随阶段 2 删除；发布侧防复活墓碑（禁 `STAFF_MCP_*` 绑定/变量）保留并仍在 preflight 覆盖
- Google Drive 冷归档：模板写侧关闭，但文件读取、恢复和调度共享核心路径，因此保留在核心 bundle；不改变已冻结的归档产品规则（D-055 ZIP Bundle + Queues 模型在阶段 5 重建）
- Rakuten / TikTok Provider Adapter 与平台平行订单模型：已删除（阶段 2e/3）；不得把历史 Adapter / preflight 记录当成 Provider 已可用
- `/review`：仅 Demo 数据，真实 API 必须由 `REVIEW_MODE_REAL_API_BLOCKED` 失败关闭

## 当前开发流程

```text
latest main
→ 短生命周期 feature/* / fix/* / chore/*
→ 单一任务与对应 OpenSpec / Acceptance
→ 本地真实验证
→ 普通 PR
→ main
```

- 不再从 `feature/frozen-*`、`chore/final-*` 或历史 V3/V4 分支开始新开发
- 不通过创建长期 `final`、`final-final`、`V3`、`V4` 分支表示产品阶段
- 历史审计里的旧 branch / SHA 必须保留原样作为证据，不要为了“看起来统一”篡改历史记录

## 必读权威入口

1. `AGENTS.md`
2. `PROJECT.md`
3. `docs/decisions/V2_DECISION_REGISTER.md`
4. `docs/product/V2_PRODUCT_RULES.md`
5. `docs/contracts/`
6. `docs/architecture/`
7. `docs/acceptance/V2_ACCEPTANCE_MATRIX.md`
8. 当前 active OpenSpec Change

飞书历史 Schema 的精确对象和 0065 前向清理结果见 `docs/audits/FEISHU_SCHEMA_RETIREMENT_AUDIT.md`。

历史本机 worktree、本地分支和恢复边界见 `docs/audits/LOCAL_GIT_HYGIENE_AUDIT.md`；其中数量和路径是当时快照，不代表当前远程 GitHub 状态。

稳定化阶段的代码、包体、OpenSpec、Schema 与验证前后指标见 `docs/audits/FINAL_REPOSITORY_STABILIZATION_AUDIT.md`。

名称包含 `FREEZE` 的文件只代表对应阶段的验收快照和实现说明，不得覆盖上述权威顺序；历史交接内容由 Git、audit 和 archived OpenSpec 保存。

## 默认外部安全边界

除非用户在当前会话明确授权具体动作：

- 不得 Push、创建 / 合并 PR 或修改 GitHub 远端
- 不得执行生产 Migration、远程 SQL、真实 D1/R2/Secrets 读写或部署
- 不得写入飞书、Google Drive、Marketplace Provider 或其他外部资源
- 不得导入真实数据或上传真实业务图片

所有 PASS / FAIL / SKIP 必须来自当前 checkout 的真实执行结果。
