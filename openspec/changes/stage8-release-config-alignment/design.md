# Design: stage8-release-config-alignment

## Canonical switch contract

四个且仅四个活动归档环境开关为：

- `ARCHIVE_SELECTOR_ENABLED`
- `ARCHIVE_DRIVE_UPLOAD_ENABLED`
- `ARCHIVE_HOT_DELETE_ENABLED`
- `ARCHIVE_RESTORE_WORKER_ENABLED`

所有发布模板都必须有这四个键，值必须是 JSON string `"false"`。通用
Cloudflare release preflight 和 `resolveCloudflareRuntime` 继续以
`value === 'false'` 作为完整、关闭状态；字段缺失、布尔值、其他字符串或
旧 `DRIVE_ARCHIVE_*` 键均不能满足校验。Google Drive 首阶段 shadow-copy
preflight 使用同名字段：scheduler、selector、drive upload 为 `"true"`，
hot delete 与 restore worker 为 `"false"`；D1 controls 仍是独立第二道门。

旧 `DRIVE_ARCHIVE_*` 名称不再出现在活动模板、活动 preflight、production
verifier 或操作 runbook 的有效配置列表中。历史交接和 archived OpenSpec
保留原文用于追溯；若活动文档必须提及，则只作为“已废弃/不可满足校验”的
迁移提示，不作为可配置开关。

## Runtime and fail-closed boundary

`cloudflare-runtime.ts` 是 staging/production Worker 的入口门禁；任一
`ARCHIVE_*` 缺失或不等于字符串 `"false"` 时返回 `null`，Worker 以 503
失败关闭，且不会进入 Hono、scheduler、Drive、R2 或 Queue 路径。进入已通过
入口后的 `cold-image-archive/runtime.ts` 仍把四个字符串精确映射为布尔 gate；
缺少任何开关的直接 runtime 解析测试必须证明所有能力保持关闭且不建立可执行
的归档路径。D1 `archive_runtime_controls` 继续独立控制业务事实，不被环境
开关替代。

## Verification changes

1. 模板测试从每个 checked-in template 解析出渲染产物，逐一删除四个新字段并
   断言 `validateReleaseConfig` 拒绝；四个保留为字符串 `"false"` 时通过；
   只放旧 `DRIVE_*` 时仍拒绝。
2. Google Drive preflight 测试以外部私有临时配置覆盖正向 shadow-copy、
   缺失/旧名/错误类型/true 以及 hot-delete/restore 启用场景，保持零外部调用。
3. Runtime 测试覆盖每个缺失 `ARCHIVE_*` 的 production binding，断言入口
   503/null；archive runtime 测试覆盖不完整 bindings 的四个布尔值全为 false。
4. `file-storage.test.ts` 只检查允许的 DTO key 集与 `url`/永久 URL 字段缺失，
   不再对随机 token 做字符串子串断言。
5. scheduled-operations 并发测试用 `Promise.allSettled`（或等价的立即
   rejection handler）收集两个请求，并断言恰有一个成功、另一个
   `REQUEST_IN_PROGRESS`/409。

## Documentation boundary

同步 production Cloudflare contract、Google Drive external activation checklist、
冷归档 runbook、当前 cold-image-archive/release configuration specs，以及
本 Change 的任务和验证记录。不得修改 `apps/web`、数据库 schema 或远程状态。
