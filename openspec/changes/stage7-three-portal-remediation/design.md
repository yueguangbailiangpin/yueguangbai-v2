# Design: stage7-three-portal-remediation

## 1. 卖家运行时 schema 对齐权威合同

权威来源（优先级从高到低）：

1. `packages/contracts/src/seller-formal-order-portal.ts` —
   `SellerFormalOrderPortalDto`（单一 AMAZON_JP 形状：`marketplace_code:
   'AMAZON_JP'`、amazon 字段必填非空、`locked_service_fee_snapshot.created_at`）。
2. `packages/contracts/src/order-communication-screenshot.ts` —
   `OrderCommunicationScreenshotReferenceDto`（`uploaded_at: number` 必填、
   `uploaded_by_staff_id: string | null` 必填可空、
   `uploaded_by_staff_name?: string | null` 可选可空）。
3. `packages/contracts/src/seller-principal-rate-policy.ts` —
   `SellerPrincipalRateSnapshotDto`（`base_rate_created_at`、`policy_created_at`）。
4. `apps/api/src/seller-formal-orders/read-model.ts` — 后端投影实现（非
   AMAZON_JP fail closed 503，因此运行时 schema 不再保留
   `legacy_projection: 'NONE'` 平台变体；该变体源自已归档 Change
   `2026-08-17-rakuten-tiktok-jp-marketplace-foundation`，现行权威合同从未发布）。

对齐方式：strict Zod object 逐字段声明（与员工端
`apps/web/src/staff/contracts/runtime.ts` 截图字段写法一致：
`uploaded_at: epoch`、`uploaded_by_staff_id: z.string().nullable()`、
`uploaded_by_staff_name: z.string().nullable().optional()`），不用
`.passthrough()`。

## 2. 多截图渲染

`SellerPages.tsx` 订单卡"聊天截图"分区改为渲染完整数组：每项一个
`SellerChatScreenshotControl`（独立 read-intent provider，绑定自己的
`file_object_id`/`file_version`），标题行显示序号、上传人（
`uploaded_by_staff_name ?? '员工'` 中性占位）与上传时间（北京时间格式化）。
空数组显示"暂无沟通截图"。concealed 404/权限边界由既有 read-intent 传输层
处理，不改动。

## 3. CSS 去重策略

`global.css` 结构实测：行 1–3280 / 3281–6560 / 6561–9840 三段 SHA256 完全相同
（同一份完整样式表的三次追加），9841–13120 为第四份修订副本，13121–13755 为
尾部新增。删除策略：

- 只删除**字节级完全重复**的整段区块（保留一份），不做语义合并；
- 保留最后出现的规则语义：重复副本删除后，剩余声明顺序仍保证与原层叠结果一致
  （A/B/C 字节相同 → 删除任意两份不改变计算样式；D 与尾段原样保留在后）；
- 全仓类名引用检查（含动态类名拼接族）后才允许删除无引用规则；
- 防回归：新增 verifier 脚本扫描样式表，检测大段（阈值 ≥256 行）完全重复区块，
  挂入既有 npm scripts 验证链。

## 4. 买家 e2e 失败分类

每个失败必须归入：真实功能回归 / 无障碍回归 / 已批准业务变更导致的旧断言 /
fixture 与真实合同不一致。前两类修产品代码；后两类仅在断言确与当前批准合同
冲突时更新测试/fixture，并在 Stage7R 交接文档逐项记录旧断言、当前合同、修改
理由。禁止删测试、skip、降低断言、纯延长超时。

## 5. 决策记录

- 不改后端：`uploaded_by_*`/`uploaded_at` 已由 6.6E 落地（migration 0029 起），
  本轮纯前端接线。
- 注册成功页：以当前批准交互为准（成功页人工点击进入，不自动跳转），测试与
  实现统一。
- `demo-data.ts` 卖家订单 fixture 同步修为真实合同形状（review demo 的
  `demoApiRequest` 会用运行时 schema 解析，旧形状在 schema 收紧后必然失败）。
