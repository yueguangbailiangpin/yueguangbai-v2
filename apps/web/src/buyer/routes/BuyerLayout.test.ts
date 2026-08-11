import { describe, expect, it } from 'vitest';
import { buyerNavigationOwner } from './BuyerLayout';

describe('buyer semantic navigation ownership', () => {
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
