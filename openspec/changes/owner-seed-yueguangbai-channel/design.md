## Decisions

- 种子行沿用 0003 既有格式（固定时间戳字面量 1787661496000，保重放确定性）；next_sequence=1 与其他通道一致。
- 不在迁移里 UPDATE 别名或历史数据——别名归一化属导入器输入层，DB 只存 canonical。
- 幸存引用门禁放在 verify-migrations 的 required/forbidden 检查之后（fresh 与 sequential 两库均执行），未来任何迁移删除对象时该门禁自动防止"触发器体仍引用被删对象"的盲区复发。
