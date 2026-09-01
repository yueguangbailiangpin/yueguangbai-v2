## Why

Owner 2026-09-01 别名终裁把 `yueguangbai` 拆为独立 canonical（与 `yueguangbaiai` 永不合并），源码两份 CHANNEL_ALIASES 已同步且有契约测试钉死；但运行时 `seller_channels` 注册表仍只有六个通道种子。seller-partner commit 路径按 canonical code 查询 ACTIVE 通道（index.ts:344），`yueguangbai` 规范记录将在导入时失败于 CHANNEL_NOT_FOUND（Codex 0901 审查 Q4 认定的阻塞项）。主 spec `seller-partner-master-data-import` 的 frozen channel routing 要求也仍写旧的 `yueguangbai→yueguangbaiai` 合并口径，与源码和 Owner 裁决矛盾。

## What Changes

- 迁移 0040（schema 40，数据级）：`seller_channels` 补种第七通道 `seller-channel-yueguangbai`（ACTIVE，prefix/code/name=yueguangbai）；断言通道总数 7 且两月光白通道并存。对象清单计数不变，仅数据。
- `scripts/verify-migrations.mjs`：通道种子期望 6→7（含 yueguangbai 排序位）；另按 Codex Q6 建议新增"被删对象幸存引用"门禁（0038/0039 全部被删对象名不得出现在任何幸存 schema 对象 SQL 中）。
- 主 spec 修订（delta）：frozen channel routing 别名表按 Owner 终裁重写，新增"两月光白账号各自持有通道行"场景。
- baseline-schema 守卫测试新增七通道种子断言。

## Impact

- 只补种子与文档/守卫，不改任何表结构或运行时代码路径；导入器 commit 路径无需变更即可找到新通道。
- schema 39→40 全锚点同步。

## Reachability boundary（Codex push 总审 P1-1 采纳）

通道种子消除的是注册表缺口；**导入路径可达性仍按设计受限**：显式 `yueguangbai` 别名与所在冻结文件夹默认通道不同时按 `FOLDER_CHANNEL_CONFLICT` 隔离（seller-partner 测试已固化该语义）。当前数据没有任何卖家被 Owner 指派为 yueguangbai（CF-016/019 两例均裁归 yueguangbaiai），故今日无可达性损失；未来若需要，须 Owner 裁定文件夹映射或像 queshengai 一样增设显式例外，并以 preview→commit 正向用例验收。
