## 关键决策（Codex 0901 已审，第 5 项 Owner 已裁决）

1. 命名：RAKUTEN_JP / YAHOO_JP 是否循 {BRAND}_{REGION} 惯例正确；来源层 JP_AMAZON/JP_RAKUTEN 与 canonical 的映射放 adapter 而非 contracts 是否维持现行分层。
2. 启用语义：注册表新增行的初始状态（ENABLED vs STAGED）；AMAZON_US 从未启用转启用是否需要与真实美国站卖家的导入解耦。
3. 雅虎 JAN：EAN-13 校验位验证失败时 quarantine 类别命名；4571504490230/4571504490193 两个真值的校验位是否实际合法（若不合法则 JAN_CANDIDATE_WITH_EVIDENCE 语义需要保留证据性通过）。
4. 乐天标识：归档认可集 {R-1,S-1} 之外的新乐天商品编号按 IDENTIFIER_REVIEW_REQUIRED 隔离是否足够（数据中乐天行目前恰为 R-1/S-1）。
5. 预约资格：**Owner 2026-09-01 已裁决——自动"上架可约"**（注册表启用后新市场商品即具备可预约资格，无需逐商品二次确认）。注：此裁决与 Codex 0901 审查建议（逐 offering 显式条件）相反，按 Owner 最新决定执行；实现时保留风控条件（合作状态/需求批次/既有永久限制等）不变。结算/汇率快照按市场币种扩展的边界。
6. D-056 修订的落点：Decision Register 条目更新方式（修订原文 vs 增补 2026-09-01 裁决条）。

## Non-Goals

- 不动 COUPANG_KR；不做乐天/雅虎 API 集成（仍是人工导入路径）；不改三端导航信息架构（市场仅作为筛选维度扩展）。

## 实现顺序（拟）

迁移（预计 0041）与注册表种子 → contracts/runtime → 导入器 adapter v2（含标识校验）→ 前端筛选 → 全锚点同步 → 测试与守卫。
