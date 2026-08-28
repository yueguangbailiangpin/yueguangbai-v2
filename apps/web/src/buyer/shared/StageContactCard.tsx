import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { buyerApi } from '../api/client';
import { Card } from '../../ui/primitives';

/**
 * Stage 7.5 batch 2: the buyer-side stage contact card. The stage decides
 * which fixed owner and which company channel to show:
 * - PRE_SALES on reservations and order materials,
 * - AFTER_SALES on orders, reviews and refunds.
 * Values are backend projections (owner public display name + public channel
 * config). When the channel is unconfigured the card falls back to guidance
 * text and never leaks staff emails, ids or any internal field.
 */

const STAGE_LABELS: Record<Stage, string> = {
  PRE_SALES: '售前联系人',
  AFTER_SALES: '售后联系人',
};

type Stage = 'PRE_SALES' | 'AFTER_SALES';

interface ChannelRow {
  code: 'BUYER_PRE_SALES' | 'BUYER_AFTER_SALES';
  display_name: string;
  wechat_id: string | null;
  qr_file_object_id: string | null;
}

export function StageContactCard({ stage }: { stage: Stage }): React.JSX.Element {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ['buyer', 'me'],
    queryFn: ({ signal }) => buyerApi.me(client, signal).then((response) => response.data),
    staleTime: 60_000,
    retry: false,
  });
  const ownerDisplayName = stage === 'PRE_SALES'
    ? me.data?.assigned_contacts?.pre_sales_owner_display_name
    : me.data?.assigned_contacts?.refund_owner_display_name;
  const channels = useQuery({
    queryKey: ['buyer', 'service-channels'],
    queryFn: ({ signal }) =>
      buyerApi.serviceChannels(client, signal).then((response) => response.data),
    staleTime: 60_000,
    retry: false,
  });
  const code = stage === 'PRE_SALES' ? 'BUYER_PRE_SALES' : 'BUYER_AFTER_SALES';
  const channel: ChannelRow | undefined = channels.data?.channels.find(
    (candidate) => candidate.code === code,
  );
  const ownerName = ownerDisplayName ?? null;
  return (
    <Card className="stage-contact-card" aria-label={STAGE_LABELS[stage]}>
      <h3>{STAGE_LABELS[stage]}</h3>
      <dl>
        <dt>当前负责工作人员</dt>
        <dd>{ownerName ?? '请联系工作人员'}</dd>
        <dt>客服渠道</dt>
        <dd>
          {channel === undefined
            ? '请联系工作人员'
            : channel.wechat_id === null
              ? `${channel.display_name}：请联系工作人员`
              : `${channel.display_name}：${channel.wechat_id}`}
        </dd>
      </dl>
      <p className="stage-contact-note">
        遇到问题可先联系当前负责工作人员；渠道未配置时我们的工作人员会主动与您联系。
      </p>
    </Card>
  );
}
