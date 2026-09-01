import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card, FormField, RequestIdDisplay, TextInput } from '../../ui/primitives';
import { StaffProtectedImage } from '../shared/StaffProtectedImage';
import { uploadSingleFileMultipart } from '../../files/file-upload-transport';
import {
  completePurposeBoundUploadIntent,
  createPurposeBoundUploadIntent,
} from '../../files/file-upload-api';
import { validateFileSelection } from '../../files/file-descriptor';
import type { FileUploadWorkflow } from '../../files/file-purpose-config';
import { z } from 'zod';

/**
 * Stage 7.5 batch 2 + 7.5R: Owner-only company public service channel settings.
 * Values start empty — no real WeChat ids may be invented here. Basic fields
 * (display name, WeChat id) update via PUT /api/staff/service-channels/:code.
 * The QR travels the controlled file chain: purpose-bound upload intent →
 * content → complete (all verified) → POST .../qr attach. Owners never type a
 * raw internal file id.
 */

const QR_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const QR_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const safeFileReference = z.object({
  file_object_id: z.string(),
  file_version: z.number().int().positive(),
  purpose: z.literal('SERVICE_CHANNEL_QR'),
  visibility: z.literal('BUYER_VISIBLE'),
}).strict();

const channelSchema = z.object({
  code: z.enum(['BUYER_PRE_SALES', 'BUYER_AFTER_SALES']),
  display_name: z.string(),
  wechat_id: z.string().nullable(),
  qr_file: safeFileReference.nullable(),
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
      <main className="sp-settings-page">
        <Alert tone="danger">只有总管理员可以修改公司公开客服渠道。</Alert>
      </main>
    );
  }
  return (
    <main className="sp-settings-page">
      <section aria-labelledby="service-channels-title">
        <p>
          买家端按业务阶段展示对应渠道；未配置时买家端显示"请联系工作人员"。
          当前没有真实微信号与二维码，初始为空，不得编造。二维码通过受控上传通道配置，不能手填文件编号。
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

type StaffChannel = z.output<typeof channelSchema>;

function ChannelForm({ channel }: { channel: StaffChannel }): React.JSX.Element {
  return (
    <Card>
      <h3>{CODE_LABELS[channel.code]}</h3>
      <p>
        当前版本 v{channel.version}；
        {channel.wechat_id === null ? '未配置微信号' : `微信号 ${channel.wechat_id}`}
        {channel.qr_file === null ? '；未配置二维码' : `；已配置二维码（文件 v${channel.qr_file.file_version}）`}
      </p>
      <ChannelSettingsForm channel={channel} />
      <ChannelQrSection channel={channel} />
    </Card>
  );
}

function ChannelSettingsForm({ channel }: { channel: StaffChannel }): React.JSX.Element {
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
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        update.mutate({
          body: {
            display_name: String(data.get('display_name')),
            wechat_id: String(data.get('wechat_id') ?? '').trim() || null,
            expected_version: channel.version,
            reason: String(data.get('reason') ?? ''),
          },
          key: crypto.randomUUID(),
        });
      }}
    >
      <FormField label="公开名称" htmlFor={`channel-name-${channel.code}`}>
        <TextInput
          id={`channel-name-${channel.code}`}
          name="display_name"
          defaultValue={channel.display_name}
          required
        />
      </FormField>
      <FormField label="微信号（留空即未配置）" htmlFor={`channel-wechat-${channel.code}`}>
        <TextInput
          id={`channel-wechat-${channel.code}`}
          name="wechat_id"
          defaultValue={channel.wechat_id ?? ''}
        />
      </FormField>
      <FormField label="变更原因" htmlFor={`channel-reason-${channel.code}`}>
        <TextInput
          id={`channel-reason-${channel.code}`}
          name="reason"
          minLength={3}
          required
        />
      </FormField>
      <Button type="submit" loading={update.isPending}>
        保存渠道配置
      </Button>
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
    </form>
  );
}

/**
 * Stage 7.5R: QR attach runs the controlled chain — purpose-bound intent →
 * content → complete(verified) → attach — mirroring the order communication
 * screenshot flow. Clearing attaches null with the current file version so the
 * server can revoke the old link.
 */
