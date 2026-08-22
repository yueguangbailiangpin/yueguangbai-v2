import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { isFrontendApiError } from '../api/errors';
import type { ApiResult } from '../api/transport';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { useFileUpload } from '../buyer/shared/useFileUpload';
import { FileDropZone } from '../ui/FileDropZone';
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  FormField,
  RequestIdDisplay,
  Select,
  StatusBadge,
  TextInput,
} from '../ui/primitives';
import { staffApi } from './api/client';
import type {
  DemandReviewMutation,
  StaffOrderEvidence,
  StaffReview,
  StaffWorkItem,
} from './contracts/runtime';
import {
  isAmbiguousStaffMutationError,
  StaffMutationAuthority,
  type StaffMutationRequest,
} from './mutations/StaffMutationAuthority';
import { staffWorkbenchKeys } from './queries/keys';
import { SellerSettlementPanel, sellerSettlementCapabilities } from './SellerSettlementPanel';
import { formatCny, formatShanghai } from './shared/format';
import {
  describeBuyerRefundMutationError,
  describeOrderEvidenceMutationError,
  describeReviewMutationError,
  describeStaffMutationError,
} from './shared/staffMutationOutcome';
import { StaffPanelError } from './shared/StaffPanelError';
import { StaffProtectedFileButton } from './shared/StaffProtectedFileButton';

const labels: Record<StaffWorkItem['work_type'], string> = {
  PRODUCT_APPLICATION_REVIEW: '商品申请审核',
  DEMAND_REVIEW: '需求审核',
  RESERVATION_DECISION: '预约处理',
  ORDER_INSTRUCTION_PUBLISH: '下单指引发布',
  ORDER_EVIDENCE_REVIEW: '订单资料核对',
  REVIEW_DECISION: '评论审核',
  BUYER_REFUND_PROCESSING: '买家返款',
};
type RetainedSelection = Readonly<{
  queueIdentity: string;
  item: StaffWorkItem;
  sourceQueueUpdatedAt: number;
  retainedQueueUpdatedAt: number | null;
}>;

