## Purpose

确保结算批次关键写命令在首次提交、幂等重放和 HTTP 投影之间始终返回可用且一致的权威批次响应，避免成功事实与客户端响应分离。

## ADDED Requirements

### Requirement: Settlement batch mutations persist their complete first response

结算批次的成员添加、成员移除、确认和取消命令在成功提交时 MUST 在同一事务中保存完整的非空 `batch` 响应；该对象 MUST 反映本次提交后的批次状态、版本、冻结字段、取消字段和业务金额字段。相同 actor、相同命令、相同目标和相同请求哈希再次使用同一 Idempotency-Key 时，服务 MUST 返回已保存响应中的相同 `batch` 业务字段，并只把 `replayed` 标记为 `true`。

#### Scenario: Adding members replays the committed batch projection

- **WHEN** 员工成功添加一个或多个应付成员，然后用相同 Idempotency-Key 和请求体重试成员添加
- **THEN** 首次响应、幂等记录中的响应和重放响应都包含非空 `batch`，其批次业务字段完全一致，且只区分首次 `replayed=false` 与重放 `replayed=true`

#### Scenario: Removing a member replays the committed batch projection

- **WHEN** 员工成功从 DRAFT 批次移除成员，然后用相同 Idempotency-Key 和请求体重试移除
- **THEN** 首次响应、幂等记录中的响应和重放响应都包含非空 `batch`，并一致反映移除后的批次金额、状态和版本事实

#### Scenario: Confirming a batch replays the committed batch projection

- **WHEN** 员工成功确认含成员的 DRAFT 批次，然后用相同 Idempotency-Key 和请求体重试确认
- **THEN** 首次响应、幂等记录中的响应和重放响应都包含非空 `batch`，并一致反映确认后的冻结总额、成员数、确认时间、状态和版本

#### Scenario: Cancelling a batch replays the committed batch projection

- **WHEN** 员工成功取消 DRAFT 或 CONFIRMED 批次，然后用相同 Idempotency-Key 和请求体重试取消
- **THEN** 首次响应、幂等记录中的响应和重放响应都包含非空 `batch`，并一致反映取消状态、取消时间、原因、冻结字段和版本

### Requirement: HTTP mutation DTOs remain strict and non-null

四条批次写端点 MUST 返回符合现有 `SellerSettlementBatchMutationDto` 的严格 HTTP envelope；成功响应的 `data.batch` MUST 是完整非空 `SellerSettlementBatchDto`，不得通过 `null`、缺字段或内部字段来表达首次响应。HTTP 首次成功与同键重放 MUST 保持相同的 `data.batch` 业务字段；既有 status code 约定（首次创建/变更 201、重放 200）保持不变。

#### Scenario: HTTP add, remove, confirm and cancel responses satisfy the DTO

- **WHEN** 客户端分别调用成员添加、成员移除、确认和取消端点并随后使用相同键重放
- **THEN** 每个首次响应和重放响应的 `data.batch` 都通过严格 DTO 校验且非空，业务字段相同，重放仅返回 HTTP 200 与 `replayed=true`

### Requirement: Existing idempotency and settlement invariants are unchanged

本 Change MUST 保持请求哈希不匹配返回 `IDEMPOTENCY_CONFLICT`、过期或错误 `expected_version` 返回 `VERSION_CONFLICT`、状态机和跨组织 concealed 404、审计事件与批次事件单次写入、账本和快照不可变、Seller 安全 DTO、导出幂等收据以及现有真流式导出行为不变。失败命令 MUST NOT 产生额外业务变更或成功幂等响应；同一逻辑命令的并发请求 MUST 至多产生一次状态/成员变化和一次对应审计事件。

#### Scenario: Payload mismatch stays a conflict without a duplicate effect

- **WHEN** 已成功提交的批次命令使用同一 Idempotency-Key 但不同请求体重试
- **THEN** 服务返回 409 `IDEMPOTENCY_CONFLICT`，不增加批次状态/成员变化、批次事件、审计事件或成功幂等完成记录

#### Scenario: Stale version stays a version conflict

- **WHEN** 批次命令提交的 `expected_version` 不是当前版本
- **THEN** 服务返回 409 `VERSION_CONFLICT`，不写入成功批次响应，既有批次、账本、审计和事件事实保持不变

#### Scenario: Concurrent same-key requests have one business effect

- **WHEN** 同一 actor 对同一目标并发提交相同 Idempotency-Key 和相同请求体
- **THEN** 请求至多有一个业务提交和一个对应审计/批次事件，其他请求只能得到已有提交的重放或 `REQUEST_IN_PROGRESS`，最终重放的 `batch` 与首次提交的 `batch` 业务字段一致
