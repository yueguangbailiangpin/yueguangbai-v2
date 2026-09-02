# Production Cloudflare / Web / R2 本地发布合同

## 结论与边界

本合同只定义可审查的本地实现和操作者输入，不授权创建或修改 Cloudflare 资源。`apps/api/wrangler.staging.template.jsonc` 与 `apps/api/wrangler.production.template.jsonc` 故意保留 `REQUIRED_*`，不能部署。真实渲染配置必须保存在 Git 外并通过本地 preflight；任何本地通过都不等于真实 staging/production 验收。

当前发布候选要求 Migration 连续为 `0001`–`0043`，尾部为 `0043_relax_platform_identifier_constraints.sql`；0038/0039 为 Owner 授权零消费者对象清理、0040/0041 为客服通道种子补齐后按"月光白=ygbceping"终裁以墓碑方式收口（六 ACTIVE 通道+yueguangbai DISABLED 墓碑，FK 安全），仓库连续性只证明本地候选结构，不能据此推断生产 ledger。

## 环境与 binding

staging 和 production 必须是两个不同环境，并由操作者显式提供：

- Cloudflare account ID、Worker name；
- 一个精确 HTTPS application origin 和对应 Custom Domain hostname；
- 已存在且环境独立的 D1 database name/ID；
- 已存在且环境独立的 R2 bucket name；
- production Cron 表达式；staging 在 Scheduler 关闭时不得配置 Cron；
- `DB`、`FILE_OBJECT_STORAGE_R2`、`WEB_ASSETS` 三个固定 binding；
- 受管 Secret 名单的值、负责人、轮换与吊销证据。

不得省略 D1 ID 或 R2 bucket name 触发 Wrangler 自动创建默认资源。不得复用 local、staging、production 的 D1、R2、Secret、域名或 Worker name。真实值、配置快照和 Secret 不进入 Git。

## R2 adapter

Cloudflare 注入 `FILE_OBJECT_STORAGE_R2`，Worker 把它适配为应用现有 `FILE_OBJECT_STORAGE`。Adapter 只允许：

- `putObject`：写入 D1 生成的私有 key，保存 content type、内部 file/intent metadata 和 SHA-256；
- `headObject`：回读并校验 key、size、MIME、SHA-256 和 metadata；
- `readPrefix`：只为可信魔数校验做有界读取；
- `readObject`：只由现有受控 read-intent/Audience 流程调用；
- `deleteObject`：只受既有上传失败补偿、孤立清理和冷归档门禁控制。

Adapter 不支持 list、公有访问、签名 URL 或永久 URL，也不返回 bucket name/object key 给浏览器。现有 upload intent、权限、容量、HEAD、D1 最终断言、补偿、Personal DENY、Scope、Audience 和 404 concealment 不变。

`putObject` 的失败合同区分“确定未写入”和“对象可能已写入”。R2 PUT 发出后 Provider rejection 可能是 ambiguous；非 null 回执的 key/size/MIME/SHA/metadata/ETag 任一校验失败则是 post-put failure。两者都由 adapter 通过供应商无关的端口错误标记 `objectMayExist=true`，现有上传层必须执行补偿；删除成功落 `DELETED`，删除失败落不暴露 key 的 `DELETION_PENDING` 并由 cleanup 重试。权限层不得识别 R2 错误。

归档环境开关唯一使用 `ARCHIVE_SELECTOR_ENABLED`、
`ARCHIVE_DRIVE_UPLOAD_ENABLED`、`ARCHIVE_HOT_DELETE_ENABLED` 和
`ARCHIVE_RESTORE_WORKER_ENABLED`。四个开关在本发布合同中都必须是字符串
`"false"`；`ARCHIVE_HOT_DELETE_ENABLED=false` 只关闭归档删除，不得关闭
失败上传后的安全补偿删除。本 Change 不启用任何首次归档删除。

历史 `DRIVE_ARCHIVE_ENABLED`、`DRIVE_ARCHIVE_COPY_ENABLED`、
`DRIVE_ARCHIVE_PROXY_READ_ENABLED` 和 `DRIVE_ARCHIVE_R2_DELETE_ENABLED`
命名已废弃，不作为活动模板、preflight 或 verifier 的有效开关；若输入仍
带有旧名，验证器会明确报告 `deprecated`，也不会作为 `ARCHIVE_*` 的兼容别名。

## Web、API、CORS 与 HTTPS

