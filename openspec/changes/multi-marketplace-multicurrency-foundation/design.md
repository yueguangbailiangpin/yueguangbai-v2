# Design: Multi-Marketplace and Multi-Currency Foundation

## Authority Model

`marketplaces` 保存稳定站点代码、平台、国家/地区、交易币种和启停状态。Seller Organization 不保存权威 Marketplace；每个 Store 必须保存一个 Marketplace。Buyer Profile 保存且只保存一个 Marketplace。正式订单从 Reservation → Product Version → Store 锁定 Marketplace，不信任客户端提交。

金额使用 `amount_minor` 与 `currency_code`；汇率保存 source/quote currency、整数比例尺、版本和有效业务日期。所有财务计算继续使用 BigInt，正式事实保存规则/汇率快照而不是回读当前规则。

## Platform Adapter Boundary

共享工作流只接受平台中性 `platform_order_identifier`、`platform_product_identifier` 和 `platform_order_date`。Adapter 按 Marketplace 执行格式、URL 和语义验证。`COUPANG_KR` 在没有真实样本前只注册能力为 unavailable，不接受伪造校验。

## Transaction and Invariants

- Store 创建必须验证 Seller Organization、Marketplace 和权限，但不得要求 Organization 单站点。
- Buyer Marketplace 纠正只允许 owner，在不存在 Reservation、Order Evidence、Formal Order、Review 或 Financial Facts 时条件更新并写 Audit。
- Rate/Fee 当前版本唯一键按 D-016 组合键建立；新版本追加，旧正式快照不可修改。
- Migration 必须逐表复制、断言行数/金额/关系、切换、重建 Trigger/View，再删除临时表。

## Security and Privacy

Seller 查询必须继续应用 Organization + Store Scope；Buyer 查询必须继续应用 Buyer + Marketplace Scope。平台扩展不得放宽 concealed 404、字段白名单或 Buyer/Seller DTO 隔离。

## Performance

在 Marketplace、Store、Buyer Profile、Rate Current Key 和 Fee Current Key 上建立与真实查询匹配的复合索引。按最多每日二百订单设计，不引入分库、缓存服务或微服务。

## Rollback and Verification

升级前生成 D1 备份与 Schema/row/hash Manifest。升级 verifier 同时运行空库、JP 既有 Fixture 和匿名多币种 Fixture。任何断言失败都停止切换；已产生新币种事实后只能前向修复或从隔离备份恢复。

## Rejected Alternatives

- 拒绝为 US/KR 复制整套表或数据库。
- 拒绝在 Seller Organization 上保留单一 Marketplace 并增加例外数组。
- 拒绝以 REAL/FLOAT 保存币种或汇率。
- 拒绝现在实现未知的 Coupang 格式。
