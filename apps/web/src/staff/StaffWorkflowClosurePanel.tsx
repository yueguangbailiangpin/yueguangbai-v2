import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { isFrontendApiError } from '../api/errors';
import { identityApiRequest } from '../api/identity-request';
import { operationHeaders } from '../api/idempotency';
import { Alert, Button, Card, FormField, Select, StatusBadge, TextInput } from '../ui/primitives';
import { staffWorkbenchKeys } from './queries/keys';

const workItemSchema = z
  .object({
    work_item: z
      .object({
        work_item_id: z.string(),
        work_type: z.enum([
          'PRODUCT_APPLICATION_REVIEW',
          'DEMAND_REVIEW',
          'RESERVATION_DECISION',
          'ORDER_INSTRUCTION_PUBLISH',
          'ORDER_EVIDENCE_REVIEW',
          'REVIEW_DECISION',
          'BUYER_REFUND_PROCESSING',
        ]),
        source_entity_id: z.string(),
        status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED']),
      })
      .passthrough(),
  })
  .passthrough();

const productContextSchema = z
  .object({
    review_context: z
      .object({
        application_id: z.string(),
        store: z.object({ id: z.string(), display_name: z.string() }).strict(),
        marketplace_code: z.string(),
        asin: z.string(),
        product_name: z.string(),
        search_keywords: z.array(z.string()),
        product_url: z.string().nullable(),
        buyer_visible_notes: z.string().nullable(),
        seller_notes: z.string().nullable(),
        ordering_guide_expected_amount_jpy: z.string().nullable(),
        status: z.string(),
        version: z.number().int().positive(),
        submitted_at: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough();

const productDecisionSchema = z
  .object({
    product_application_review: z
      .object({
        application_id: z.string(),
        status: z.enum(['APPROVED', 'REJECTED']),
        application_version: z.number().int().positive(),
        product_id: z.string().nullable(),
        product_version_id: z.string().nullable(),
        review_reason: z.string().nullable(),
        replayed: z.boolean(),
      })
      .strict(),
  })
  .passthrough();

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

const instructionSchema = z
  .object({
    order_instruction: z
      .object({
        instruction_id: z.string(),
        reservation_id: z.string(),
        status: z.string(),
        current_version_no: z.number().int().nonnegative(),
        version: z.number().int().positive(),
        published_at: z.number().int().nonnegative().nullable(),
        initial_deadline_at: z.number().int().nonnegative().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const publicationSchema = z
  .object({
    publication: z
      .object({
        instruction: z
          .object({
            instruction_id: z.string(),
            status: z.string(),
            version: z.number().int().positive(),
          })
          .passthrough(),
        instruction_version_id: z.string(),
        content_hash: z.string(),
        replayed: z.boolean(),
        unchanged: z.boolean(),
      })
      .strict(),
  })
  .passthrough();

type WorkItem = z.output<typeof workItemSchema>['work_item'];

export function StaffWorkflowClosurePanel(): React.JSX.Element | null {
  const client = useQueryClient();
  const params = useParams();
  const [search] = useSearchParams();
  const workItemId = params['id'] ?? search.get('work_item');
  const item = useQuery({
    queryKey: ['staff-workflow-closure', 'work-item', workItemId],
    enabled: Boolean(workItemId),
    queryFn: () =>
      identityApiRequest('staff', client, {
        path: `/api/staff/me/work-items/${encodeURIComponent(workItemId!)}`,
        method: 'GET',
        schema: workItemSchema,
      }).then((response) => response.data.work_item),
    retry: false,
    staleTime: 0,
  });
  if (!workItemId || item.isPending || item.isError || !item.data || item.data.status !== 'OPEN')
    return null;
  if (item.data.work_type === 'PRODUCT_APPLICATION_REVIEW')
    return <ProductApplicationReview item={item.data} />;
  if (item.data.work_type === 'RESERVATION_DECISION')
    return <ReservationDecision item={item.data} />;
  if (item.data.work_type === 'ORDER_INSTRUCTION_PUBLISH')
    return <OrderInstructionPublish item={item.data} />;
  return null;
}

function ProductApplicationReview({ item }: { item: WorkItem }): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['staff-workflow-closure', 'product', item.source_entity_id],
    queryFn: () =>
      identityApiRequest('staff', client, {
        path: `/api/staff/product-applications/${encodeURIComponent(item.source_entity_id)}/review-context`,
        method: 'GET',
        schema: productContextSchema,
      }).then((r) => r.data.review_context),
    retry: false,
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: ({ body, key }: { body: Record<string, unknown>; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/product-applications/${encodeURIComponent(item.source_entity_id)}/review`,
        method: 'POST',
        schema: productDecisionSchema,
        body,
        headers: operationHeaders({ body, key }),
      }),
    onSuccess: async () => {
      client.setQueryData<WorkItem>(
        ['staff-workflow-closure', 'work-item', item.work_item_id],
        (current) => current ? { ...current, status: 'COMPLETED' } : current,
      );
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
    },
  });
  if (query.isPending)
    return (
      <ClosureCard title="产品申请审核">
        <p role="status">正在加载申请事实</p>
      </ClosureCard>
    );
  if (query.isError)
    return (
      <ClosureCard title="产品申请审核">
        <Alert tone="danger">申请事实读取失败，请刷新后重试。</Alert>
      </ClosureCard>
    );
  const value = query.data;
  function approve(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      key: crypto.randomUUID(),
      body: {
        expected_version: value.version,
        decision: 'APPROVE',
        ordering_guide_expected_amount_jpy: Number(data.get('amount')),
        color_spec_mode: String(data.get('color_mode')),
        default_buyer_self_pay_bps: Number(data.get('self_pay_bps')),
        order_interval_days: Number(data.get('interval_days')),
        orders_per_run: Number(data.get('orders_per_run')),
      },
    });
  }
  function reject(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      key: crypto.randomUUID(),
      body: {
        expected_version: value.version,
        decision: 'REJECT',
        rejection_reason: String(data.get('reason')),
      },
    });
  }
  return (
    <ClosureCard title="产品申请审核">
      <Fact label="产品" value={`${value.product_name} · ${value.asin}`} />
      <Fact label="店铺" value={value.store.display_name} />
      <Fact label="搜索词" value={value.search_keywords.join('、') || '未填写'} />
      <Fact
        label="卖家填写金额"
        value={value.ordering_guide_expected_amount_jpy === null
          ? '历史申请未填写'
          : `${value.ordering_guide_expected_amount_jpy} JPY`}
      />
      <Fact label="卖家备注" value={value.seller_notes ?? '无'} />
      <form onSubmit={approve}>
        <FormField label="下单参考金额（JPY）" htmlFor="product-review-amount">
          <TextInput
            id="product-review-amount"
            name="amount"
            type="number"
            min="1"
            step="1"
            defaultValue={value.ordering_guide_expected_amount_jpy ?? ''}
            required
          />
        </FormField>
        <FormField label="颜色规格" htmlFor="product-review-color">
          <Select id="product-review-color" name="color_mode" defaultValue="ANY_VARIANT">
            <option value="ANY_VARIANT">任意规格</option>
            <option value="MAIN_IMAGE_VARIANT">主图规格</option>
          </Select>
        </FormField>
        <FormField label="买家自付比例（bps，0=0%）" htmlFor="product-review-bps">
          <TextInput
            id="product-review-bps"
            name="self_pay_bps"
            inputMode="numeric"
            defaultValue="0"
            required
          />
        </FormField>
        <FormField label="下单间隔天数" htmlFor="product-review-interval">
          <TextInput
            id="product-review-interval"
            name="interval_days"
            inputMode="numeric"
            defaultValue="1"
            required
          />
        </FormField>
        <FormField label="每次下单数" htmlFor="product-review-orders">
          <TextInput
            id="product-review-orders"
            name="orders_per_run"
            inputMode="numeric"
            defaultValue="1"
            required
          />
        </FormField>
        <Button className="danger" loading={mutation.isPending}>
          批准并创建正式产品
        </Button>
      </form>
      <form onSubmit={reject}>
        <FormField label="拒绝原因" htmlFor="product-review-reason">
          <TextInput id="product-review-reason" name="reason" required />
        </FormField>
        <Button className="secondary" disabled={mutation.isPending}>
          拒绝申请
        </Button>
      </form>
      <MutationState mutation={mutation} />
    </ClosureCard>
  );
}

function ReservationDecision({ item }: { item: WorkItem }): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['staff-workflow-closure', 'reservation', item.source_entity_id],
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
      client.setQueryData<WorkItem>(
        ['staff-workflow-closure', 'work-item', item.work_item_id],
        (current) => current ? { ...current, status: 'COMPLETED' } : current,
      );
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
    },
  });
  if (query.isPending)
    return (
      <ClosureCard title="预约审核">
        <p role="status">正在加载预约事实</p>
      </ClosureCard>
    );
  if (query.isError)
    return (
      <ClosureCard title="预约审核">
        <Alert tone="danger">预约事实读取失败，请刷新后重试。</Alert>
      </ClosureCard>
    );
  const value = query.data;
  return (
    <ClosureCard title="预约审核">
      <Fact label="买家姓名" value={value.buyer.name} />
      <Fact label="微信号" value={value.buyer.wechat ?? '未设置'} />
      <Fact label="买家编号" value={value.buyer.customer_no ?? '首次正式订单后生成'} />
      <Fact label="内部买家 ID" value={value.buyer.id} />
      <Fact label="产品" value={value.demand.product_name} />
      <Fact label="店铺" value={value.store.display_name} />
      <Fact label="参考金额" value={`${value.reference_order_amount_jpy_snapshot} JPY`} />
      <Fact label="预计买家自付" value={`${value.estimated_self_pay_jpy_snapshot} JPY`} />
      <Fact label="预计返本金" value={`${value.estimated_refundable_principal_jpy_snapshot} JPY`} />
      <div className="entry-actions">
        <Button
          className="danger"
          loading={mutation.isPending}
          onClick={() =>
            mutation.mutate({
              key: crypto.randomUUID(),
              body: { expected_version: value.version, decision: 'APPROVE' },
            })
          }
        >
          批准预约并创建下单指引
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const reason = String(new FormData(event.currentTarget).get('reason'));
          mutation.mutate({
            key: crypto.randomUUID(),
            body: { expected_version: value.version, decision: 'REJECT', rejection_reason: reason },
          });
        }}
      >
        <FormField label="拒绝原因" htmlFor="reservation-reject-reason">
          <TextInput id="reservation-reject-reason" name="reason" required />
        </FormField>
        <Button className="secondary" disabled={mutation.isPending}>
          拒绝预约
        </Button>
      </form>
      <MutationState mutation={mutation} />
    </ClosureCard>
  );
}

function OrderInstructionPublish({ item }: { item: WorkItem }): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['staff-workflow-closure', 'instruction', item.source_entity_id],
    queryFn: () =>
      identityApiRequest('staff', client, {
        path: `/api/staff/order-instructions/${encodeURIComponent(item.source_entity_id)}`,
        method: 'GET',
        schema: instructionSchema,
      }).then((r) => r.data.order_instruction),
    retry: false,
    staleTime: 0,
  });
  const publish = useMutation({
    mutationFn: ({ body, key }: { body: Record<string, unknown>; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/order-instructions/${encodeURIComponent(item.source_entity_id)}/publish`,
        method: 'POST',
        schema: publicationSchema,
        body,
        headers: operationHeaders({ body, key }),
    }),
    onSuccess: async () => {
      client.setQueryData<WorkItem>(
        ['staff-workflow-closure', 'work-item', item.work_item_id],
        (current) => current ? { ...current, status: 'COMPLETED' } : current,
      );
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
    },
  });
  if (query.isPending)
    return (
      <ClosureCard title="下单指引发布">
        <p role="status">正在加载下单指引</p>
      </ClosureCard>
    );
  if (query.isError)
    return (
      <ClosureCard title="下单指引发布">
        <Alert tone="danger">下单指引读取失败，请刷新后重试。</Alert>
      </ClosureCard>
    );
  const value = query.data;
  return (
    <ClosureCard title="下单指引发布">
      <Fact label="指引状态" value={value.status} />
      <Fact label="版本" value={`v${value.version}`} />
      <Alert tone="info">
        发布后，买家任务会显示店铺名称、搜索关键词和必要的下单信息。
      </Alert>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const note = String(new FormData(event.currentTarget).get('note') ?? '').trim();
          publish.mutate({
            key: crypto.randomUUID(),
            body: {
              expected_version: value.version,
              staff_public_note: note || null,
            },
          });
        }}
      >
        <FormField label="买家可见备注（可选）" htmlFor="instruction-public-note">
          <TextInput id="instruction-public-note" name="note" />
        </FormField>
        <Button className="danger" loading={publish.isPending}>
          直接发布下单指引
        </Button>
      </form>
      <MutationState mutation={publish} />
    </ClosureCard>
  );
}

function ClosureCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="staff-workflow-closure">
      <Card className="sensitive-action">
        <div className="pane-heading">
          <h2>{title}</h2>
          <StatusBadge tone="processing">闭环操作</StatusBadge>
        </div>
        {children}
      </Card>
    </section>
  );
}
function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <p>
      <strong>{label}：</strong>
      {value}
    </p>
  );
}
function MutationState({
  mutation,
}: {
  mutation: { isError: boolean; isSuccess: boolean; error?: unknown };
}): React.JSX.Element | null {
  if (mutation.isError) {
    if (isFrontendApiError(mutation.error)) {
      const request = mutation.error.requestId ? `；请求编号：${mutation.error.requestId}` : '';
      return (
        <Alert tone="danger">
          操作失败（错误码：{mutation.error.code}{request}）。请按提示检查后重试。
        </Alert>
      );
    }
    return <Alert tone="danger">操作失败（错误码：UNKNOWN）。请刷新后重试。</Alert>;
  }
  if (mutation.isSuccess) return <Alert tone="success">操作已提交并按服务器规则完成。</Alert>;
  return null;
}
