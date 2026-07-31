import { describe, expect, it } from 'vitest';
import {
  PRODUCT_STATUSES,
  SELLER_STORE_STATUSES,
} from './catalog';

describe('catalog contracts', () => {
  it('publishes only active and disabled master-data states', () => {
    expect(SELLER_STORE_STATUSES).toEqual([
      'ACTIVE',
      'DISABLED',
    ]);
    expect(PRODUCT_STATUSES).toEqual([
      'ACTIVE',
      'DISABLED',
    ]);
  });
});
