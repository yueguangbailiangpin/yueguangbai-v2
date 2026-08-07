# Feishu Staff Workbench PoC and Integration

## Why

飞书已冻结为最多八名员工的身份入口、任务摘要、队列和提醒，但免费版真实权限、额度、Task/Bitable/回调行为和中国大陆可用性尚未验证。D1 task/outbox 已有权威边界，仍缺匿名 PoC、真实同步 Adapter、失败闭环和员工工作台验收。

## What Changes

- 交付不发起外部网络请求的本地 adapter、mock 和 dry-run，用虚构数据固定待后续真实匿名 PoC 验证的输入输出合同、容量模型与操作清单。
- 以 D1 Staff/Task/Permission 为权威，飞书只镜像本人/团队待办、异常、逾期和聚合摘要。
- 支持已存在的低风险任务重新分派回调；每个回调必须先通过签名、时间窗、nonce 和重放检查，再映射到当前 D1 Staff Authorization 并进入既有 versioned command。
- 正式审批、返款、结算、汇率和完整资料继续打开受控 Web。
- Outbox 同步幂等、可合并、可重放；飞书故障不回滚业务。

## Non-Goals

- 不把飞书作为订单、财务、权限或任务权威数据库。
- 不同步完整微信号、原始截图、付款凭证或完整客户资料。
- 不镜像每日二百订单的每次状态变化。
- 不创建真实飞书应用、表格或机器人，不调用真实飞书、OAuth 或回调 URL，不创建凭证，不部署，不写入远程 D1。

## Migration and Contract Impact

复用现有 `staff_work_items`、Staff identity、`integration_outbox` 和 Scheduled Job 事实。源码 inventory 已确认缺少镜像版本和受信回调收据的持久化边界，因此本 Change 使用紧接 0032 的 0033 Migration 保存本地镜像和已验签回调收据；不得改变既有业务或财务事实。Contracts 冻结 D1→飞书摘要白名单、飞书→D1 的唯一低风险动作、callback signature/replay、version conflict、失败分类和 sync health DTO。

## Dependencies

依赖 Scheduled Operations、现有 Staff Auth/Permission、Staff Task/Assignment 和 API Contract alignment。真实联调依赖业务所有者另行授权飞书资源与 Secret。

## Rollback Boundary

通过配置停用 OAuth/同步/回调后，D1 业务与 Web 必须继续运行。删除或清空飞书镜像不得删除 D1 任务。回滚 Adapter 不回滚已经合法完成的 D1 task commands；冲突回写最新 D1 状态。

## Acceptance

本地 adapter/mock、身份映射、重复/乱序回调、签名/时间窗/nonce、重新分派竞争、Outbox 合并/重放、失败分类、敏感字段扫描、八员工/二百订单 dry-run 和北京时间展示必须通过。真实匿名 PoC、OAuth、免费额度和大陆网络验证保留在最终业务所有者外部清单，不能由本 Change 声称已完成。
