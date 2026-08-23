import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { theoreticalLastOrderDate } from '@ygb/domain';
import { isFrontendApiError } from '../../api/errors';
import type { ApiResult } from '../../api/transport';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type { DemandReviewMutation, StaffWorkItem } from '../contracts/runtime';
import {
  isAmbiguousStaffMutationError,
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { staffWorkbenchKeys } from '../queries/keys';
import { StaffProtectedImage } from '../shared/StaffProtectedImage';
import { formatShanghai } from '../shared/format';
import { describeStaffMutationError } from '../shared/staffMutationOutcome';
import { Audit, CustomerContext, Fact, PaneTitle } from './shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;

export function DemandReviewPanel({
  item,
  onCompleted,
}: {
  item: StaffWorkItem;
  onCompleted: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(
    () => new StaffMutationAuthority<ApiResult<DemandReviewMutation>>(),
    [],
  );
  const [firstOrderDate, setFirstOrderDate] = useState('');
  const query = useQuery({
    queryKey: staffWorkbenchKeys.demandReview(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi
        .demandReviewContext(client, item.source_entity_id, signal)
        .then((r) => r.data.review_context),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ body }, key) =>
            staffApi.reviewDemand(client, item.source_entity_id, body, key),
          ),
    onSuccess: () => {
      // 发布或拒绝成功即结束该工作项：立即返回任务队列并刷新。
      // 不再重读 review-context；已完成的审核事实会被后端拒绝（404），
      // 重读只会把成功显示成失败。
      onCompleted(item);
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
            <Fact
              label="下单参考金额"
              value={value.ordering_guide_expected_amount_jpy === null
                ? '未配置（发布前必须补齐）'
                : `${value.ordering_guide_expected_amount_jpy} JPY`}
            />
            <Fact
              label="颜色规格"
              value={value.color_spec_mode === 'MAIN_IMAGE_VARIANT'
                ? '按主图规格'
                : value.color_spec_mode === 'ANY_VARIANT'
                  ? '任意规格'
                  : '未配置（发布前必须补齐）'}
            />
            <Fact
              label="买家自费比例"
              value={value.buyer_self_pay_bps_snapshot === null
                ? '发布时按产品版本默认冻结'
                : `${(value.buyer_self_pay_bps_snapshot / 100).toFixed(2)}%`}
            />
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
            {value.main_image ? (
              <div className="demand-review-main-image">
                <span className="fact-label">主图（v{value.product_version_no}）</span>
                <StaffProtectedImage
                  alt={`${value.product_name} 主图`}
                  className="demand-review-main-image-thumb"
                  fallback={<span className="protected-image-placeholder">主图加载中</span>}
                  reference={{
                    file_object_id: value.main_image.file_object_id,
                    file_version: value.main_image.file_version,
                    purpose: 'PRODUCT_IMAGE',
                    visibility: 'SELLER_VISIBLE',
                  }}
                />
                <span className="demand-review-main-image-name">
                  {value.main_image.client_file_name}
                </span>
              </div>
            ) : (
              <Alert tone="warning">
                该产品版本未绑定主图，发布会被拦截；请先在产品详情绑定主图。
              </Alert>
            )}
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
                    value={firstOrderDate}
                    onChange={(event) => setFirstOrderDate(event.target.value)}
                  />
                </FormField>
                {firstOrderDate && value.cadence ? (
                  <Alert tone="info">
                    排期预览：首单 {firstOrderDate}；理论最后下单日 {theoreticalLastOrderDate({
                      firstOrderDate,
                      targetQuantity: value.target_quantity,
                      orderIntervalDays: value.cadence.order_interval_days,
                      ordersPerRun: value.cadence.orders_per_run,
                    })}；预约截止 {formatShanghai(value.reservation_deadline)}；下单截止 {formatShanghai(value.order_deadline)}。
                  </Alert>
                ) : null}
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
