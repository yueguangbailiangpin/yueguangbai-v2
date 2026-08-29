## Context

现有批次写命令先读取批次并准备业务 statements，再以 `database.batch([...])` 原子提交批次事实、批次事件、Audit、幂等完成记录和事务断言。成员添加、成员移除、确认和取消的返回值目前在提交后重新读取，但提交时写入幂等记录的响应仍是 `batch: null`，所以重放读到的不是首次响应。既有 `SellerSettlementBatchMutationDto` 已把 `batch` 定义为非空对象，且本 Change 不改变既有批次业务规则。

## Goals / Non-Goals

**Goals:**

- 在业务事实提交的同一 `database.batch` 中保存四条命令的完整首次响应。
- 让服务层返回值、幂等记录和 HTTP DTO 的 `batch` 业务字段一致。
- 以回归测试证明请求哈希、版本、并发、事件/Audit 单次效果与原有财务和权限边界未被改变。

**Non-Goals:**

- 不处理历史上已经写入的损坏幂等记录，不通过重查询或宽类型兜底掩盖它们。
- 不新增表、索引、触发器、Migration、状态、权限、API 路径或导出协议。
- 不修改 Seller Portal 投影、付款账本、快照、状态机、跨组织错误边界或流式 CSV 实现。

## Decisions

### 1. 在提交前构造确定的完成响应

每个命令使用成功事务开始前已读取的权威批次/账本投影和本次命令确定的变化，构造与提交后应返回的 `SellerSettlementBatchDto`，并把同一个响应对象传给 `completeIdempotencyStatement`。成员添加把新加入的未分配应付金额纳入 DRAFT 的实时金额投影；成员移除扣除当前 active 成员的实时余额；确认设置冻结总额、成员数、确认时间和递增版本；取消设置 CANCELLED、取消时间/原因、递增版本，并令已释放成员不再计入实时金额。

选择预先构造是因为幂等完成记录必须和业务事实在同一事务中写入；事务批处理接口不能在已执行 UPDATE 后再把查询结果回填到同一批次的绑定参数。响应只使用已有权威字段和明确的命令变化，不增加第二次业务写入。

### 2. 统一返回保存的首次响应，不增加损坏记录兜底

事务成功后命令直接返回已传入幂等完成语句的完整首次响应；重放仍由现有幂等基础设施解析 `response_json`，并仅覆盖 `replayed=true`。不新增对 `batch:null` 的兼容分支、重新查询补全或类型断言放宽。

### 3. 测试以四条命令和 HTTP 路径覆盖合同

在现有结算批次测试中先加入四条命令的 direct service replay、幂等记录 JSON 和 HTTP DTO 断言；同时保留/扩展 payload mismatch、版本冲突、并发和事件/Audit 计数断言。添加源码守卫扫描受影响完成路径，禁止再次把 `batch: null` 传入幂等完成写入。

## Risks / Trade-offs

- [Risk] 预先构造的响应可能遗漏某个命令的派生金额或版本变化 → [Mitigation] 使用现有 `readBatch` 投影字段、命令已验证的成员/余额事实，并让专项测试比较首次响应、存储 JSON 和最终详情。
- [Risk] 未来新增批次可变字段后忘记同步完成响应 → [Mitigation] 保留非空严格 DTO、源码守卫和四命令首次/重放字段等价测试。
- [Risk] 并发窗口下预读状态与事务提交状态不同 → [Mitigation] 继续依赖现有唯一索引、状态机/expected_version、幂等 lease 和 transaction assertions；本 Change 不放宽任何并发保护，冲突事务仍失败并标记幂等失败。

## Migration Plan

无需 Migration。仅修改本地批次命令实现、回归测试和 OpenSpec 规划文件；验证仅运行本地 fresh/sequential 数据库链和既有静态/容量门禁。若实现回退，使用普通 Git 提交级别回退，不执行 down migration，不触碰远端数据。

## Open Questions

无。
