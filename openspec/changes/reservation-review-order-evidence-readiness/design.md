## Staff review projection

预约审核读取继续先以预约所属卖家组织作为权威范围，并要求当前 Staff 持有对应的已分配工作项。通过既有授权后，响应才投影买家内部 ID、姓名、可空客户编号，以及该买家身份主体的当前有效微信号。缺失客户编号由前端解释为“首次正式订单后生成”，不伪造编号。

## Successful decision closeout

预约决定命令仍是唯一状态写入者。命令成功后，前端把当前工作项缓存标记为完成并刷新工作台队列；它不再请求已经完成、因分配约束可能返回 404 的审核事实。真实命令失败继续保留，并显示安全错误码与请求编号。

## Buyer evidence visibility

买家待提交列表是读模型门槛：预约必须为 `APPROVED`，同时存在与同一预约、买家和市场绑定的 `ACTIVE` 下单指引。提交命令仍保留自己的权威状态校验，避免只依赖页面可见性。

## Keyword image generator

新增一个无公开路由的 staging Worker，通过 Cloudflare Service Binding 接收主 Worker 请求。两端使用独立共享密钥；生成器从 staging R2 读取 Noto CJK 字体，在 Worker 内把 Staff 已配置的关键词渲染为 PNG。关键词不发送到外部字体或图片服务，主应用仍验证 MIME、PNG 结构、尺寸、哈希和生成器版本后再写入对象存储。字体二进制不进入 Git。

## Rollback

代码回滚可恢复接口投影、读模型筛选和前端缓存处理。staging D1 重建前先导出完整 SQL 备份；如需回退，可删除新的隔离测试 D1、重新创建并导入该备份，再恢复旧 Worker 版本和数据库 binding。该回退只适用于 staging。

## Staging rebuild

重建仅针对已确认全部为测试数据的 `yueguangbai-v2-staging`。操作顺序为：只读计数、完整 SQL 导出及哈希、删除旧 D1、同名创建新的 APAC D1、应用 `0001`–`0070`、核对 Schema 70 和 70 条迁移、使用现有 Git 外输入执行受控 first-owner bootstrap。R2 桶不清空，旧对象因新 D1 无引用而不可达；仅新增生成器字体对象。
