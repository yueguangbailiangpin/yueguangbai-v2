# Design: Customer Portal Entry and Copy Simplification

## Entry Authority

路由是客户登录目标的唯一客户端输入：`/buyer/login` 固定 Buyer，`/seller/login` 固定 Seller。表单不渲染 Persona 选择，也不接受可覆盖路由目标的字段。服务端仍从受控入口和当前 Customer Session 构造 Actor；双 Persona 账号不会因此合并缓存、DTO 或资源权限。

## Minimal Projection

客户编号、会话到期和返款内部时间若没有客户业务用途，应从 Buyer DTO/查询缓存中移除，而不是只用 CSS 隐藏。登录页和卖家内部说明属于纯视图删除。任何仍被其他正式页面使用的字段必须先完成调用方清单，再以专用最小 DTO 保留。

## Reservable Products

“产品”列表由后端按 Buyer Marketplace、需求发布状态、预约窗口、容量、历史参与和当前 Buyer 资格返回。前端不得先下载全部需求再自行隐藏；服务端的最终预约命令仍重新校验版本、容量和状态。

## Copy and Time

登录页只显示月光白、账号、密码、登录。Buyer/Seller 页面删除 D-025 指定的重复或内部文案；“返款金额”仅改变客户术语，不改变商品本金计算。时间事实继续为 UTC 毫秒，客户格式化固定使用 `Asia/Shanghai` 并标注“北京时间”。

## Security and Accessibility

保持 Cookie/Session、同源、401 清理、跨 Persona Query Cache 隔离、404 隐藏和后端字段白名单。删除选择器后，账号、密码、登录按钮仍具有可见标签、键盘顺序、错误关联和 320px 最小宽度验收。

## Rejected Alternatives

- 不用隐藏的 Persona `<select>`：隐藏控件仍会形成错误状态和可提交 authority。
- 不只做 CSS 隐藏：内部字段仍会进入浏览器。
- 不在前端计算预约资格：会产生陈旧和越权展示。
