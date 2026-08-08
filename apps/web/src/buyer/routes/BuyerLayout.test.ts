import { describe, expect, it } from 'vitest';
import { buyerNavigationOwner } from './BuyerLayout';

describe('buyer semantic navigation ownership', () => {
  it.each([
    ['/buyer', '/buyer'],
    ['/buyer/tasks', '/buyer/products'],
    ['/buyer/products', '/buyer/products'],
    ['/buyer/demands/d-1', '/buyer/products'],
    ['/buyer/reservations/r-1', '/buyer/products'],
    ['/buyer/reservations/r-1/instruction', '/buyer/products'],
    ['/buyer/order-materials/new', '/buyer/order-materials'],
    ['/buyer/orders/o-1', '/buyer/order-materials'],
    ['/buyer/reviews/review-1', '/buyer/reviews'],
    ['/buyer/refunds/refund-1', '/buyer/me'],
    ['/buyer/change-password', '/buyer/me'],
  ])('maps %s to exactly one owner', (pathname, expected) => {
    expect(buyerNavigationOwner(pathname)).toBe(expected);
  });
});
