# V2 API 合同

本文档描述当前默认 Hono App 的正式 HTTP 合同。运行时注册表和共享 Contract path 常量是事实来源；本文档不创建别名，也不为路径美观改名。

## 1. 路径与版本

正式业务 API 使用当前已注册的 `/api/*` 路由族。健康检查是 `/health`，不属于业务 API。

当前内部 Web 与 HTTP API 同部署，不使用 URL 路径版本。MCP 工具另行以工具名和输入/输出 schema 维护自己的 `v1`；MCP 版本不从 HTTP 路径推导。

未来若外部消费者需要 breaking HTTP 版本，必须建立独立 Change，定义并存、迁移和退役；不得把当前 `/api/*` 静默重命名为 `/api/v2/*`。

完整的 180 个 `/api/*` 端点及 `/health` 基线见 [`V2_API_ROUTE_INVENTORY.md`](./V2_API_ROUTE_INVENTORY.md)。该 inventory 由自动验证器与默认 App 的运行时 route table 对照，route count 必须与当前 Change 同步。

## 2. 响应

成功：

```json
{
  "data": {},
  "meta": {
    "request_id": "..."
  }
}
```

错误：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "当前数据已更新，请刷新后重试",
    "details": null
  },
  "meta": {
    "request_id": "..."
  }
}
```

客户响应不得包含堆栈、SQL、R2 Key、其他客户名称或内部异常细节。

## 3. 稳定错误码

至少：`VALIDATION_ERROR`、`UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`REQUEST_IN_PROGRESS`、`RATE_LIMITED`、`DEPENDENCY_UNAVAILABLE`、`UPLOAD_FAILED`、`STATE_CONFLICT`、`DUPLICATE_ORDER_NUMBER`、`DUPLICATE_PRODUCT`、`ASIN_STORE_CONFLICT`、`CAPACITY_FULL`。

## 4. 写操作

关键 POST/PATCH/PUT 必须要求：

```http
Idempotency-Key: ...
```

更新既有聚合必须包含：

```json
{
  "expected_version": 7
}
```

Key 格式：8–128 字符，仅允许字母、数字、点、下划线、冒号和短横线。

## 5. 分页

会增长、需要稳定遍历的列表默认使用 opaque cursor：

```text
请求：cursor（可选）、limit（有上限）
响应：items、next_cursor（string 或 null）
```

客户端必须继续使用服务端返回的 `next_cursor`，不得推断总行数、页数或把 cursor 当作 page number。各领域的默认/最大 `limit` 以及是否在 `page` 包装对象内返回，必须以对应 runtime Contract 为准；`page.limit` + `page.next_cursor` 仍是 cursor 语义，不是页码分页。

当前有限例外是 Staff 内部财务报告：`/api/staff/finance/orders`、`/api/staff/finance/groups`、`/api/staff/finance/cash-flow`、`/api/staff/finance/exceptions` 返回 `page: { limit, next_cursor }`。这些是受权限保护、按筛选条件读取的有限报表，仍以 cursor 遍历，不提供 `page_size`、`total_pages` 或总数承诺。

## 6. 文件上传

- 使用 multipart/form-data。
- 元数据放单一 JSON `payload` 或明确白名单字段。
- 未知字段拒绝。
- 校验真实文件魔数，不只相信 MIME。
- 限制文件数量、单文件和总请求大小。
- 计算 SHA-256。
- 同一请求内重复文件拒绝或去重。
- R2 上传后 `head` 校验。

## 7. 鉴权与信息隐藏

- 员工：飞书 OAuth/身份交换后获得短期内部 Session；每次请求重新计算或读取当前 D1 权限上下文。
- 客户：买家和卖家成员使用客户账号 Session；Session 可撤销，客户停用或安全变更后立即失效。
- 未授权资源统一返回 404。
- 卖家 DTO 使用字段白名单。
- 买家 DTO 不暴露卖家内部备注、内部利润或其他买家信息。
- R2 对象通过授权端点读取。