export function FrozenStaffWorkbench(): React.JSX.Element {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [parameters] = useSearchParams();
  const routeId = /^\/staff\/work\/([^/]+)$/u.exec(location.pathname)?.[1];
  const selectedId = routeId ? decodeURIComponent(routeId) : parameters.get('work_item');
  const status = parameters.get('status') === 'COMPLETED' ? 'COMPLETED' : 'OPEN';
  const workType = parameters.get('work_type');
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const retainedSelectedRef = useRef<RetainedSelection | null>(null);
  const effectiveScopeFingerprint = JSON.stringify({
    role: session.role.code,
    permissions: [...session.permissions].sort(),
    data_scope: {
      type: session.data_scope.type,
      marketplaceCodes: [...session.data_scope.marketplaceCodes].sort(),
      buyerCustomerIds: [...session.data_scope.buyerCustomerIds].sort(),
      sellerOrganizationIds: [...session.data_scope.sellerOrganizationIds].sort(),
      teamIds: [...session.data_scope.teamIds].sort(),
    },
  });
  const query = useQuery({
    queryKey: staffWorkbenchKeys.queue(
      session.staff_id,
      session.authorization_version,
      session.session_version,
      effectiveScopeFingerprint,
      status,
      workType,
      cursor,
    ),
    queryFn: ({ signal }) =>
      staffApi.workItems(client, { status, workType, cursor }, signal).then((r) => r.data),
    retry: false,
    staleTime: 0,
  });
  const hasCurrentQueue = query.isSuccess && !query.isFetching;
  const selectedFromQueue = hasCurrentQueue
    ? (query.data.work_items.find((item) => item.work_item_id === selectedId) ?? null)
    : null;
  const queueIdentity = JSON.stringify({
    selectedId,
    status,
    workType,
    cursor,
    staffId: session.staff_id,
    authorizationVersion: session.authorization_version,
    sessionVersion: session.session_version,
    effectiveScopeFingerprint,
  });
  const retained = retainedSelectedRef.current;
  if (retained && retained.queueIdentity !== queueIdentity) retainedSelectedRef.current = null;
  if (retainedSelectedRef.current && query.isError) retainedSelectedRef.current = null;
  if (
    retainedSelectedRef.current &&
    hasCurrentQueue &&
    query.dataUpdatedAt > retainedSelectedRef.current.sourceQueueUpdatedAt
  ) {
    if (retainedSelectedRef.current.retainedQueueUpdatedAt === null) {
      retainedSelectedRef.current = selectedFromQueue
        ? null
        : { ...retainedSelectedRef.current, retainedQueueUpdatedAt: query.dataUpdatedAt };
    } else if (retainedSelectedRef.current.retainedQueueUpdatedAt !== query.dataUpdatedAt) {
      retainedSelectedRef.current = null;
    }
  }
  const selected = hasCurrentQueue
    ? (selectedFromQueue ?? retainedSelectedRef.current?.item ?? null)
    : null;
  function retainAfterSuccessfulMutation(item: StaffWorkItem) {
    if (item.work_item_id !== selectedId) return;
    retainedSelectedRef.current = {
      queueIdentity,
      item,
      sourceQueueUpdatedAt: query.dataUpdatedAt,
      retainedQueueUpdatedAt: null,
    };
  }
  function completeSelectedWorkItem(item: StaffWorkItem) {
    if (item.work_item_id !== selectedId) return;
    // 审核事实已经由命令响应确认；完成后不得再读取该审核上下文，
    // 否则后端按已完工作项返回 404，会把成功显示成失败。
    client.setQueryData<{ work_items: StaffWorkItem[]; next_cursor: string | null }>(
      staffWorkbenchKeys.queue(
        session.staff_id,
        session.authorization_version,
        session.session_version,
        effectiveScopeFingerprint,
        status,
        workType,
        cursor,
      ),
      (data) =>
        data
          ? {
              work_items: data.work_items.map((entry) =>
                entry.work_item_id === item.work_item_id
                  ? { ...entry, status: 'COMPLETED' as const, completed_at: Date.now() }
                  : entry,
              ),
              next_cursor: data.next_cursor,
            }
          : data,
    );
    retainedSelectedRef.current = null;
    const next = new URLSearchParams(parameters);
    next.delete('work_item');
    void navigate(`/staff?${next}`);
    void client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
  }
  function filter(name: 'status' | 'work_type', value: string) {
    const next = new URLSearchParams(parameters);
    value ? next.set(name, value) : next.delete(name);
    next.delete('work_item');
    retainedSelectedRef.current = null;
    setCursor(null);
    setHistory([]);
    void navigate(`/staff?${next}`);
  }
  function select(item: StaffWorkItem) {
    const next = new URLSearchParams(parameters);
    next.set('work_item', item.work_item_id);
    void navigate(`/staff/work/${encodeURIComponent(item.work_item_id)}?${next}`);
  }
  return (
    <main className="staff-panes staff-workbench frozen-w1">
      <section className="staff-queue">
        <div className="pane-heading">
          <div>
            <h2>工作队列</h2>
            <p>只显示当前岗位与负责站点的业务。</p>
          </div>
          <StatusBadge tone={query.data?.work_items.length ? 'processing' : 'neutral'}>
            {query.data?.work_items.length ?? 0}
          </StatusBadge>
        </div>
        <div className="staff-filter-grid">
          <label htmlFor="queue-status">
            状态
            <Select
              id="queue-status"
              value={status}
              onChange={(event) => filter('status', event.target.value)}
            >
              <option value="OPEN">待处理</option>
              <option value="COMPLETED">已完成</option>
            </Select>
          </label>
          <label htmlFor="queue-type">
            类型
            <Select
              id="queue-type"
              value={workType ?? ''}
              onChange={(event) => filter('work_type', event.target.value)}
            >
              <option value="">全部类型</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {query.isPending ? (
          <p role="status">正在加载工作队列</p>
        ) : query.isError ? (
          <StaffPanelError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : query.data.work_items.length === 0 ? (
          <EmptyState
            title="当前队列为空"
            description="没有符合当前岗位、站点和筛选条件的工作项。"
          />
        ) : (
          <ol className="staff-work-list">
            {query.data.work_items.map((item) => (
              <li key={item.work_item_id}>
                <button
                  type="button"
                  className={`staff-work-item${item.work_item_id === selectedId ? ' selected' : ''}`}
                  onClick={() => select(item)}
                >
                  <span className="staff-work-item-heading">
                    <strong>{labels[item.work_type]}</strong>
                    <StatusBadge tone={item.status === 'OPEN' ? 'warning' : 'success'}>
                      {item.status === 'OPEN' ? '待处理' : '已完成'}
                    </StatusBadge>
                  </span>
                  <span>编号：{item.source_entity_id}</span>
                  <small>{formatShanghai(item.created_at)}</small>
                </button>
              </li>
            ))}
          </ol>
        )}
        <nav className="pagination-actions">
          <Button
            className="secondary"
            disabled={history.length === 0}
            onClick={() => {
              setCursor(history.at(-1) ?? null);
              setHistory((all) => all.slice(0, -1));
            }}
          >
            上一页
          </Button>
          <Button
            className="secondary"
            disabled={!query.data?.next_cursor}
            onClick={() => {
              setHistory((all) => [...all, cursor]);
              setCursor(query.data?.next_cursor ?? null);
            }}
          >
            下一页
          </Button>
        </nav>
      </section>
      {selected ? (
        <WorkItemColumns
          item={selected}
          onSuccessfulQueueMutation={retainAfterSuccessfulMutation}
          onCompletedQueueMutation={completeSelectedWorkItem}
        />
      ) : (
        <>
          <section className="staff-detail">
            <EmptyState title="请选择工作项" description="中间展示业务事实和证据。" />
          </section>
          <aside className="staff-actions">
            <EmptyState title="等待选择" description="右侧只显示当前客户和可执行操作。" />
          </aside>
        </>
      )}
    </main>
  );
}

function WorkItemColumns({
  item,
  onSuccessfulQueueMutation,
  onCompletedQueueMutation,
}: {
  item: StaffWorkItem;
  onSuccessfulQueueMutation: (item: StaffWorkItem) => void;
  onCompletedQueueMutation: (item: StaffWorkItem) => void;
}) {
  const session = useCurrentStaffSession();
  if (item.work_type === 'DEMAND_REVIEW')
    return (
      <DemandColumns
        item={item}
        onCompletedQueueMutation={onCompletedQueueMutation}
      />
    );
  if (item.work_type === 'ORDER_EVIDENCE_REVIEW')
    return <OrderColumns item={item} onCompletedQueueMutation={onCompletedQueueMutation} />;
  if (item.work_type === 'REVIEW_DECISION')
    return <ReviewColumns item={item} onCompletedQueueMutation={onCompletedQueueMutation} />;
  if (item.work_type === 'BUYER_REFUND_PROCESSING')
    return (
      <RefundColumns
        item={item}
        onSuccessfulQueueMutation={onSuccessfulQueueMutation}
        onCompletedQueueMutation={onCompletedQueueMutation}
      />
    );
  if (item.seller_organization_id && sellerSettlementCapabilities(session).canView)
    return <SellerSettlementPanel item={item} />;
  return <GenericColumns item={item} />;
}

function GenericColumns({ item }: { item: StaffWorkItem }) {
  return (
    <>
      <section className="staff-detail">
        <PaneTitle item={item} />
        <Card className="customer-visible">
          <h3>工作项事实</h3>
          <Fact label="来源类型" value={item.source_entity_type} />
          <Fact label="来源编号" value={item.source_entity_id} />
          <Fact label="状态" value={item.status} />
          {item.store_id ? <Fact label="店铺" value={item.store_id} /> : null}
        </Card>
        <Alert tone="info">当前后端没有为该工作类型冻结独立详情读取合同；页面不会猜测数据。</Alert>
      </section>
      <aside className="staff-actions">
        <CustomerContext item={item} />
        <Card>
          <h3>当前操作</h3>
          <p>请进入对应产品 / 排期业务页继续处理。</p>
        </Card>
        <Audit />
      </aside>
    </>
  );
}

function DemandColumns({
  item,
  onCompletedQueueMutation,
}: {
  item: StaffWorkItem;
  onCompletedQueueMutation: (item: StaffWorkItem) => void;
}) {
  const client = useQueryClient();
  const authority = useMemo(
    () => new StaffMutationAuthority<ApiResult<DemandReviewMutation>>(),
    [],
  );
  const query = useQuery({
    queryKey: staffWorkbenchKeys.demandReview(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi
        .demandReviewContext(client, item.source_entity_id, signal)
        .then((r) => r.data.review_context),
    retry: false,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ body }, key) =>
            staffApi.reviewDemand(client, item.source_entity_id, body, key),
          ),
    onSuccess: () => {
      // 发布或拒绝成功即结束该工作项：立即关闭审核面板并刷新队列。
      // 不再重读 review-context；已完成的审核事实会被后端拒绝（404），
      // 重读只会把成功显示成失败。
      onCompletedQueueMutation(item);
    },
  });
  const value = query.data;
  const completed = mutation.data?.data.demand_review;
  const failure = mutation.isError ? describeStaffMutationError(mutation.error) : null;
  return (
    <>
      <section className="staff-detail">
        <PaneTitle item={item} />
        {completed ? (
          <Card className="customer-visible">
            <h3>需求审核结果</h3>
            <Fact label="状态" value={completed.status} />
            <Fact label="审核版本" value={`v${completed.version}`} />
          </Card>
        ) : query.isPending ? (
          <p role="status">正在加载需求事实</p>
        ) : value ? (
          <Card className="customer-visible">
            <h3>需求发布事实</h3>
            <Fact label="产品" value={`${value.product_name} · v${value.product_version_no}`} />
            <Fact label="目标数量" value={`${value.target_quantity} 单`} />
            <Fact label="预约截止" value={formatShanghai(value.reservation_deadline)} />
            <Fact label="下单截止" value={formatShanghai(value.order_deadline)} />
            <Fact
              label="排期"
              value={
                value.cadence
                  ? `每 ${value.cadence.order_interval_days} 天 / ${value.cadence.orders_per_run} 单`
                  : '未配置'
              }
            />
          </Card>
        ) : (
          <Alert tone="danger">需求事实暂时无法加载。</Alert>
        )}
      </section>
      <aside className="staff-actions">
        <CustomerContext item={item} />
        {value && !completed ? (
          <Card>
            <h3>当前操作</h3>
            {value.can_publish ? (
              <form
                onChange={() => {
                  if (!mutation.isPending) {
                    authority.release();
                    mutation.reset();
                  }
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const date = String(new FormData(event.currentTarget).get('first_order_date'));
                  mutation.mutate({
                    action: 'demand-publish',
                    path: `/api/staff/demand-batches/${encodeURIComponent(item.source_entity_id)}/review`,
                    body: {
                      expected_version: value.demand_version,
                      decision: 'PUBLISH',
                      first_order_date: date,
                    },
                  });
                }}
              >
                <FormField label="首个下单日期" htmlFor={`publish-${item.work_item_id}`}>
                  <TextInput
                    id={`publish-${item.work_item_id}`}
                    name="first_order_date"
                    type="date"
                    required
                  />
                </FormField>
                <Button loading={mutation.isPending}>通过并发布</Button>
              </form>
            ) : null}
            <form
              onChange={() => {
                if (!mutation.isPending) {
                  authority.release();
                  mutation.reset();
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const reason = String(new FormData(event.currentTarget).get('reason'));
                mutation.mutate({
                  action: 'demand-reject',
                  path: `/api/staff/demand-batches/${encodeURIComponent(item.source_entity_id)}/review`,
                  body: {
                    expected_version: value.demand_version,
                    decision: 'REJECT',
                    rejection_reason: reason,
                  },
                });
              }}
            >
              <FormField label="拒绝原因" htmlFor={`demand-reject-${item.work_item_id}`}>
                <TextInput id={`demand-reject-${item.work_item_id}`} name="reason" required />
              </FormField>
              <Button className="secondary" disabled={mutation.isPending}>
                拒绝
              </Button>
            </form>
            {failure ? (
              <>
                <Alert tone="danger">
                  需求审核未完成。{failure.hint}
                  {failure.code ? `（错误码：${failure.code}）` : ''}
                </Alert>
                <RequestIdDisplay
                  requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
                />
                {isAmbiguousStaffMutationError(mutation.error) ? (
                  <Button className="secondary" onClick={() => mutation.mutate(null)}>
                    重试原请求
                  </Button>
                ) : null}
              </>
            ) : null}
          </Card>
        ) : null}
        <Audit />
      </aside>
    </>
  );
}

