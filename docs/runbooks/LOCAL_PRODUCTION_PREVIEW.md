# 本地生产式预览

该预览用于在不连接任何生产或外部资源的前提下，体验正式构建后的 Buyer、Seller 和 Staff 页面。它每次先运行 Web production build，再使用同源匿名内存数据库提供本地 API；进程退出后账号、会话和数据全部销毁。

## 启动

```bash
npm run preview:web:local
```

默认地址为 `http://127.0.0.1:4174`。若端口已被占用，可设置 `LOCAL_PREVIEW_PORT` 为 1024–65535 的本地端口。

## 本地账号

- Buyer：`buyer_demo` / `Moonlight-Buyer-2026!`
- Seller：`seller_demo` / `Moonlight-Seller-2026!`
- Staff：打开 `/__test/staff-login`

这些都是当前进程内的演示身份，不是真实账号，也不能访问生产数据。

## 边界

- 不读取 `.env`、`.dev.vars` 或真实 Secret。
- 不连接 Cloudflare、D1、R2、域名、飞书、Drive 或 MCP。
- 不代表生产 Web Vitals；正式 LCP、INP、CLS 仍须在获准的 staging/production 真实网络中采集。
