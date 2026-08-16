# 历史订单导入闭环设计（Change 设计草案）

> 状态：**设计草案（未批准、未实现）**。本文是未来独立导入 Change 的规划基线，不构成任何远程写入授权。
> 前置现状：`tools/imports/historical-order/historical_order_master_migration.py` 是**本地只读 manifest 生成器**，输出 `production_import=NOT_EXECUTED`；`openspec/changes/historical-order-master-and-chat-screenshot-migration` 已冻结本地边界。
> 用户最终目标：**卖家客户只需上传历史订单表格（XLSX/CSV），系统完成归属校验、预览确认后导入**。

## 1. 目标与非目标

### 目标

- 卖家客户上传历史订单表格 → 字段契约校验 → 只读解析 → 归属校验 → 预览确认 → 分批导入 → 可查状态。
- 全程幂等、可断点续传、可批次回滚 / 前向修复；财务字段只保留来源事实，禁止猜测与覆盖。
- 导入只发生在 staging canary 验证通过之后，且**禁止直连生产**（生产写入必须经单独授权 + 正式发布流程）。

### 非目标（本 Change 不做）

- 不修改 Marketplace registry / schema / API / UI（Rakuten / TikTok 的独立决定另行 Change）。
- 不导入聊天截图媒体字节（H 列）——媒体导入是另一个独立 Change（已有 R2 计划草稿）。
- 不重算历史财务（Migration 0041 未执行；历史金额保留来源快照）。
- 不把腾讯文档当第二套权威库；腾讯文档只是上传入口之一，权威事实仍在 D1。

## 2. 输入契约（表格字段）

字段契约以 `EXPECTED_HEADERS`（30 列）为基线，见《历史订单数据要求（字段内容）》文档。要点：

- 表头名称、顺序、单位、枚举值、日期格式全部由契约锁定；未知列 / 缺列 → HOLD。
- 必填：下单日期、客户编号、买家微信、店铺名字、ASIN/平台标识、订单号、订单价格。
- 财务列（订单价格、返款汇率、返款时间、服务费金额、卖家返金汇率、结算日期、买家返金金额、卖家返金金额、汇率差、利润）：**只读来源快照**，导入时禁止换算、四舍五入猜测或覆盖。
- 图片列（聊天截图、订单截图、到货图、评论通过截图、补fb截图、返款截图）：本 Change 只登记计划，不抽取字节。

## 3. 幂等与断点续传

- **source hash**：每个上传文件先算 SHA-256（大小写、BOM、CRLF 归一化后的稳定哈希）；同 hash 重复上传 → 返回既有批次结果，不重复导入。
- **row key**：`historical-order-source:<file-hash>:row:<六位行号>`（沿用 manifest 的稳定 row key 约定），加 `order_line_key`。
- **幂等键**：每次导入请求必须带 `Idempotency-Key`（批内唯一）；重放返回相同响应。
- **断点续传**：以 row key 为 checkpoint，每个批次提交后持久化 checkpoint；中断后从最后确认的 checkpoint 继续，已导入行跳过（不重放写）。
- **exact-duplicate 策略**：marketplace-aware 重复组进 `duplicate_group_key`；精确重复来源事实进入 quarantine 而非静默去重。

## 4. 校验与 HOLD / quarantine

解析阶段分层：

1. **表结构校验**：表头、必填列、行数上限、编码。
2. **行级校验**：枚举值、日期解析、金额整数（JPY 整数日元 / CNY 整数分）、平台订单号正则（Amazon `^\d{3}-\d{7}-\d{7}$`、Rakuten `^\d{6}-\d{8}-\d{10}$`、TikTok JP `^585\d{15}$`）。
3. **归属校验**（quarantine 条件）：
   - 卖家 / 店铺 / 产品必须能唯一映射到当前 Seller Organization 与 Store；多卖家结果 → HOLD。
   - 订单号必须唯一归属；跨卖家订单 → 拒绝（`reject_without_explicit_current_seller_organization_and_store_scope`）。
   - Marketplace registry 不支持（JP_RAKUTEN / JP_TIKTOK）→ 行级 blocker，不进入导入集。
4. 校验失败行进入 **quarantine/HOLD** 状态（含原因、原始值、来源行号），可导出明细；**不允许**自动纠错写入。

## 5. 预览确认

- 解析完成后生成**预览报告**：总行数、可导入行、quarantine 行、财务列摘要（不泄露客户隐私）、重复组、图片计划。
- 预览确认是**人工动作**（当前用户规则：浏览器敏感数据提交前需明确确认），确认后生成批次标记 `import_batch_marker`（UUID + 时间 + 用户 + 文件 hash）。

## 6. 批次导入与事务

- 每批：`INSERT` 订单主档 + 订单行 + 财务快照 + 图片计划 + 审计事件（`ORDER_IMPORTED`，含 source hash、row key、批号、actor）。
- 批内最终断言（行数、金额合计、状态机）不通过 → 整批失败回滚。
- **回滚**：批次标记 + 可逆批范围（按 `import_batch_marker` 删除本批对象，保留审计与 quarantine 记录）；**前向修复**：错误行用冲正 / 更正 / 重新入账，不直接覆盖。
- 并发：一个 Seller Organization 同一时间只允许一个活跃导入批次。

## 7. staging canary 与生产边界

- 先在 staging canary（独立 D1/R2）跑同一套导入流程 + 全量校验，证据归档到受管目录。
- **禁止直连生产**：导入工具不读、不写生产 D1/R2；生产执行必须走正式发布 + 单独授权。
- 任何生产部署需要另一次明确授权（沿用现有 `PRODUCTION_GO=NO` 边界）。

## 8. 交付物清单（未来 Change）

- [ ] 字段契约 JSON（表头、枚举、单位、正则、必填/可选）
- [ ] 上传适配层（XLSX/CSV 只读解析 → 规范记录）
- [ ] 归属校验服务（卖家/店铺/产品/订单）
- [ ] 预览报告 + 确认 API（沿用 staff 权限模型，仅授权岗位可见）
- [ ] 导入执行器（幂等、checkpoint、批次回滚、quarantine）
- [ ] 状态查询（批次/行级）
- [ ] staging canary 脚本 + 验收矩阵条目
- [ ] 独立安全复审（财务字段、隐私、越权）

## 9. 开放决策（需总控/用户确认）

- Rakuten / TikTok marketplace registry 是否进入导入范围（当前 blocker）。
- 历史财务的权威表示（Migration 0041 是否执行、formal-order 关系如何建立）。
- 腾讯文档作为上传入口时的读取方式（见腾讯文档 skill / MCP 待办）。
