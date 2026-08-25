# Tasks: backend-clean-baseline-rebuild

## Stage 2 — 删除与 OpenSpec 处置

- [x] 2.1 归档 4 个 completed 变更（reservation-review-order-evidence-readiness、schema64-integration-stabilization、seller-principal-rate-policy、staging-isolated-readiness-bootstrap）
- [x] 2.2 归档 2 个 superseded 变更（google-drive-cold-archive-production-preflight、staging-access-jwks-worker-runtime）
- [x] 2.3 删除自动获客 Agent/machine：3 条 acquisition-machine 路由、3 条 staff machines 路由、machine 运行时、相关测试/脚本/seed 引用（`maintenance.ts` 与其表是 D-026 保留能力，不删）
- [x] 2.4 删除 `acquisition_prospect_signals` 与机器时代指标运行实现（保留人工来源/首触归因事实）
- [x] 2.5 删除 Staff MCP：`apps/api/src/staff-mcp`、`packages/contracts/src/staff-mcp.ts`、0038 表的运行引用、npm 脚本与文档
- [x] 2.6 删除关键词图片：generator service/worker、resvg-wasm、资产路由与 reconciliation 引用
- [x] 2.7 删除旧别名与兼容层：`marketplace_legacy_aliases` 运行引用、旧 Seller Agreement 投影残留、无用途 Feature Flag
- [x] 2.8 删除 Rakuten/TikTok `platform_*` 运行实现与 `marketplace-adapters` 预备（保留 Registry/AMAZON_JP/禁用边界）
- [x] 2.9 每删除类别后 typecheck + 受影响测试通过；被删能力 verifier 按 §7 留核验记录
- [ ] 2.10 阶段出口：typecheck/test/build/check + openspec strict 全绿

## Stage 3 — 数据库 baseline

- [ ] 3.1 新建 `0001` baseline（按域拆顺序文件），包含全部保留能力表、整数金额/汇率、source guard、审计/幂等/版本约束
- [ ] 3.2 删除旧迁移链 0001–0075 与 `phase3*_backup_*`/`*_next` 脚手架
- [ ] 3.3 重写本地 seed 与匿名测试数据；空库一次初始化成功测试
- [ ] 3.4 重建 verify-migrations / verify-migration-version-guards（fresh/sequential/wrong-order/repeat/dirty-stock 回滚 + FK/integrity）
- [ ] 3.5 schema 形状承载 20,000 历史订单导入的字段覆盖清单

## Stage 4 — Contracts 与 API

- [ ] 4.1 按 §1/§3 重建 contracts（删除兼容 DTO）
- [ ] 4.2 重建路由并以真实 `app.routes` 重生成 `V2_API_ROUTE_INVENTORY.md`
- [ ] 4.3 看板简化为清单 §3.2 范围；删除 funnel/drill-down/trends 机器维度
- [ ] 4.4 幂等/expected_version/请求哈希/状态机/审计/Outbox 全路径回归

## Stage 5 — 冷归档、Queue 与恢复

- [ ] 5.1 归档单元与状态机（ORDER 含卖家聊天、BUYER_REFUND_PAYMENT、SELLER_SETTLEMENT_PAYMENT；6 上海自然月）
- [ ] 5.2 ZIP + manifest 流式 bundle → 临时 R2 → resumable upload → 回读校验 → 条件删除
- [ ] 5.3 Queues 本地模板（batch 1–5、DLQ、逐消息 ack/retry、指数退避、Drive 并发 3 可配置）
- [ ] 5.4 Staff-only 恢复 + 占位提示 + 原 audience 授权 + 7 天清理；首次 shadow-copy
- [ ] 5.5 容量指标与 100k Manifest 容量测试

## Stage 6 — 历史导入与容量

- [ ] 6.1 导入工具重建：字段级映射、行数守恒、抽样核对
- [ ] 6.2 20,000 单 dry-run 无损证据
- [ ] 6.3 每日 200 单/1,000 图合成负载与吞吐 ≥1.5 倍验证

## Stage 7 — 安全与隐私测试

- [ ] 7.1 权限/Personal DENY/scope/concealed 404 全套
- [ ] 7.2 幂等重放、payload mismatch、expected_version 冲突、财务不可变
- [ ] 7.3 Buyer/Seller DTO 隔离、R2 失败补偿、Drive 校验失败、Queue 重复投递/DLQ
- [ ] 7.4 归档/恢复/7 天清理/卖家聊天归档回归

## Stage 8 — 验证与交付

- [ ] 8.1 npm run typecheck / test / build / check + openspec strict 真实执行
- [ ] 8.2 旧 verifier 按 §7 映射逐行核销（迁移或废弃）
- [ ] 8.3 中文交接报告 + AGENTS.md 报告格式
