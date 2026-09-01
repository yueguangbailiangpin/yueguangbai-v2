import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { anonymousSellerPartnerFixture } from './fixtures/anonymous-fixture';
import {
  commitSellerPartnerImport,
  previewSellerPartnerImport,
  rollbackSellerPartnerImport,
  type SellerPartnerSourceManifest,
} from '.';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('seller partner master-data import', () => {
  it('routes frozen folders, groups within a folder, and keeps fifth-channel aliases', async () => {
    const plan = await previewSellerPartnerImport(anonymousSellerPartnerFixture);
    expect(plan.counts).toEqual({
      source: 5,
      valid: 4,
      quarantined: 1,
      organizations: 3,
      standardProducts: 3,
      offerings: 4,
    });
    expect(plan.groups.map((group) => group.channelCode).sort())
      .toEqual(['ido-mango', 'queshengai', 'ygbceping']);
    expect(plan.records.find((record) => record.status === 'QUARANTINED'))
      .toMatchObject({ exceptionCode: 'UNKNOWN_CHANNEL_ALIAS' });
  });

  it('quarantines an explicit moonwhite alias that contradicts its frozen folder default', async () => {
    // Owner ruling 2026-09-01: yueguangbai and yueguangbaiai are distinct
    // accounts, and F4's frozen default stays yueguangbaiai. An explicit
    // yueguangbai alias under F4 is therefore a folder/channel contradiction:
    // it must quarantine as FOLDER_CHANNEL_CONFLICT instead of silently
    // re-routing the seller to the other moonwhite account. Reaching a
    // yueguangbai commit requires an owner-ruled folder mapping or alias
    // exception (the pattern queshengai already has), not registry seeding.
    const plan = await previewSellerPartnerImport({
      records: [{
        sourceFolderId: 'dhtkJdpmZEgh', sourceRecordId: 'explicit-yueguangbai',
        sourceLocator: 'fixture://dhtkJdpmZEgh/explicit-yueguangbai',
        sellerWechat: 'moonwhite-split-seller', asin: 'B0ABC12360',
        productName: '显式月光白别名应隔离', channelAlias: 'yueguangbai',
        cooperationStatus: 'CURRENT', currentReservable: true,
      }],
    });
    expect(plan.counts).toMatchObject({ source: 1, valid: 0, quarantined: 1 });
    expect(plan.records.find((record) => record.status === 'QUARANTINED'))
      .toMatchObject({ exceptionCode: 'FOLDER_CHANNEL_CONFLICT' });
  });

  it('commits two independent organizations for the same WeChat and one standard ASIN', async () => {
    database = createMigratedTestDatabase();
    const plan = await previewSellerPartnerImport(anonymousSellerPartnerFixture);
    const result = await commitSellerPartnerImport(database, plan, {
      actorStaffId: 'fixture-staff',
      now: 1_700_000_000_000,
    });
    expect(result).toMatchObject({
      replayed: false,
      organizationCount: 3,
      standardProductCount: 3,
      offeringCount: 4,
      loginAccountsCreated: 0,
      externalMutations: 0,
    });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM seller_organizations
      WHERE id LIKE 'seller-import-org-%'
    `).first()).resolves.toEqual({ count: 3 });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM seller_organization_members member
      JOIN seller_organizations organization ON organization.id=member.organization_id
      WHERE organization.id LIKE 'seller-import-org-%' AND member.status='DISABLED'
    `).first()).resolves.toEqual({ count: 3 });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM standard_products
      WHERE asin_normalized='B0ABC12345'
    `).first()).resolves.toEqual({ count: 1 });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM seller_product_offerings offering
      JOIN standard_products product ON product.id=offering.standard_product_id
      WHERE product.asin_normalized='B0ABC12345'
    `).first()).resolves.toEqual({ count: 2 });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM customer_login_accounts
      WHERE id LIKE 'seller-import-%'
    `).first()).resolves.toEqual({ count: 0 });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM product_reservations
      WHERE id LIKE 'seller-import-%'
    `).first()).resolves.toEqual({ count: 0 });
  });

  it('replays the same manifest without duplicating source or master rows', async () => {
    database = createMigratedTestDatabase();
    const plan = await previewSellerPartnerImport(anonymousSellerPartnerFixture);
    const command = { actorStaffId: 'fixture-staff', now: 1_700_000_000_000 };
    const first = await commitSellerPartnerImport(database, plan, command);
    const replay = await commitSellerPartnerImport(database, plan, command);
    expect(replay).toMatchObject({ batchId: first.batchId, replayed: true });
    await expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM seller_partner_import_batches) AS batches,
        (SELECT COUNT(*) FROM seller_partner_import_source_records) AS sources,
        (SELECT COUNT(*) FROM seller_product_offerings) AS offerings
    `).first()).resolves.toEqual({ batches: 1, sources: 5, offerings: 4 });
  });

  it('does not merge the same normalized WeChat across frozen folders', async () => {
    const manifest: SellerPartnerSourceManifest = {
      records: [
        {
          sourceFolderId: 'dJwldHrckeFY', sourceRecordId: 'a',
          sourceLocator: 'fixture://a', sellerWechat: 'Same-WX-01',
          asin: 'B0ABC12349', productName: 'A',
        },
        {
          sourceFolderId: 'dDUYsBOrYoEk', sourceRecordId: 'b',
          sourceLocator: 'fixture://b', sellerWechat: 'same-wx-01',
          asin: 'B0ABC12349', productName: 'A',
        },
      ],
    };
    const plan = await previewSellerPartnerImport(manifest);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups[0]?.groupKey).not.toBe(plan.groups[1]?.groupKey);
  });

  it('rolls back only import projections while retaining immutable source trace', async () => {
    database = createMigratedTestDatabase();
    const plan = await previewSellerPartnerImport(anonymousSellerPartnerFixture);
    const first = await commitSellerPartnerImport(database, plan, {
      actorStaffId: 'fixture-staff', now: 1_700_000_000_000,
    });
    await expect(rollbackSellerPartnerImport(
      database, first.batchId, 1_700_000_000_001,
    )).resolves.toEqual({
      batchId: first.batchId,
      rolledBack: true,
      sourceTraceRetained: true,
      downstreamFactsChecked: true,
    });
    await expect(database.prepare(`
      SELECT
        (SELECT status FROM seller_partner_import_batches WHERE id=?) AS batch_status,
        (SELECT COUNT(*) FROM seller_partner_import_source_records WHERE batch_id=?) AS source_rows,
        (SELECT COUNT(*) FROM seller_product_offerings WHERE source_batch_id=? AND status='DISABLED') AS disabled_offerings
    `).bind(first.batchId, first.batchId, first.batchId).first()).resolves.toEqual({
      batch_status: 'ROLLED_BACK', source_rows: 5, disabled_offerings: 4,
    });
  });

  it('derives reservation eligibility from the exact seller-and-ASIN rows', async () => {
    database = createMigratedTestDatabase();
    const plan = await previewSellerPartnerImport({
      records: [
        {
          sourceFolderId: 'dJwldHrckeFY', sourceRecordId: 'current',
          sourceLocator: 'fixture://eligibility/current', sellerWechat: 'seller-one',
          asin: 'B0ABC12351', productName: 'Current product',
          cooperationStatus: 'CURRENT', currentReservable: true,
        },
        {
          sourceFolderId: 'dJwldHrckeFY', sourceRecordId: 'historical',
          sourceLocator: 'fixture://eligibility/historical', sellerWechat: 'seller-one',
          asin: 'B0ABC12352', productName: 'Historical product',
          cooperationStatus: 'HISTORICAL', currentReservable: true,
        },
      ],
    });
    await commitSellerPartnerImport(database, plan, {
      actorStaffId: 'fixture-staff', now: 1_700_000_000_000,
    });
    await expect(database.prepare(`
      SELECT product.asin_normalized, opening.status
      FROM product_reservation_openings opening
      JOIN seller_product_offerings offering ON offering.id=opening.offering_id
      JOIN standard_products product ON product.id=offering.standard_product_id
      ORDER BY product.asin_normalized
    `).all()).resolves.toEqual({
      results: [
        { asin_normalized: 'B0ABC12351', status: 'ELIGIBLE' },
        { asin_normalized: 'B0ABC12352', status: 'NOT_OPEN' },
      ],
    });
  });

  it('does not disable a shared standard product when its first batch rolls back', async () => {
    database = createMigratedTestDatabase();
    const firstPlan = await previewSellerPartnerImport({ records: [{
      sourceFolderId: 'dJwldHrckeFY', sourceRecordId: 'first',
      sourceLocator: 'fixture://rollback/first', sellerWechat: 'seller-first',
      asin: 'B0ABC12353', productName: 'Shared product',
    }] });
    const secondPlan = await previewSellerPartnerImport({ records: [{
      sourceFolderId: 'dDUYsBOrYoEk', sourceRecordId: 'second',
      sourceLocator: 'fixture://rollback/second', sellerWechat: 'seller-second',
      asin: 'B0ABC12353', productName: 'Shared product',
    }] });
    const first = await commitSellerPartnerImport(database, firstPlan, {
      actorStaffId: 'fixture-staff', now: 1_700_000_000_000,
    });
    const second = await commitSellerPartnerImport(database, secondPlan, {
      actorStaffId: 'fixture-staff', now: 1_700_000_000_001,
    });
    await rollbackSellerPartnerImport(database, first.batchId, 1_700_000_000_002);
    await expect(database.prepare(`
      SELECT product.status,
        (SELECT COUNT(*) FROM seller_product_offerings offering
         WHERE offering.standard_product_id=product.id
           AND offering.source_batch_id=?) AS later_offerings
      FROM standard_products product
      WHERE product.asin_normalized='B0ABC12353'
    `).bind(second.batchId).first()).resolves.toEqual({
      status: 'ACTIVE', later_offerings: 1,
    });
  });

  it('quarantines malformed rows instead of aborting the whole dry-run', async () => {
    const plan = await previewSellerPartnerImport({
      records: [
        {
          sourceFolderId: 'dJwldHrckeFY', sourceRecordId: 'malformed',
          sourceLocator: 'fixture://malformed', sellerWechat: 'valid-wx-01',
          asin: 'B0ABC12349', productName: '',
        },
      ],
    });
    expect(plan.counts).toMatchObject({ source: 1, valid: 0, quarantined: 1 });
    expect(plan.records[0]).toMatchObject({
      status: 'QUARANTINED', exceptionCode: 'INVALID_FIELD',
    });
  });
});
