## Why

Owner 2026-09-01 在客服分布复盘时补充终裁：**月光白（yueguangbai）与 ygbceping 是同一个号**——yueguangbai 是账号名、ygbceping 是微信号；月光白AI（yueguangbaiai）仍为另一独立账号。该裁决与"两月光白账号永不互并"的原裁决不矛盾（yueguangbai 归并目标是 ygbceping 而非 yueguangbaiai）。据此：①两份源码 CHANNEL_ALIASES 的 yueguangbai 目标值由自身改为 ygbceping（错拼 yuegungbai 跟随）；②0040 刚补种的独立 yueguangbai 通道失去存在意义，以 0041 前向收口：引用组织改指 ygbceping 并把撞号的每通道卖家序号接续到 ygbceping 编号空间末尾（seller_code 同步重写、next_sequence 抬高），通道行以 DISABLED 墓碑保留（审计 FK 完整，六 ACTIVE+一墓碑）；③契约测试改为"yueguangbai 折入 ygbceping 且 yueguangbaiai 隔离"。数据事实更正：此前"零卖家指派 yueguangbai"的说法有误——当时有 3 组（ricky4819@F2、LJQ2181422450@F4、qq851032182@F4）客服为月光白，本裁决后全部归并到 ygbceping 名下（44→47 组）。

## What Changes

- 迁移 0041（schema 41，数据级）：组织改指+序号归并+seller_code 重写+next_sequence 抬高+通道 DISABLED 墓碑；断言六 ACTIVE、墓碑在、零残留引用、next_sequence 越过归并最大值。
- 源码两份 CHANNEL_ALIASES：yueguangbai/yuegungbai → 'ygbceping'。
- 契约测试（channel-alias-contract）三处断言按新口径重写；seller-partner 隔离测试注释更新（F4 显式月光白→解析为 ygbceping→仍与文件夹默认月光白AI 冲突而隔离；F2 下与默认一致可导入）。
- verify-migrations 通道种子期望=7 行（六 ACTIVE+yueguangbai DISABLED 墓碑）+墓碑状态断言；baseline 测试改为六 ACTIVE+墓碑断言并新增撞号归并迁移门禁；全锚点 40→41；四份生产文档/G3/CURRENT_SYSTEM_STATE/CONVENTIONS 尾部声明 0041（墓碑口径）。
- `owner-seed-yueguangbai-channel` 变更标注"被同日补充终裁部分取代"（种子已撤销；其 Reachability 边界结论在新别名表下自然成立：F2 显式月光白与默认一致直接可导，F4 两卖家仍需例外或改派——留待导入器实现时按当时口径处理）。

## Impact

- 数据级+导入工具层变更，零运行时行为差异；客服全景变为 5 个人工号（ido-mango/ygbceping/yinghua1942/queshengai/yueguangbaiai）+1 系统通道。
- 确认表派生层同日同步重生成（ygbceping 47 组）。
