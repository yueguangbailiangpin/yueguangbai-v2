import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const buyerContracts = [
  'packages/contracts/src/buyer-portal.ts',
  'packages/contracts/src/order-instruction.ts',
  'packages/contracts/src/buyer-order-evidence-portal.ts',
  'packages/contracts/src/buyer-formal-order-portal.ts',
  'packages/contracts/src/buyer-review-portal.ts',
  'packages/contracts/src/buyer-refund-portal.ts',
].map((path) => readFileSync(join(root, path), 'utf8')).join('\n');

describe('buyer DTO isolation', () => {
  it.each([
    'asin',
    'asin_display',
    'asin_normalized',
    'product_url',
    'search_keywords_json',
    'keyword_text',
    'seller_organization_id',
    'object_key',
  ])('does not publish %s as a buyer DTO field', (field) => {
    expect(buyerContracts).not.toMatch(new RegExp(`\\b${field}\\s*:`,'u'));
  });

  it('publishes only the Buyer-safe ordered keyword list', () => {
    expect(buyerContracts).toMatch(/search_keywords\s*:\s*readonly string\[\]/u);
    expect(buyerContracts).not.toMatch(/search_keywords_json\s*:/u);
  });
});
