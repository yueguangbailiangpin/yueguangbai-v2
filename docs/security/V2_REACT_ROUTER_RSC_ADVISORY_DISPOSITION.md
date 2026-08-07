# React Router RSC Advisory 正式处置

记录日期：2026-08-07（Asia/Shanghai）

## 结论

基线 `react-router-dom 7.18.2` 被 `npm audit` 报告为 2 个 high（直接包与传递 `react-router`），对应 GitHub Advisory `GHSA-qwww-vcr4-c8h2`。官方 Advisory 的受影响范围是 `>=7.12.0 <8.3.0`，修复版本是 `8.3.0`；问题只在 unstable RSC API 路径可利用。

本项目是 Vite SPA，源码 inventory 未使用 unstable RSC API，但“当前未走该路径”不替代可用安全升级。官方 React Router v8 changelog 明确移除 `react-router-dom`：除 `RouterProvider`/`HydratedRouter` 从 `react-router/dom` 导入外，其余 API 从 `react-router` 导入。项目未使用前两者，且 Node 24、React 19.2.8、Vite 8 满足 v8 最低版本。

因此正式处置为：移除 `react-router-dom 7.18.2`，升级到官方修复版 `react-router 8.3.0`，按官方迁移规则更新 imports，并执行完整前端与全仓回归。禁止采用 npm 自动建议的 `react-router-dom 7.11.0` 降级，因为它不是本 Advisory 的官方修复目标，且会回退已获得的后续安全修复。

## 一手证据

- GitHub Advisory：<https://github.com/advisories/GHSA-qwww-vcr4-c8h2>
- React Router 官方 v8 changelog：<https://reactrouter.com/start/changelog#v800>
- React Router 官方 v8.3.0 release：<https://github.com/remix-run/react-router/releases/tag/react-router@8.3.0>

## 验收标准

- `npm ls react-router react-router-dom` 只出现 `react-router@8.3.0`。
- `npm audit` 为 0 vulnerabilities。
- 不存在 `react-router-dom` import 或依赖。
- Web typecheck、Vitest、build 与浏览器回归通过。
