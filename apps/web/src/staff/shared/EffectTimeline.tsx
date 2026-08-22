import { formatShanghai } from './format';

export type EffectTimelineEntryState = 'PENDING_CONFIRM' | 'CONFIRMED_WAITING';

export interface EffectTimelineEntry {
  id: string;
  /** Configuration kind label, e.g. 基础汇率 / 默认加点 / 服务费 · 图片评论. */
  kind: string;
  /** Human-readable value label, e.g. +0.004 / ¥12.50 / 0.046. */
  value: string;
  effectiveAt: number;
  state: EffectTimelineEntryState;
}

const STATE_LABELS: Record<EffectTimelineEntryState, string> = {
  PENDING_CONFIRM: '待确认',
  CONFIRMED_WAITING: '已确认待生效',
};

/**
 * Shared effective-time timeline for the finance configuration page and the
 * staff order detail page.  Entries render in chronological order; the
 * earliest already-confirmed future change is highlighted as 下一个变更.
 */
export function EffectTimeline({ entries }: { entries: readonly EffectTimelineEntry[] }): React.JSX.Element {
  if (entries.length === 0) {
    return <p className="staff-effect-timeline-empty">当前没有待确认或待生效的变更。</p>;
  }
  const sorted = [...entries].sort((a, b) => a.effectiveAt - b.effectiveAt);
  const nextChangeId = sorted.find((entry) => entry.state === 'CONFIRMED_WAITING')?.id ?? null;
  return (
    <ol className="staff-effect-timeline" aria-label="生效时间线">
      {sorted.map((entry) => (
        <li
          key={entry.id}
          className={entry.id === nextChangeId ? 'staff-effect-timeline-next' : ''}
        >
          <span className="staff-effect-timeline-kind">{entry.kind}</span>
          <strong className="staff-effect-timeline-value">{entry.value}</strong>
          <span className="staff-effect-timeline-state">{STATE_LABELS[entry.state]}</span>
          <time dateTime={new Date(entry.effectiveAt).toISOString()}>
            生效 {formatShanghai(entry.effectiveAt)}
          </time>
          {entry.id === nextChangeId ? <em className="staff-effect-timeline-badge">下一个变更</em> : null}
        </li>
      ))}
    </ol>
  );
}
