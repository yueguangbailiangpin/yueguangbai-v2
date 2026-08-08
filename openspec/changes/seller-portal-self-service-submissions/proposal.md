# Change Proposal: Seller Portal Self-Service Submissions

## Why

Seller API 已具备产品申请和需求批次的受控提交/撤回能力，但正式 Seller Web 只有列表和详情，卖家无法从页面完成“提交需求”。需要补齐前端入口和表单，而不复制后端状态机。

## Scope

- 在 Seller 门户增加清晰的“提交产品申请”和“提交需求”入口。
- 为产品申请、需求批次和允许的撤回动作提供中文表单、运行时合同和恢复体验。
- 复用现有 Seller Session、Store Scope、角色、文件上传、幂等、版本和审计边界。
- 补齐桌面/手机、键盘、错误、空列表和权限验收。

## Out of Scope

- 新产品/需求业务状态、自动审批、Seller 财务导出、韩国站启用。
- Staff 审核页面重做、获客漏斗、经营看板或生产部署。

## Migration

预计不需要 Migration。实现前必须核验现有 Seller Portal POST 合同和文件目的完整；发现缺失业务事实时停止本 Change，不得顺手创建竞争 Migration。

## Rollback

可回退 Seller Web 与第一方 adapter；已成功提交的产品申请、需求批次、审计和文件事实不得删除或覆盖。
