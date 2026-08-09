# 管理员经营看板运行手册

## 本地验收

1. 将本地 D1 迁移到仓库当前版本；当前连续末号为 `0038`，确认 `app_schema_state.schema_version=38`。Dashboard 自身仍是 NO_SCHEMA_CHANGE。
2. 运行 `npm run verify:admin-dashboard`。脚本会验证连续 Migration、0036 获客与 0037 排期的明确归属，再使用真实本地 D1 执行查询计划并确认规范财务视图和 BigInt 聚合边界；后续合法 Migration 不得被误判为管理员看板自行拥有 Schema。
3. 运行 `npm run test:admin-dashboard`、`npm run test:admin-dashboard:browser` 和 `npm run check:admin-dashboard`。
4. 再运行仓库完整 D1、财务、授权、安全、类型检查与构建门禁，以及 OpenSpec strict 校验。

查询计划允许对当前有界核心事实表执行范围扫描；归档完成、获客咨询和线索链接必须分别命中现有 `idx_order_archive_closures_due`、`idx_acquisition_consultations_date`、`idx_acquisition_lead_links_target`。如果真实计划或容量测试表明需要新索引，必须建立独立后续 Change 并取得下一连续 Migration；管理员看板仍保持 `NO_SCHEMA_CHANGE`。

## 故障判断

- 401：会话失效；前端应清除 owner-only React Query 缓存。
- 403：不是 Active system owner、缺少 `FINANCIAL_VIEW`，或 Personal `DENY` 生效。
- 400：未知/重复参数、非法窗口、非法 cursor 或超过 366 日范围。
- 503：D1 或规范读模型不可用；不得用缓存假 KPI 或客户端财务重算替代。

所有响应均为只读、`no-store`。排查时只记录 `request_id` 和安全聚合，不复制客户隐私或财务底层私密事实到工单。

## 回滚与停用

该 Change 为 `NO_SCHEMA_CHANGE`，没有 Migration、定时任务、队列、R2 或外部同步副作用。回滚只需移除三个只读路由、Web 路由/导航和对应读取代码；不会修改 Buyer、Reservation、Formal Order、获客线索或财务事实。

若需临时停用，优先撤下 API 路由并隐藏 Web 导航。旧页面随后只能得到 404，不能继续读取指标。无需数据回填或数据库回滚。
