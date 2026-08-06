# API Contract Baseline Alignment

## Why

治理文档仍声明 `/api/v2/*` 和 `page/page_size`，真实注册接口与正式前端使用 `/api/*`、`cursor/limit/next_cursor`。继续保留冲突会使新 OpenSpec、MCP 和外部集成基于错误基线规划。

## What Changes

- 以真实已注册 HTTP API 为权威盘点 `/api/*` 路由族。
- 将可增长列表的正式分页合同统一记录为 cursor 模型。
- 标记确需 page 模型的有限报表，而不是全局混用。
- 更新 API conventions、route inventory、示例和 OpenSpec context，不重命名运行中路由。
- 冻结 MCP 工具版本独立于 HTTP URL 版本。

## Non-Goals

- 不新增或删除业务 API。
- 不全仓迁移到 `/api/v2/*`。
- 不改变 DTO、权限、状态机或财务语义。
- 不创建 Migration。

## Migration and Contract Impact

Schema Migration 明确为 none。该 Change 只修正权威合同与验证器；任何盘点中发现的真实行为缺陷必须进入对应业务 Change，不能借文档改写掩盖。

## Rollback Boundary

文档/验证器可以普通 Git revert；不得回滚真实 API。若校正暴露消费者依赖冲突，保留当前实现并记录独立兼容 Change。

## Acceptance

静态路由盘点、Frontend adapter 盘点、pagination DTO/runtime schema、内部链接和 OpenSpec strict 必须一致；route count 不得因本 Change 改变。
