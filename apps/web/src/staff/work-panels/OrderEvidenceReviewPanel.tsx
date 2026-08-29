import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isFrontendApiError } from '../../api/errors';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type { StaffOrderEvidence, StaffWorkItem } from '../contracts/runtime';
import {
  isAmbiguousStaffMutationError,
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { staffWorkbenchKeys } from '../queries/keys';
import { describeOrderEvidenceMutationError } from '../shared/staffMutationOutcome';
import { StaffPanelError } from '../shared/StaffPanelError';
import { StaffProtectedImage } from '../shared/StaffProtectedImage';
import { Audit, CustomerContext, Fact, PaneTitle } from './shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;

export function OrderEvidenceReviewPanel({
  item,
  onCompleted,
}: {
  item: StaffWorkItem;
  onCompleted: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority(), []);
  const query = useQuery({
    queryKey: staffWorkbenchKeys.orderEvidence(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi
        .orderEvidence(client, item.source_entity_id, signal)
        .then((r) => r.data.order_evidence),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  // This read-only preflight mirrors the approval command's financial
  // prerequisites.  It is intentionally scoped to the selected evidence
  // item: queue changes must never leave a stale result enabling approval.
  const preflight = useQuery({
    queryKey: staffWorkbenchKeys.orderEvidencePreflight(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi
        .orderEvidencePreflight(client, item.source_entity_id, signal)
        .then((result) => result.data.preflight),
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
      // 此时直接返回任务队列并刷新；不得再读取已完成任务的详情，避免 404
      // 或状态变化把成功显示成失败。
      onCompleted(item);
    },
  });
  const value = query.data;
  const failure = mutation.isError ? describeOrderEvidenceMutationError(mutation.error) : null;
  return (
    <>
      <section className="sp-workpanel-aside">
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
              {preflight.isError ? (
                <Alert tone="warning">
                  无法读取订单审批前检查；为避免生成不完整业务事实，暂不能通过。请刷新订单事实后重试。
                </Alert>
              ) : preflight.data ? (
                preflight.data.ready ? (
                  <div className="staff-pricing-checks">
                    <p className="hint">计价要素（通过时将按以下配置冻结）：</p>
                    <ul>
                      {preflight.data.checks.map((check) => (
                        <li key={check.code}>{check.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <Alert tone="warning">
                    <p>通过前请补齐以下财务配置：</p>
                    <ul>
                      {preflight.data.checks
                        .filter((check) => check.status === 'MISSING')
                        .map((check) => (
                          <li key={check.code}>
                            {check.message}（需要：{check.required_access}）{' '}
                            <a href={check.action_path}>前往处理</a>
                          </li>
                        ))}
                    </ul>
                  </Alert>
                )
              ) : null}
              <div className="entry-actions">
                <Button name="action" value="request-changes" disabled={mutation.isPending}>
                  要求修改
                </Button>
                <Button
                  className="secondary"
                  name="action"
                  value="approve"
                  disabled={
                    mutation.isPending ||
                    preflight.isPending ||
                    preflight.isError ||
                    !preflight.data?.ready
                  }
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

function OrderFacts({ value }: { value: StaffOrderEvidence }): React.JSX.Element {
  return (
    <>
      <Card className="customer-visible">
        <h3>订单资料</h3>
        <Fact label="订单号" value={value.amazon_order_number_normalized} />
        <Fact label="订单日期" value={value.amazon_order_date ?? '未知'} />
        <Fact label="最终支付" value={`${value.final_paid_jpy} JPY`} />
        <StaffProtectedImage
          reference={value.screenshot}
          alt="订单截图"
          className="protected-evidence-thumbnail"
          fallback={<span className="protected-image-placeholder">订单截图加载中</span>}
        />
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
