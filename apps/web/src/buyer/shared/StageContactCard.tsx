import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buyerApi } from '../api/client';
import {
  type BuyerServiceChannel,
} from '../contracts/runtime';
import { Card } from '../../ui/primitives';
import { ProtectedImage } from './ProtectedImage';

/**
 * Stage 7.5 batch 2 + 7.5R: the single stage contact card for the whole
 * buyer portal. STAGE_FOR_ROUTE is the one authoritative stage map — every
 * page imports it instead of re-deciding pre-sales vs after-sales locally.
 *
 * Values are backend projections: the fixed owner's public display name and
 * the company service channel config. An unconfigured channel falls back to
 * safe guidance text. The QR renders through the controlled buyer
 * read-intent chain (SafeFileReference) and never a bare internal file id;
 * no staff emails/ids/permissions ever appear.
 */

export type ContactStage = 'PRE_SALES' | 'AFTER_SALES';

/** Route families that carry a stage contact card. */
export const ROUTE_FAMILIES = [
  '/buyer/reservations',
  '/buyer/order-materials',
  '/buyer/orders',
  '/buyer/reviews',
  '/buyer/refunds',
] as const;

export type RouteFamily = (typeof ROUTE_FAMILIES)[number];

/** The authoritative route-family → stage mapping for the buyer portal. */
export const STAGE_FOR_ROUTE: Record<RouteFamily, ContactStage> = Object.freeze({
  // 售前：预约、订单资料、下单指引——尚未形成正式订单的阶段。
  '/buyer/reservations': 'PRE_SALES',
  '/buyer/order-materials': 'PRE_SALES',
  // 售后：正式订单、评论、买家返款——已进入订单履行与返款阶段。
  '/buyer/orders': 'AFTER_SALES',
  '/buyer/reviews': 'AFTER_SALES',
  '/buyer/refunds': 'AFTER_SALES',
} satisfies Record<RouteFamily, ContactStage>);

const STAGE_LABELS: Record<ContactStage, string> = Object.freeze({
  PRE_SALES: '售前联系人',
  AFTER_SALES: '售后联系人',
});

export function StageContactCard({ stage }: { stage: ContactStage }): React.JSX.Element {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: ['buyer', 'me'],
    queryFn: ({ signal }) =>
      buyerApi.me(client, signal).then((response) => response.data),
    staleTime: 60_000,
    retry: false,
  });
  const channels = useQuery({
    queryKey: ['buyer', 'service-channels'],
    queryFn: ({ signal }) =>
      buyerApi.serviceChannels(client, signal).then((response) => response.data),
    staleTime: 60_000,
    retry: false,
  });
  const code = stage === 'PRE_SALES' ? 'BUYER_PRE_SALES' : 'BUYER_AFTER_SALES';
  const channel: BuyerServiceChannel | undefined = channels.data?.channels.find(
    (candidate) => candidate.code === code,
  );
  const ownerName = stage === 'PRE_SALES'
    ? me.data?.assigned_contacts?.pre_sales_owner_display_name ?? null
    : me.data?.assigned_contacts?.refund_owner_display_name ?? null;
  const fallbackText = '请联系工作人员';
  return (
    <Card className="stage-contact-card" aria-label={STAGE_LABELS[stage]}>
      <h3>{STAGE_LABELS[stage]}</h3>
      <dl>
        <dt>当前负责工作人员</dt>
        <dd>{ownerName ?? fallbackText}</dd>
        <dt>客服渠道</dt>
        <dd>
          {channel === undefined
            ? fallbackText
            : channel.wechat_id === null
              ? `${channel.display_name}：${fallbackText}`
              : `${channel.display_name}：${channel.wechat_id}`}
        </dd>
      </dl>
      {channel?.qr_file ? (
        <figure className="stage-contact-qr">
          <ProtectedImage
            reference={channel.qr_file}
            alt={`${channel.display_name}二维码`}
            className="stage-contact-qr-image"
            fallback={<span className="stage-contact-qr-fallback">二维码加载中</span>}
          />
          <figcaption>扫二维码添加{channel.display_name}</figcaption>
        </figure>
      ) : null}
      <p className="stage-contact-note">
        遇到问题可先联系当前负责工作人员；渠道未配置时我们的工作人员会主动与您联系。
      </p>
    </Card>
  );
}
