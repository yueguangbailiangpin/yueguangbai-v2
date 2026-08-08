# Change Proposal: Admin Business Dashboard

## Why

后端已有注册、预约、正式订单和内部财务事实，但没有总管理员经营看板；获客渠道和单人线索将由 `staff-acquisition-funnel-workbench` 补齐。需要把这些权威事实组合成可解释、可按北京时间核对的经营视图。

## Scope

- 今日/本周/本月新增买家、预约、正式订单。
- 买家咨询→加微信→注册→预约→正式订单→业务完成漏斗。
- 卖家咨询→加微信→确认合作漏斗。
- 每名员工、每个渠道的分开业绩和日/周/月趋势。
- 预计利润与已完成利润分开展示，复用现有内部财务公式。
- owner-only API、中文响应状态、时间/金额/隐私和浏览器验收。

## Dependencies

必须在 `staff-four-role-consolidation` 与 `staff-acquisition-funnel-workbench` 合入 main 后实现。不能在获客事实尚未冻结时用前端假数据或临时表替代。

## Out of Scope

- 手工填写利润/注册/订单转化、预测模型、广告支出/ROI、外部 BI、飞书利润摘要或 Seller 可见利润。
- 生产部署、真实数据导入或修改现有不可变财务公式。

## Migration

预计不需要 Migration：在冻结规模（最多 8 Staff、每日 200 订单）下优先使用现有业务/财务事实和获客 Change 的索引化表。若真实查询计划证明需要新索引或物化事实，必须在实现时独立说明并取得当时下一连续编号，不得提前占号。

## Rollback

看板是只读投影；可回退 API/Web，不修改来源业务、获客或财务事实。缓存必须可丢弃并按权限隔离。
