## Why

当前多个 API 家族各自复制 base64url、UTF-8、JSON 和 padding 的低层实现。重复实现会让 malformed token 边界和旧 token 兼容性难以逐项核对，但各家族的 payload 字段、版本、排序方向、过滤回显和错误类并不相同，不能以一个无类型 cursor 替代它们。

本 Change 只收敛可证明语义等价的低层编码原语，并让保留的 typed codec 继续拥有各自的 payload 与验证规则。目标是维护成本下降，同时对外 token、分页顺序、过滤/组织范围和 HTTP 行为保持字节及语义兼容。

## What Changes

- 在 API foundation 层提供共享的 base64url 字节、legacy binary-string 和 UTF-8 JSON 编码/解码原语。
- 将现有 UTF-8 JSON cursor 家族的重复低层实现迁移到该原语；将历史 ASCII/二进制 JSON 家族仅迁移到保持原始字节行为的 binary-string 原语。
- 保留每个领域 typed codec 的 payload 字段、版本/kind、长度与字段校验、过滤回显、空 cursor 规则和领域错误映射。
- 添加共享原语负向测试、Unicode/边界测试、每个迁移家族的固定旧 token 兼容测试，并复核已有两页以上分页、权限、concealed 404、幂等与版本边界测试。
- 在本 Change 设计中记录全仓 cursor 家族盘点，明确未共享的 raw/internal/frontend cursor 及兼容性理由。

## Non-Goals

- 不改变任何公开 cursor token 字节格式，不让既有 token 失效。
- 不改变 SQL `ORDER BY`、seek `WHERE`、tie-breaker、ASC/DESC、limit+1、has_more、`next_cursor`、过滤顺序、组织/租户范围、DTO、HTTP 状态或错误码。
- 不处理 Seller 权限、safe-dead-code-cleanup、integer schema/envelope、legacy CSS、业务 bug、前端视觉或业务流程。
- 不新增 Migration/table/index，不访问远程 CI、Cloudflare、D1/R2/Queues/Google Drive/生产资源，不 push、不部署、不归档本 Change。

## Impact

源码范围仅限 `apps/api/src/foundation` 共享原语和现有 API 游标实现的低层调用点；测试与本独立 OpenSpec Change 同提交。没有数据库、远程资源或生产放行影响。回滚边界是回滚本次普通提交，不使用 reset、rebase、stash、clean、squash 或 amend。
