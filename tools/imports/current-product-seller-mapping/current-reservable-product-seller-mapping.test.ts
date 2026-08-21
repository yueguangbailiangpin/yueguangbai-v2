import { describe, expect, it } from 'vitest';
import { readonlySnapshotFixture } from './fixtures/readonly-snapshot';
import { fullReadonlyManifest } from './fixtures/full-readonly-manifest.mjs';
import {
  previewCurrentReservableProductSellerMapping,
  type CurrentWhitelistManifest,
} from '.';

describe('current reservable product and seller mapping', () => {
  it('uses both current worksheets, preserves Rakuten identifiers, and maps confirmed sellers', async () => {
    const preview = await previewCurrentReservableProductSellerMapping(readonlySnapshotFixture);
    expect(preview.counts).toMatchObject({
      currentSourceRows: 9,
      currentValidRows: 9,
      currentQuarantinedRows: 0,
      currentUniqueProducts: 9,
      mappedSellerOfferings: 8,
      confirmedSellerWithoutHistory: 2,
      unresolvedCurrentProducts: 1,
      historicalQuarantinedRows: 2,
    });
    expect(preview.currentRows.find((row) => row.platformProductIdentifier === 'R-1'))
      .toMatchObject({ marketplaceCode: 'JP_RAKUTEN', asinNormalized: null, status: 'VALID' });
    expect(preview.mappedSellerOfferings.filter((offer) =>
      offer.organizationKey === 'ygbceping:ls381048211')).toHaveLength(2);
  });

  it('keeps one confirmed organization for GoldHorizon and Philips', async () => {
    const preview = await previewCurrentReservableProductSellerMapping({
      current: readonlySnapshotFixture.current.filter((row) =>
        row.storeName.includes('Philips') || row.storeName.includes('GoldHorizon')),
      historical: [],
    });
    expect(new Set(preview.mappedSellerOfferings.map((offer) => offer.organizationKey)))
      .toEqual(new Set(['ygbceping:ls381048211']));
    expect(preview.confirmedSellerWithoutHistory).toHaveLength(2);
  });

  it('preserves two sellers for one product and keeps same WeChat folder-bounded', async () => {
    const manifest: CurrentWhitelistManifest = {
      current: [{
        sourceSheet: '工作表1', sourceRow: 1, sourceLocator: 'fixture://current/1',
        marketplaceCode: 'JP_AMAZON', storeName: 'current', asin: 'B0ABC12345',
        productName: 'same product',
      }],
      historical: [
        {
          sourceFolderId: 'dJwldHrckeFY', sourceFileId: 'a', sourceFileTitle: 'a',
          sourceLocator: 'fixture://a', marketplaceCode: 'JP_AMAZON',
          sellerWechat: 'same-wx', asin: 'B0ABC12345', productName: 'same product',
        },
        {
          sourceFolderId: 'dDUYsBOrYoEk', sourceFileId: 'b', sourceFileTitle: 'b',
          sourceLocator: 'fixture://b', marketplaceCode: 'JP_AMAZON',
          sellerWechat: 'same-wx', asin: 'B0ABC12345', productName: 'same product',
        },
      ],
    };
    const preview = await previewCurrentReservableProductSellerMapping(manifest);
    expect(preview.sameAsinMultiSeller).toEqual(['JP_AMAZON:B0ABC12345']);
    expect(preview.mappedSellerOfferings.map((offer) => offer.organizationKey)).toEqual([
      'dDUYsBOrYoEk:same-wx',
      'dJwldHrckeFY:same-wx',
    ]);
  });

  it('deduplicates duplicate current rows and reports product-field conflicts', async () => {
    const preview = await previewCurrentReservableProductSellerMapping({
      current: [
        {
          sourceSheet: '工作表1', sourceRow: 10, sourceLocator: 'fixture://current/10',
          marketplaceCode: 'JP_AMAZON', storeName: 'store-a', asin: 'B0ABC12345',
          productName: 'Product A',
        },
        {
          sourceSheet: '工作表1', sourceRow: 11, sourceLocator: 'fixture://current/11',
          marketplaceCode: 'JP_AMAZON', storeName: 'store-b', asin: 'b0abc12345',
          productName: 'Product B',
        },
      ],
      historical: [],
    });
    expect(preview.standardProducts).toHaveLength(1);
    expect(preview.standardProducts[0]?.currentRows).toEqual([10, 11]);
    expect(preview.fieldConflicts.map((conflict) => conflict.code)).toEqual([
      'CURRENT_PRODUCT_NAME_CONFLICT',
      'CURRENT_STORE_CONTEXT_CONFLICT',
    ]);
  });

  it('applies owner availability corrections without deleting historical evidence', async () => {
    const preview = await previewCurrentReservableProductSellerMapping({
      current: [
        ...[1, 2, 3, 4].map((sourceRow) => ({
          sourceSheet: '工作表1' as const, sourceRow,
          sourceLocator: `fixture://somiso/${sourceRow}`,
          marketplaceCode: 'JP_AMAZON' as const, storeName: 'Somiso JP',
          asin: 'B0GR5C43PG', productName: `Somiso ${sourceRow}`,
        })),
        {
          sourceSheet: '工作表1', sourceRow: 5, sourceLocator: 'fixture://paused/5',
          marketplaceCode: 'JP_AMAZON', storeName: 'paused', asin: 'B0ABC12345',
          productName: '暂停产品', reservationStatus: 'PAUSED' as const,
        },
        {
          sourceSheet: '飞利浦产品', sourceRow: 6, sourceLocator: 'fixture://philips/6',
          marketplaceCode: 'JP_AMAZON', storeName: '', asin: '', productName: '',
        },
        {
          sourceSheet: '工作表1', sourceRow: 7, sourceLocator: 'fixture://multi-seller/7',
          marketplaceCode: 'JP_AMAZON', storeName: 'current', asin: 'B0GRMRV64K',
          productName: '美容棒',
        },
      ],
      historical: [
        {
          sourceFolderId: 'dDUYsBOrYoEk', sourceFileId: 'ygb-history',
          sourceFileTitle: '历史卖家', sourceLocator: 'fixture://ygb-history',
          marketplaceCode: 'JP_AMAZON', sellerWechat: 'shiguo0317',
          asin: 'B0GRMRV64K', productName: '美容棒',
        },
        {
          sourceFolderId: 'dJwldHrckeFY', sourceFileId: 'ido-history',
          sourceFileTitle: '历史卖家', sourceLocator: 'fixture://ido-history',
          marketplaceCode: 'JP_AMAZON', sellerWechat: 'szgavin68',
          asin: 'B0GRMRV64K', productName: '美容棒',
        },
      ],
    });
    expect(preview.standardProducts).toEqual(expect.arrayContaining([
      expect.objectContaining({ productKey: 'JP_AMAZON:B0GR5C43PG', currentRows: [1, 2, 3, 4] }),
    ]));
    expect(preview.currentRows).toContainEqual(expect.objectContaining({
      sourceRow: 5, status: 'EXCLUDED', exceptionCode: 'EXCLUDED_PAUSED_PRODUCT',
    }));
    expect(preview.currentRows).toContainEqual(expect.objectContaining({
      sourceRow: 6, status: 'EXCLUDED', exceptionCode: 'EXCLUDED_ABNORMAL_EMPTY_PHILIPS_ROW',
    }));
    expect(preview.mappedSellerOfferings.map((offer) => offer.organizationKey))
      .toEqual(['dJwldHrckeFY:szgavin68']);
    expect(preview.sameAsinMultiSeller).toEqual([]);
    expect(preview.excludedSellerOfferings).toEqual([
      expect.objectContaining({
        productKey: 'JP_AMAZON:B0GRMRV64K', organizationKey: 'dDUYsBOrYoEk:shiguo0317',
      }),
    ]);
  });

  it('accepts only the explicit channel alias map and quarantines unknown aliases', async () => {
    const preview = await previewCurrentReservableProductSellerMapping({
      current: [],
      historical: [
        {
          sourceFolderId: 'dDUYsBOrYoEk', sourceFileId: 'alias-ok', sourceFileTitle: 'alias-ok',
          sourceLocator: 'fixture://alias-ok', marketplaceCode: 'JP_AMAZON',
          sellerWechat: 'seller-alias', channelAlias: 'gyb', asin: 'B0ABC12345',
          productName: 'mapped',
        },
        {
          sourceFolderId: 'dDUYsBOrYoEk', sourceFileId: 'alias-bad', sourceFileTitle: 'alias-bad',
          sourceLocator: 'fixture://alias-bad', marketplaceCode: 'JP_AMAZON',
          sellerWechat: 'seller-bad', channelAlias: 'unknown-channel', asin: 'B0ABC12346',
          productName: 'quarantined',
        },
      ],
    });
    expect(preview.historicalRows).toContainEqual(expect.objectContaining({
      sourceFileId: 'alias-ok', channelCode: 'ygbceping', status: 'VALID',
    }));
    expect(preview.historicalRows).toContainEqual(expect.objectContaining({
      sourceFileId: 'alias-bad', exceptionCode: 'UNKNOWN_CHANNEL_ALIAS',
      status: 'QUARANTINED',
    }));
  });

  it('is deterministic and excludes self-fulfillment review rows', async () => {
    const first = await previewCurrentReservableProductSellerMapping(readonlySnapshotFixture);
    const second = await previewCurrentReservableProductSellerMapping(readonlySnapshotFixture);
    expect(second).toEqual(first);
    expect(first.quarantinedHistorical).toContainEqual(expect.objectContaining({
      exceptionCode: 'EXCLUDED_SELF_FULFILLMENT_STORE_REVIEWS',
      status: 'EXCLUDED',
    }));
  });

  it('verifies the complete readonly manifest conservation and stable hash', async () => {
    const first = await previewCurrentReservableProductSellerMapping(fullReadonlyManifest);
    const second = await previewCurrentReservableProductSellerMapping(fullReadonlyManifest);
    const frozenManifestHash =
      '9298997ed69f7d83fdca00daa5e8c3a185b57f8072e8125967883b1fe032ec7c';
    expect(first).toEqual(second);
    expect(first.manifestHash).toBe(frozenManifestHash);
    expect(first.counts).toMatchObject({
      currentSourceRows: 114,
      currentValidRows: 109,
      currentQuarantinedRows: 5,
      currentUniqueProducts: 88,
      currentAmazonAsins: 86,
      currentRakutenIdentifiers: 2,
      historicalFilesIndexed: 184,
      historicalFilesWithRows: 26,
      historicalFilesQuarantined: 158,
      historicalSourceRows: 157,
      historicalValidRows: 60,
      historicalQuarantinedRows: 97,
      });
    expect(first.currentRows.filter((row) => row.status === 'VALID')).toHaveLength(109);
    expect(first.standardProducts).toHaveLength(88);
    expect(new Set(first.standardProducts.map((product) => product.productKey)).size)
      .toBe(88);
    expect(first.standardProducts.reduce((total, product) => total + product.currentRows.length, 0))
      .toBe(109);
    expect(first.standardProducts.filter((product) => product.marketplaceCode === 'JP_RAKUTEN'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ platformProductIdentifier: 'R-1', asinNormalized: null }),
        expect.objectContaining({ platformProductIdentifier: 'S-1', asinNormalized: null }),
      ]));

    const productKeys = new Set(first.standardProducts.map((product) => product.productKey));
    const mappedProductKeys = new Set(first.mappedSellerOfferings.map((offer) => offer.productKey));
    const unresolvedProductKeys = new Set(first.unresolvedCurrentProducts);
    expect(mappedProductKeys.size).toBe(51);
    expect(unresolvedProductKeys.size).toBe(37);
    expect(first.mappedSellerOfferings.length).toBe(51);
    expect(new Set(first.mappedSellerOfferings.map((offer) =>
      `${offer.productKey}:${offer.organizationKey}`))).toHaveLength(51);
    expect(first.excludedSellerOfferings).toEqual([
      expect.objectContaining({
        productKey: 'JP_AMAZON:B0GRMRV64K', organizationKey: 'dDUYsBOrYoEk:shiguo0317',
      }),
    ]);
    expect([...mappedProductKeys].filter((productKey) =>
      unresolvedProductKeys.has(productKey))).toHaveLength(0);
    expect(new Set([...mappedProductKeys, ...unresolvedProductKeys])).toEqual(productKeys);

    expect(first.currentRows
      .filter((row) => row.status === 'QUARANTINED')
      .map((row) => ({
        sourceSheet: row.sourceSheet,
        sourceRow: row.sourceRow,
        exceptionCode: row.exceptionCode,
      }))).toEqual([
        { sourceSheet: '工作表1', sourceRow: 53, exceptionCode: 'MISSING_PRODUCT_IDENTIFIER' },
        { sourceSheet: '工作表1', sourceRow: 54, exceptionCode: 'MISSING_PRODUCT_IDENTIFIER' },
        { sourceSheet: '工作表1', sourceRow: 69, exceptionCode: 'MISSING_PRODUCT_IDENTIFIER' },
        { sourceSheet: '工作表1', sourceRow: 70, exceptionCode: 'MISSING_PRODUCT_IDENTIFIER' },
        { sourceSheet: '工作表1', sourceRow: 71, exceptionCode: 'MISSING_PRODUCT_IDENTIFIER' },
      ]);

    const inventoryStatusCounts = Object.fromEntries(
      first.historicalFileInventory.reduce((counts, file) => {
        counts.set(file.scanStatus, (counts.get(file.scanStatus) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
    );
    expect(inventoryStatusCounts).toEqual({
      MATCHED: 26,
      NO_CURRENT_MATCH: 153,
      EXCLUDED_SELF_FULFILLMENT_STORE_REVIEWS: 1,
      NOT_PRODUCT_SOURCE: 1,
      NO_PRODUCT_SHEET: 3,
    });
    expect(new Set(first.historicalFileInventory.map((file) => file.scanStatus))).toEqual(
      new Set([
        'MATCHED',
        'NO_CURRENT_MATCH',
        'EXCLUDED_SELF_FULFILLMENT_STORE_REVIEWS',
        'NOT_PRODUCT_SOURCE',
        'NO_PRODUCT_SHEET',
      ]),
    );
    const inventoryFolderCounts = Object.fromEntries(
      first.historicalFileInventory.reduce((counts, file) => {
        counts.set(file.sourceFolderId, (counts.get(file.sourceFolderId) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
    );
    expect(inventoryFolderCounts).toEqual({
      dJwldHrckeFY: 93,
      dDUYsBOrYoEk: 51,
      davLDVdZLoPV: 2,
      dhtkJdpmZEgh: 38,
    });
    expect(first.historicalFileInventory).toHaveLength(184);
    expect(new Set(first.historicalFileInventory.map((file) => file.sourceFileId)).size)
      .toBe(184);
    expect(first.unreadHistoricalFiles).toHaveLength(158);
    expect(new Set(first.unreadHistoricalFiles)).toHaveLength(158);

    for (const productKey of ['JP_RAKUTEN:R-1', 'JP_RAKUTEN:S-1']) {
      expect(mappedProductKeys).toContain(productKey);
      expect(unresolvedProductKeys).not.toContain(productKey);
    }
  });
});
