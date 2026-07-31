# 旧仓库代码复用合同

## 1. 固定来源

```text
Repository: yinghua520ai/yueguangbai-ChatGPT
Commit:     e211dff657dbcb100b111ba69a75f8e51268aef3
Tree:       f8c8c1fe2312322b49c09fd1d98638a780a769da
```

不得从未固定的 main、其他分支或后续 Commit 取代码。

## 2. A 类：可提取后适配

这些文件可提取纯工具函数和测试思想，但必须改名、去旧依赖并写入 V2 新路径：

| 旧文件 | 可复用部分 |
|---|---|
| `src/security/customer-password.ts` | PBKDF2、Salt、临时密码、验证成本、Base64URL |
| `src/security/customer-session.ts` | HMAC Session 编解码和校验 |
| `src/utils/bounded-request.ts` | 请求体、JSON、Multipart 大小限制 |
| `src/security/response-headers.ts` | API 安全响应头基础 |
| `src/utils/fixed-decimal.ts` | 固定点数字解析 |
| `src/routes/admin/shared.ts` | SHA-256、文本清理、LIKE 转义、幂等键校验 |
| `src/domain/product-code.ts` | 产品编号类型识别基础 |
| `src/observability.ts` | 结构化错误日志基础 |
| `scripts/scan-secrets.mjs` | Secret 扫描框架 |

要求：复制前逐函数审查；不得复制旧表名、路由、角色或环境变量。

## 3. B 类：保留算法和测试场景，业务服务重写

| 旧文件 | 可保留思想 | 必须重写原因 |
|---|---|---|
| `src/services/daily-order-rates/index.ts` | 中国业务日期、版本冲突、定点汇率 | V2 汇率方向、版本和权限合同不同 |
| `src/services/amazon-order-number-claims.ts` | 规范化、Claim、并发冲突 | 旧订单组和旧表结构 |
| `src/services/seller-member-access.ts` | 组织/店铺 Scope、字段白名单 | V2 权限公式、成员表和硬禁止不同 |
| `src/services/seller-product-submissions.ts` | Multipart、魔数、SHA、R2 校验、补偿、冲突 | 旧实现混合产品和需求 |
| `src/services/product-reservations/index.ts` | 状态机、幂等租约、事件、名额锁定 | 旧 Campaign、资格和 Todo 耦合 |
| `src/services/reservation-to-order/index.ts` | 上传意图、补偿、最终复检 | V2 先待核对、再正式确认 |
| `src/app.ts` / `src/index.ts` | Hono 骨架、Request ID、统一错误、scheduled | 旧路由和 Workflow |
| `scripts/d1-full-backup.mjs` | 导出、压缩、哈希、隔离恢复、回读验证 | 硬编码旧表、Trigger、DB、Bucket |

B 类文件不得整文件搬迁。必须先写 V2 接口和测试，再按需要重写。

## 4. C 类：只参考业务场景，核心实现全部重写

- `src/routes/admin/reviews.ts`
- `src/routes/admin/refunds.ts`
- `src/routes/admin/seller-settlements.ts`
- 旧利润计算和订单表财务字段更新

原因：旧实现直接覆盖订单上的评论、返款、结算和利润，不符合 V2 追加式财务账本和冲正合同。

## 5. 禁止迁入

- 旧 `.git`
- 全部旧 `migrations/`
- 旧 `wrangler.jsonc`
- 旧 D1/R2 ID、域名、Google Drive 文件夹
- 旧 Secrets 和环境文件
- 旧 SQLite、备份和真实数据
- 旧腾讯迁移脚本和 Phase 3/4 导入包
- 旧员工共享链接、旧 Admin Session 和旧四角色权限表
- 旧前端目录整体
- 旧生产测试账号和 Fixture

## 6. 标准复用流程

```text
读取固定 Commit 的单个文件
→ 标记允许函数
→ 写 V2 接口和匿名测试
→ 重写 V2 文件
→ 检查不存在旧表名、资源 ID、路由和角色
→ 本地测试
→ 审查 Diff
```

禁止：

```text
cp -R old-repo/src new-repo/
```
