const steps = [
  { id: 'products', label: '产品' },
  { id: 'materials', label: '订单资料' },
  { id: 'reviews', label: '评论' },
  { id: 'complete', label: '完成' },
] as const;

export type BuyerJourneyStep = typeof steps[number]['id'];

export function BuyerJourney({ current }: { current: BuyerJourneyStep | null }): React.JSX.Element {
  return <section className="buyer-journey buyer-journey-compact" aria-label="业务流程">
    <ol>{steps.map((step, index) => <li key={step.id}
      aria-current={current === step.id ? 'step' : undefined}>
      <span>{index + 1}</span><strong>{step.label}</strong>
    </li>)}</ol>
  </section>;
}