function OrderColumns({
  item,
  onCompletedQueueMutation,
}: {
  item: StaffWorkItem;
  onCompletedQueueMutation: (item: StaffWorkItem) => void;
}) {
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority(), []);
  const query = useQuery({
    queryKey: staffWorkbenchKeys.orderEvidence(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi
        .orderEvidence(client, item.source_entity_id, signal)
        .then((r) => r.data.order_evidence),
    retry: false,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ action, body }, key) =>
            staffApi.mutateOrderEvidence(
              client,
              item.source_entity_id,
              action as 'approve' | 'request-changes',
              body,
              key,
            ),
          ),
    onSuccess: () => {
      // “通过”和“要求修改”都会由后端完成当前工作项。命令响应已经确认成功，
      // 此时直接关闭面板并刷新队列；不得再读取已完成任务的详情，避免 404
      // 或状态变化把成功显示成失败。
      onCompletedQueueMutation(item);
    },
  });
  const value = query.data;
  const failure = mutation.isError
    ? describeOrderEvidenceMutationError(mutation.error)
    : null;
  return (
    <>
      <section className="staff-detail">
        <PaneTitle item={item} />
        {query.isPending ? (
          <p role="status">正在加载订单资料</p>
        ) : query.isError ? (
          <StaffPanelError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : value ? (
          <OrderFacts value={value} />
        ) : null}
      </section>
      <aside className="staff-actions">
        <CustomerContext item={item} />
        {value ? (
          <Card>
            <h3>当前操作</h3>
            <form
              onChange={() => {
                if (!mutation.isPending) {
                  authority.release();
                  mutation.reset();
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const submitter = (event.nativeEvent as SubmitEvent).submitter;
                const action = (submitter?.getAttribute('value') ?? '') as
                  | 'approve'
                  | 'request-changes';
                const internal = String(data.get('internal_note') ?? '').trim();
                const body =
                  action === 'approve'
                    ? {
                        expected_version: value.version,
                        ...(internal ? { internal_note: internal } : {}),
                        ...(value.price_mismatch
                          ? {
                              price_mismatch_acknowledged: data.get('ack') === 'on',
                              price_mismatch_reason: String(data.get('mismatch_reason') ?? ''),
                            }
                          : {}),
                      }
                    : {
                        expected_version: value.version,
                        public_reason: String(data.get('public_reason') ?? ''),
                        ...(internal ? { internal_note: internal } : {}),
                      };
                mutation.mutate({
                  action,
                  path: `/api/staff/order-evidence/${encodeURIComponent(value.submission_id)}/${action}`,
                  body,
                });
              }}
            >
              <FormField label="要求修改原因" htmlFor={`order-public-${item.work_item_id}`}>
                <TextInput id={`order-public-${item.work_item_id}`} name="public_reason" />
              </FormField>
              <FormField label="内部备注" htmlFor={`order-internal-${item.work_item_id}`}>
                <TextInput id={`order-internal-${item.work_item_id}`} name="internal_note" />
              </FormField>
              {value.price_mismatch ? (
                <>
                  <Alert tone="warning">存在价格差异，请核对截图后确认。</Alert>
                  <label>
                    <input type="checkbox" name="ack" /> 已核对价格差异
                  </label>
                  <FormField label="价差确认原因" htmlFor={`mismatch-${item.work_item_id}`}>
                    <TextInput id={`mismatch-${item.work_item_id}`} name="mismatch_reason" />
                  </FormField>
                </>
              ) : null}
              <div className="entry-actions">
                <Button name="action" value="request-changes" disabled={mutation.isPending}>
                  要求修改
                </Button>
                <Button
                  className="secondary"
                  name="action"
                  value="approve"
                  disabled={mutation.isPending}
                >
                  通过
                </Button>
              </div>
            </form>
            {failure ? (
              <>
                <Alert tone="danger">
                  订单资料操作未完成。{failure.hint}
                  {failure.code ? `（错误码：${failure.code}）` : ''}
                </Alert>
                <RequestIdDisplay
                  requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
                />
                {isAmbiguousStaffMutationError(mutation.error) ? (
                  <Button className="secondary" onClick={() => mutation.mutate(null)}>
                    重试原请求
                  </Button>
                ) : (
                  <Button
                    className="secondary"
                    onClick={() => {
                      authority.release();
                      mutation.reset();
                      void query.refetch();
                    }}
                  >
                    刷新订单事实
                  </Button>
                )}
              </>
            ) : null}
          </Card>
        ) : null}
        <Audit />
      </aside>
    </>
  );
}
function OrderFacts({ value }: { value: StaffOrderEvidence }) {
  return (
    <>
      <Card className="customer-visible">
        <h3>订单资料</h3>
        <Fact label="订单号" value={value.amazon_order_number_normalized} />
        <Fact label="订单日期" value={value.amazon_order_date ?? '未知'} />
        <Fact label="最终支付" value={`${value.final_paid_jpy} JPY`} />
        <StaffProtectedFileButton reference={value.screenshot} label="查看订单截图" />
      </Card>
      <Card className="internal-note">
        <h3>内部核对</h3>
        <Fact label="参考金额" value={`${value.reference_order_amount_jpy} JPY`} />
        <Fact label="价差" value={`${value.price_difference_jpy} JPY`} />
        <Fact label="证据版本" value={`v${value.version}`} />
      </Card>
    </>
  );
}

function ReviewColumns({
  item,
  onCompletedQueueMutation,
}: {
  item: StaffWorkItem;
  onCompletedQueueMutation: (item: StaffWorkItem) => void;
}) {
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority(), []);
  const query = useQuery({
    queryKey: staffWorkbenchKeys.review(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi.review(client, item.source_entity_id, signal).then((r) => r.data.review),
    retry: false,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ action, body }, key) =>
            staffApi.mutateReview(
              client,
              item.source_entity_id,
              action as 'approve' | 'reject' | 'request-changes',
              body,
              key,
            ),
          ),
    onSuccess: () => {
      // 三种评论决定都会结束 REVIEW_DECISION 工作项。命令响应已确认成功后，
      // 不得重读旧详情或保留已完成队列项，否则权限/状态收紧时会把成功显示成失败。
      onCompletedQueueMutation(item);
    },
  });
  const value = query.data;
  const failure = mutation.isError ? describeReviewMutationError(mutation.error) : null;
  return (
    <>
      <section className="staff-detail">
        <PaneTitle item={item} />
        {query.isPending ? (
          <p role="status">正在加载评论资料</p>
        ) : value ? (
          <ReviewFacts value={value} />
        ) : (
          <Alert tone="danger">评论资料暂时无法加载。</Alert>
        )}
      </section>
      <aside className="staff-actions">
        <CustomerContext item={item} />
        {value ? (
          <Card>
            <h3>当前操作</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const submitter = (event.nativeEvent as SubmitEvent).submitter;
                const action = (submitter?.getAttribute('value') ?? '') as
                  | 'approve'
                  | 'reject'
                  | 'request-changes';
                const publicReason = String(data.get('public_reason') ?? '').trim();
                const internal = String(data.get('internal_note') ?? '').trim();
                mutation.mutate({
                  action,
                  path: `/api/staff/reviews/${encodeURIComponent(item.source_entity_id)}/${action}`,
                  body:
                    action === 'approve'
                      ? {
                          expected_version: value.version,
                          ...(internal ? { internal_note: internal } : {}),
                        }
                      : {
                          expected_version: value.version,
                          public_reason: publicReason,
                          ...(internal ? { internal_note: internal } : {}),
                        },
                });
              }}
            >
              <FormField label="拒绝 / 修改原因" htmlFor={`review-public-${item.work_item_id}`}>
                <TextInput id={`review-public-${item.work_item_id}`} name="public_reason" />
              </FormField>
              <FormField label="内部备注" htmlFor={`review-internal-${item.work_item_id}`}>
                <TextInput id={`review-internal-${item.work_item_id}`} name="internal_note" />
              </FormField>
              <div className="entry-actions">
                <Button name="action" value="request-changes">
                  要求修改
                </Button>
                <Button className="secondary" name="action" value="reject">
                  拒绝
                </Button>
                <Button name="action" value="approve">
                  通过
                </Button>
              </div>
            </form>
            {failure ? (
              <>
                <Alert tone="danger">
                  评论审核未完成。{failure.hint}
                  {failure.code ? `（错误码：${failure.code}）` : ''}
                </Alert>
                <RequestIdDisplay
                  requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
                />
                {isAmbiguousStaffMutationError(mutation.error) ? (
                  <Button className="secondary" onClick={() => mutation.mutate(null)}>
                    重试原请求
                  </Button>
                ) : (
                  <Button
                    className="secondary"
                    onClick={() => {
                      authority.release();
                      mutation.reset();
                      void query.refetch();
                    }}
                  >
                    刷新评论事实
                  </Button>
                )}
              </>
            ) : null}
          </Card>
        ) : null}
        <Audit />
      </aside>
    </>
  );
}
function ReviewFacts({ value }: { value: StaffReview }) {
  return (
    <>
      <Card className="customer-visible">
        <h3>评论资料</h3>
        <Fact label="评论类型" value={value.review_type} />
        <Fact label="评论链接" value={value.current_evidence.review_url ?? '无'} />
        <Fact label="买家备注" value={value.current_evidence.buyer_note ?? '无'} />
        {value.current_evidence.files.map((file) => (
          <StaffProtectedFileButton
            key={file.file_object_id}
            reference={file}
            label={`查看 ${file.client_file_name}`}
          />
        ))}
      </Card>
      <Card className="internal-note">
        <h3>内部事实</h3>
        <Fact label="状态 / 版本" value={`${value.status} / v${value.version}`} />
        <Fact label="正式订单" value={value.formal_order_id} />
      </Card>
    </>
  );
}

