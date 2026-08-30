## Context

本 Change 的只读基线为 `feature/staging-workflow-rate-ux` / `63c890eccce9799a4e805cc8663c672fe566bbbb`，以当前本地 Git、源码、运行时注册和 focused tests 为事实来源。旧交接报告不作为完成证据。

公共 API 仍遵循 `docs/contracts/V2_API_CONVENTIONS.md` 的 opaque `cursor` + bounded `limit` + nullable `next_cursor` 合同；本 Change 只替换低层字节处理，不替换领域 codec，不触碰分页 SQL。

## Cursor family inventory

| 家族/消费者 | Payload、版本和编码 | 排序、seek 与分页 | 过滤/范围与错误语义 | 共享决定 |
|---|---|---|---|---|
| Buyer demand list | `{k:'demand',reservation_deadline,submitted_at,id}`；无版本；legacy binary-string JSON 再 base64url | `reservation_deadline ASC, submitted_at ASC, id ASC`；三段 `>` seek；`limit+1` | Buyer/customer + marketplace + current time；空/缺失 cursor 为 null，非法结构为 Buyer `400 VALIDATION_ERROR` | 保留 typed codec；binary-string 原语保持旧非 UTF-8 字节行为 |
| Buyer reservation list | `{k:'reservation',submitted_at,id}`；无版本；legacy binary-string JSON/base64url | `submitted_at DESC,id DESC`；两段 `<` seek；`limit+1` | Buyer/customer；空/缺失 cursor 为 null，非法结构为 Buyer `400` | 同上 |
| Buyer formal orders | `{v:1,confirmed_at,id}`；UTF-8 JSON/base64url；最大长度 1000 | `confirmed_at DESC,id DESC`；`<` seek；`limit+1` | Buyer-owned confirmed orders；缺失 null，empty/malformed/unknown version/invalid fields 为 `400 VALIDATION_ERROR` | 共享 UTF-8 JSON 原语，保留 typed validator/error |
| Buyer eligible evidence reservations | `{k:'buyer-order-evidence-eligible',order_deadline,submitted_at,id}`；无版本；legacy binary-string JSON/base64url；最大长度 1024 | 三键 ASC；三段 `>` seek；`limit+1` | Buyer-owned approved reservations and submission status；empty 为 null，非法为 `400` | binary-string 原语，typed kind/fields 保留 |
| Buyer order evidence | `{k:'buyer-order-evidence',updated_at,id}`；无版本；legacy binary-string JSON/base64url；最大长度 1024 | `updated_at DESC,id DESC`；`<` seek；`limit+1` | Buyer-owned，optional status filter；empty 为 null，非法为 `400` | binary-string 原语，typed kind/fields 保留 |
| Buyer refund portal | `{v:1,kind:'buyer-refund',at,id}`；UTF-8 JSON/base64url；最大长度 1000 | `updated_at DESC,id DESC`；`<` seek；`limit+1` | Buyer-owned，optional outstanding filter；缺失 null，empty/malformed/unknown version 为 Buyer `400` | 共享 UTF-8 JSON 原语，typed validator/error 保留 |
| Buyer review eligible orders | `{v:1,kind:'eligible-order',at,id}`；UTF-8 JSON/base64url；最大长度 1000 | `confirmed_at DESC,id DESC`；`<` seek；`limit+1` | Buyer-owned eligible projection；缺失 null，kind/fields/version 错误为 `400` | 共享 UTF-8 JSON 原语，typed kind/error 保留 |
| Buyer reviews | `{v:1,kind:'review',at,id}`；UTF-8 JSON/base64url；最大长度 1000 | `updated_at DESC,id DESC`；`<` seek；`limit+1` | Buyer-owned，optional status filter；同上 | 共享 UTF-8 JSON 原语，typed kind/error 保留 |
| Seller portal stores | `{text,id}`；无版本；UTF-8 JSON/base64url；入口最大长度 1000 | `display_name COLLATE NOCASE ASC,id ASC`；`>` seek；`limit+1` | Seller organization/store scope；generic codec 的 malformed 为 Seller `400` | 保留 Seller typed guards，共享 UTF-8 JSON 原语 |
| Seller portal products | `{time,id}`；无版本；UTF-8 JSON/base64url | `updated_at DESC,id DESC`；`<` seek；`limit+1` | Seller organization/store/status/ASIN filters；Seller `400` | 同上 |
| Seller product versions | `{version_no}`；无版本；UTF-8 JSON/base64url | `version_no DESC`；`<` seek；`limit+1` | Scoped product；Seller `400` | 同上 |
| Seller applications/demand batches | `{time,id}`；无版本；UTF-8 JSON/base64url | submitted_at DESC/id DESC；`<` seek；`limit+1` | Seller organization/store/status filters；Seller `400` | 同上 |
| Seller formal orders/reviews | `{confirmed_at,formal_order_id}` 或 `{updated_at,review_case_id}`；无版本；UTF-8 JSON/base64url | 各自 DESC 双键 `<` seek；`limit+1` | Seller organization/store scope and declared filters；Seller `400` | 复用 Seller generic typed codec + shared primitive |
| Seller payables/payments and Staff internal finance positions | `{at,id}` 或 `{confirmed_at,formal_order_id}`；无版本；UTF-8 JSON/base64url | due/paid/confirmed DESC 双键 `<` seek；`limit+1` | Seller organization/store 或 Staff financial scope；各自错误包装不变 | 共享 UTF-8 JSON 原语；保留各自 typed validator/error |
| Staff work items | `{v:1,kind:'staff-work-item',at,id,status,work_type}`；UTF-8 JSON/base64url；最大长度 1000 | `created_at DESC,id DESC`；`<` seek；`limit+1` | status/work_type 必须与当前过滤回显一致；Staff `400` | 共享 UTF-8 JSON 原语，过滤绑定和 typed validator 保留 |
| Staff formal-order list | `{v:1,kind:'staff-order-list',at,id,echo}`；UTF-8 JSON/base64url；最大长度 2000 | `confirmed_at DESC,id DESC`；`<` seek；`limit+1` | echo 必须等于当前 filters；Staff `400`，详情越权仍 concealed `404` | 共享 UTF-8 JSON 原语，echo/typed validator 保留 |
| Staff order evidence | `{v:1,submitted_at,id}`；UTF-8 JSON/base64url；最大长度 2048 | `submitted_at ASC,id ASC`；`>` seek；`limit+1` | Staff data scope + status；Staff `400` | 共享 UTF-8 JSON 原语，strict key set/error 保留 |
| Staff Buyer Refund | `{v:2,review_approved_at,settled:0|1,id}`；UTF-8 JSON/base64url；最大长度 2048 | `(settled), review_approved_at ASC, obligation_id ASC`；复合 seek；`limit+1` | Staff assignment/team/global scope + status/China date filters；Staff `400` | 共享 UTF-8 JSON 原语，v2/strict key/error 保留 |
| Seller settlement batch list | `{at,id}`；无版本；UTF-8 JSON/base64url | `created_at DESC,id DESC`；`<` seek；`limit+1` | seller organization + optional SQL `CONFIRMED` filter；Seller settlement `400` | 共享 UTF-8 JSON 原语，typed field/error 保留 |
| Seller settlement batch members | `{t,n,id}`；无版本；UTF-8 JSON/base64url | `payable_type ASC, amazon_order_number_normalized ASC, id ASC`；`>` seek；`limit+1` | batch ownership and active members; concealed 404 and `400` unchanged | 共享 UTF-8 JSON 原语，typed field/error 保留 |
| Archive bundle HTTP list | raw `bundle_id` string, no JSON/base64 | `created_at DESC,id DESC` via raw id continuation; `limit+1` | Staff owner + archive state/type filters; existing parser defaults/errors | 不共享，token is intentionally raw DB identifier |
| Cold archive selector scans | raw order/refund/settlement IDs inside resumable `{orderCursor,refundCursor,settlementCursor}` state | Per-source SQL keyset; selector pulls one page each | Internal scheduled archive scope; not HTTP cursor and no public token | 不共享，different persisted state topology |
| Staff settlement reconciliation | raw `entity_key` continuation | Existing per-page reconciliation order and `limit+1` | Staff organization scope; response/error contract unchanged | 不共享，raw domain key, no codec |
| Scheduled/order-instruction expiry cursors | in-memory/persisted raw `(due,id)` / `(deadline_at,instruction_id)` | ASC keyset for bounded jobs | Internal scheduler lease/state, not API cursor | 不共享，automation state not cursor token |
| Internal finance/cash and unallocated-credit walkers | raw in-process typed `(occurred_at,movement_id)`, `(seller_organization_id)` | ASC keyset, fixed report batch | Staff finance report internal iteration | 不共享，never emitted as API token |
| Frontend local cursors | server `next_cursor` stored in React Query keys, hooks, URL, demo/MSW fixtures; member cursor pass-through | Frontend follows returned token; no decoding or ordering | Buyer/Seller/Staff UI preserves filter context; errors come from API | 不共享，frontend is opaque pass-through |

