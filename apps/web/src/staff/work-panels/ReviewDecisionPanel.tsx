import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  Select,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type { StaffReview, StaffWorkItem } from '../contracts/runtime';
import {
  isAmbiguousStaffMutationError,
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { staffWorkbenchKeys } from '../queries/keys';
import { describeReviewMutationError } from '../shared/staffMutationOutcome';
import { StaffProtectedFileButton } from '../shared/StaffProtectedFileButton';
import { StaffProtectedImage } from '../shared/StaffProtectedImage';
import { Audit, CustomerContext, Fact, PaneTitle } from './shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;

export function ReviewDecisionPanel({
  item,
  onCompleted,
}: {
  item: StaffWorkItem;
  onCompleted: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority(), []);
  const query = useQuery({
    queryKey: staffWorkbenchKeys.review(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi.review(client, item.source_entity_id, signal).then((r) => r.data.review),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
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
      onCompleted(item);
    },
  });
  const value = query.data;
  const failure = mutation.isError ? describeReviewMutationError(mutation.error) : null;
  return (
    <>
      <section className="sp-workpanel-aside">
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
        <ReviewVisibilityObservation item={item} />
        <Audit />
      </aside>
    </>
  );
}

const visibilityObservationSchema = z
  .object({
    observation: z
      .object({
        observation_id: z.string(),
        review_case_id: z.string(),
        formal_order_id: z.string(),
        visibility_status: z.string(),
        note: z.string().nullable(),
        observed_at: z.number().int(),
        actor_staff_id: z.string(),
        created_at: z.number().int(),
      })
      .strict(),
  })
  .strict();

/**
 * 评论可见性观察（D-056 §4.5 保留的业务操作）：只记录 Amazon 当前展示
 * 情况，不修改“当时审核通过”的历史事实；owner / pre_sales 可记录。
 */
function ReviewVisibilityObservation({ item }: { item: StaffWorkItem }): React.JSX.Element | null {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const role = session.role.code;
  const visibility = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/reviews/${encodeURIComponent(item.source_entity_id)}/visibility`,
        method: 'POST',
        schema: visibilityObservationSchema,
        body: request.body,
        headers: operationHeaders({ key: request.key, body: request.body }),
      }),
    onSuccess: () => setMessage('评论当前展示状态已记录；原审核通过结果保持不变。'),
  });
  if (role !== 'owner' && role !== 'pre_sales') return null;
  return (
    <Card>
      <h3>评论展示状态</h3>
      <p>这里只记录 Amazon 当前展示情况，不修改“当时审核通过”的历史事实。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          visibility.mutate({
            body: {
              visibility_status: String(data.get('visibility_status')),
              note: String(data.get('note') ?? '').trim() || null,
              observed_at: Date.now(),
            },
            key: crypto.randomUUID(),
          });
        }}
      >
        <FormField label="当前展示情况" htmlFor={`review-visibility-${item.work_item_id}`}>
          <Select id={`review-visibility-${item.work_item_id}`} name="visibility_status">
            <option value="VISIBLE">正常显示</option>
            <option value="NOT_VISIBLE">一直未显示</option>
            <option value="DROPPED">掉评</option>
            <option value="RECHECK_REQUIRED">待复查</option>
          </Select>
        </FormField>
        <FormField label="备注（可选）" htmlFor={`review-visibility-note-${item.work_item_id}`}>
          <TextInput id={`review-visibility-note-${item.work_item_id}`} name="note" />
        </FormField>
        <Button className="secondary" loading={visibility.isPending}>
          记录展示状态
        </Button>
      </form>
      {message ? <Alert tone="success">{message}</Alert> : null}
      {visibility.isError ? (
        <>
          <Alert tone="danger">
            展示状态记录未完成
            {isFrontendApiError(visibility.error) ? `（错误码：${visibility.error.code}）` : ''}。
          </Alert>
          <RequestIdDisplay
            requestId={isFrontendApiError(visibility.error) ? visibility.error.requestId : null}
          />
        </>
      ) : null}
    </Card>
  );
}

function ReviewFacts({ value }: { value: StaffReview }): React.JSX.Element {
  return (
    <>
      <Card className="customer-visible">
        <h3>评论资料</h3>
        <Fact label="评论类型" value={value.review_type} />
        <Fact label="评论链接" value={value.current_evidence.review_url ?? '无'} />
        <Fact label="买家备注" value={value.current_evidence.buyer_note ?? '无'} />
        {value.current_evidence.files.map((file) => file.mime.startsWith('image/') ? (
          <StaffProtectedImage
            key={file.file_object_id}
            reference={{
              file_object_id: file.file_object_id,
              file_version: file.file_version,
              purpose: file.purpose,
              visibility: file.visibility,
            }}
            alt={file.client_file_name}
            className="protected-evidence-thumbnail"
            fallback={<span className="protected-image-placeholder">图片加载中</span>}
          />
        ) : (
          <StaffProtectedFileButton
            key={file.file_object_id}
            reference={{
              file_object_id: file.file_object_id,
              file_version: file.file_version,
              purpose: file.purpose,
              visibility: file.visibility,
            }}
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
