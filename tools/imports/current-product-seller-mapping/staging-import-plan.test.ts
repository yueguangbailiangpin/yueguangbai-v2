import { describe, expect, it } from 'vitest';
import {
  createStagingImportPlan,
  type LiveManifest,
} from './staging-import-plan';
import { emitStagingD1Sql } from './staging-import-sql';

const manifest: LiveManifest = {
  manifestVersion: 'fixture-live',
  current: [
    {
      sourceSheet: '工作表1', sourceRow: 2, sourceLocator: 'fixture://a',
      marketplaceCode: 'JP_AMAZON', storeName: 'A', asin: 'B0ABC12345',
      productName: 'A product', searchKeywords: '検索語A\n关键词2：検索語B',
      orderTotal: '3', reviewRequirements: '1单图评2单文评',
    },
    {
      sourceSheet: '工作表1', sourceRow: 3, sourceLocator: 'fixture://b',
      marketplaceCode: 'JP_AMAZON', storeName: 'B', asin: 'B0ABC12346',
      productName: 'B product', orderTotal: '',
    },
    {
      sourceSheet: '飞利浦产品', sourceRow: 4, sourceLocator: 'fixture://paused',
      marketplaceCode: 'JP_AMAZON', storeName: 'Paused', asin: 'B0ABC12347',
      productName: 'Paused product', orderTotal: '2', reservationStatus: 'PAUSED',
    },
    {
      sourceSheet: '工作表1', sourceRow: 5, sourceLocator: 'fixture://rakuten',
      marketplaceCode: 'JP_RAKUTEN', storeName: 'Rakuten', asin: 'R-1',
      productName: 'Rakuten product', orderTotal: '2', reviewRequirements: '图评',
    },
  ],
  historical: [
    {
      sourceFolderId: 'dJwldHrckeFY', sourceFileId: 'history-a',
      sourceFileTitle: 'A', sourceLocator: 'fixture://history-a',
      marketplaceCode: 'JP_AMAZON', sellerWechat: 'seller-a',
      asin: 'B0ABC12345', productName: 'A product',
    },
  ],
};

describe('staging current reservable import plan', () => {
  it('creates a deterministic read-only plan with conservative runtime fields', async () => {
    const first = await createStagingImportPlan(manifest, { now: 1_755_734_400_000 });
    const second = await createStagingImportPlan(manifest, { now: 1_755_734_400_000 });
    expect(second).toEqual(first);
    expect(first.counts).toMatchObject({
      currentStandardProducts: 3,
      unsupportedRuntimeMarketplace: 1,
      legacyRuntimeProducts: 2,
      openProductSellerMappings: 1,
      openProducts: 1,
      noSellerMapping: 1,
      noPositiveOrderTotal: 1,
    });
    expect(first.openProductSellerMappings[0]).toMatchObject({
      productKey: 'JP_AMAZON:B0ABC12345',
      sellerOrganizationKey: 'dJwldHrckeFY:seller-a',
      sourceRow: 2,
      orderTotal: 3,
      taskDefinitions: [
        expect.objectContaining({ taskType: 'IMAGE', targetQuantity: 1, parseStatus: 'EXPLICIT_SPLIT' }),
        expect.objectContaining({ taskType: 'TEXT', targetQuantity: 2, parseStatus: 'EXPLICIT_SPLIT' }),
      ],
    });
    expect(first.notOpened).toEqual(expect.arrayContaining([
      expect.objectContaining({
        productKey: 'JP_AMAZON:B0ABC12346',
        reasons: ['UNMAPPED_SELLER', 'NO_POSITIVE_INTEGER_ORDER_TOTAL'],
      }),
      expect.objectContaining({
        productKey: 'JP_RAKUTEN:R-1',
        productId: null,
        reasons: ['UNSUPPORTED_RUNTIME_MARKETPLACE'],
      }),
    ]));
    expect(first.platformProductIdentities).toEqual([
      expect.objectContaining({
        productKey: 'JP_RAKUTEN:R-1', status: 'UNSUPPORTED_RUNTIME_MARKETPLACE',
      }),
    ]);
    expect(first.productVersions).toHaveLength(2);
    expect(first.productVersions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        productName: 'A product',
        searchKeywordsJson: JSON.stringify(['検索語A', '検索語B']),
      }),
      expect.objectContaining({
        productName: 'B product',
        searchKeywordsJson: JSON.stringify(['B product']),
      }),
    ]));
    expect(first.sellerProductOfferings.every((offering) => offering.marketplaceCode === 'AMAZON_JP'))
      .toBe(true);
    expect(first.runtimePlans.map((task) => [task.taskType, task.targetQuantity]))
      .toEqual(expect.arrayContaining([['IMAGE', 1], ['TEXT', 2]]));
    expect(first.runtimePlans[0]).toMatchObject({
      taskType: expect.any(String),
      targetQuantity: expect.any(Number),
      status: 'SUBMITTED_PENDING_STAFF_REVIEW',
      openAt: 1_755_734_400_000,
      reservationDeadline: 1_755_734_400_000 + 30 * 24 * 60 * 60 * 1000 - 1,
      orderDeadline: 1_755_734_400_000 + 30 * 24 * 60 * 60 * 1000,
    });
    expect(first.externalCalls).toBe(0);
    expect(first.databaseWrites).toBe(0);
    expect(first.cloudflareWrites).toBe(0);
    expect(first.tencentDocsWrites).toBe(0);
  });

  it('emits idempotent SQL with Amazon runtime facts and Rakuten identities only', async () => {
    const plan = await createStagingImportPlan(manifest, { now: 1_755_734_400_000 });
    const output = await emitStagingD1Sql(plan, {
      actorStaffId: 'staff-owner-001', now: 1_755_734_400_000, batchId: 'staging-batch-fixture',
    });
    expect(output.amazonStandardProductCount).toBe(2);
    expect(output.rakutenIdentityCount).toBe(1);
    expect(output.reservationTaskCount).toBe(2);
    expect(output.sql).toContain('INSERT OR IGNORE INTO platform_product_identities');
    expect(output.sql).toContain("'R-1'");
    expect(output.sql).not.toContain("'RAKUTEN_JP', 'ACTIVE', 'CURRENT'");
    expect(output.sql).toContain('INSERT OR IGNORE INTO demand_batches');
    expect(output.sql).toContain("'PUBLISHED'");
    expect(output.sql).toContain('seller_channels');
    expect(output.sql).not.toContain('next_sequence=next_sequence+1');
    expect(output.sql).toContain('INSERT OR IGNORE');
  });
});