全仓静态搜索未发现这些 cursor module 的动态 import 或额外路由注册；动态 import 只作为消费者检查项保留在验收扫描中。`apps/api/src/staff-assignment/read-model.ts` 的内部 `JSON.stringify({createdAt,id})` 是 route 内部桥接值，不是外发 token，不迁移其数据形状。

## Decisions

### 1. Shared primitive boundary

`apps/api/src/foundation/cursor-codec.ts` 只负责：

- base64url 字节编码/解码及 padding；
- 保持历史 `btoa(JSON.stringify(...))` 所需的 binary-string 变体；
- UTF-8 JSON 的 encode/decode。

它不负责 cursor 最大长度、字符集、JSON object 检查、字段名、版本/kind、过滤 echo、错误类或空值。每个 typed codec 继续在 primitive 外执行自己的既有校验，因此不同家族不能互相接受 token。

### 2. Compatibility rules

UTF-8 家族保持 JSON 属性插入顺序、base64url alphabet、无 padding 和解码 padding 算法。两个 legacy binary-string 家族继续用 binary-string 原语，避免把非 ASCII 字符的历史 `btoa` 行为暗中改成 UTF-8。固定旧 token 测试以 Change 实施前的 payload 字节为基准。

### 3. Pagination non-change proof

实施只替换低层 encode/decode 调用。不得修改 read model 的 SQL、bindings、limit+1、visible slice、last-row 选择、`next_cursor` null 条件、scope/filter predicates 或 route error normalization。已有跨页测试继续作为 request-level 证据；新增 compatibility tests 证明旧 token 可解码且新编码字节相同。

### 4. Rejected alternatives

- 统一为一个无类型 cursor：拒绝，会丢失 kind/version/filter echo/settled 等安全边界。
- 统一所有家族为 UTF-8：拒绝，会改变 legacy binary-string payload 的字节格式和非 ASCII malformed 行为。
- 把 raw archive/scheduler/reconciliation/frontend cursor 纳入 API codec：拒绝，它们不是同一外部 token 合同，且会扩大范围。
- 修改 SQL、排序、过滤或重新修复分页 bug：拒绝，本 Change 是行为等价重构；发现真实 bug 只用失败测试列为新问题并路由到独立 Change。

## Security and rollback

Malformed、empty、unknown-version、wrong-kind、illegal-field、tampered、cross-filter 和 cross-scope 行为由 typed codec/route 原样保留。没有签名机制新增或移除；cursor 仍是 opaque continuation，不作为授权凭证。出现任一 token fixture、focused route、typecheck、build、test 或 check 回归时停止晋级，使用普通提交回退，不修改数据库或远程资源。
