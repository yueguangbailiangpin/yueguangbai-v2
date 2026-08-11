# AGENTS.md

本文件约束所有参与月光白 V2 的代码 Agent、Codex 和本地执行工具。

## 1. 权威来源顺序

发生冲突时按以下优先级执行：

1. 用户最新明确决定。
2. `docs/decisions/V2_DECISION_REGISTER.md`
3. `docs/product/V2_PRODUCT_RULES.md`
4. `docs/contracts/*`
5. `docs/architecture/*`
6. 当前模块验收文件。
7. 旧仓库代码仅为参考，不是权威规则。

## 2. Git 与开发基线治理

- 当前唯一正式开发基线是最新 `main`。
- 每个新任务先同步并确认最新 `main`，再创建短生命周期 `feature/*`、`fix/*` 或 `chore/*` 分支。
- 历史 `feature/frozen-*`、`chore/final-*`、旧 V3/V4、handoff 或阶段性 SHA 只用于追溯，不得作为新任务默认起点。
- 一个任务只建立必要的工作分支和 active OpenSpec；不要用 `V3`、`V4`、`final`、`final-final` 等长期分支表达产品版本。
- 功能完成后通过普通 PR 回到 `main`；不得为了整理历史默认 force push、rebase 已共享历史或重写迁移历史。
- 合并后的临时分支不再拥有“权威基线”地位。删除远程分支前必须确认其提交已被 `main` 包含或已明确判定无需保留。

## 3. 禁止自行重设计

Agent 不得：

- 擅自改变业务流程、角色、字段含义或编号规则；
- 因实现困难而删除审计、幂等、版本或权限检查；
- 将正式业务事实改放到飞书；
- 将私人微信聊天当成正式数据库；
- 将订单、财务状态改成可随意覆盖字段；
- 为通过测试而删除、跳过或弱化测试；
- 整目录复制旧仓库。

遇到合同不清楚时停止该模块并报告，不自行猜测。

## 4. 远程操作默认禁止

除非用户在当前会话中明确授权具体动作，否则不得：

- 创建或修改 GitHub 远程仓库；
- Push、创建 PR 或合并；
- 创建、删除、绑定或迁移 Cloudflare D1/R2/Worker；
- 运行远程 Migration 或远程 SQL；
- 部署 Worker；
- 创建或修改飞书应用、表格、机器人或权限；
- 导入真实数据；
- 上传真实图片；
- 读取旧生产 D1、R2 或 Secrets。

本地 `wrangler dev`、本地 D1、匿名测试数据和 dry-run 可以在明确的本地执行任务中使用。

## 5. 旧仓库边界

只允许读取固定 Commit：

```text
e211dff657dbcb100b111ba69a75f8e51268aef3
```

禁止迁入：

- `.git`
- `migrations/`
- 旧 `wrangler.jsonc`
- 旧真实数据、SQLite、备份和导入包
- 旧资源 ID、域名、Secrets
- 旧员工共享链接体系
- 旧财务覆盖式更新实现

允许提取的具体文件和方法见：

```text
docs/migration/V2_LEGACY_CODE_REUSE.md
```

## 6. 数据与财务硬约束

- 所有时间点以 UTC 毫秒整数存储，显示和业务日期使用 `Asia/Shanghai`。
- JPY 使用整数日元。
- CNY 使用整数分。
- 汇率使用有明确方向和比例尺的整数。
- D1 中禁止使用 `REAL` 保存金额、汇率或利润事实。
- 已完成返款、卖家本金、服务费、内部结算不得直接覆盖或删除。
- 错误财务通过冲正、更正和重新入账处理。
- 财务写入必须有幂等键、版本或唯一业务约束和审计事件。

## 7. 身份和权限硬约束

- Staff 使用独立 Staff 身份、可信后端会话和权限模型，不使用旧共享角色链接。
- Cloudflare Access 只证明 Staff 邮箱身份；D1 Staff 状态、唯一角色、Marketplace Scope 和个人授权 / 禁用决定最终业务权限。
- 飞书已退出当前及计划运行架构；历史 Migration 与 archived Change 只保留升级和审计历史，不得形成登录、绑定、同步、回调、任务或告警运行能力。
- 未来如重新引入飞书，必须有用户新的明确决定、独立 OpenSpec Change 和总控批准；不得把历史代码或配置开关直接复活。
- 每名 ACTIVE Staff 恰有一个 ACTIVE 角色；零角色、多角色、旧角色或未知角色均失败关闭。
- 最终权限：
  `(角色默认权限并集 + 个人授权 + 负责人权限包) - 个人禁用 - 系统硬禁止`
- 权限之后仍必须检查组织、部门、团队、客户、店铺、资源归属和字段投影。
- 无权访问其他客户资源时统一返回 404，避免信息泄露。
- 内部公司财务查看仅允许 Active Staff、system owner role 和 `FINANCIAL_VIEW`，且 Personal DENY 最终优先。
- 内部公司财务导出还必须具有 `FINANCIAL_EXPORT`，且 Personal DENY 最终优先。
- Seller Organization OWNER 不得因此读取内部利润、Buyer Refund 成本、公司现金流、内部财务异常、内部财务导出或其他 Seller 数据。
- 未来卖家侧导出必须通过独立 OpenSpec Change，使用单独的 Seller-safe Contract 和 Permission，只输出该 Seller Organization 被允许的字段；不得复用内部公司财务 API 或 `FINANCIAL_EXPORT`，也不得输出内部利润或 Buyer Refund 成本。
- 买家隐私、买家返款和内部利润不得出现在卖家可见 DTO 中。

## 8. API 和并发硬约束

所有关键写操作必须具备：

- `Idempotency-Key`
- 请求哈希
- `expected_version` 或等效条件更新
- 状态机校验
- 事务 / 批处理中的最终断言
- 审计事件
- 重放相同响应或明确冲突

R2 上传类操作必须：

1. 先做权限、重复、容量和业务预检查；
2. 建立上传意图 / 租约；
3. 上传；
4. `head` 校验；
5. 最终提交前再次检查；
6. 失败时补偿删除；
7. 对残留对象可安全重试清理。

## 9. 测试要求

每个模块至少需要：

- 纯函数单元测试；
- D1 本地集成测试；
- 权限和越权测试；
- 幂等重放与冲突测试；
- 版本冲突测试；
- R2 失败补偿测试（涉及图片时）；
- 客户 DTO 隐私泄露测试；
- 对应验收矩阵条目。

不得报告未执行的测试为通过。

## 10. 每次执行后的报告格式

```text
TASK=
FILES_CHANGED=
COMMANDS_RUN=
TESTS_PASSED=
TESTS_FAILED=
REMOTE_WRITES=no
CLOUDFLARE_RESOURCES_TOUCHED=no
FEISHU_RESOURCES_TOUCHED=no
GITHUB_REMOTE_TOUCHED=no
OPEN_RISKS=
NEXT_SAFE_STEP=
```

## 11. OpenSpec 治理入口

- 变更规划遵循 `openspec/config.yaml` 与 `docs/AI_ENGINEERING_GOVERNANCE.md`。
- 总控对话是业务规则的最终决策者；Spec 与代码冲突必须交回总控判断。
- 一个 Feature 同时只能有一个源码写入者；Integration 只验证，不开发。
- Ponytail 默认关闭，只能在完整验收后进行只读审查，绝不自动修改代码。
