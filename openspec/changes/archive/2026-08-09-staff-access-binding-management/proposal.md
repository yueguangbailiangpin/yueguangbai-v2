# Staff Access and Feishu Binding Management

## Why

月光白已有安全的 Staff 创建、四角色授权和飞书登录底座，但总管理员没有可操作的员工管理页面。现状要求人工准备飞书内部标识，既不适合老板使用，也容易把“飞书身份验证”误变成手工录入。需要补齐一个仅总管理员可见的最小管理闭环。

## What Changes

- 新增总管理员员工管理页，展示员工、唯一四角色、启停状态、飞书绑定状态和未完成邀请。
- 新增一次性员工绑定邀请：总管理员填写姓名、一个角色，并为非 owner 明确选择一个 ACTIVE 团队；员工本人打开邀请并通过现有 `月光白` 飞书应用完成验证，后端才复用现有 `provisionStaff` 原子创建员工、角色、团队成员关系和身份绑定。
- 新增员工启用/停用和唯一角色调整；每次写入要求幂等键、期望版本、当前状态断言、审计和会话失效。
- 禁止总管理员停用自己、修改自己的 owner 角色或移除最后一个 ACTIVE owner。
- 新增 Migration `0039` 保存邀请及其单次 OAuth state；只存 token/state 哈希，不保存 Provider token。
- 更新 Staff Auth callback，使它能区分普通登录和受控邀请绑定；未知身份在普通登录中仍然失败关闭。

## Non-Goals

- 不建设员工花名册、部门通讯录、考勤、薪资或 HR 系统。
- 不从飞书导入角色、权限、部门、手机号或客户/财务事实。
- 不允许手工编辑 `open_id`、`user_id`、tenant key 或任意细粒度权限。
- 不新增第二个飞书应用，不修改真实飞书配置，不部署、不运行线上 Migration。

## Migration Decision

新增连续 Migration `0039_staff_access_binding_management.sql`。邀请与绑定 OAuth state 是新的安全事实，不能塞入只允许 `STAFF_LOGIN` 的既有 `staff_login_states`，也不能将明文邀请 token 放进客户端可篡改状态。Migration 只新增 `staff_binding_invitations`（含受控 Team 引用）和 `staff_binding_login_states`、索引、转换/不可删除约束，并将 schema version 从 38 推进到 39；不修改历史 Migration。

## Permission and Privacy Impact

管理 API 同时要求唯一 `owner` 角色、`STAFF_MANAGE` 和 `PERMISSION_MANAGE`，Personal DENY 仍为最终否决。列表不返回飞书 `open_id`、`user_id`、tenant key、token hash、state hash、Cookie 或 Provider claims。邀请链接只在创建成功时返回一次；D1 仅持有哈希。普通未知飞书身份继续拒绝，只有未过期、未取消、未消费的绑定邀请才能在 Provider 验证后创建员工。

## Rollback Boundary

隐藏管理入口并停止创建新邀请即可停止新绑定。回滚不得删除已创建 Staff、角色、身份、邀请、审计或幂等事实。已消费邀请生成的 Staff 通过受控停用处理；不得通过删除 D1 行撤销。线上 Migration 和部署须另行由老板授权。

## Acceptance

本地验收覆盖 Migration 新建/升级约束、owner-only、Personal DENY、邀请单次/过期/取消/重放、普通未知身份拒绝、Provider 验证后复用 `provisionStaff`、四角色唯一性、最后 owner/self 保护、启停/角色变更会话失效、DTO 泄露扫描、响应式 Web/MSW/浏览器和完整仓库门禁。当前 Change 结束时仍不得声称真实飞书或生产已验收。
