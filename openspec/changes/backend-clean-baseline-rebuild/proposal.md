# Change: backend-clean-baseline-rebuild

## Why

业务所有者 2026-08-25 授权（Decision D-054/D-055）在无生产数据阶段重建后端干净基线：当前系统没有生产数据库、生产订单、生产图片或线上用户；约 20,000 单真实历史业务数据保留在外部源，未来导入。现有代码积累了自动获客 Agent、Staff MCP、飞书残留、关键词图片生成、Rakuten/TikTok 预备层和多层迁移脚手架（0001–0075），这些能力无现行业务用途，继续维护的成本高于重建。

## What Changes

- 按权威清单 `docs/migration/V2_BACKEND_REBUILD_INVENTORY.md` 删除：自动获客 Agent/machine 与机器时代指标（含 `acquisition_prospect_signals`）、Staff MCP、飞书残留对象、关键词图片生成、旧别名与兼容层（`marketplace_legacy_aliases`、`phase3*_backup_*`、`*_next`、旧 Seller Agreement 投影、无用途 Feature Flag）、Rakuten/TikTok `platform_*` 预备层（保留 Marketplace Registry、AMAZON_JP 写路径、禁用的 AMAZON_US/COUPANG_KR 边界）。
- 删除旧迁移链 0001–0075，建立单一干净 baseline schema；本地空库一次初始化成功；Migration verifier 同步重建。
- 按 D-054 门槛 1 迁移旧 verifier 保护的业务断言到新 baseline 测试与新命名 verifier，等价通过后才删除旧脚本。
- 重建保留能力的 contracts 与 API（清单 §1/§3）：经营看板简化为今日/本周/本月客户、预约、正式订单、待返款、待结算、异常逾期、Owner 财务摘要；保留人工来源与首触归因。
- 按 D-055 重建冷归档：ORDER（含卖家聊天）、BUYER_REFUND_PAYMENT、SELLER_SETTLEMENT_PAYMENT 三个归档单元的 ZIP + manifest 流式 Bundle、Drive 回读校验、Cloudflare Queues 本地模板、Staff-only 恢复状态机与 7 天临时副本清理。
- 重建历史订单导入（20,000 真实历史单无损 dry-run）与容量验证（≥100,000 Manifest、cursor 分页、吞吐 ≥ 日增到期量 1.5 倍）。
- 阶段 6.5 收口：生产 Google Drive HTTP 适配器代码（默认关闭、零真实请求）、只读历史图片盘点 CLI 与 100k 容量验证、未匹配身份显式 unresolved 隔离、归档时间统一为 6 个 UTC 日历月、多商品多行订单 MULTI_LINE_ORDER_REQUIRES_MAPPING 合同（migration 0026）。

## Non-Goals

- 不开始员工端视觉重构；不为旧员工端保留双 API。
- 不触碰远程 Cloudflare、GitHub、Google Drive、真实历史订单源文件；不创建真实 Queue；不部署。
- 不修改 Git 历史；旧实现在 Git 历史中可追溯。
- 不改变保留业务的硬约束：财务不可变、整数金额、DTO 隔离、concealed 404、幂等/版本/审计/Outbox、Personal DENY。

## Migration

需要。删除旧迁移链并建立新 baseline 是本 Change 的核心内容（D-054 明确授权）。外部历史订单源文件不受影响。

## 权限与隐私影响

不降低任何权限约束。删除的能力（机器获客、MCP、关键词图片）本身是权限面收缩。归档访问规则按 D-055：仅 Staff 可触发恢复；Buyer/Seller 只见占位；恢复后按原 file audience 授权、不扩大可见范围。

## 风险与回滚

- 风险：删除引用遗漏导致编译/测试失败——以每删除类别后 typecheck+test 全绿控制。
- 风险：verifier 断言迁移不完整——以 §7 映射表逐行核销控制。
- 回滚边界：所有变更为本地 Git 提交，可按提交回退；无远程资源依赖。