Web 与 API 使用同一个精确 Custom Domain origin。Vite 产物由 Worker Static Assets 提供；`single-page-application` 负责 Buyer/Seller/Staff 深链 fallback。`/api`、`/api/*` 与 `/health` 只能进入 Hono，绝不能返回 SPA HTML。

浏览器 API 始终使用 origin-relative `/api/*` 与 HttpOnly Cookie。运行时拒绝 URL origin、`Origin` 或 `Sec-Fetch-Site` 不匹配的跨源 API 请求，不发 `Access-Control-Allow-Origin: *`，也不建立 credentialed cross-origin CORS。

staging/production 响应必须包含 CSP、HSTS、`frame-ancestors 'none'`、`X-Frame-Options: DENY`、`nosniff`、no-referrer 和禁用 camera/microphone/geolocation。SPA shell 使用 `no-cache`；构建产生的哈希 `/assets/*` 使用 immutable cache。生产构建不得发布 source map 或外部 asset origin。

CSP 固定为 `style-src 'self'`，不得加入 `unsafe-inline`。Web JSX 源码不得出现 `style=`；动态进度使用原生 `<progress>`，Skeleton 宽度使用 CSS 选择器。静态 verifier 与完整 Web gate 对所有 `.tsx/.jsx` 源码执行零 inline-style 断言。

Custom Domain 只接受操作者填入的精确 hostname；本 Change 不选择域名、不改 DNS、不申请证书。真实 HTTPS/DNS/运营商/微信内置浏览器证据仍属 Production GO Gate。

## 默认关闭与 Secret

Staff Auth 只使用 Cloudflare Access 与 Moonwhite Staff 数据库，模板不得包含任何飞书登录、绑定、同步或回调配置；重新出现即由 preflight 阻断。Staging 保持 Scheduler、获客维护与 operational alert sink 关闭，不配置 Cron，并开启 Worker observability；对应 `/ready` check 明确为 `not_required`，不得伪造为运行成功。Staging Worker、D1、R2 与 hostname 必须具有明确 staging identity，并显式把 invitation-based Buyer registration 绑定到一次性 bootstrap 创建的 `staging-buyer-channel`；production/default 目标或临时散装渠道配置由 preflight 阻断。Access Audience 是 Cloudflare 生成的 opaque tag，必须通过当前会话只读 Access inventory 证明它属于独立 staging Application 且不等于 production Audience，禁止按字符串命名猜测。production 要求 `OPERATIONAL_ALERT_MODE=bound` 和唯一 `OPERATIONAL_ALERT_SINK` RPC service binding。rendered target、canonical entrypoint、exact props、sink identity、sink deployment/version 构成单一 descriptor；preflight 用 stable canonical JSON + SHA-256 派生 fingerprint，任一漂移或任意自报 hex 都阻断。正式 Owner route 不接受 client PASS，而是顺序发起 delivery、安全 failure simulation、recovery 三项 nonce challenge；只有 current exact release/fingerprint/version 的完整 receipt 集合才可原子写入不可变 Audit。缺失、过期、RPC 失败或不匹配时 production `/ready` 一律失败关闭。仓库不包含生产 sink Worker、真实 binding 或证明，本 Change 未执行线上演练。Drive copy/proxy/R2-delete 与 Staff MCP/local mock 继续默认关闭，独立 Change 和老板逐项批准前不得启用。

Secret 只能通过 Cloudflare managed Secret 或批准的受管渠道注入，不得放在 `vars`、JSON、日志、dry-run 输出、测试 Fixture 或 Git。Preflight 只输出 Secret 名称，不读取或打印值。

## Preflight 结果语义

`npm run dry-run:cloudflare-release` 只读取两个本地模板，输出 `BLOCKED_NEEDS_OPERATOR_INPUT`、字段名、Secret 名和外部批准类别，外部调用/部署/资源修改均为 0。操作者在 Git 外渲染配置后可运行：

```text
npm run preflight:cloudflare-release -- --environment staging --config /outside-git/wrangler.staging.jsonc
npm run preflight:cloudflare-release -- --environment production --config /outside-git/wrangler.production.jsonc
```

该命令没有部署模式。`LOCAL_CONFIG_VALID` 仅证明本地结构通过；不证明资源存在、binding 正确、Secret 已写入、域名可用或部署成功。

`--config` 必须是绝对路径；规范化后的词法路径和 `realpath` 都必须位于仓库根目录之外，且真实目标必须是普通文件。仓库内文件、仓库内 symlink（即使指向外部）、仓库外 symlink 指回仓库、相对路径和不可读/无效 JSON 均在读取配置值前失败关闭，只输出固定错误字段，不输出路径、配置值或 Secret。
