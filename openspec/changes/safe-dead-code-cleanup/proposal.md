## Why

当前分支仍保留若干已退役入口、指向不存在测试文件的 package script、重复的前端保护资源解析器和仅供旧测试使用的 UI 壳。这些残留会制造错误的维护入口、允许漂移 schema 继续存在，并掩盖真正的运行时入口；本 Change 只做已有证据支持的安全清理。

## What Changes

- 删除失效的 `dry-run:staff-acquisition` script。
- 从 `test:seller-principal-rate-bootstrap` 移除两个不存在的测试路径，保留其余有效覆盖。
- 删除无当前 Worker 入口、无运行时消费者的 keyword-generator staging 模板。
- 删除无生产消费者的 `protected-resources.ts` 漂移副本；将保留的 401/403/404 测试接到各身份的现行 API client，并为现行 staff assignments endpoint 使用共享 runtime schema。
- 删除无生产消费者的 `StaffAccessManagementWorkspace` re-export 壳，并让其测试直接使用 canonical workspace。
- 删除仅被旧测试引用的 `StaffCustomerSecurityPanel` 及其两项旧 UI 测试；保留当前密码恢复页面测试。
- 移除已退役 `/mcp` 与 OAuth protected-resource `/mcp` 路径的 API 请求白名单项，保留现行健康检查、API 路由和所有墓碑检测。
- 删除 `expire-reservation.ts` 中的 `VER` 调试日志，不改变版本冲突行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。该 Change 是不改变可观察产品/API/数据库行为的死代码、工具入口和测试适配清理，因此通过 `.openspec.yaml` 的 `skip_specs: true` 明确不产生 spec delta。

## Impact

影响范围仅限 package scripts、前端测试适配与 runtime schema、旧 UI 文件、Cloudflare Worker 路径分类、一个调试输出和 OpenSpec 记录。无数据库 migration、远程资源、部署、API 路径注册、权限规则、财务事实、文件数据或产品流程变更。回滚边界为回滚本次正常提交；不使用 reset、rebase、stash、clean、amend 或 push。
