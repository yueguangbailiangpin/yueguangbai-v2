import { describe, expect, it } from 'vitest';
import { BUYER_NAVIGATION, buyerNavigationOwner } from './BuyerLayout';

describe('buyer semantic navigation ownership', () => {
  it('keeps the exact three-item canonical primary navigation', () => {
    expect(BUYER_NAVIGATION.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: '产品', path: '/buyer/products' },
      { label: '任务', path: '/buyer/tasks' },
      { label: '我的', path: '/buyer/me' },
    ]);
  });

  it.each([
    ['/buyer', '/buyer/products'],
    ['/buyer/tasks', '/buyer/tasks'],
    ['/buyer/products', '/buyer/products'],
    ['/buyer/demands/d-1', '/buyer/products'],
    ['/buyer/reservations/r-1', '/buyer/tasks'],
    ['/buyer/reservations/r-1/instruction', '/buyer/tasks'],
    ['/buyer/order-materials/new', '/buyer/tasks'],
    ['/buyer/orders/o-1', '/buyer/tasks'],
    ['/buyer/reviews/review-1', '/buyer/tasks'],
    ['/buyer/refunds/refund-1', '/buyer/tasks'],
    ['/buyer/change-password', '/buyer/me'],
  ])('maps %s to exactly one owner', (pathname, expected) => {
    expect(buyerNavigationOwner(pathname)).toBe(expected);
  });
});
