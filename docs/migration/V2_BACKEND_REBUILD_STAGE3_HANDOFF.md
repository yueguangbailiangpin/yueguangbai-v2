# 后端重建阶段 3–8 指令（2026-08-25 交接，粘贴到新对话使用）

```
$security-best-practices
你是月光白 V2 后端重构负责人，使用 GLM 5.3 在 ZCode 中开发。
项目：/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller
当前目标分支：feature/staging-workflow-rate-ux
本阶段只做后端、数据库、contracts、文件系统、后台任务、测试和权威文档。不要开始员工端视觉重构。

一、当前状态（前两次对话已完成，不要重做）
1. 阶段 1、2 已完成并通过出口门禁；本地提交链 a0411cc1..190c16d6（未 push）。
2. openspec Change backend-clean-baseline-rebuild 已建立（proposal/design/tasks/spec 齐备，阶段 2 任务已勾选）；6 个旧变更已归档。
3. 阶段 2 删除已完成：自动获客机器与 prospect_signals、Staff MCP、关键词图片生成与资产管线、Rakuten/TikTok adapter 预备层。
4. 保留修正（业务所有者 2026-08-25 已确认）：
   - maintenance.ts 与其表是 D-026 保留能力（线索自动关联、卖家合作检测、12 个月匿名化），连同 ACQUISITION_MAINTENANCE_ENABLED 就绪门保留；
   - platform_* 六张表处置：platform_product_identities / platform_order_identities / platform_identity_events 三张死表随新 baseline 直接删除；platform_formal_orders / platform_order_evidence_records / platform_order_evidence_internal_files 三张活表（卖家聊天截图现行存储）在阶段 3/5 并入统一 formal_orders 模型后消失；
   - 买家侧 marketplace 'JP' 短码是现行 API 合同，别名层（marketplace_legacy_aliases 表、LegacyMarketplaceCode、legacyMarketplaceProjection）必须在阶段 3/4 与 DTO 变更原子移除，不得单独提前。
5. 门禁基线：npm test 270 文件/1772 用例、npm run check exit 0、openspec strict 63/63、typecheck 0 错。
6. 权威文档：docs/migration/V2_BACKEND_REBUILD_INVENTORY.md（含 §5 分类表、§7 verifier 映射表、§7.1 阶段 2 核验记录）、D-054/D-055。

二、开始前必须
- 完整阅读 AGENTS.md；阅读 D-054/D-055 与 V2_BACKEND_REBUILD_INVENTORY.md 全文；git status 确认干净（如有未提交文档先本地 commit，禁止 push）。
- 每个 Change 的 tasks.md 勾选随进度更新；每阶段出口门禁全绿才进入下一阶段。

三、授权与禁止（延续 2026-08-25 授权）
1. 无生产数据库/订单/图片/线上用户；可删除重建本地代码、API、表、Migration、测试、配置与文档。
2. 约 20,000 单是真实历史业务数据但未进入本项目生产库；外部订单源、图片源、导入源必须保留且只读；新 baseline 必须证明可无损导入（字段级映射覆盖、行数守恒、抽样核对）。
3. 禁止：远程 Cloudflare/GitHub/Google Drive 任何写操作、部署、Queue 创建、D1/R2 远程操作、push/PR。
4. D-054 门槛 1：旧 verifier（verify-phase3*、wave11/12/13*、module1* 等）禁止直接删除；按 §7 映射把仍有效断言迁入新 baseline 测试/新命名 verifier，等价测试真实通过后才删旧脚本。
5. 保留硬约束：财务不可变与整数金额（JPY 整数日元、CNY 整数分、汇率整数刻度、禁 REAL）、UTC 毫秒 + Asia/Shanghai 显示、审计、幂等、expected_version、状态机、Outbox、R2 上传补偿、Buyer/Seller DTO 隔离、concealed 404、五角色 + Personal DENY + Marketplace scope、服务费 seller_organization+marketplace+review_type+effective_version 且显式 0≠缺失。
6. 新代码按 security-best-practices Skill 默认安全书写：参数化 SQL、会话 cookie 属性、输入 schema 校验、错误不泄内部细节。
7. 后端完成前不重写员工端；不为旧前端保留双 API（前端在后端完成后单独重构）。

四、阶段 3：数据库干净 baseline（从这里开始）
1. 新建单一 baseline：migrations/ 重置为 0001 起的新链（可按域拆顺序文件），包含全部保留能力的表与约束：整数金额/汇率刻度、source guard 触发器、财务 append-only（返款/本金/服务费/结算不可 UPDATE/DELETE）、幂等、审计事件、Outbox、版本列、文件授权、催办、Advance V1 全额模式、0072 汇率中心语义、排期版本、0068 安全限流、maintenance 表、D-055 归档三单元所需事实表。
2. 三张死表（platform_product_identities/platform_order_identities/platform_identity_events）不进入 baseline；三张活表：本阶段先按现状保留等价结构（或直接并入统一模型，若能在本阶段内连同运行时读写路径一次改完并保持测试绿，则允许直接并入，阶段 5 只做归档层）。
3. marketplace_legacy_aliases 与 legacy JP 存储列：若阶段 3 内不同时完成运行时/DTO 改造，则在 baseline 中暂时保留其最小形态，并在阶段 4 以 baseline 之上的前向 Migration 原子删除（表+列+类型+投影一起）；禁止出现运行时读已删列的中间态。
4. 删除旧迁移链 0001–0075 与 phase3*_backup_*/_*_next 脚手架（Git 历史可追溯）；重写本地 seed 与匿名测试数据。
5. 重建 scripts/verify-migrations.mjs 与 verify-migration-version-guards.mjs：fresh 空库一次成功、sequential、wrong-order、repeat、dirty-stock 回滚、FK/integrity 检查全部保留；TARGET_SCHEMA 相关常量（operational-readiness、recovery-attestation、staging-bootstrap）与新链对齐。
6. schema 形状必须承载 20,000 真实历史订单导入：输出字段级映射覆盖清单入库（docs/migration/ 下）。
7. docs/CURRENT_SYSTEM_STATE.md schema 叙述重写；openspec strict 保持通过。
8. 出口门禁：typecheck/test/build/check + openspec strict 全绿。

五、阶段 4：contracts 与 API 重建
1. 按清单 §1/§3 重建 contracts：删除兼容 DTO；别名层原子移除（表+LegacyMarketplaceCode+legacyMarketplaceProjection+买家 DTO 'JP' 短码，一次性提交）。
2. 经营看板只保留：今日/本周/本月（Asia/Shanghai，周一开头）客户、预约、正式订单计数、待返款、待结算、异常逾期、Owner 财务摘要（复用正式内部财务公式，仅 Active owner + FINANCIAL_VIEW，Personal DENY 优先）；删除复杂获客漏斗、多维渠道趋势、大型 drill-down 对应路由与读模型；保留人工来源与首触归因事实及最小漏斗统计。
3. 获客指标收敛（§3.1）：删除机器时代指标路由剩余部分；保留渠道/日咨询/Prospect/Lead/归因。
4. 以真实 app.routes 重生成 V2_API_ROUTE_INVENTORY.md 并更新 api-contract-baseline-alignment 计数。
5. 按 §7 映射完成 verifier 等价迁移：新命名 verifier（buyer-portal-contract、dto-isolation、secret-dto-hygiene、finance-security、staff-auth-composition、marketplace-registry、admin-dashboard-simplified 等）真实通过后，删除对应旧脚本与 npm 条目，并在 §7 表逐行标记核销；seller-agreement-rate-retirement 在 baseline 建成后做一次性核验再废弃。
6. 幂等/expected_version/请求哈希/状态机/审计/Outbox 全路径回归；出口门禁同上。

六、阶段 5：冷归档、Queue 与恢复（D-055 全文为权威）
1. 归档单元：ORDER（订单、评论、买家聊天、卖家聊天——卖家聊天此时已在统一模型）、BUYER_REFUND_PAYMENT、SELLER_SETTLEMENT_PAYMENT；R2 热副本 6 个上海自然月；业务全部关闭满 6 个上海自然月后归档。
2. ZIP + manifest.json 流式生成临时 R2 bundle（JPEG store 模式不重压缩、Worker 不整包缓冲）→ resumable upload → 回读校验 size/MIME/SHA-256 → 条件删除 R2；失败保留 R2 并可幂等重试。
3. Queues 本地模板：消息仅 opaque bundle_id/version/trace_id；批次 1–5；Drive 并发初始 3 可配置；逐消息 ack/retry；DLQ；403/429 指数退避；重复投递不产生重复文件或删除；不创建真实 Queue。
4. 恢复：仅 Staff 可触发；Buyer/Seller 只见占位与"联系工作人员"提示；恢复后按原 file audience 与资源归属授权、不扩大可见范围；临时 R2 副本 7 天清理；Drive 原包永久保留；首次历史归档 shadow-copy。
5. 指标：backlog、成功、失败、重试、最老积压、最近成功；阶段 8 前与 github-independent-production-health-monitor 的 /ready 合同核对。

七、阶段 6：历史导入与容量
- 20,000 真实历史订单 dry-run import（外部源只读），字段级映射、行数守恒、抽样核对证明无损。
- ≥5 图/单场景、≥100,000 Manifest、每日约 200 单/1,000 图合成负载；归档吞吐 ≥ 日增到期量 1.5 倍；增长列表全部 cursor 分页；禁止全量读取 20,000 订单。

八、阶段 7：完整安全与隐私测试
- 空库初始化、schema/约束、权限/Personal DENY/scope/concealed 404、幂等重放与 payload mismatch、expected_version 冲突、财务不可变、Buyer/Seller DTO 隔离、R2 失败补偿、Drive 上传/回读/checksum 失败、Queue 重复投递/重试/DLQ、归档/恢复/7 天清理、卖家聊天截图归档、100k Manifest 容量、20,000 dry-run。

九、阶段 8：全量验证与交付
- npm run typecheck / test / build / check、openspec strict 全部真实执行；不得把未执行测试写成通过。
- 后端完成后停止，不开始前端。输出中文交接：删除了哪些功能、新数据库模型、新 API 和 DTO、图片归档与恢复流程、权限和财务规则、历史导入方式、容量证据、测试真实结果、Git 状态、未完成风险、前端必须采用的最终合同、LOCAL/STAGING/PRODUCTION 证据边界。
- 最后使用 AGENTS.md 固定报告格式。
```
