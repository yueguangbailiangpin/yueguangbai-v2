# 月光白 V2

状态：`LOCAL_RELEASE_CANDIDATE / PRODUCTION_REQUIRES_SEPARATE_APPROVAL`

月光白 V2 是卖家、买家和内部 Staff 共用的业务管理系统。当前唯一正式开发基线是 `main`；历史 `feature/frozen-*`、`chore/final-*`、阶段性 V3/V4 或 handoff 名称只作为历史记录，不是新的开发入口。

## 当前架构

- Staff：Cloudflare Access 验证邮箱身份；D1 中的 Staff 状态、唯一角色、Marketplace 范围和个人授权/禁用决定最终权限
- Buyer / Seller：日常沟通可使用私人微信；正式提交、查询和状态操作进入月光白 Web 门户
- API：Cloudflare Workers + Hono
- 权威业务数据：Cloudflare D1
- 权威在线图片：Cloudflare R2
- 员工正式工作：月光白 Staff Web/API
- 飞书：已退出当前及计划运行架构；仅允许历史 Migration / archived Change 作为升级和审计证据存在

## 当前核心业务链

仓库已经包含以下领域的实现与测试资产，最终完成状态以验收矩阵和当前真实执行结果为准：

```text
卖家产品申请
→ Staff 审核
→ 创建 / 发布需求批次
→ 买家查看需求
→ 买家预约
→ 待核对订单资料
→ 售前确认 / 正式订单快照
→ 评论提交与审核
→ 买家返款 / 卖家应收与结算
→ 财务查询、审计与异常处理
```

同时包含客户与店铺主数据、权限与隔离、幂等与版本控制、审计 / Outbox、R2 文件链、Scheduler、三端 Portal 和 `/review` Demo 评审模式等基础能力。

## 当前发布边界

- 当前仓库是本地 Release Candidate，不等于生产已验收
- 真实 Cloudflare Access、生产 D1/R2、部署、恢复演练、真实数据导入和员工试用必须单独授权与验收
- Staff MCP 源码和独立测试可保留，但不属于核心 Worker 运行时或核心发布模板
- Google Drive 冷归档写侧默认关闭；不得把它当在线图片权威源
- Rakuten / TikTok Provider Adapter 尚未接入核心 Worker 运行入口
- `/review` 只能使用 Demo 数据，真实 API 必须失败关闭

## 数据库与迁移

- 当前 Schema：65
- `migrations/0001`–`0065` 是已建立的迁移历史，不得为“整理代码”重写
- 后续数据库变化从新的前向 Migration 开始（当前基线之后即 `0066+`）

## 开发入口

1. 从最新 `main` 开始
2. 使用短生命周期 `feature/*`、`fix/*` 或 `chore/*` 分支完成单一任务
3. 按 OpenSpec / Acceptance 要求验证
4. 通过普通 PR 合回 `main`
5. 合并后的临时分支不再作为下一轮开发基线

不要通过创建长期 `V3`、`V4`、`final-final`、`frozen` 分支表达产品版本。

## 本地基线验证

```bash
npm ci
npm run verify:openspec:strict
npm run check
git diff --check
```

任何 PASS / FAIL 必须来自当前 checkout 的真实执行结果，历史审计不能替代当前验证。

## 必读顺序

1. `AGENTS.md` — Agent / 开发执行硬边界
2. `PROJECT.md` — 产品目标和范围
3. `docs/CURRENT_SYSTEM_STATE.md` — 当前系统状态和发布边界
4. `docs/decisions/V2_DECISION_REGISTER.md` — 已决策事项
5. `docs/product/V2_PRODUCT_RULES.md` — 产品规则
6. `docs/contracts/*` — API / 数据合同
7. `docs/architecture/*` — 架构边界
8. `docs/acceptance/V2_ACCEPTANCE_MATRIX.md` — 验收矩阵
9. 当前 active OpenSpec Change — 当前任务变更说明
10. `docs/audits/*` / archived OpenSpec — 仅用于历史证据和追溯

发生冲突时以 `AGENTS.md` 中定义的权威顺序为准。

## 强制安全边界

除非用户在当前会话明确授权具体动作，否则不得 Push / Merge / Deploy，不得修改 Cloudflare、生产 D1/R2、Secrets、真实数据或其他外部资源；不得开发私人微信 Hook、RPA、非官方协议、批量自动加人或全量聊天抓取。
