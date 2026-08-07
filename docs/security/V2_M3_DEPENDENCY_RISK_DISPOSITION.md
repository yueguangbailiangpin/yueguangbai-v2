# M3 生产依赖风险处置

## 结论（已由 M10 安全升级取代）

2026-08-07（北京时间）在 `customer-multipersona-invitation-recovery`
实现完成后执行 `npm audit --omit=dev`：仍为基线的 2 个 high、0 critical，
没有新增或升高。两项均由 `react-router-dom` 间接聚合到 `react-router`。

M3 当时锁定版本 `7.18.2` 是当时 npm registry 的最新版。其现存 high
`GHSA-qwww-vcr4-c8h2` 只影响 React Router RSC Mode；本仓库是 Vite SPA，
不使用 RSC Mode、React Router Server Actions、SSR hydration、
`ScrollRestoration` 或 React Router 服务端请求处理。

## M3 当时处置（仅历史，不再适用）

- M3 当时保持 `react-router-dom@7.18.2` 精确锁定且不启用受影响的 RSC 服务端能力；M10 已替换此决定。
- 所有身份写请求继续由 Hono API 的可信 Session、同源校验、精确 DTO、
  限流和幂等边界处理；客户端 Router 不作为授权边界。
- 实测 npm 建议的 `7.11.0` 回退会重新暴露多项已修复的 XSS、RCE、DoS
  与 open redirect advisory，风险面更大，因此未采用且没有保留锁文件变更。
- 完整 typecheck、单元、构建及 Chromium 回归是版本变更的强制门禁。

## 当前生产门禁

上述内容是 M3 当时的临时适用性处置，不再是当前发布基线。M10 已确认官方
修复版 `react-router 8.3.0` 可用并完成 `react-router-dom` 移除/导入迁移；当前
权威处置见 `docs/security/V2_REACT_ROUTER_RSC_ADVISORY_DISPOSITION.md`。最终门禁
要求 `npm audit` 为 0；不得继续以“未使用 RSC”静默接受该 high。
