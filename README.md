# 月光白 V2 · 模块 0 冻结合同包

状态：`MODULE_0_FROZEN_FOR_LOCAL_BOOTSTRAP`

本包用于创建全新的月光白 V2 本地仓库。它只包含产品、架构、权限、安全、同步、验收和旧代码复用合同，不包含业务实现代码，不连接任何远程资源。

## 当前路线

- 内部员工：飞书
- 买家、卖家日常沟通：私人微信
- 客户正式操作：月光白 Web 门户
- API：Cloudflare Workers + Hono
- 权威数据：Cloudflare D1
- 权威图片：Cloudflare R2
- 第一版门户：问题反馈、资料补充，不开发完整多轮实时聊天
- 员工任务：飞书展示摘要，正式业务动作在受控 Web 页面完成

## 强制边界

- 不导入旧 Git 历史、旧 Migration、旧生产数据或旧 Cloudflare 资源 ID。
- 不复制旧仓库整个目录。
- 旧仓库只允许在固定 Commit 上按文件提取算法和测试思想。
- 在获得明确授权前，不创建远程 GitHub 仓库，不 Push，不创建或修改 Cloudflare、飞书资源。
- 不开发私人微信 Hook、RPA、非官方协议、自动控制、批量自动加人或全量聊天抓取。

## 推荐阅读顺序

1. `PROJECT.md`
2. `AGENTS.md`
3. `docs/decisions/V2_DECISION_REGISTER.md`
4. `docs/product/V2_PRODUCT_RULES.md`
5. `docs/architecture/V2_ARCHITECTURE.md`
6. `docs/contracts/*`
7. `docs/acceptance/V2_ACCEPTANCE_MATRIX.md`
8. `docs/migration/V2_LEGACY_CODE_REUSE.md`
9. `CODEX_BOOTSTRAP_PROMPT.md`
