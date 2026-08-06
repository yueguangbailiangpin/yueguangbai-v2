import { describe, expect, it } from 'vitest';
import { rankBuyerTasks, type BuyerTask } from './tasks';

const task = (taskId: string, priority: number, deadline: number | null = null, businessObjectKey = taskId): BuyerTask => ({
  taskId, businessObjectKey, priority, deadline, title: taskId, detail: taskId, href: `/buyer/${taskId}`,
});

describe('Module 1 dashboard task ranking', () => {
  it('applies the frozen priority order', () => {
    expect(rankBuyerTasks([task('refund', 7), task('evidence-change', 1), task('review-change', 2)])
      .map((item) => item.taskId)).toEqual(['evidence-change', 'review-change', 'refund']);
  });

  it('groups equal priority deadlines by earliest deadline', () => {
    expect(rankBuyerTasks([task('later', 3, 200), task('none', 3), task('early', 3, 100)])
      .map((item) => item.taskId)).toEqual(['early', 'later', 'none']);
  });

  it('deduplicates cross-source tasks by business object and keeps highest priority', () => {
    expect(rankBuyerTasks([task('eligible', 4, null, 'reservation:r1'), task('instruction', 3, null, 'reservation:r1')]))
      .toEqual([task('instruction', 3, null, 'reservation:r1')]);
  });
});
