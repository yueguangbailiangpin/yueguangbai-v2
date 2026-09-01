import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('buyer public projection source guard', () => {
  it('does not select or map seller search material', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const contract = readFileSync(
      path.join(root, 'packages/contracts/src/buyer-portal.ts'),
      'utf8',
    );
    const readModel = readFileSync(
      path.join(root, 'apps/api/src/buyer-portal/read-model.ts'),
      'utf8',
    );
    for (const forbidden of [
      'search_keywords',
      'search_keywords_json',
      'product_url',
      'asin:',
      'AS asin',
    ]) {
      expect(contract).not.toContain(forbidden);
      expect(readModel).not.toContain(forbidden);
    }
  });

  it('keeps reservable-product eligibility on the server query', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const readModel = readFileSync(
      path.join(root, 'apps/api/src/buyer-portal/read-model.ts'),
      'utf8',
    );
    for (const predicate of [
      "demand.status='PUBLISHED'",
      'demand.open_at<=?',
      'demand.reservation_deadline>?',
      'demand.held_reservation_count',
      'existing.buyer_customer_id=?',
      'active_store_reservation.buyer_customer_id=?',
      "active_store_reservation.status IN ('PENDING_REVIEW', 'APPROVED')",
    ]) expect(readModel).toContain(predicate);
  });

  it('does not retain frozen Buyer profile, order, or refund fields in browser contracts', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    for (const file of [
      'packages/contracts/src/buyer-portal.ts',
      'packages/contracts/src/buyer-formal-order-portal.ts',
      'packages/contracts/src/buyer-refund-portal.ts',
      'packages/contracts/src/buyer-review-portal.ts',
      'apps/web/src/buyer/contracts/runtime.ts',
    ]) {
      const source = readFileSync(path.join(root, file), 'utf8');
      // customer_number 例外（D2 2026-08-22 拍板）：注册即分配后买家端
      // 个人区与注册成功页展示客户编码（me DTO 契约与其前端镜像）；
      // 其余文件与内部列名（buyer_customer_no）仍禁止暴露。
      const customerNumberAllowed = file === 'packages/contracts/src/buyer-portal.ts'
        || file === 'apps/web/src/buyer/contracts/runtime.ts';
      for (const forbidden of [
        'buyer_customer_no',
        'became_due_at',
        'first_paid_at',
        'last_paid_at',
        ...(customerNumberAllowed ? [] : ['customer_number']),
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
