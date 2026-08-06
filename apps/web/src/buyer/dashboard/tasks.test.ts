import { describe, expect, it } from 'vitest';
import { rankBuyerTasks, type BuyerTask } from './tasks';

const task = (id: string, priority: number, deadline: number | null = null): BuyerTask => ({
  id, priority, deadline, title: id, detail: id, href: `/buyer/${id}`,
});

describe('Module 1 dashboard task ranking', () => {
  it('applies the frozen priority order', () => {
    expect(rankBuyerTasks([task('refund', 7), task('evidence-change', 1), task('review-change', 2)])
      .map((item) => item.id)).toEqual(['evidence-change', 'review-change', 'refund']);
  });

  it('groups equal priority deadlines by earliest deadline', () => {
    expect(rankBuyerTasks([task('later', 3, 200), task('none', 3), task('early', 3, 100)])
      .map((item) => item.id)).toEqual(['early', 'later', 'none']);
  });

  it('deduplicates the same authoritative task id', () => {
    expect(rankBuyerTasks([task('same', 6), task('same', 1)])).toEqual([task('same', 1)]);
  });
});
