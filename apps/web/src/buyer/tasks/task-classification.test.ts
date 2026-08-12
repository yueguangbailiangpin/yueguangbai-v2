import { describe, expect, it } from 'vitest';
import { classifyBuyerTasks, type BuyerTaskSources } from './task-classification';

const label = (value: string) => value;

describe('canonical Buyer task classification', () => {
  it('counts only Buyer actions while keeping reservation, evidence, review, and refund processing separate', () => {
    const sources = {
      reservations: [
        { reservation_id: 'approved', status: 'APPROVED', demand: { product_name: '指引产品' } },
        { reservation_id: 'pending', status: 'PENDING_REVIEW', demand: { product_name: '审核产品' } },
      ],
      eligibleEvidence: [{ reservation_id: 'evidence-ready', product_name: '订单产品', review_type: 'IMAGE', allowed_actions: ['SUBMIT'] }],
      evidence: [
        { submission_id: 'evidence-change', status: 'CHANGES_REQUESTED', reservation: { product_name: '改单产品' }, public_change_reason: '补充截图' },
        { submission_id: 'evidence-pending', status: 'PENDING_VERIFICATION', reservation: { product_name: '审核订单' }, public_change_reason: null },
      ],
      eligibleReviews: [{ order: { formal_order_id: 'review-ready', product_name: '评论产品', review_type: 'TEXT' }, allowed_actions: ['SUBMIT'] }],
      reviews: [
        { review_case_id: 'review-change', status: 'CHANGES_REQUESTED', order: { product_name: '改评产品' }, public_change_reason: '补充链接' },
        { review_case_id: 'review-pending', status: 'PENDING_REVIEW', order: { product_name: '审核评论' }, public_change_reason: null },
      ],
      refunds: [
        { refund_obligation_id: 'refund-due', status: 'DUE', order: { product_name: '返款产品' } },
        { refund_obligation_id: 'refund-paid', status: 'PAID', order: { product_name: '已完成返款' } },
      ],
    } satisfies BuyerTaskSources;
    const tasks = classifyBuyerTasks(sources, label);

    expect(tasks.urgent.map((item) => item.title)).toEqual(['修改订单资料', '修改评论资料']);
    expect(tasks.action.map((item) => item.title)).toEqual(['提交订单资料', '提交评论资料', '查看下单指引']);
    expect(tasks.actionableCount).toBe(5);
    expect(tasks.system.map((item) => item.title)).toEqual(['预约审核中', '订单资料审核中', '评论审核中', '返款处理中']);
  });

  it('does not fabricate an instruction task when the current evidence source owns that reservation', () => {
    const sources = {
      reservations: [{ reservation_id: 'r-1', status: 'APPROVED', demand: { product_name: '产品' } }],
      eligibleEvidence: [{ reservation_id: 'r-1', product_name: '产品', review_type: 'IMAGE', allowed_actions: [] }],
      evidence: [], eligibleReviews: [], reviews: [], refunds: [],
    } satisfies BuyerTaskSources;
    const tasks = classifyBuyerTasks(sources, label);

    expect(tasks.action).toEqual([]);
    expect(tasks.actionableCount).toBe(0);
  });
});
