import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import {
  Alert,
  Button,
  Card,
  FormField,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import type { StaffWorkItem } from '../contracts/runtime';
import { staffWorkbenchKeys } from '../queries/keys';
import { Fact, PanelMutationState } from './shared';

const reservationContextSchema = z
  .object({
    review_context: z
      .object({
        reservation_id: z.string(),
        buyer: z
          .object({
            id: z.string(),
            customer_no: z.string().nullable(),
            name: z.string(),
            wechat: z.string().nullable(),
          })
          .strict(),
        store: z.object({ id: z.string(), display_name: z.string() }).strict(),
        marketplace_code: z.string(),
        status: z.string(),
        version: z.number().int().positive(),
        submitted_at: z.number().int().nonnegative(),
        hold_expires_at: z.number().int().nonnegative(),
        order_deadline_snapshot: z.number().int().nonnegative(),
        buyer_self_pay_bps_snapshot: z.number().int(),
        reference_order_amount_jpy_snapshot: z.string(),
        estimated_self_pay_jpy_snapshot: z.string(),
        estimated_refundable_principal_jpy_snapshot: z.string(),
        demand: z
          .object({
            demand_batch_id: z.string(),
            product_name: z.string(),
            task_type: z.string(),
            reservation_deadline: z.number().int().nonnegative(),
            order_deadline: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .passthrough(),
  })
  .passthrough();

const reservationDecisionSchema = z
  .object({
    reservation_decision: z
      .object({
        reservation_id: z.string(),
        demand_batch_id: z.string(),
        buyer_customer_id: z.string(),
        status: z.enum(['APPROVED', 'REJECTED']),
        version: z.number().int().positive(),
        decision_reason: z.string().nullable(),
        replayed: z.boolean(),
      })
      .strict(),
  })
  .passthrough();

export function ReservationDecisionPanel({
  item,
  onCompleted,
}: {
  item: StaffWorkItem;
  onCompleted: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: staffWorkbenchKeys.reservationReview(item.source_entity_id),
    queryFn: () =>
      identityApiRequest('staff', client, {
        path: `/api/staff/reservations/${encodeURIComponent(item.source_entity_id)}/review-context`,
        method: 'GET',
        schema: reservationContextSchema,
      }).then((r) => r.data.review_context),
    retry: false,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: ({ body, key }: { body: Record<string, unknown>; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/reservations/${encodeURIComponent(item.source_entity_id)}/decision`,
        method: 'POST',
        schema: reservationDecisionSchema,
        body,
        headers: operationHeaders({ body, key }),
      }),
    onSuccess: async () => {
      // 决定命令响应已确认成功；完成后不再读取已完工作项的预约事实。
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
      onCompleted(item);
    },
  });
  return (
    <section className="staff-workflow-closure staff-work-panel">
      <Card className="sensitive-action">
        <div className="pane-heading">
          <h2>预约审核</h2>
          <StatusBadge tone="processing">待处理</StatusBadge>
        </div>
        {query.isPending ? (
          <p role="status">正在加载预约事实</p>
        ) : query.isError ? (
          <Alert tone="danger">预约事实读取失败，请刷新后重试。</Alert>
        ) : (
          <ReservationDecisionForm
            item={item}
            value={query.data}
            pending={mutation.isPending}
            error={mutation.error}
            onSubmit={(body) => mutation.mutate({ body, key: crypto.randomUUID() })}
            onRetry={() => {
              mutation.reset();
              void query.refetch();
            }}
          />
        )}
      </Card>
    </section>
  );
}

function ReservationDecisionForm({
  item,
  value,
  pending,
  error,
  onSubmit,
  onRetry,
}: {
  item: StaffWorkItem;
  value: z.output<typeof reservationContextSchema>['review_context'];
  pending: boolean;
  error: unknown;
  onSubmit: (body: Record<string, unknown>) => void;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <>
      <Fact label="买家姓名" value={value.buyer.name} />
      <Fact label="微信号" value={value.buyer.wechat ?? '未设置'} />
      <Fact label="客户编码" value={value.buyer.customer_no ?? '首次正式订单后生成'} />
      <Fact label="内部买家 ID" value={value.buyer.id} />
      <Fact label="产品" value={value.demand.product_name} />
      <Fact label="店铺" value={value.store.display_name} />
      <Fact label="参考金额" value={`${value.reference_order_amount_jpy_snapshot} JPY`} />
      <Fact label="预计买家自付" value={`${value.estimated_self_pay_jpy_snapshot} JPY`} />
      <Fact label="预计返本金" value={`${value.estimated_refundable_principal_jpy_snapshot} JPY`} />
      <div className="entry-actions">
        <Button
          className="danger"
          loading={pending}
          onClick={() =>
            onSubmit({ expected_version: value.version, decision: 'APPROVE' })
          }
        >
          批准预约并创建下单指引
        </Button>
      </div>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const reason = String(new FormData(event.currentTarget).get('reason'));
          onSubmit({
            expected_version: value.version,
            decision: 'REJECT',
            rejection_reason: reason,
          });
        }}
      >
        <FormField label="拒绝原因" htmlFor={`reservation-reject-reason-${item.work_item_id}`}>
          <TextInput id={`reservation-reject-reason-${item.work_item_id}`} name="reason" required />
        </FormField>
        <Button className="secondary" disabled={pending}>
          拒绝预约
        </Button>
      </form>
      <PanelMutationState error={error} />
      {error ? (
        <Button className="secondary" onClick={onRetry}>
          刷新预约事实
        </Button>
      ) : null}
    </>
  );
}
