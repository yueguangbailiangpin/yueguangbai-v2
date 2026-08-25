# Change: Google Drive 冷归档生产启用预检

## Why

现有冷归档状态机、受控读取、回灌、D1 加密备份恢复和 OAuth 匿名验收已在主线存在，但它们没有一个统一、零网络、零 Secret 读取的生产启用结构预检。操作员容易将单项本地通过误认为可以开启 Drive copy、代理读取或 R2 删除。

## What Changes

- 新增可由外部渲染配置和匿名化证据文件驱动的 Google Drive 冷归档 preflight。
- 预检只允许首阶段 shadow copy：copy 开启，Drive proxy read 与 R2 delete 都必须关闭；两项后续能力保留独立批准。
- 预检验证 managed Secret 仅被声明而不出现在配置，`drive.file` 精确 Scope、私有 owner-only 证明、无 token 持久化、已加密 D1 bundle/manifest 的 SHA-256 闭环，以及 D1 三个阶段开关。
- 无配置、缺证据或任何不匹配时 fail closed，并输出 `LOCAL_NO_GO` / `BLOCKED`；不调用 Google、Cloudflare、D1、R2 或读取 Secret。
- 补充老板外部授权步骤与匿名 E2E 验收命令。

## Non-goals

- 不执行 OAuth、创建/查询 Drive 目录、上传/删除 Drive 文件、访问生产 D1/R2 或写入 Secrets。
- 不导入任何历史订单、产品、卖家编号或 R2 历史图片。
- 不创建 Migration；现有 D1 archive controls 和不可变 manifest 满足本 Change 所需结构。

## Impact

- Affected code: `scripts/`, package scripts, runbook, focused tests.
- Affected capabilities: production cold-image archive activation evidence only.
- Security: defaults remain hard-disabled and this Change adds no provider write path.
