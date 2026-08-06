# Feishu Staff Workbench PoC and Integration

## Why

飞书已冻结为最多八名员工的身份入口、任务摘要、队列和提醒，但免费版真实权限、额度、Task/Bitable/回调行为和中国大陆可用性尚未验证。D1 task/outbox 已有权威边界，仍缺匿名 PoC、真实同步 Adapter、失败闭环和员工工作台验收。

## What Changes

- 先用匿名数据验证同租户、管理员权限、OAuth、Task v2/Bitable、事件回调、深链接和免费额度。
- 以 D1 Staff/Task/Permission 为权威，飞书只镜像本人/团队待办、异常、逾期和聚合摘要。
- 支持安全的领取、退回、重新分派等低风险任务动作，回调必须进入 D1 versioned command。
- 正式审批、返款、结算、汇率和完整资料继续打开受控 Web。
- Outbox 同步幂等、可合并、可重放；飞书故障不回滚业务。

## Non-Goals

- 不把飞书作为订单、财务、权限或任务权威数据库。
- 不同步完整微信号、原始截图、付款凭证或完整客户资料。
- 不镜像每日二百订单的每次状态变化。
- 不在未经当前会话明确授权时创建真实飞书应用、表格或机器人。

## Migration and Contract Impact

优先复用现有 Staff identity/task/outbox facts。匿名 PoC 与源码 inventory 后才能判断是否需要下一连续 Migration 保存 Feishu record/version/dead-letter facts；不得提前占号。Contracts 需冻结 D1→飞书摘要白名单、飞书→D1动作、callback signature/replay、version conflict 和 sync health DTO。

## Dependencies

依赖 Scheduled Operations、现有 Staff Auth/Permission、Staff Task/Assignment 和 API Contract alignment。真实联调依赖业务所有者另行授权飞书资源与 Secret。

## Rollback Boundary

通过配置停用 OAuth/同步/回调后，D1 业务与 Web 必须继续运行。删除或清空飞书镜像不得删除 D1 任务。回滚 Adapter 不回滚已经合法完成的 D1 task commands；冲突回写最新 D1 状态。

## Acceptance

匿名 PoC、OAuth、身份映射、重复回调、任务领取竞争、Outbox 合并/重放、免费额度估算、飞书故障、敏感字段扫描、八员工/二百订单负载和大陆网络测试必须通过。
