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
});
