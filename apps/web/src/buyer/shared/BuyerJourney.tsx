import { Link } from 'react-router';

/**
 * 买家端真实进度旅程条（P6）：按预约/订单/评论/返款的真实状态点亮
 * 六步（已预约→待下单→待提交资料→审核中→待评论→返款中），当前步高亮，
 * 可选"下一步"动作按钮，减少买家在微信里问"我现在该干嘛"。
 * settled=true（返款已结清）时全部点亮。
 */
const steps = [
  { id: 'reserved', label: '已预约' },
  { id: 'ordering', label: '待下单' },
  { id: 'evidence', label: '待提交资料' },
  { id: 'verifying', label: '审核中' },
  { id: 'review', label: '待评论' },
  { id: 'refund', label: '返款中' },
] as const;

export type BuyerJourneyStep = typeof steps[number]['id'];

export function BuyerJourney({
  current,
  settled = false,
  action,
}: {
  current: BuyerJourneyStep | null;
  settled?: boolean;
  action?: { label: string; to: string } | null;
}): React.JSX.Element {
  const currentIndex = current === null
    ? -1
    : steps.findIndex((step) => step.id === current);
  return <section className="buyer-journey buyer-journey-compact" aria-label="业务流程">
    <ol>{steps.map((step, index) => {
      const reached = settled || (currentIndex >= 0 && index <= currentIndex);
      const isCurrent = !settled && current !== null && index === currentIndex;
      return <li key={step.id}
      className={reached && !isCurrent ? 'is-done' : undefined}
      aria-current={isCurrent ? 'step' : undefined}>
      <span>{index + 1}</span>
      <strong>{step.label}</strong>
    </li>;
    })}</ol>
    {settled ? <p className="buyer-journey-note">返款已完成，本次测评流程结束。</p> : null}
    {action ? <p className="buyer-journey-action"><Link to={action.to}>{action.label}</Link></p> : null}
  </section>;
}

/** 预约状态 → 旅程步：待审核=已预约，已批准=待下单，其余不可点亮。 */
export function reservationJourneyStep(status: string): BuyerJourneyStep | null {
  if (status === 'PENDING_REVIEW') return 'reserved';
  if (status === 'APPROVED') return 'ordering';
  return null;
}

/** 订单资料状态 → 旅程步：审核中=审核中，要求修改=待提交资料，通过=待评论。 */
export function evidenceJourneyStep(status: string): BuyerJourneyStep {
  if (status === 'PENDING_VERIFICATION') return 'verifying';
  if (status === 'VERIFIED') return 'review';
  return 'evidence';
}

/** 评论状态 → 旅程步：审核中/要求修改=待评论，通过=返款中。 */
export function reviewJourneyStep(status: string): BuyerJourneyStep {
  if (status === 'APPROVED') return 'refund';
  return 'review';
}
