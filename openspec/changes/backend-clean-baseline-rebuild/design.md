# Design: backend-clean-baseline-rebuild

## 数据事实来源

- 新 baseline schema 是唯一权威数据库结构；`app_schema_state` 从新链重新计数（`0001` 起）。
- 外部历史订单/图片/导入源文件是历史业务数据的事实来源，全程只读；导入工具只产生本地 dry-run 证据。
- R2 语义不变：D1 是文件授权与 Manifest 权威，R2 是热副本；Google Drive 是冷归档（D-055）。

## 事务与权限边界

- 保留 AGENTS.md §6–§8 全部硬约束：整数金额/汇率、UTC 毫秒、财务不可变、幂等键 + 请求哈希 + expected_version + 状态机 + 最终断言 + 审计 + Outbox、R2 上传意图/租约/补偿。
- D1 关键写继续使用 `db.batch()` 条件写 + 唯一约束 + source guard 触发器；禁止先读后无条件写。
- 权限模型不变：Cloudflare Access 只证明邮箱；D1 五角色 + Personal DENY + Marketplace scope 是唯一授权权威；无权访问统一 404。
- Queues 消费者（本地模板）消息仅含 opaque `bundle_id/version/trace_id`，不含 PII/财务内容；每条消息独立确认，DLQ 兜底，403/429 指数退避。

## 幂等、Audit、Outbox、文件策略、性能与分页

- 归档/恢复命令沿用命令幂等记录与审计事件；重复投递不得产生重复 Drive 文件或重复 R2 删除。
- ZIP Bundle 使用流式生成（JPEG store 模式不重压缩，TransformStream，不在 Worker 内整包缓冲）；先落临时 R2 bundle，再 resumable upload，回读校验 size/MIME/SHA-256 后条件删除 R2。
- 所有增长列表 cursor 分页（cursor + limit + next_cursor）；禁止全量读取 20,000 订单。
- 容量指标：backlog、成功、失败、重试、最老积压、最近成功。

## 被拒绝的替代方案

- 保留旧迁移链继续追加：拒绝——75 个迁移中大量对象服务于已删除能力，继续保留等于维护双结构；D-054 明确授权重建。
- 每张图一个 Drive 文件：拒绝——Drive 文件数量上限风险；采用业务实体 ZIP + manifest（D-055）。
- 先删旧 verifier 再写新测试：拒绝——D-054 门槛 1 要求断言先迁移、等价通过后才删。
- 在旧 API 上保留兼容别名给旧前端：拒绝——前端将在后端完成后单独重构，双 API 只增加删除成本。
