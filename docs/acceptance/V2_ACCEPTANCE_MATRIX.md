# V2 验收矩阵

## A. 基础

- [ ] 从空目录初始化全新 Git。
- [ ] 无远程 origin。
- [ ] 无旧 Migration、资源 ID、Secrets 或真实数据。
- [ ] TypeScript 严格检查通过。
- [ ] Secret/PII 扫描通过。
- [ ] Hono `/health` 本地通过。
- [ ] 所有 Migration 从空库连续执行。
- [ ] `PRAGMA integrity_check=ok`。
- [ ] `PRAGMA foreign_key_check` 为 0。

## B. 身份与权限

- [ ] Cloudflare Access 邮箱唯一映射到 ACTIVE Staff。
- [ ] Role 权限与 Marketplace 可见范围正确组合。
- [ ] 个人 deny 优先。
- [ ] Owner 全局；PRIMARY 负责 OPEN 队列；SUPPORT 不竞争 OPEN 队列。
- [ ] 五岗位字段与入口隔离。
- [ ] 卖家成员四角色正确。
- [ ] 非 OWNER 不能导出财务。
- [ ] 越权资源返回 404。
- [ ] 客户停用后 Session 立即失效。
- [ ] 微信号冲突进入人工审核。

## C. 编号

- [ ] 买家编号只在第一张正式订单生成。
- [ ] 渠道序号原子递增。
- [ ] 序号不复用。
- [ ] 历史编号保持原样。
- [ ] 卖家渠道序号独立。
- [ ] ASIN Marketplace 唯一。
- [ ] 订单号 Claim 并发测试通过。

## D. 产品、需求和预约

- [ ] 产品申请与需求批次分表。
- [ ] 同店铺重复和跨店铺冲突正确。
- [ ] R2 上传失败无残留业务记录。
- [ ] 需求追加不覆盖旧批次。
- [ ] 普通买家只看到公开需求。
- [ ] 预约预检正确。
- [ ] 同一名额并发批准最多成功一次。
- [ ] 过期释放名额。
- [ ] 预约重开保留历史事件。

## E. 订单

- [ ] 买家提交先进入待核对。
- [ ] 售前确认才生成正式订单。
- [ ] 无对应日期汇率时拒绝确认。
- [ ] 正式订单保存完整快照。
- [ ] 重复请求返回相同结果。
- [ ] 同 Key 不同请求返回冲突。
- [ ] 图片上传失败补偿。
- [ ] 客户不能伪造 buyer/seller/product 等主体字段。

## F. 评论与财务

- [ ] 评论状态只能通过工作流。
- [ ] 审核命令要求 Idempotency-Key 和 expected_version。
- [ ] 评论通过产生返款应付和服务费应收。
- [ ] 重放不重复产生财务事实。
- [ ] 已完成返款不可直接编辑。
- [ ] 卖家本金和服务费独立。
- [ ] 冲正、更正和重新入账完整。
- [ ] 差额由系统计算。
- [ ] 多口径利润可追溯到事实。
- [ ] 卖家 DTO 不含买家返款或内部利润。

## G. 内部任务与告警

- [ ] D1 是任务权威源。
- [ ] 任务领取原子。
- [ ] 工作项命令重复请求保持幂等。
- [ ] 不存在飞书登录、绑定、同步、回调或告警运行入口。
- [ ] 内部任务异常进入受控重试或人工处理。
- [ ] 外部独立健康告警不包含完整敏感数据。
- [ ] 正式动作必须打开受控 Web 页面。

## H. 备份与上线

- [ ] D1 完整备份生成哈希和 Manifest。
- [ ] 隔离恢复演练通过。
- [ ] R2 Manifest 可核对。
- [ ] Staging 全流程通过。
- [ ] 中国大陆主要网络实测门户可用。
- [ ] 真实导入先 PREVIEW、再人工审批。
- [ ] 生产部署有显式授权和回滚方案。

## I. Staff MCP 本地交付（M9）

- [x] Staff-only 13 工具合同、schema、mock 和 protocol dry-run 通过。
- [x] ACTIVE Staff、角色、Personal DENY、Team/Department 和资源 scope 每次调用重算。
- [x] 微信号/单任务截图允许路径与 Credential/Secret/批量导出禁止路径通过。
- [x] Prompt injection/OCR/客户文本不能扩工具、参数或权限。
- [x] Immutable safe audit、重放/并发、限流和全局/逐工具 kill switch 通过。
- [x] MCP 关闭不影响 D1/Web，Buyer/Seller MCP 未注册。
- [x] 无需 0035 的 Migration 证据、回滚 Runbook 和本地验收矩阵完成。
- [ ] 真实 OAuth、外部 AI 隐私批准、ChatGPT 注册和生产激活完成（必须按老板清单另行执行）。

## J. 员工获客漏斗本地交付（M14）

- [x] Migration 0036 仅从 schema 35 升级，错序、重复和部分 DDL 失败关闭，隔离备份恢复/前向重新升级通过。
- [x] owner / pre_sales / seller_ops / buyer_refund 职责、Scope 和 Personal DENY 通过，客户端无渠道权威。
- [x] 微信规范化、同类型唯一有效线索、服务端加密/HMAC、脱敏 DTO 与秘钥失败关闭通过。
- [x] 北京日咨询更正、不可变初始归因、自动 Buyer/Seller 关联、未参加与 Seller ACTIVE 合作口径通过。
- [x] 正式订单/利润只计 Buyer 初始来源，Seller 投影无利润字段。
- [x] 十二个北京日历月匿名化、业务/安全/争议/法律豁免、租约重试和只读 Worker dry-run 通过。
- [x] 员工工作台中文入口、`/staff/acquisition` 可收藏路由、窄屏浏览器与 buyer_refund 隐藏控件通过。
- [ ] 正式 Implementation Verify、总控验收、归档与 Production GO（不属于本地实现授权）。
