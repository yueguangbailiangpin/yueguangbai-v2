# V2 飞书同步合同

## 1. 权威性

D1 中的 `staff_tasks`、`task_events` 和权限上下文是权威事实。飞书记录是镜像和操作入口。

## 2. 任务创建

业务命令在同一 D1 批处理中：

1. 更新业务聚合；
2. 追加业务事件；
3. 创建/更新权威任务；
4. 插入 `integration_outbox`。

Worker 消费 Outbox 后创建或更新飞书记录。

## 3. D1 → 飞书

同步字段：

- D1 task_id；
- 任务类型；
- 标题摘要；
- 部门；
- 状态；
- 主负责人；
- 协作者；
- 优先级；
- 截止时间；
- 详情链接；
- D1 version；
- 更新时间。

不发送完整财务或敏感聊天内容。

## 4. 飞书 → D1

允许动作：

- 领取；
- 放回公共队列；
- 分配；
- 改派；
- 添加/移除协作者；
- 改优先级；
- 改截止时间；
- 更新内部任务备注。

请求必须包含：

- task_id；
- expected_version；
- 飞书用户 ID；
- action；
- idempotency_key；
- 回调事件 ID。

D1 校验员工、角色、团队范围和版本后写入。成功后生成新 Outbox 更新飞书。

## 5. 原子领取

领取通过条件更新完成：

```sql
UPDATE staff_tasks
SET primary_assignee_id=?, status='CLAIMED', version=version+1
WHERE id=? AND status='OPEN' AND primary_assignee_id IS NULL AND version=?;
```

受影响行数不是 1 时返回冲突，飞书显示“任务已被其他人领取”。

## 6. 同步失败

- Outbox 保存 attempt_count、last_error、next_retry_at。
- 指数退避。
- 超过阈值进入同步异常表。
- 业务命令成功不因飞书暂时失败而回滚。
- 飞书恢复后可幂等重放。
- 不允许手工修改飞书记录伪造同步成功。

## 7. 身份映射

每个员工保存：

- internal_staff_id；
- feishu_open_id；
- feishu_user_id；
- tenant_key；
- status；
- last_verified_at。

未知或停用飞书用户不得执行 D1 写操作。
