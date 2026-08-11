# Offline Imports

本目录只包含本地、显式调用的数据导入和迁移工具，不属于 Worker 或 Web 运行时。

- `seller-partner/`：卖家与合作伙伴主数据的确定性预览、提交和回滚实现。
- `current-product-seller-mapping/`：当前可预约商品与卖家关系的只读 manifest 预览。
- `historical-order/`：历史订单母表和聊天截图迁移 manifest 工具。

统一从根目录 `package.json` 的 `dry-run:*`、`test:*` 命令调用。fixture、manifest hash、守恒计数、quarantine 和零外部写入边界保持不变；这些文件不得被 `apps/api` 或 `apps/web` 导入。
