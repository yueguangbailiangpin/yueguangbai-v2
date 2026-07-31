# V2 API 合同

## 1. 路径

```text
/api/v2/*
```

健康检查：

```text
/health
```

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

至少：

- `VALIDATION_ERROR`
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `VERSION_CONFLICT`
- `IDEMPOTENCY_CONFLICT`
- `REQUEST_IN_PROGRESS`
- `RATE_LIMITED`
- `DEPENDENCY_UNAVAILABLE`
- `UPLOAD_FAILED`
- `STATE_CONFLICT`
- `DUPLICATE_ORDER_NUMBER`
- `DUPLICATE_PRODUCT`
- `ASIN_STORE_CONFLICT`
- `CAPACITY_FULL`

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

请求：

```text
page
page_size
```

`page_size` 最大 100。

响应：

```json
{
  "pagination": {
    "page": 1,
    "page_size": 25,
    "total": 100,
    "total_pages": 4
  }
}
```

## 6. 文件上传

- 使用 multipart/form-data。
- 元数据放单一 JSON `payload` 或明确白名单字段。
- 未知字段拒绝。
- 校验真实文件魔数，不只相信 MIME。
- 限制文件数量、单文件和总请求大小。
- 计算 SHA-256。
- 同一请求内重复文件拒绝或去重。
- R2 上传后 `head` 校验。

## 7. 鉴权

### 员工

飞书 OAuth/身份交换后获得短期内部 Session。每次请求重新计算或读取当前 D1 权限上下文。

### 客户

买家和卖家成员使用客户账号 Session。Session 可撤销，客户停用或安全变更后立即失效。

## 8. 信息隐藏

- 未授权资源统一返回 404。
- 卖家 DTO 使用字段白名单。
- 买家 DTO 不暴露卖家内部备注、内部利润或其他买家信息。
- R2 对象通过授权端点读取。
