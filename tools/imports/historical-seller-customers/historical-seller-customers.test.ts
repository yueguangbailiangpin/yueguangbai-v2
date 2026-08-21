import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHistoricalSellerDirectoryPlan } from './index';

describe('frozen historical seller customer directory', () => {
  it('uses all four frozen inventories and deduplicates seller WeChat IDs', () => {
    const reference = path.resolve(process.cwd(),
      'openspec/changes/archive/2026-08-17-current-reservable-product-seller-mapping/references');
    const files = ['dJwldHrckeFY', 'dDUYsBOrYoEk', 'davLDVdZLoPV', 'dhtkJdpmZEgh']
      .flatMap((folder) => JSON.parse(readFileSync(
        path.join(reference, `historical-file-inventory-${folder}.json`), 'utf8',
      )).readOnlyIndex);
    const plan = buildHistoricalSellerDirectoryPlan(files);
    expect(plan.sourceFileCount).toBe(184);
    expect(plan.resolvedFileCount).toBe(155);
    expect(plan.customers).toHaveLength(146);
    expect(plan.unresolvedFiles).toHaveLength(29);
    expect(plan.customers.find((seller) => seller.normalizedWechat === 'w903488068')?.sources)
      .toHaveLength(4);
    expect(plan.customers.find((seller) => seller.normalizedWechat === 'michael_er'))
      .toMatchObject({ displayWechat: 'Michael_er', channelCode: 'ido-mango' });
    expect(plan.customers.find((seller) => seller.normalizedWechat === 'michael_er')?.sources)
      .toContainEqual(expect.objectContaining({ productName: '紫光灯' }));
    expect([...new Set(plan.customers.find((seller) => seller.normalizedWechat === 'yinxc520')
      ?.sources.map((source) => source.productName))]).toEqual(['贴纸']);
  });
});
