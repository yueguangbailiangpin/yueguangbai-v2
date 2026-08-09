# Design: Frontend Runtime Loading Performance V2

## Baseline

基线提交为 `cace231f2249aaf28d68677bce2483980c8b248d`，Node `v24.18.1`，npm `11.16.0`，lockfile SHA-256 `8d8742ed9ed0e9b5d27c21fe719afafd90bd334c2da259e3dd1de97b021e2d05`。生产构建入口为 245.63 kB（gzip 75.24 kB），共享 session/query 包为 149.77 kB（gzip 45.10 kB），Buyer portal 为 19.14 kB（gzip 4.88 kB），Seller portal 为 40.89 kB（gzip 10.70 kB）。

同机匿名本地复测显示：Vite 开发模式登录壳会解码约 11.7 MB、发出 48 个资源请求；Buyer 登录到首页约 332 ms/80 个新资源，Seller 登录到工作台约 368 ms/77 个新资源，而相关 API 为 1–24 ms。相同代码的生产静态登录页只请求 4 个资源、传输约 134 kB，本机 FCP 约 64 ms。以上是本地实验室证据，不冒充生产 LCP/INP/CLS。

## Production-like Local Preview

仓库脚本使用当前工作树正式 `vite build` 输出的带 hash 静态资源，并在同一 loopback origin 上挂载匿名内存数据库和现有真实 API app。它不得连接网络、读取生产数据或依赖真实 Secret。测试账号只存在于进程内，进程退出即销毁。SPA fallback、静态压缩结果和浏览器缓存语义应与正式构建接近；Vite 开发模块图不再作为老板体验测试入口。

## Buyer Instruction Boundary

默认 Buyer portal 当前静态引入下单指引页面。该页面又引入 `ProtectedFileButton` 与 file-read controller，使 `/buyer` 首页在没有查看任何指引时也下载约 38 kB 的文件读取代码。`/buyer/reservations/:id/instruction` 改由独立 `BuyerInstructionRouteModule` 加载；产品、需求和预约列表/详情仍留在轻量 Buyer portal，避免无证据微拆包。

该边界仍在 `CustomerSessionBoundary` 之后，失败继续使用既有中文 `RouteChunkErrorBoundary`，不得提前显示图片、token、object key 或任何受保护内容。

## Seller Submission Boundary

`SellerRouteModule` 保留 Layout、Dashboard 和常用只读业务页。`/seller/products/new` 与 `/seller/demands/new` 通过单独的 `SellerSubmissionRouteModule` 加载，因这些页面静态引入文件上传、mutation recovery 和表单依赖，而卖家首页不需要它们。禁止把 Seller API、会话或数据权限移入不受控的加载占位。

## Rejected Alternative

曾实验在匹配登录成功后预热对应 portal。三次同环境冷启动显示 Buyer 中位数约从 350.0 ms 变为 369.9 ms，并多出一个小 JavaScript 请求；它没有减少需要解析的业务代码，也没有形成可靠收益。因此该实验被撤销，保留既有认证后动态边界，转而拆除可测量的 Buyer 指引依赖和 Seller 提交依赖。

## Verification

- 生产构建不得出现超过 500 kB 的 JavaScript 包；初始入口 raw 与 gzip 体积相对基线增幅均不得超过 1%，同时 Buyer/Seller 默认工作台总加载量必须实质下降。该窄容差只覆盖新增动态导入映射，不得用来隐藏共享依赖增长。
- Seller 默认入口不得请求 submission chunk 或文件上传 chunk；首次进入提交页才请求。
- Buyer 首页不得请求 instruction/file-read chunks；只有受保护指引路由才请求。
- 完整 Web 单元/MSW、浏览器、可访问性、身份/权限/缓存隔离和全仓门禁必须通过。
- 在同一提交、相同浏览器与无缓存条件下采集至少三次中位数；本地数据只作为实验室验收。