function ChannelQrSection({ channel }: { channel: StaffChannel }): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const workflow: FileUploadWorkflow = {
    identity: 'staff',
    intentPath: '/api/staff/file-uploads/service-channel-qr/intents',
    lifecyclePrefix: '/api/staff',
    purpose: 'SERVICE_CHANNEL_QR',
    visibility: 'BUYER_VISIBLE',
    maximumFileCount: 1,
    maximumByteSize: QR_UPLOAD_LIMIT_BYTES,
    allowedMimes: QR_ALLOWED_MIMES,
  };

  const attach = useMutation({
    mutationFn: async (input: { file: File | null; reason: string }) => {
      const idempotencyKey = crypto.randomUUID();
      let fileObjectId: string | null = null;
      let fileVersion = 0;
      if (input.file !== null) {
        const selection = validateFileSelection(workflow, [input.file])[0]!;
        const intent = await createPurposeBoundUploadIntent({
          client,
          workflow,
          files: [selection],
          idempotencyKey,
          signal: new AbortController().signal,
        });
        const slot = intent.data.uploads[0]!;
        const uploaded = await uploadSingleFileMultipart({
          client,
          identity: 'staff',
          lifecyclePrefix: '/api/staff',
          intentId: intent.data.upload_intent_id,
          fileObjectId: slot.file_object_id,
          file: selection.file,
          uploadToken: slot.upload_token ?? '',
          idempotencyKey: crypto.randomUUID(),
          signal: new AbortController().signal,
          onProgress: () => undefined,
        });
        const completed = await completePurposeBoundUploadIntent({
          client,
          workflow,
          intentId: intent.data.upload_intent_id,
          expectedVersion: intent.data.version,
          uploadedReceipts: new Map([
            [
              slot.file_object_id,
              {
                detectedMime: uploaded.data.detected_mime,
                byteSize: uploaded.data.byte_size,
                sha256: uploaded.data.sha256,
                uploadedVersion: uploaded.data.version,
              },
            ],
          ]),
          idempotencyKey: crypto.randomUUID(),
          signal: new AbortController().signal,
        });
        const verified = completed.data.files[0]!;
        fileObjectId = verified.file_object_id;
        fileVersion = verified.version;
      } else if (channel.qr_file !== null) {
        fileObjectId = null;
        fileVersion = channel.qr_file.file_version;
      } else {
        throw new Error('QR_NOT_CONFIGURED');
      }
      const body = {
        file_object_id: fileObjectId,
        expected_file_version: fileVersion,
        expected_version: channel.version,
        reason: input.reason,
      };
      return identityApiRequest('staff', client, {
        path: `/api/staff/service-channels/${encodeURIComponent(channel.code)}/qr`,
        method: 'POST',
        schema: mutationSchema,
        body,
        headers: operationHeaders({ key: idempotencyKey, body }),
      });
    },
    onSuccess: (response) => {
      setQrError(null);
      setMessage(response.data.replayed ? '重复请求：二维码配置保持不变。' : '渠道二维码已更新。');
      void client.invalidateQueries({ queryKey: ['staff', 'service-channels'] });
    },
    onError: (error) => {
      setMessage(null);
      setQrError(
        `二维码上传未完成${
          isFrontendApiError(error) ? `（${error.code}）` : ''
        }，请重试。`,
      );
    },
  });

  function onPick(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!QR_ALLOWED_MIMES.includes(file.type as (typeof QR_ALLOWED_MIMES)[number])) {
      setQrError('仅支持 JPG、PNG 或 WebP 图片。');
      return;
    }
    if (file.size > QR_UPLOAD_LIMIT_BYTES) {
      setQrError('图片超过 5 MiB，请压缩后重试。');
      return;
    }
    setQrError(null);
    setMessage(null);
    setPendingFile(file);
  }

  function confirmAttach(reason: string): void {
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    attach.mutate({ file, reason });
  }

  function confirmClear(reason: string): void {
    attach.mutate({ file: null, reason });
  }

  return (
    <section className="channel-qr-section" aria-label={`${CODE_LABELS[channel.code]}二维码`}>
      <h4>客服二维码{channel.qr_file === null ? '（未配置）' : ''}</h4>
      {channel.qr_file !== null ? (
        <figure className="channel-qr-preview">
          <StaffProtectedImage
            reference={channel.qr_file}
            alt={`${channel.display_name}二维码`}
            className="channel-qr-image"
            fallback={<span className="protected-image-placeholder" aria-hidden="true">—</span>}
          />
          <figcaption>当前二维码（文件 v{channel.qr_file.file_version}）</figcaption>
        </figure>
      ) : (
        <p>买家端未配置二维码时不展示二维码图。</p>
      )}
      <QrAttachForm
        channel={channel}
        pendingFile={pendingFile}
        busy={attach.isPending}
        onPick={() => fileInput.current?.click()}
        onCancelPick={() => setPendingFile(null)}
        onConfirmAttach={confirmAttach}
        onClear={channel.qr_file !== null ? confirmClear : null}
      />
      {message ? <Alert tone="success">{message}</Alert> : null}
      {qrError ? <Alert tone="danger">{qrError}</Alert> : null}
      {attach.isError && isFrontendApiError(attach.error) ? (
        <RequestIdDisplay requestId={attach.error.requestId} />
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept={QR_ALLOWED_MIMES.join(',')}
        className="visually-hidden"
        onChange={onPick}
        aria-hidden="true"
        tabIndex={-1}
      />
    </section>
  );
}

function QrAttachForm({
  channel,
  pendingFile,
  busy,
  onPick,
  onCancelPick,
  onConfirmAttach,
  onClear,
}: {
  channel: StaffChannel;
  pendingFile: File | null;
  busy: boolean;
  onPick: () => void;
  onCancelPick: () => void;
  onConfirmAttach: (reason: string) => void;
  onClear: ((reason: string) => void) | null;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const reasonReady = reason.trim().length >= 3;
  return (
    <div className="channel-qr-form">
      {pendingFile !== null ? (
        <p role="status">
          已选择文件：{pendingFile.name}（{Math.ceil(pendingFile.size / 1024)} KiB）
        </p>
      ) : null}
      <FormField label="变更原因" htmlFor={`channel-qr-reason-${channel.code}`}>
        <TextInput
          id={`channel-qr-reason-${channel.code}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={3}
          required
        />
      </FormField>
      <div className="entry-actions">
        <Button type="button" className="secondary" onClick={onPick} disabled={busy}>
          {pendingFile === null ? '选择二维码图片' : '重新选择'}
        </Button>
        {pendingFile !== null ? (
          <>
            <Button
              type="button"
              loading={busy}
              disabled={!reasonReady}
              onClick={() => onConfirmAttach(reason.trim())}
            >
              上传并启用二维码
            </Button>
            <Button type="button" className="secondary" onClick={onCancelPick} disabled={busy}>
              取消
            </Button>
          </>
        ) : null}
        {onClear !== null && pendingFile === null ? (
          <Button
            type="button"
            className="danger"
            disabled={busy || !reasonReady}
            onClick={() => onClear(reason.trim())}
          >
            清除二维码
          </Button>
        ) : null}
      </div>
      <p className="staff-hint">图片上传后需通过系统校验才能启用；清除会解除当前二维码，买家端立即停止展示。</p>
    </div>
  );
}
