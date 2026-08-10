# 月光白 V2 正式飞书自建应用与运营告警接入手册

## 1. 当前可复核结论

仓库已经具备 Staff Feishu OAuth、内部 Session、Task v2 同步、签名/加密 callback、Outbox、mirror、receipt、Task 死信与 Scheduled Operations 告警状态机。本手册补充同一正式应用的组合配置和默认关闭的脱敏机器人告警。

仓库归档验收材料记录过真实 Staff 登录与 callback URL 验证，但本次工作没有登录飞书开发者后台、读取租户、检查当前版本、调用 Provider、部署或写生产资源。因此这些历史材料不能替代当前管理员复核，最终状态仍是 `LOCAL_IMPLEMENTATION_READY / PRODUCTION_NO_GO`。

## 2. 三类应用必须隔离

| 应用 | 用途 | 禁止事项 |
| --- | --- | --- |
| 月光白 V2 正式自建应用 | Staff 网页入口、Staff OAuth、Task v2、`card.action.trigger`、内部私有群脱敏告警 | 不接 AI 对话，不接测试数据，不开放外部用户/外部群 |
| 月光白 V2 测试应用 | 匿名 staging/PoC、权限和 callback 演练 | 不使用正式 Secret、正式 callback、正式群或真实客户数据 |
| 未来 AI 应用 | 未来经独立 OpenSpec 批准的 AI/消息事件能力 | 不复用正式应用 App ID/Secret，不读取正式群消息，不获得订单/财务/权限权威 |

三类应用必须使用不同 App ID、Secret、callback、可用范围、版本和审批记录。任何测试/AI 能力混入正式应用时停止激活。

## 3. 正式应用能力与最小权限

在飞书开发者后台为一个企业自建应用开启“网页应用”和“机器人”能力。不要开启商店应用、外部用户或外部群能力。

只申请以下三个 scope：

| Scope | 身份 | 必要原因 |
| --- | --- | --- |
| `contact:user.base:readonly` | 用户身份 | Staff OAuth 读取当前登录用户的基础稳定身份；不导入飞书角色或通讯录权限 |
| `task:task:write` | 应用身份 | 当前 Task v2 adapter 创建/更新任务，并在更新负责人前读取任务成员；`task:task:writeonly` 不覆盖读取步骤 |
| `im:message:send_as_bot` | 应用身份 | 机器人向一个内部私有告警群发送固定脱敏文本 |

不得追加 `im:message`、`im:message:readonly`、`im:message.group_msg`、`im:message.group_at_msg`、`contact:contact:readonly_as_app`、历史 Task scope 或任意 AI scope。正式应用不订阅 `im.message.receive_v1`，也不读取群历史消息。

## 4. 精确入口、redirect 与 callback

将以下 `<APP_ORIGIN>` 替换为经发布审批确认的唯一 HTTPS origin。值只保存在仓库外发布配置，不写入本手册或报告。

| 项目 | 精确值 |
| --- | --- |
| 网页应用桌面/移动端入口 | `<APP_ORIGIN>/staff` |
| Staff OAuth redirect | `<APP_ORIGIN>/api/staff-auth/feishu/callback` |
| Workbench/card callback | `<APP_ORIGIN>/api/feishu-workbench/callback` |
| Provider API origin | `https://open.feishu.cn` |
| Staff OAuth authorization origin | `https://accounts.feishu.cn` |
| callback 订阅 | 只保留 `card.action.trigger`，使用开发者服务器方式 |

在“事件与回调”的加密策略中启用 Encrypt Key 与 Verification Token。URL challenge 只验证地址，不读写 D1；正式 action 必须继续通过完整 `X-Lark-*` 签名、五分钟窗口、AES 解密、App/Tenant/Token、receipt replay、D1 Staff 权限与 expected version。

## 5. 可用范围与机器人告警群

1. 应用可用范围只选实际使用月光白 V2 的内部 ACTIVE Staff；不选全公司、不选外部联系人、不选外部群。
2. 飞书可用范围只决定谁能看到应用，不能授予 V2 权限。未知、停用、冲突或未绑定的 Provider 身份在 D1 失败关闭。
3. 新建或指定一个内部私有运营告警群，成员只包含业务所有者、发布/恢复负责人和安全负责人。
4. 将正式应用机器人加入该群并允许发言；不得把群 ID 写入 vars、文档、日志或验收报告。
5. 告警只含固定等级/摘要/作业/incident version/计数/北京时间与 `/staff` 链接。无按钮、无 @、无客户/订单/金额/文件/微信号/内部 ID/Provider ID。
6. 飞书只是辅助告警。必须另行配置并实测一个不依赖飞书的主告警接收器，能发现 Worker、飞书与主告警 sink 自身故障。

## 6. 配置与托管 Secret

仓库模板必须保持：

```text
STAFF_AUTH_ENABLED=false
SCHEDULED_OPERATIONS_ENABLED=false
FEISHU_WORKBENCH_SYNC_ENABLED=false
FEISHU_WORKBENCH_CALLBACK_ENABLED=false
FEISHU_OPERATIONAL_ALERT_ENABLED=false
FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND=1
OPERATIONAL_ALERT_MODE=disabled
ACQUISITION_MAINTENANCE_ENABLED=false
```

组合激活的仓库外配置必须让 Staff Auth 与 Workbench 的 App ID、Tenant Key 和 origin 完全相同。以下名称只作为 Cloudflare managed Secret 声明，禁止将值写入 vars：

