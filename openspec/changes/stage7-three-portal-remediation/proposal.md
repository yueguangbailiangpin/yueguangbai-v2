# Proposal: stage7-three-portal-remediation

## Why

ChatGPT 对阶段 7 三端重构的统一总审（2026-08-28）发现五类真实缺陷：卖家端运行时
Zod schema 与共享合同漂移（真实后端响应会被 strict schema 整体拒绝）、卖家端订单页
固定只渲染第一张沟通截图、`global.css` 含字节级完全重复的大段区块（约 9,840 行）、
四个买家 Playwright spec 存在基线即失败的用例（含无障碍 focus-visible 回归），以及
阶段 7 交接文档中的失实结论（提交数、`TESTS_FAILED=0`、CSS 清理量、"卖家 DTO 没有
上传人/时间"）。本 Change 只修复这些已确认缺陷并收口回归，不进入阶段 8、不开发营销
官网、不部署。

## What Changes

- 卖家端 `sellerFormalOrdersSchema` 与共享 `SellerFormalOrderPortalDto` /
  `OrderCommunicationScreenshotReferenceDto` 完全对齐：

  - `communication_screenshots` 每项补齐 `uploaded_at`（必填 epoch 毫秒）、
    `uploaded_by_staff_id`（必填可空）、`uploaded_by_staff_name`（可选可空）；
  - 删除共享合同与后端从不返回的 `legacy_projection` 判别字段、
    `canonical_marketplace_code`，以及 `base_rate_confirmed_at`/
    `policy_confirmed_at`/费用快照 `confirmed_at` 三个漂移时间戳字段名，改回
    `base_rate_created_at`/`policy_created_at`/`created_at`；
  - 不使用 `.passthrough()` 放宽，保持 strict 拒绝内部敏感字段。
- 卖家端订单页渲染完整 `communication_screenshots` 数组：每张截图独立的
  查看入口、`file_object_id`/`file_version`、上传员工姓名（无法解析时中性占位）与
  上传时间；空数组显示明确空状态；跨组织 concealed 404 与 SELLER_VISIBLE 边界不变。
- 合同级测试：真实后端响应形状（含三新字段）可被 `sellerFormalOrdersSchema`
  解析；内部敏感字段仍被拒绝；一张/两张/多张截图渲染测试；两张截图必须产生两个
  独立可操作入口。
- CSS 清理：删除 `global.css` 中字节级完全重复的样式表区块（保留一个副本，靠
  CSS 层叠保持行为不变），清理 `design-freeze.css` trailing whitespace 与无引用
  旧壳层；增加静态防回归检查拒绝大段完全重复 CSS 再次进入仓库；记录清理前后
  源文件行数/字节与构建 CSS raw/gzip；重新生成三端截图逐张确认无视觉回退。
- 买家 Playwright 既有失败逐项分类修复：真实功能回归、无障碍回归（恢复
  focus-visible）、当前批准业务变更导致的旧断言、fixture 与真实合同不一致；
  注册成功交互（人工点击进入）与当前批准交互对齐；不删测试、不 skip、不降低
  断言、不只延长超时。
- 补足三端正常状态视觉证据（员工/买家/卖家桌面 1440、移动 390、Drawer、
  卖家订单沟通截图含至少两张真实形状 mock 截图及上传人/时间）。
- 修正 `V2_FRONTEND_REBUILD_STAGE7_THREE_PORTALS_HANDOFF.md` 失实条目，新增
  `V2_FRONTEND_REBUILD_STAGE7R_HANDOFF.md`，把真正的后端合同缺口与已修复的
  前端缺口分开。

## Capabilities

### New Capabilities

- `stage7-three-portal-remediation`: 阶段 7R 缺陷修复与回归收口的可测试验收要求。

### Modified Capabilities

- None. 后端 API/合同/schema（224 端点、schema 30）零修改；本 Change 不改变任何
  长期业务规则，只修复前端实现与共享合同的偏差。

## Impact

- 影响文件：`apps/web/src/seller/contracts/runtime.ts`（及其测试）、
  `apps/web/src/seller/pages/SellerPages.tsx`、`apps/web/src/styles/global.css`、
  `apps/web/src/styles/design-freeze.css`、买家 e2e 四个 spec、卖家/买家相关
  fixture（demo-data、stage7/seller-visual spec）、新增 CSS 防回归 verifier、
  交接文档两份。
- 不修改 `packages/contracts`、`apps/api` 任何运行时代码（后端已返回上传人/时间，
  本轮只做前端接线）。
- 无 Migration、无权限模型变化、无远程操作。
- 风险与回滚：CSS 去重依赖层叠等价性，以三端截图对比与构建 CSS 比对兜底；schema
  收紧可能暴露更多 fixture 漂移，逐项按真实后端合同修正并在交接文档记录旧断言与
  修改理由。回滚边界：单仓库单分支本地提交，未 push。
