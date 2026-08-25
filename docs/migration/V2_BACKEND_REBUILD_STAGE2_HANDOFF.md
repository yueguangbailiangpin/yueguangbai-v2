# 后端重建阶段 2 起步指令（2026-08-25 交接，粘贴到新对话使用）

```
$security-best-practices
你是月光白 V2 后端重构负责人，使用 GLM 5.3 在 ZCode 中开发。
项目：/Users/yueguangbai/Documents/月光白项目开发/yueguangbai-v2-current-reservable-single-seller
当前目标分支：feature/staging-workflow-rate-ux
本阶段只做后端、数据库、contracts、文件系统、后台任务、测试和权威文档。不要开始员工端视觉重构。

一、当前状态（上一对话已完成，不要重做）
1. 阶段 1 已有条件通过并完成修订：D-054（无生产数据阶段允许重建干净基线，含两道执行门槛）、D-055（冷归档 Queues + ZIP Bundle 重建，含归档访问规则）已登记。
2. 权威工作清单：docs/migration/V2_BACKEND_REBUILD_INVENTORY.md（保留/删除/合并/重建四清单 + §5 OpenSpec 分类表 + §7 verifier 映射表）。执行以它为准，不要重新盘点。
3. 业务所有者已确认删除：Rakuten/TikTok platform_* 六张表及运行实现、acquisition_prospect_signals 及机器时代指标；同时保留 Marketplace Registry、AMAZON_JP 唯一写路径、禁用状态的 AMAZON_US/COUPANG_KR 扩展边界。
4. openspec validate --all --strict 当前 66/66 通过；代码测试基线 1905 通过 @ 364ba7a1。
5. 工作树有两份未提交文档变更：docs/decisions/V2_DECISION_REGISTER.md（D-054/D-055）与 docs/migration/V2_BACKEND_REBUILD_INVENTORY.md。

二、开始前必须
- 完整阅读 AGENTS.md
- 阅读 docs/decisions/V2_DECISION_REGISTER.md 的 D-054、D-055
- 完整阅读 docs/migration/V2_BACKEND_REBUILD_INVENTORY.md（含 §5、§7）
- git status 确认上述两份文档变更存在且无其他脏文件
- 第 0 步：把两份阶段 1 文档本地 commit 到当前分支（禁止 push/PR）

三、授权与禁止（延续 2026-08-25 授权，不因新对话失效）
1. 系统没有生产数据库、生产订单、生产图片或线上用户；可删除和重建本地代码、API、表、Migration、测试、配置和无用文档。
2. 约 20,000 单是真实历史业务数据但未进入本项目生产数据库；所有外部订单源、图片源和导入源必须保留且只读；新 baseline 必须证明可无损导入。
3. 禁止触碰任何远程 Cloudflare、GitHub、Google Drive 或真实历史订单源文件；禁止远程写入、部署、Queue 创建、D1/R2 远程操作、push/PR。
4. D-054 门槛 1：verify-phase3*、wave11/12/13*、module1* 等旧验证脚本禁止直接删除；按清单 §7 映射先把仍有效的断言迁入新 baseline 测试和新命名 verifier，等价测试真实执行通过后才能删除对应旧脚本。
5. 每个阶段结束必须 verify:openspec:strict 与受影响测试全绿，才进入下一阶段。
6. 保留核心业务与硬约束：财务不可变与整数金额（JPY 整数日元、CNY 整数分、汇率整数刻度、禁 REAL）、UTC 毫秒 + Asia/Shanghai 显示、审计、幂等、expected_version、状态机、Outbox、R2 上传补偿、Buyer/Seller DTO 隔离、concealed 404、五角色 + Personal DENY + Marketplace scope、服务费按 seller_organization + marketplace + review_type + effective_version 且显式 0 ≠ 缺失。
7. 新代码按 security-best-practices Skill 默认安全书写：参数化 SQL、会话 cookie 属性、输入 schema 校验、错误不泄内部细节、不引入 SSRF/命令注入面。
8. 不为即将删除的旧员工端保留双 API；但后端完成前不要重写员工端。

四、阶段 2：建立 Change 与删除（本轮从这里开始）
1. 建立 openspec Change backend-clean-baseline-rebuild：proposal/design/tasks 按 openspec/config.yaml 规则编写，明确引用 D-054/D-055 与清单文件。
2. 按 §5 处置旧变更：归档 4 个 completed 与 2 个 superseded；merge-into-rebuild（current-reservable-product-seller-mapping、security-command-integrity-readiness）的开放任务并入新 Change；unrelated/keep 三个不动。
3. 删除顺序（每类删除前确认引用关系）：
   a. 自动获客 Agent 与 machine（6 条路由、0057 四张表、0044 维护表、机器运行时与 dry-run）；
   b. Staff MCP（apps/api/src/staff-mcp、0038 五张表、两份合同文档、相关 npm 脚本）；
   c. 飞书残留对象与关键词图片（resvg-wasm、三张 order_instruction 资产表、资产路由）；
   d. 旧别名与兼容层（marketplace_legacy_aliases、phase3*_backup_*、*_next、旧 Seller Agreement 投影、无用途 Feature Flag）；
   e. platform_* 与机器时代指标（已确认）。
4. 每删一类：同步删除其测试、脚本、seed、文档引用，修复 typecheck 与测试；被删能力对应的 verifier 按 §7 标注"随能力废弃"并保留一次性核验记录。
5. 阶段出口：npm run typecheck、npm test、npm run build、npm run check 全绿 + openspec strict 通过。

五、阶段 3：数据库干净 baseline
- 删除旧迁移链 0001–0075，建立单一 baseline（可按域拆顺序文件），后续前向追加。
- 新 baseline 内容 = 清单 §1 保留能力 + §3 简化结果；所有金额/汇率/版本/权限/审计约束、source guard 触发器进入新 schema。
- 本地空数据库一次初始化成功；seed 与匿名测试数据重写；Migration verifier（verify-migrations、verify-migration-guards）同步重建，保留 fresh/sequential/wrong-order/repeat/dirty-stock 回滚与 FK/integrity 检查。
- schema 形状必须能承载 20,000 真实历史订单的无损导入。

六、阶段 4：重建 contracts 与 API
- 按清单 §1/§3 重建合同与路由，删除兼容 DTO；V2_API_ROUTE_INVENTORY.md 以真实 app.routes 重新生成。
- 看板只保留：今日/本周/本月客户、预约、正式订单、待返款、待结算、异常逾期、Owner 财务摘要；删除复杂获客漏斗、多维渠道趋势、大型 drill-down；保留人工来源与首触归因事实。
- AGENTS.md §8 的幂等/版本/状态机/审计/Outbox/R2 补偿模式原样保留。

七、阶段 5：冷归档、Queue 与恢复（D-055 全文为权威）
- 归档单元：ORDER（订单、评论、买家聊天、卖家聊天四类证据）、BUYER_REFUND_PAYMENT、SELLER_SETTLEMENT_PAYMENT；R2 热副本 6 个上海自然月；业务全部关闭满 6 个上海自然月后归档。
- ZIP + manifest.json 流式生成临时 R2 bundle（JPEG 不重压缩、Worker 不整包缓冲）→ resumable upload → 回读校验 size/MIME/SHA-256 → 条件删除 R2。
- Queues 本地模板：消息仅含 opaque bundle_id/version/trace_id；批次 1–5；Drive 并发初始 3 可配置；逐消息 ack/retry；DLQ；403/429 指数退避；重复投递不产生重复文件或删除；不创建真实 Queue。
- 恢复：仅 Staff 可触发；Buyer/Seller 只见占位与"联系工作人员"提示；恢复后按原 file audience 与资源归属授权、不扩大可见范围；临时 R2 副本 7 天清理；Drive 原包永久保留；首次历史归档 shadow-copy。
- 指标：backlog、成功、失败、重试、最老积压、最近成功。

八、阶段 6：历史导入与容量
- 20,000 真实历史订单 dry-run import，以字段级映射覆盖、行数守恒、抽样核对证明无损；外部源全程只读。
- ≥5 图/单场景、≥100,000 Manifest、每日约 200 单/1,000 图合成负载；归档吞吐 ≥ 日增到期量 1.5 倍；所有增长列表 cursor 分页；禁止全量读取 20,000 订单。

九、阶段 7：完整安全与隐私测试
- 空库初始化、schema/约束、权限/Personal DENY/scope/concealed 404、幂等重放与 payload mismatch、expected_version 冲突、财务不可变、Buyer/Seller DTO 隔离、R2 失败补偿、Drive 上传/回读/checksum 失败、Queue 重复投递/重试/DLQ、归档/恢复/7 天清理、卖家聊天截图归档、100k Manifest 容量、20,000 dry-run。

十、阶段 8：全量验证与交付
- npm run typecheck、npm test、npm run build、npm run check、openspec strict 全部真实执行；不得把未执行测试写成通过。
- 后端完成后停止，不开始前端。输出中文交接：删除了哪些功能、新数据库模型、新 API 和 DTO、图片归档与恢复流程、权限和财务规则、历史导入方式、容量证据、测试真实结果、Git 状态、未完成风险、前端必须采用的最终合同、LOCAL/STAGING/PRODUCTION 证据边界。
- 最后使用 AGENTS.md 固定报告格式。
```
