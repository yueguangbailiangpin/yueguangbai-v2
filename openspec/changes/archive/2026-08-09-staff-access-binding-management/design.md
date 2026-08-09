# Design

## Authority and route boundary

`GET/POST /api/staff/access-management/**` 位于既有 Staff Session middleware 之后。每个 handler 重新要求唯一 owner、`STAFF_MANAGE`、`PERMISSION_MANAGE`，不接受请求头或 JSON 中的角色/权限。Web 仅以当前 Session 决定是否展示入口；后端是最终权威。

## Invite-first provisioning

总管理员创建邀请时提交规范化姓名、一个四角色，以及非 owner 必需的一个 ACTIVE 团队。团队由当前 D1 Department/Team 真值中选择，不能默认授予全部团队；owner 邀请不附带团队。Worker 生成 256-bit 随机 token，D1 仅保存 SHA-256 哈希，响应只返回一次 origin-relative `/staff/bind?invite=...`。邀请默认 24 小时、单次消费、可取消、不可删除。

员工打开绑定页后，浏览器把 token 交给 `POST /api/staff-auth/binding/start`。Worker 校验同源、邀请哈希、状态和有效期，再生成独立 OAuth state；D1 只保存 state 哈希与邀请引用。既有 callback 先按 state 类型解析：普通登录继续只允许既有 ACTIVE identity；绑定 callback 在飞书 Provider 验证成功后，以邀请签发 owner 为审计 Actor，复用 `provisionStaff` 写入 Staff、唯一角色、受控团队成员关系和 ACTIVE identity，随后原子标记邀请已消费并签发正常内部 Session。

Provider 失败只消费短期 OAuth state，不消费邀请；员工可在邀请有效期内重新开始。若 Staff 已成功创建但邀请收口响应失败，确定性幂等键使后续重试读取 `provisionStaff` 已提交结果，再完成邀请消费，不会创建第二个 Staff。

## Staff lifecycle mutations

状态或角色更新读取目标的 `version`、唯一 ACTIVE role、当前身份状态和 active-owner 数量。所有命令要求 `expected_version`、Idempotency-Key 和当前状态断言：

- 停用：禁止 self，禁止最后一个 ACTIVE owner；更新 Staff 为 DISABLED，递增 version、authorization_version、session_version，并撤销全部 ACTIVE sessions。
- 启用：要求恰好一个 canonical ACTIVE role 和一个 ACTIVE 飞书 identity；恢复 ACTIVE 并递增三个版本。
- 角色调整：禁止 self；若目标是最后一个 ACTIVE owner，不得改为非 owner；目标非 owner 时必须已有 ACTIVE 团队成员关系。原角色行按既有 immutable-history 规则转为 REVOKED，并插入新的 ACTIVE 角色历史行，Staff 递增三个版本并撤销 Sessions。

每个成功命令写入 `staff_authorization_events`、通用 immutable audit、Outbox 和 transaction assertion。Feishu workbench、Staff MCP、任务分配、文件 Audience 和 Personal DENY 继续在下一次请求按 D1 当前状态重算。

## Read projection and UI

列表返回最小安全 DTO：Staff ID、显示名、状态、版本、唯一角色、绑定状态、绑定验证时间和更新时间；邀请只返回 ID、显示名、角色、安全团队标签、状态、版本、签发/到期时间。创建区只返回 ACTIVE Department/Team 的安全名称和 ID。UI 沿用 `tokens.css` 和员工高密度布局，桌面为列表与受控操作区，窄屏顺序堆叠。UI 不显示 Provider 内部标识，不提供任意权限编辑器。

## Testing cadence

实施过程中只跑 Migration、服务和 Web 的定向检查；全部范围完成后统一跑一次完整 `npm run check`、完整 Chromium、严格 OpenSpec、依赖和 Secret 门禁。失败只修复受影响范围，再执行必要定向复测和一次最终确认。
