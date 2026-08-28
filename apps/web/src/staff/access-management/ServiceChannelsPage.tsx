import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card, FormField, RequestIdDisplay } from '../../ui/primitives';
import { z } from 'zod';

/**
 * Stage 7.5 batch 2: Owner-only company public service channel settings.
 * Values start empty — no real WeChat ids may be invented here. Updates run
 * through PUT /api/staff/service-channels/:code with idempotency,
 * expected_version and reason.
 */

const channelSchema = z.object({
  code: z.enum(['BUYER_PRE_SALES', 'BUYER_AFTER_SALES']),
  display_name: z.string(),
  wechat_id: z.string().nullable(),
  qr_file_object_id: z.string().nullable(),
  version: z.number().int().positive(),
  updated_at: z.number().int().nonnegative(),
});

const channelsSchema = z.object({
  channels: z.array(channelSchema),
}).strict();

const mutationSchema = z.object({
  channel: channelSchema,
  replayed: z.boolean(),
}).strict();

const CODE_LABELS: Record<'BUYER_PRE_SALES' | 'BUYER_AFTER_SALES', string> = {
  BUYER_PRE_SALES: '售前客服（预约、订单资料阶段）',
  BUYER_AFTER_SALES: '售后客服（评论、返款、正式售后阶段）',
};

export function ServiceChannelsPage(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const isOwner = session.role.code === 'owner' && session.permissions.includes('STAFF_MANAGE');
  const channels = useQuery({
    queryKey: ['staff', 'service-channels'],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: '/api/staff/service-channels',
        method: 'GET',
        schema: channelsSchema,
        signal,
      }).then((response) => response.data),
    retry: false,
  });

  if (!isOwner) {
    return (
      <main className="staff-service-channels">
        <Alert tone="danger">只有总管理员可以修改公司公开客服渠道。</Alert>
      </main>
    );
  }
  return (
    <main className="staff-service-channels">
      <section aria-labelledby="service-channels-title">
        <p className="eyebrow">系统设置 · 仅总管理员</p>
        <h2 id="service-channels-title">公司公开客服渠道</h2>
        <p>
          买家端按业务阶段展示对应渠道；未配置时买家端显示"请联系工作人员"。
          当前没有真实微信号与二维码，初始为空，不得编造。
        </p>
      </section>
      {channels.isPending ? (
        <p role="status">正在读取客服渠道</p>
      ) : channels.isError ? (
        <Alert tone="danger">
          客服渠道读取失败（
          {isFrontendApiError(channels.error) ? channels.error.code : 'NETWORK_FAILURE'}
          ）。
          <Button className="secondary" onClick={() => void channels.refetch()}>
            重试
          </Button>
        </Alert>
      ) : (
        channels.data.channels.map((channel) => (
          <ChannelForm key={channel.code} channel={channel} />
        ))
      )}
    </main>
  );
}

function ChannelForm({
  channel,
}: {
  channel: z.output<typeof channelSchema>;
}): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/service-channels/${encodeURIComponent(channel.code)}`,
        method: 'PUT',
        schema: mutationSchema,
        body: request.body,
        headers: operationHeaders({ key: request.key, body: request.body }),
      }),
    onSuccess: (response) => {
      setMessage(response.data.replayed ? '重复请求：渠道配置保持不变。' : '客服渠道配置已更新。');
      void client.invalidateQueries({ queryKey: ['staff', 'service-channels'] });
    },
  });
  return (
    <Card>
      <h3>{CODE_LABELS[channel.code]}</h3>
      <p>
        当前版本 v{channel.version}；
        {channel.wechat_id === null ? '未配置微信号' : `微信号 ${channel.wechat_id}`}
        {channel.qr_file_object_id === null ? '；未配置二维码' : '；已配置二维码'}
      </p>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          update.mutate({
            body: {
              display_name: String(data.get('display_name')),
              wechat_id: String(data.get('wechat_id') ?? '').trim() || null,
              qr_file_object_id:
                String(data.get('qr_file_object_id') ?? '').trim() || null,
              expected_version: channel.version,
              reason: String(data.get('reason') ?? ''),
            },
            key: crypto.randomUUID(),
          });
        }}
      >
        <FormField label="公开名称" htmlFor={`channel-name-${channel.code}`}>
          <input
            id={`channel-name-${channel.code}`}
            name="display_name"
            defaultValue={channel.display_name}
            required
          />
        </FormField>
        <FormField label="微信号（留空即未配置）" htmlFor={`channel-wechat-${channel.code}`}>
          <input
            id={`channel-wechat-${channel.code}`}
            name="wechat_id"
            defaultValue={channel.wechat_id ?? ''}
          />
        </FormField>
        <FormField
          label="二维码文件 ID（可选，留空即未配置）"
          htmlFor={`channel-qr-${channel.code}`}
        >
          <input
            id={`channel-qr-${channel.code}`}
            name="qr_file_object_id"
            defaultValue={channel.qr_file_object_id ?? ''}
          />
        </FormField>
        <FormField label="变更原因" htmlFor={`channel-reason-${channel.code}`}>
          <input
            id={`channel-reason-${channel.code}`}
            name="reason"
            minLength={3}
            required
          />
        </FormField>
        <Button type="submit" loading={update.isPending}>
          保存渠道配置
        </Button>
      </form>
      {message ? (
        <Alert tone={update.isSuccess ? 'success' : 'info'}>{message}</Alert>
      ) : null}
      {update.isError ? (
        <>
          <Alert tone="danger">
            更新未完成（{isFrontendApiError(update.error) ? update.error.code : 'NETWORK_FAILURE'}）。
          </Alert>
          <RequestIdDisplay
            requestId={isFrontendApiError(update.error) ? update.error.requestId : null}
          />
        </>
      ) : null}
    </Card>
  );
}
