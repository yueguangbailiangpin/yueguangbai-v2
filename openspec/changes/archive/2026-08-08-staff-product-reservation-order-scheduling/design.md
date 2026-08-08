# Design: Staff Product Reservation Order Scheduling

## Existing Baseline

复用 `products`、不可变 `product_versions`、`demand_batches.target_quantity`、`product_reservations.submitted_at` 和现有 `(demand_batch_id, status, submitted_at, id)` 索引。现有 Staff Catalog 只有创建产品和新增产品版本写接口，Staff Web 没有产品库/预约详情页面；本 Change 补齐受控读取与排期合同，不复用 Seller Session 作为 Staff 权限。

## Schedule Facts

产品版本保存两个可选默认正整数：`order_interval_days` 与 `orders_per_run`。旧产品版本保持未配置，不能伪造默认值；卖家对接或 owner 通过现有“新增产品版本”语义修改默认节奏，不原地覆盖旧版本。

每个需求发布时必须创建排期版本，保存北京时间 `first_order_date`、从产品版本复制的 `order_interval_days`、`orders_per_run`、版本、操作者、原因和时间。产品默认节奏后来变化只用于未来需求。当前已发布需求需要改期时新增排期版本；服务端先按相同事实返回受影响人数及修改前后日期，确认请求绑定预览哈希、需求 expected_version 与 Idempotency-Key，不能静默继承产品新默认值。

Migration 使用可恢复的表重建或新表保存上述事实和约束，不覆盖历史需求。旧需求在人工补齐首单日期和节奏前显示“尚未配置排期”，不根据旧 deadline 猜测日期。

## Ordering and Date Formula

有效队列包含 `PENDING_REVIEW` 与 `APPROVED` 预约，按 `submitted_at ASC, id ASC` 得到从 1 开始的稳定排名。原预约被重新打开时沿用其不可变原提交时间；`REJECTED`、`CANCELLED`、`EXPIRED` 不进入当前有效队列，但继续出现在受控历史中。退出有效队列后，后续有效预约自动前移。

设排名为 `r`、间隔自然日为 `N`、每次单数为 `M`：`run_index=floor((r-1)/M)`，`planned_order_date=first_order_date + run_index*N calendar days`。日期按 `Asia/Shanghai` 解释并连续包含周六、周日和节假日，不使用工作日日历。发布或修改排期时，以 `target_quantity` 验证最后一个理论名额的预计日期不晚于现有 order deadline；冲突时拒绝并要求调整日期、节奏或 deadline。

预计日期是员工排期事实，不是实际订单事实。已经提交订单资料或形成正式订单时，界面优先显示真实状态/实际订单日期；排期计算不得修改订单资料、Amazon 下单日期、正式订单或财务快照。

## Authority and Projection

权限按动作收口，角色始终硬限制为 Active owner 或 seller_ops：产品申请 `REJECT` 只要求 `PRODUCT_REVIEW`，`APPROVE` 因创建带节奏的产品版本而额外要求 `DEMAND_PUBLISH`；需求 `REJECT`、`CLOSE` 只要求 `DEMAND_PUBLISH`，`PUBLISH` 因创建首个排期而额外要求 `PRODUCT_REVIEW`。产品创建、新增产品版本、排期预览/确认仍要求双权限。所有动作在读出权威 Source 后重新解析当前 Staff 授权与数据范围，对权威 Seller Organization/Store 执行 Scope，并保留工作项指派检查；pre_sales、buyer_refund 即使获得个人权限也失败关闭。pre_sales 具有 `PRODUCT_VIEW` 时可读取产品与预约排名，但买家身份字段仍受其 Buyer/Customer Scope 限制；没有范围时只返回不具识别性的业务标识。

Buyer、Seller API 不增加排名、其他买家、内部预计日期或 Staff 信息。列表分页、搜索和详情均由服务端强制权限、Scope 与字段投影；客户端不得提交权威 rank、channel、buyer identity 或 planned date。

## API and Web

为 Staff 增加有界产品列表/详情、需求预约排期详情和服务端影响预览。产品默认修改继续使用新增产品版本；需求排期使用独立预览与确认命令。`DEMAND_REVIEW` 工作项通过受指派保护的 `GET /api/staff/demand-batches/:id/review-context` 读取权威需求版本、产品版本与节奏，不误用工作项版本，并复用 `POST /api/staff/demand-batches/:id/review` 发布或拒绝。Staff Web 增加可收藏的产品库、产品详情和预约详情路径，以及中文需求审核面板；发布表单明确填写北京时间首个下单日期并携带权威 `expected_version` 与幂等键。

## Performance and Audit

排名和日期按现有索引在有界分页查询中计算，不建立会漂移的每日排期 Job 或重复排名表。所有修改写产品/需求事件、Audit 和必要 Outbox；相同请求重放相同结果，不同请求哈希冲突。排期读取返回 `data_as_of`、时区、排期版本和排序键，便于员工解释日期变化。

## Rejected Alternatives

- 不保存“每天一单”等自由文本；两个正整数覆盖已确认格式并可校验。
- 不让产品默认值自动重排已发布需求；会静默改变客户顺序。
- 不把预计日期写成实际订单日期；两者是不同事实。
- 不接入节假日日历；业务明确所有自然日都计入。
- 不每日批量写二十条派生日期；列表读取时由权威快照和稳定排序计算即可。