```text
STAFF_AUTH_FEISHU_APP_SECRET
STAFF_AUTH_HASH_SECRET
FEISHU_WORKBENCH_APP_SECRET
FEISHU_WORKBENCH_ENCRYPT_KEY
FEISHU_WORKBENCH_VERIFICATION_TOKEN
FEISHU_OPERATIONAL_ALERT_CHAT_ID
```

同一正式应用的当前 App Secret 分别绑定到 Staff Auth 与 Workbench 的两个既有 Secret 名称；preflight 不读取、比较或打印 Secret 值。App ID、Tenant Key、open_id、chat ID、token、Secret 和 callback body 都不得进入提交或验收报告。

## 7. 零网络组合 preflight

渲染配置必须是仓库外绝对路径。命令只读本地文件，不发网络请求、不读取 Secret 值、不部署、不修改资源：

```bash
npm run preflight:feishu-production-app -- \
  --environment production \
  --config /absolute/path/outside-repository/production.jsonc \
  --declared-secret STAFF_AUTH_FEISHU_APP_SECRET \
  --declared-secret STAFF_AUTH_HASH_SECRET \
  --declared-secret FEISHU_WORKBENCH_APP_SECRET \
  --declared-secret FEISHU_WORKBENCH_ENCRYPT_KEY \
  --declared-secret FEISHU_WORKBENCH_VERIFICATION_TOKEN \
  --declared-secret FEISHU_OPERATIONAL_ALERT_CHAT_ID
```

结构正确也只返回 `LOCAL_STRUCTURE_VALID_PRODUCTION_NO_GO`。输出中的 `external_calls`、`provider_calls`、`deployments`、`resource_mutations` 必须全为 `0`。缺字段时只输出字段名，不输出值。

## 8. 管理员发布顺序

以下步骤均是本任务未执行的外部动作，必须由老板逐项授权：

1. 在测试应用用匿名员工、任务和告警群验证三个 scope、两个 callback、手机/桌面深链、机器人发言、限额、失败和恢复。
2. 由正式应用管理员核对网页应用、机器人、三个 scope、内部可用范围、外部访问关闭、`card.action.trigger` 和加密策略。
3. 创建版本，填写版本号/更新说明/默认能力/可用范围，提交企业管理员审批；审批通过并发布后再继续。
4. 在仓库外渲染配置，声明 managed Secret 名称并运行组合 preflight；任何 `BLOCKED` 都停止。
5. 确认非飞书主告警已完成带时间戳的发送、故障和恢复演练。
6. 分阶段启用并每步观察：Staff Auth → callback → Feishu-only Scheduler/Task sync → Feishu operational alert。不要一次打开 Drive、MCP、获客维护或其他作业。
7. 使用一个已存在的 ACTIVE D1 Staff 完成真实 OAuth；使用一个合法 D1 work item 完成首次 Task create/update；不得制造正式订单或客户数据只为测试。
8. 以固定匿名运营信号验证告警开启、冷却去重、恢复消息、Provider UUID 幂等和 `FEISHU_ADAPTER_FAILURE`；核对消息无客户原文。
9. 记录实际应用版本、管理员审批、可用范围、scope、callback、机器人群成员角色、主告警证据和回滚负责人，但不要记录任何 operational ID 或 Secret。

## 9. 验收清单

- [ ] 正式、测试、未来 AI 应用完全隔离。
- [ ] 仅三个最小 scope；没有消息读取、全量通讯录或 AI scope。
- [ ] 网页入口、OAuth redirect、card callback 与唯一 HTTPS origin 精确匹配。
- [ ] `card.action.trigger` challenge 与正式签名/加密 action 均通过，其他事件未订阅。
- [ ] 可用范围只含内部 Staff，外部用户/群关闭。
- [ ] 已存在 ACTIVE D1 Staff 登录成功，未知/停用/冲突身份失败关闭。
- [ ] 合法 D1 work item 的 Task create/update、负责人变更与稳定 client token 通过。
- [ ] 私有告警群只收到脱敏固定文本；重复 observation/incident 不重复发送。
- [ ] 429/5xx/权限移除/机器人离群均保留固定失败证据，不回滚 D1 业务事实。
- [ ] Task 第五次失败进入既有无 payload dead letter，并可由受控 Web replay。
- [ ] 非飞书主告警完成发送、故障、恢复，能发现飞书 outage。
- [ ] 移动端、桌面端、三运营商与必要的内置浏览器实测通过。
- [ ] 老板批准激活与回滚窗口；未完成项均保持对应开关为 `false`。

## 10. 回滚

1. `FEISHU_OPERATIONAL_ALERT_ENABLED=false`，停止新的机器人消息。
2. `FEISHU_WORKBENCH_SYNC_ENABLED=false`，停止新的 Task Provider 写入。
3. `FEISHU_WORKBENCH_CALLBACK_ENABLED=false`，停止 callback action。
4. 如需进一步隔离，停止 Scheduler；始终保持 `ACQUISITION_MAINTENANCE_ENABLED=false`。
5. 登录故障时独立设置 `STAFF_AUTH_ENABLED=false`；D1 Staff、角色、Permission 和 Session 审计事实保留。
6. 不删除 alert state、Outbox、mirror、receipt 或 dead letter，不从飞书恢复/覆盖业务事实。
7. 机器人移群、scope 回收、版本回退、callback 注销和 Secret 轮换由管理员在独立授权下完成。
