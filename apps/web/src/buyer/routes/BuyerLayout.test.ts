import { describe, expect, it } from 'vitest';
import {
  BUYER_NAVIGATION,
  BUYER_SIDEBAR_NAVIGATION,
  buyerNavigationOwner,
  buyerSidebarOwner,
} from './BuyerLayout';

describe('buyer semantic navigation ownership', () => {
  it('keeps the exact four-item mobile primary navigation', () => {
    expect(BUYER_NAVIGATION.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: '首页', path: '/buyer' },
      { label: '产品', path: '/buyer/products' },
      { label: '订单', path: '/buyer/orders' },
      { label: '我的', path: '/buyer/me' },
    ]);
  });

  it('keeps the exact sidebar navigation mapped to real buyer routes', () => {
    expect(BUYER_SIDEBAR_NAVIGATION.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: '首页', path: '/buyer' },
      { label: '产品与预约', path: '/buyer/products' },
      { label: '我的订单', path: '/buyer/orders' },
      { label: '评论任务', path: '/buyer/reviews' },
      { label: '返款记录', path: '/buyer/refunds' },
      { label: '账户资料', path: '/buyer/me' },
    ]);
  });

  it.each([
    ['/buyer', '/buyer'],
    ['/buyer/products', '/buyer/products'],
    ['/buyer/demands/d-1', '/buyer/products'],
    ['/buyer/orders/o-1', '/buyer/orders'],
    ['/buyer/order-materials/new', '/buyer/orders'],
    ['/buyer/reservations/r-1', '/buyer/orders'],
    ['/buyer/reservations/r-1/instruction', '/buyer/orders'],
    ['/buyer/tasks', '/buyer/orders'],
    ['/buyer/reviews/review-1', '/buyer/orders'],
    ['/buyer/refunds/refund-1', '/buyer/orders'],
    ['/buyer/me', '/buyer/me'],
    ['/buyer/change-password', '/buyer/me'],
  ])('maps %s to exactly one mobile owner', (pathname, expected) => {
    expect(buyerNavigationOwner(pathname)).toBe(expected);
  });

  it.each([
    ['/buyer', '/buyer'],
    ['/buyer/demands/d-1', '/buyer/products'],
    ['/buyer/orders/o-1', '/buyer/orders'],
    ['/buyer/order-materials/new', '/buyer/orders'],
    ['/buyer/reservations/r-1/instruction', '/buyer/orders'],
    ['/buyer/tasks', '/buyer/reviews'],
    ['/buyer/reviews/review-1', '/buyer/reviews'],
    ['/buyer/refunds/refund-1', '/buyer/refunds'],
    ['/buyer/me', '/buyer/me'],
    ['/buyer/change-password', '/buyer/me'],
  ])('maps %s to exactly one sidebar owner', (pathname, expected) => {
    expect(buyerSidebarOwner(pathname)).toBe(expected);
  });
});