function RefundColumns({
  item,
  onSuccessfulQueueMutation,
  onCompletedQueueMutation,
}: {
  item: StaffWorkItem;
  onSuccessfulQueueMutation: (item: StaffWorkItem) => void;
  onCompletedQueueMutation: (item: StaffWorkItem) => void;
}) {
  const client = useQueryClient();
  const authority = useMemo(
    () => new StaffMutationAuthority<ApiResult<{ obligation: { status: string } }>>(),
    [],
  );
  const [uploader, upload] = useFileUpload();
  const query = useQuery({
    queryKey: staffWorkbenchKeys.refund(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi.buyerRefund(client, item.source_entity_id, signal).then((r) => r.data.buyer_refund),
    retry: false,
    staleTime: 0,
  });
  const [confirm, setConfirm] = useState<{
    kind: 'payment' | 'reversal';
    body: unknown;
    paymentId?: string;
  } | null>(null);
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ action, path, body }, key) => {
            if (action === 'payment')
              return staffApi.recordRefundPayment(client, item.source_entity_id, body, key);
            if (action === 'reversal') {
              const paymentId = decodeURIComponent(path.split('/').at(-2)!);
              return staffApi.reverseRefundPayment(
                client,
                item.source_entity_id,
                paymentId,
                body,
                key,
              );
            }
            throw new Error('INVALID_BUYER_REFUND_ACTION');
          }),
    onSuccess: (response) => {
      if (response.data.obligation.status === 'PAID') {
        // 结清返款会完成工作项；不要再依赖旧详情读取确认成功。
        onCompletedQueueMutation(item);
        return;
      }
      onSuccessfulQueueMutation(item);
      setConfirm(null);
      void query.refetch();
      void client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
    },
  });
  const value = query.data;
  const failure = mutation.isError ? describeBuyerRefundMutationError(mutation.error) : null;
  return (
    <>
      <section className="staff-detail">
        <PaneTitle item={item} />
        {query.isPending ? (
          <p role="status">加载中…</p>
        ) : value ? (
          <>
            <Card className="customer-visible">
              <h3>买家返款</h3>
              <Fact label="订单号" value={value.order.amazon_order_number_normalized} />
              <Fact label="应返" value={formatCny(value.due_amount_cny_fen)} />
              <Fact label="已返净额" value={formatCny(value.net_paid_cny_fen)} />
              <Fact label="待返" value={formatCny(value.outstanding_amount_cny_fen)} />
            </Card>
            <Card className="internal-note">
              <h3>买家催办</h3>
              <Fact label="催办次数" value={String(value.reminder_count)} />
              <Fact
                label="最后催办时间"
                value={
                  value.last_reminded_at === null ? '暂无' : formatShanghai(value.last_reminded_at)
                }
              />
            </Card>
            <Card className="internal-note">
              <h3>已记录付款</h3>
              {value.payments.length === 0 ? (
                <p>暂无付款记录。</p>
              ) : (
                value.payments.map((entry) => (
                  <div key={entry.payment_entry_id} className="staff-payment-row">
                    <span>
                      {formatCny(entry.amount_cny_fen)} · {formatShanghai(entry.paid_at)}
                    </span>
                    <Button
                      className="secondary"
                      disabled={mutation.isPending}
                      onClick={() => {
                        authority.release();
                        mutation.reset();
                        setConfirm({
                          kind: 'reversal',
                          paymentId: entry.payment_entry_id,
                          body: {
                            expected_version: value.version,
                            amount_cny_fen: entry.amount_cny_fen,
                            reversed_at: Date.now(),
                            reason: '员工确认冲正',
                          },
                        });
                      }}
                    >
                      冲正
                    </Button>
                  </div>
                ))
              )}
            </Card>
          </>
        ) : (
          <Alert tone="danger">返款信息暂时加载不了。</Alert>
        )}
      </section>
      <aside className="staff-actions">
        <CustomerContext item={item} />
        {value ? (
          <Card>
            <h3>记录返款</h3>
            <FileDropZone
              id="buyer-refund-proof"
              aria-label="买家返款凭证"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={mutation.isPending}
              maximumFiles={1}
              maximumBytes={20 * 1024 * 1024}
              buttonLabel="选择返款凭证"
              emptyLabel="尚未选择返款凭证"
              onFilesChange={(files) => {
                if (!mutation.isPending) {
                  authority.release();
                  mutation.reset();
                }
                const file = files[0];
                if (file) void uploader.start('staffBuyerRefundProof', [file]);
              }}
            />
            <p className="staff-upload-state">凭证：{upload.state}</p>
            <form
              onChange={() => {
                if (!mutation.isPending) {
                  authority.release();
                  mutation.reset();
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const file = upload.manifest?.files[0];
                if (!file) return;
                const data = new FormData(event.currentTarget);
                const paidAt = Date.now();
                const date = new Intl.DateTimeFormat('en-CA', {
                  timeZone: 'Asia/Shanghai',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(new Date(paidAt));
                authority.release();
                mutation.reset();
                setConfirm({
                  kind: 'payment',
                  body: {
                    expected_version: value.version,
                    amount_cny_fen: String(data.get('amount')),
                    paid_at: paidAt,
                    china_business_date: date,
                    payment_channel: String(data.get('channel')),
                    public_note: String(data.get('public_note') ?? ''),
                    internal_note: String(data.get('internal_note') ?? ''),
                    proof_files: [
                      {
                        file_object_id: file.file_object_id,
                        expected_file_version: file.file_version,
                      },
                    ],
                  },
                });
              }}
            >
              <FormField
                label="实际返款（人民币分）"
                htmlFor={`refund-amount-${item.work_item_id}`}
              >
                <TextInput
                  id={`refund-amount-${item.work_item_id}`}
                  name="amount"
                  inputMode="numeric"
                  required
                />
              </FormField>
              <label htmlFor={`refund-channel-${item.work_item_id}`}>渠道</label>
              <Select id={`refund-channel-${item.work_item_id}`} name="channel">
                <option value="WECHAT">微信</option>
                <option value="ALIPAY">支付宝</option>
                <option value="BANK_TRANSFER">银行转账</option>
                <option value="OTHER_MANUAL">其他</option>
              </Select>
              <FormField label="客户备注" htmlFor={`refund-public-${item.work_item_id}`}>
                <TextInput id={`refund-public-${item.work_item_id}`} name="public_note" />
              </FormField>
              <FormField label="内部备注" htmlFor={`refund-internal-${item.work_item_id}`}>
                <TextInput id={`refund-internal-${item.work_item_id}`} name="internal_note" />
              </FormField>
              <Button disabled={upload.state !== 'VERIFIED' || mutation.isPending}>记录</Button>
            </form>
          </Card>
        ) : null}
        <Audit />
        <Dialog
          open={confirm !== null}
          title={confirm?.kind === 'payment' ? '确认记录返款' : '确认冲正'}
          description={
            confirm?.kind === 'payment'
              ? '请确认客户、金额和渠道后再记录。'
              : '冲正会改变已记录的付款事实。'
          }
          busy={mutation.isPending}
          onClose={() => {
            if (!mutation.isPending) setConfirm(null);
          }}
        >
          <div className="entry-actions">
            <Button
              className="secondary"
              disabled={mutation.isPending}
              onClick={() => setConfirm(null)}
            >
              取消
            </Button>
            <Button
              className="danger"
              loading={mutation.isPending}
              onClick={() => {
                if (!confirm) return;
                mutation.mutate({
                  action: confirm.kind,
                  path:
                    confirm.kind === 'payment'
                      ? `/api/staff/buyer-refunds/${encodeURIComponent(item.source_entity_id)}/payments`
                      : `/api/staff/buyer-refunds/${encodeURIComponent(item.source_entity_id)}/payments/${encodeURIComponent(confirm.paymentId!)}/reversals`,
                  body: confirm.body,
                });
              }}
            >
              确认
            </Button>
          </div>
          {failure ? (
            <>
              <Alert tone="danger">
                返款操作未完成。{failure.hint}
                {failure.code ? `（错误码：${failure.code}）` : ''}
              </Alert>
              <RequestIdDisplay
                requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
              />
              <Button
                className="secondary"
                onClick={
                  authority.canRetry()
                    ? () => mutation.mutate(null)
                    : () => {
                        setConfirm(null);
                        mutation.reset();
                        void query.refetch();
                      }
                }
              >
                {authority.canRetry() ? '重试原请求' : '刷新返款事实'}
              </Button>
            </>
          ) : null}
        </Dialog>
      </aside>
    </>
  );
}

function PaneTitle({ item }: { item: StaffWorkItem }) {
  return (
    <div className="pane-heading">
      <div>
        <p className="eyebrow">业务事实与证据</p>
        <h2>{labels[item.work_type]}</h2>
      </div>
      <StatusBadge tone={item.status === 'OPEN' ? 'processing' : 'success'}>
        {item.status === 'OPEN' ? '待处理' : '已完成'}
      </StatusBadge>
    </div>
  );
}
function CustomerContext({ item }: { item: StaffWorkItem }) {
  return (
    <Card className="staff-current-customer">
      <h3>当前客户</h3>
      {item.buyer_customer_id ? (
        <>
          <Fact label="买家" value={item.buyer_customer_id} />
          <Fact label="业务范围" value="按当前 Marketplace 权限过滤" />
        </>
      ) : item.seller_organization_id ? (
        <>
          <Fact label="卖家组织" value={item.seller_organization_id} />
          <Fact label="业务范围" value="按当前 Marketplace 权限过滤" />
        </>
      ) : (
        <Fact label="来源" value={item.source_entity_id} />
      )}
    </Card>
  );
}
function Audit() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="staff-audit-collapsed">
      <button type="button" className="audit-toggle" onClick={() => setOpen((value) => !value)}>
        操作记录 <span>{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <div className="audit-list">
          <p>当前页面只展示已冻结的操作结果；完整审计事实由后端 Audit Log 保存。</p>
        </div>
      ) : null}
    </Card>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <dl className="fact-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </dl>
  );
}
