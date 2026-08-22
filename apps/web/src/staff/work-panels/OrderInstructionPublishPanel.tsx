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

export function OrderInstructionPublishPanel({
  item,
  onCompleted,
}: {
  item: StaffWorkItem;
  onCompleted: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: staffWorkbenchKeys.orderInstruction(item.source_entity_id),
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
      await client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
      onCompleted(item);
    },
  });
  return (
    <section className="staff-workflow-closure staff-work-panel">
      <Card className="sensitive-action">
        <div className="pane-heading">
          <h2>下单指引发布</h2>
          <StatusBadge tone="processing">待处理</StatusBadge>
        </div>
        {query.isPending ? (
          <p role="status">正在加载下单指引</p>
        ) : query.isError ? (
          <Alert tone="danger">下单指引读取失败，请刷新后重试。</Alert>
        ) : (
          <PublishForm
            value={query.data}
            pending={publish.isPending}
            error={publish.error}
            onSubmit={(body) => publish.mutate({ body, key: crypto.randomUUID() })}
            onRetry={() => {
              publish.reset();
              void query.refetch();
            }}
          />
        )}
      </Card>
    </section>
  );
}

function PublishForm({
  value,
  pending,
  error,
  onSubmit,
  onRetry,
}: {
  value: z.output<typeof instructionSchema>['order_instruction'];
  pending: boolean;
  error: unknown;
  onSubmit: (body: Record<string, unknown>) => void;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <>
      <Fact label="指引状态" value={value.status} />
      <Fact label="版本" value={`v${value.version}`} />
      <Alert tone="info">
        发布后，买家任务会显示店铺名称、搜索关键词和必要的下单信息。
      </Alert>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const note = String(new FormData(event.currentTarget).get('note') ?? '').trim();
          onSubmit({
            expected_version: value.version,
            staff_public_note: note || null,
          });
        }}
      >
        <FormField label="买家可见备注（可选）" htmlFor="instruction-public-note">
          <TextInput id="instruction-public-note" name="note" />
        </FormField>
        <Button className="danger" loading={pending}>
          直接发布下单指引
        </Button>
      </form>
      <PanelMutationState error={error} />
      {error ? (
        <Button className="secondary" onClick={onRetry}>
          刷新指引事实
        </Button>
      ) : null}
    </>
  );
}
