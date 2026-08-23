import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import {
  Alert,
  Button,
  Card,
  FormField,
  Select,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { StaffProtectedImage } from '../shared/StaffProtectedImage';
import type { StaffWorkItem } from '../contracts/runtime';
import { staffWorkbenchKeys } from '../queries/keys';
import { Fact, PanelMutationState } from './shared';

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
        images: z.array(z.object({
          file_object_id: z.string(),
          file_version: z.number().int().positive(),
          client_file_name: z.string(),
        }).strict()).default([]),
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
        main_image_file_object_id: z.string().nullable(),
        review_reason: z.string().nullable(),
        replayed: z.boolean(),
      })
      .strict(),
  })
  .passthrough();

export function ProductApplicationReviewPanel({
  item,
  onCompleted,
}: {
  item: StaffWorkItem;
  onCompleted: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: staffWorkbenchKeys.productApplicationReview(item.source_entity_id),
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
      // 审批命令响应已确认成功；完成后不再读取已完工作项的审核上下文。
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
      onCompleted(item);
    },
  });
  return (
    <section className="staff-workflow-closure staff-work-panel">
      <Card className="sensitive-action">
        <div className="pane-heading">
          <h2>产品申请审核</h2>
          <StatusBadge tone="processing">待处理</StatusBadge>
        </div>
        {query.isPending ? (
          <p role="status">正在加载申请事实</p>
        ) : query.isError ? (
          <Alert tone="danger">申请事实读取失败，请刷新后重试。</Alert>
        ) : (
          <ProductApplicationForm
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

function ProductApplicationForm({
  item,
  value,
  pending,
  error,
  onSubmit,
  onRetry,
}: {
  item: StaffWorkItem;
  value: z.output<typeof productContextSchema>['review_context'];
  pending: boolean;
  error: unknown;
  onSubmit: (body: Record<string, unknown>) => void;
  onRetry: () => void;
}): React.JSX.Element {
  const [mainImageId, setMainImageId] = useState<string | null>(
    value.images[0]?.file_object_id ?? null,
  );
  function approve(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({
      expected_version: value.version,
      decision: 'APPROVE',
      ordering_guide_expected_amount_jpy: Number(data.get('amount')),
      color_spec_mode: String(data.get('color_mode')),
      default_buyer_self_pay_bps: Number(data.get('self_pay_bps')),
      order_interval_days: Number(data.get('interval_days')),
      orders_per_run: Number(data.get('orders_per_run')),
      main_image_file_object_id: mainImageId,
    });
  }
  function reject(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({
      expected_version: value.version,
      decision: 'REJECT',
      rejection_reason: String(data.get('reason')),
    });
  }
  return (
    <>
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
      {value.images.length > 0 ? (
        <fieldset className="form-fieldset">
          <legend>申请图（勾选一张作为正式产品主图）</legend>
          <div className="application-image-picker">
            {value.images.map((image, index) => (
              <label
                key={image.file_object_id}
                className="application-image-option"
              >
                <input
                  type="radio"
                  name={`main-image-${item.work_item_id}`}
                  value={image.file_object_id}
                  checked={mainImageId === image.file_object_id}
                  onChange={() => setMainImageId(image.file_object_id)}
                />
                <span className="application-image-caption">
                  {index === 0 ? '第 1 张（默认）' : `第 ${index + 1} 张`}
                  {' · '}
                  {image.client_file_name}
                </span>
                <StaffProtectedImage
                  reference={{
                    file_object_id: image.file_object_id,
                    file_version: image.file_version,
                    purpose: 'PRODUCT_APPLICATION_IMAGE',
                    visibility: 'SELLER_VISIBLE',
                  }}
                  alt={`申请图 ${index + 1}`}
                  className="application-image-thumb"
                  fallback={<span className="protected-image-fallback-text">图片不可用</span>}
                />
              </label>
            ))}
            <label className="application-image-option">
              <input
                type="radio"
                name={`main-image-${item.work_item_id}`}
                checked={mainImageId === null}
                onChange={() => setMainImageId(null)}
              />
              <span className="application-image-caption">
                暂不设置主图（稍后在产品详情手动上传绑定）
              </span>
            </label>
          </div>
        </fieldset>
      ) : (
        <p className="hint">本申请没有图片；通过后可在产品详情手动上传主图。</p>
      )}
      <form onSubmit={approve}>
        <FormField label="下单参考金额（JPY）" htmlFor={`product-review-amount-${item.work_item_id}`}>
          <TextInput
            id={`product-review-amount-${item.work_item_id}`}
            name="amount"
            type="number"
            min="1"
            step="1"
            defaultValue={value.ordering_guide_expected_amount_jpy ?? ''}
            required
          />
        </FormField>
        <FormField label="颜色规格" htmlFor={`product-review-color-${item.work_item_id}`}>
          <Select
            id={`product-review-color-${item.work_item_id}`}
            name="color_mode"
            defaultValue="ANY_VARIANT"
          >
            <option value="ANY_VARIANT">任意规格</option>
            <option value="MAIN_IMAGE_VARIANT">主图规格</option>
          </Select>
        </FormField>
        <FormField label="买家自付比例（bps，0=0%）" htmlFor={`product-review-bps-${item.work_item_id}`}>
          <TextInput
            id={`product-review-bps-${item.work_item_id}`}
            name="self_pay_bps"
            inputMode="numeric"
            defaultValue="0"
            required
          />
        </FormField>
        <FormField label="下单间隔天数" htmlFor={`product-review-interval-${item.work_item_id}`}>
          <TextInput
            id={`product-review-interval-${item.work_item_id}`}
            name="interval_days"
            inputMode="numeric"
            defaultValue="1"
            required
          />
        </FormField>
        <FormField label="每次下单数" htmlFor={`product-review-orders-${item.work_item_id}`}>
          <TextInput
            id={`product-review-orders-${item.work_item_id}`}
            name="orders_per_run"
            inputMode="numeric"
            defaultValue="1"
            required
          />
        </FormField>
        <Button className="danger" loading={pending}>
          批准并创建正式产品
        </Button>
      </form>
      <form onSubmit={reject}>
        <FormField label="拒绝原因" htmlFor={`product-review-reason-${item.work_item_id}`}>
          <TextInput id={`product-review-reason-${item.work_item_id}`} name="reason" required />
        </FormField>
        <Button className="secondary" disabled={pending}>
          拒绝申请
        </Button>
      </form>
      <MutationState error={error} onRetry={onRetry} />
    </>
  );
}

function MutationState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <>
      <PanelMutationState error={error} />
      {error ? (
        <Button className="secondary" onClick={onRetry}>
          刷新申请事实
        </Button>
      ) : null}
    </>
  );
}
