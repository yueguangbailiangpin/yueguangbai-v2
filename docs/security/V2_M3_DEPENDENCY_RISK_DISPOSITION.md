# M3 生产依赖风险处置

## 结论

2026-08-07（北京时间）在 `customer-multipersona-invitation-recovery`
实现完成后执行 `npm audit --omit=dev`：仍为基线的 2 个 high、0 critical，
没有新增或升高。两项均由 `react-router-dom` 间接聚合到 `react-router`。

当前锁定版本 `7.18.2` 是 npm registry 的最新版。现存 high
`GHSA-qwww-vcr4-c8h2` 只影响 React Router RSC Mode；本仓库是 Vite SPA，
不使用 RSC Mode、React Router Server Actions、SSR hydration、
`ScrollRestoration` 或 React Router 服务端请求处理。

## 已验证处置

- 保持 `react-router-dom@7.18.2` 精确锁定，不启用受影响的 RSC 服务端能力。
- 所有身份写请求继续由 Hono API 的可信 Session、同源校验、精确 DTO、
  限流和幂等边界处理；客户端 Router 不作为授权边界。
- 实测 npm 建议的 `7.11.0` 回退会重新暴露多项已修复的 XSS、RCE、DoS
  与 open redirect advisory，风险面更大，因此未采用且没有保留锁文件变更。
- 完整 typecheck、单元、构建及 Chromium 回归是版本变更的强制门禁。

## 生产门禁

M3 可在“不启用 React Router RSC/SSR 服务端能力”的现有 SPA 架构下集成，
但这不是对未来 RSC 使用的放行。生产部署前重新执行 npm audit；若上游发布
修复版本，必须升级并完成全仓与浏览器复验。若仍无修复版本，生产负责人须对
“受影响能力未使用”的适用性结论做书面复核。任何引入 RSC、Server Actions、
SSR 或 Router 服务端请求处理的 Change 在漏洞关闭前失败关闭。
