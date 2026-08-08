# Change Proposal: Frontend Route Code Splitting Performance

## Why

M14 后的 `apps/web` 生产构建已经把依赖高风险漏洞清零，但主 JavaScript 包仍为 605.54 kB（gzip 167.31 kB），超过 Vite 默认 500 kB 警告阈值。当前 `App.tsx` 静态引入买家、卖家、员工的大部分页面，使任一身份首次访问都可能下载其他身份暂时不需要的代码。它不是 M14 的获客功能回归，但属于最终上线前应独立关闭的首屏性能风险。

## What Changes

- 建立可重复的生产构建与买家、卖家、员工代表路径冷启动基线。
- 将买家、卖家、员工入口拆成独立按需加载边界，再按证据拆分重页面路由。
- 为异步入口和页面提供简洁中文加载、失败与重试状态。
- 回归登录、会话、权限、深层链接、缓存隔离、浏览器导航和可访问性。
- 记录优化前后压缩前/gzip 分包大小及三类入口首屏实测数据，形成 Production GO 证据。

## Dependencies and Order

本 Change 只登记和冻结范围，不立即实施。实施任务必须等 M11–M16 全部完成、验收并进入当前 `origin/main` 后单独启动；完成时间必须早于最终 Production GO。

## Out of Scope

- 改变买家、卖家或员工业务能力、界面信息架构、角色权限、API 合同或财务逻辑。
- 数据库 Migration、生产部署、Cloudflare/DNS/secrets 或任何真实外部激活。
- 仅调高或关闭 `chunkSizeWarningLimit`、删除 source map，或以缓存命中代替冷启动实测。
- 为追求单一分数引入新的运行时框架、微前端或未经必要性证明的依赖。

## Migration

`NO_SCHEMA_CHANGE`。该变更只调整前端模块加载边界和验收证据，不读写新的业务事实。

## Rollback

若异步路由造成白屏、深层链接失败、权限闪现或性能倒退，回退到上一个已验证的静态路由入口；数据库、API 和业务数据不受影响。生产部署仍须另行取得老板授权。
