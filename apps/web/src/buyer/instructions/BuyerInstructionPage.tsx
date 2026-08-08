import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { BuyerInstructionImageReadIntentAdapter } from '../../files/file-read-providers';
import { Card, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { ProtectedFileButton } from '../shared/ProtectedFileButton';
import { BuyerJourney } from '../shared/BuyerJourney';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerInstructionPage(): React.JSX.Element {
  const { reservationId = '' } = useParams();
  const client = useQueryClient();
  const state = useQuery({
    queryKey: buyerQueryKeys.instructionState(reservationId),
    queryFn: ({ signal }) => buyerApi.instructionState(client, reservationId, signal).then((r) => r.data.order_instruction),
    enabled: reservationId.length > 0,
  });
  const shouldReadContent = state.data?.status === 'ACTIVE';
  const content = useQuery({
    queryKey: buyerQueryKeys.instruction(reservationId, state.data?.current_version_no ?? 0),
    queryFn: ({ signal }) => buyerApi.instruction(client, reservationId, signal).then((r) => r.data.order_instruction),
    enabled: shouldReadContent,
  });

  if (state.isPending) return <BuyerLoading label="正在读取指引状态" />;
  if (state.isError) return <BuyerQueryError error={state.error} />;
  const fact = state.data;
  if (!shouldReadContent) return <section className="buyer-page buyer-flow-page buyer-detail-page">
    <BuyerJourney current="products" />
    <PageHeader eyebrow="下单指引" title={statusLabel(fact.status)}>
      <StatusBadge tone={statusTone(fact.status)}>{statusLabel(fact.status)}</StatusBadge></PageHeader>
    <Card className="buyer-summary-card"><h2>当前状态</h2><p>{instructionStateMessage(fact.status)}</p>
      <DeadlineFacts initial={fact.initial_deadline_at} resubmission={fact.resubmission_deadline_at} /></Card>
  </section>;
  if (content.isPending) return <BuyerLoading label="正在读取指引内容" />;
  if (content.isError) return <BuyerQueryError error={content.error} />;
  const instruction = content.data;
  return <section className="buyer-page buyer-flow-page buyer-detail-page buyer-instruction-page">
    <BuyerJourney current="products" />
    <PageHeader eyebrow="下单指引" title={instruction.product_name} description={instruction.store_display_name}>
      <StatusBadge tone={statusTone(fact.status)}>{statusLabel(fact.status)}</StatusBadge></PageHeader>
    {fact.content_updated ? <Card className="buyer-notice" as="div"><strong>指引内容已更新</strong><p>请按当前版本重新确认。</p></Card> : null}
    <Card className="buyer-summary-card"><h2>下单信息</h2><dl className="buyer-facts"><div><dt>颜色规格</dt><dd>{instruction.color_spec_mode === 'ANY_VARIANT' ? '任意规格' : '按主图规格'}</dd></div>
      <div><dt>参考金额</dt><dd>{formatJpy(instruction.reference_order_amount_jpy)}</dd></div>
      <div><dt>自费比例</dt><dd>{formatBps(instruction.buyer_self_pay_bps)}</dd></div>
      <div><dt>预计自费</dt><dd>{formatJpy(instruction.estimated_buyer_self_pay_jpy)}</dd></div>
      <div><dt>预计可返本金</dt><dd>{formatJpy(instruction.estimated_refundable_principal_jpy)}</dd></div></dl>
      {instruction.staff_public_note ? <p>{instruction.staff_public_note}</p> : null}
      {instruction.buyer_visible_notes ? <p>{instruction.buyer_visible_notes}</p> : null}
      <DeadlineFacts initial={fact.initial_deadline_at} resubmission={fact.resubmission_deadline_at} />
    </Card>
    {fact.can_read_images ? <InstructionImages reservationId={reservationId} instruction={instruction} /> : null}
    <Card className="buyer-action-card"><h2>订单资料</h2><p>{statusLabel(fact.evidence_status)}</p>
      {fact.can_submit_evidence ? <Link className="button" to={`/buyer/order-materials/new?reservation_id=${encodeURIComponent(reservationId)}`}>提交订单资料</Link>
        : <p>当前状态或期限不允许提交。</p>}</Card>
  </section>;
}

function InstructionImages({ reservationId, instruction }: {
  reservationId: string;
  instruction: Awaited<ReturnType<typeof buyerApi.instruction>>['data']['order_instruction'];
}): React.JSX.Element {
  const main = useMemo(() => new BuyerInstructionImageReadIntentAdapter(
    reservationId,
    'main',
    instruction.main_image.read_intent_path,
  ), [reservationId, instruction.main_image.read_intent_path]);
  return <Card className="instruction-images"><h2>商品图片</h2>
    <div className="instruction-image-item"><strong>主图</strong><ProtectedFileButton provider={main} label="查看主图" /></div>
    {instruction.keyword_images.map((item) => <KeywordImage key={item.image_id}
      reservationId={reservationId} image={item} />)}
  </Card>;
}

function KeywordImage({ reservationId, image }: {
  reservationId: string;
  image: Awaited<ReturnType<typeof buyerApi.instruction>>['data']['order_instruction']['keyword_images'][number];
}): React.JSX.Element {
  const provider = useMemo(() => new BuyerInstructionImageReadIntentAdapter(
    reservationId,
    image.position,
    image.read_intent_path,
  ), [reservationId, image.position, image.read_intent_path]);
  return <div className="instruction-image-item"><strong>关键词图片 {image.position}</strong>
    <ProtectedFileButton provider={provider} /></div>;
}

function DeadlineFacts({ initial, resubmission }: { initial: number | null; resubmission: number | null }): React.JSX.Element {
  return <dl className="buyer-facts"><div><dt>初始提交期限</dt><dd>{formatShanghai(initial)}</dd></div>
    <div><dt>修改资料期限</dt><dd>{formatShanghai(resubmission)}</dd></div></dl>;
}

function instructionStateMessage(status: string): string {
  if (status === 'UNPUBLISHED') return '下单指引尚未发布，请稍后查看。';
  if (status === 'EXPIRED') return '下单指引已到期，当前不能继续提交。';
  if (status === 'CANCELLED') return '下单指引已取消。';
  return '当前指引已完成。';
}
