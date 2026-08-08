import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AcquisitionLeadType, StaffPermissionCode, StaffRoleCode } from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import {
  createAcquisitionAssignment,
  createAcquisitionChannel,
  recordAcquisitionConsultation,
} from './admin';
import { AcquisitionError } from './errors';
import {
  createAcquisitionLead,
  followUpAcquisitionLead,
  invalidateAcquisitionLead,
  listAcquisitionLeads,
  transferAcquisitionLead,
} from './leads';
import { runAcquisitionMaintenance } from './maintenance';
import { readAcquisitionFunnel } from './funnel';
import { addTwelveShanghaiMonths } from './time';

const SECRET = 'acquisition-test-secret-with-at-least-thirty-two-bytes';
const JAN_1_2025 = Date.UTC(2025,0,1,4);
let database: SqliteDatabase|null = null;

afterEach(() => { database?.close(); database = null; });

describe('staff acquisition funnel commands', () => {
  it('derives the channel, protects WeChat, freezes origin and deduplicates per type', async () => {
    database = db();
    const channel = await seedChannel(database, 'XHS_BUYER');
    const sellerChannel = await seedChannel(database, 'XHS_SELLER');
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    await seedAssignment(database, 'staff-seller', 'SELLER', sellerChannel.channel.channel_id);

    const buyer = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: '  ＹＧＢ_Test-01  ',
      displayName: '买家甲', note: '已添加私人微信',
    }, command(preSales(), 'lead-create-0001', JAN_1_2025), SECRET);
    expect(buyer.lead).toMatchObject({
      lead_type: 'BUYER', origin_channel_id: channel.channel.channel_id,
      origin_staff_id: 'staff-pre', current_owner_staff_id: 'staff-pre',
      wechat_masked: 'YG***01', no_participation: true,
    });

    await expect(createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'ygb_test-01', displayName: null, note: null,
    }, command(preSales(), 'lead-create-0002', JAN_1_2025 + 1), SECRET))
      .rejects.toMatchObject({ code: 'DUPLICATE_LEAD' });

    const seller = await createAcquisitionLead(database, {
      leadType: 'SELLER', wechatId: 'ygb_test-01', displayName: null, note: null,
    }, command(sellerOps(), 'lead-create-0003', JAN_1_2025 + 2), SECRET);
    expect(seller.lead.lead_type).toBe('SELLER');

    const stored = database.raw.prepare(`SELECT identity_hash,identity_ciphertext,
      identity_iv,origin_staff_id,origin_channel_id FROM acquisition_leads
      WHERE id=?`).get(buyer.lead.lead_id)!;
    expect(stored['identity_hash']).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain('ygb_test-01');
    await expect(import('./leads').then((module) => module.readAcquisitionLead(
      database!, auth('pre_sales','staff-pre-other'), buyer.lead.lead_id,
    ))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(() => database!.raw.prepare(`UPDATE acquisition_leads
      SET origin_staff_id='staff-seller',version=version+1,updated_at=updated_at+1
      WHERE id=?`).run(buyer.lead.lead_id)).toThrow(/immutable_origin/iu);
  });

  it('replays identical commands, rejects hash reuse and enforces versions', async () => {
    database = db();
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    const first = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'replay_wx', displayName: null, note: null,
    }, command(preSales(), 'lead-replay-0001', JAN_1_2025), SECRET);
    const replay = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'replay_wx', displayName: null, note: null,
    }, command(preSales(), 'lead-replay-0001', JAN_1_2025), SECRET);
    expect(replay.replayed).toBe(true);
    expect(replay.lead.lead_id).toBe(first.lead.lead_id);

    await expect(createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'different_wx', displayName: null, note: null,
    }, command(preSales(), 'lead-replay-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const followed = await followUpAcquisitionLead(database, {
      leadId: first.lead.lead_id, expectedVersion: 1, note: '再次跟进',
    }, command(preSales(), 'lead-follow-0001', JAN_1_2025 + 1000));
    expect(followed.lead.version).toBe(2);
    await expect(invalidateAcquisitionLead(database, {
      leadId: first.lead.lead_id, expectedVersion: 1, reason: '错误重复',
    }, command(preSales(), 'lead-invalid-0001', JAN_1_2025 + 2000)))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('applies staff scope before pagination and keeps origin attribution after transfer', async () => {
    database = db();
    const ownChannel = await seedChannel(database, 'XHS_OWN');
    const otherChannel = await seedChannel(database, 'XHS_OTHER');
    await seedAssignment(database, 'staff-pre', 'BUYER', ownChannel.channel.channel_id);
    await seedAssignment(database, 'staff-pre-other', 'BUYER', otherChannel.channel.channel_id);
    const own = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'own_page_wx', displayName: null, note: null,
    }, command(preSales(), 'page-own-0001', JAN_1_2025), SECRET);
    for (const [index, wechat] of ['other_page_1','other_page_2'].entries()) {
      await createAcquisitionLead(database, {
        leadType: 'BUYER', wechatId: wechat, displayName: null, note: null,
      }, command(auth('pre_sales','staff-pre-other'), `page-other-000${index + 1}`,
        JAN_1_2025 + index + 1), SECRET);
    }
    const page = await listAcquisitionLeads(database, preSales(), {
      leadType: 'BUYER', cursor: null, limit: 1,
    });
    expect(page.items.map((item) => item.lead_id)).toEqual([own.lead.lead_id]);

    const transferred = await transferAcquisitionLead(database, {
      leadId: own.lead.lead_id, expectedVersion: 1,
      newOwnerStaffId: 'staff-pre-other', reason: '负责人调整',
    }, command(preSales(), 'transfer-origin-0001', JAN_1_2025 + 10));
    expect(transferred.lead).toMatchObject({
      origin_staff_id: 'staff-pre', current_owner_staff_id: 'staff-pre-other',
    });
  });

  it('records Beijing-date aggregate corrections with immutable event history', async () => {
    database = db();
    const channel = await seedChannel(database, 'XHS_BUYER');
    const sellerChannel = await seedChannel(database, 'XHS_SELLER');
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    await seedAssignment(database, 'staff-seller', 'SELLER', sellerChannel.channel.channel_id);
    const first = await recordAcquisitionConsultation(database, {
      channelId: channel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 12, expectedVersion: 0, reason: '每日汇总',
    }, command(owner(), 'consultation-0001', JAN_1_2025));
    const corrected = await recordAcquisitionConsultation(database, {
      channelId: channel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 11, expectedVersion: 1, reason: '去除渠道内重复咨询',
    }, command(owner(), 'consultation-0002', JAN_1_2025 + 1000));
    expect(first.consultation.version).toBe(1);
    expect(corrected.consultation).toMatchObject({
      lead_type: 'BUYER', person_count: 11, version: 2,
    });
    expect(database.raw.prepare(`SELECT previous_count,next_count
      FROM acquisition_daily_consultation_events ORDER BY created_at`).all())
      .toEqual([{ previous_count: null, next_count: 12 }, { previous_count: 12, next_count: 11 }]);
    await expect(recordAcquisitionConsultation(database, {
      channelId: channel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 10, expectedVersion: 1, reason: '过期版本',
    }, command(owner(), 'consultation-0003', JAN_1_2025 + 2000)))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    await recordAcquisitionConsultation(database, {
      channelId: sellerChannel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 7, expectedVersion: 0, reason: '卖家每日汇总',
    }, command(owner(), 'consultation-seller-0001', JAN_1_2025));
    const funnel = await readAcquisitionFunnel(database, owner(), {
      fromDate: '2025-01-01', toDate: '2025-01-01',
    });
    expect(funnel.buyer?.consultation_count).toBe(11);
    expect(funnel.seller?.consultation_count).toBe(7);
  });

  it('fails closed for missing/overlapping configuration and buyer_refund', async () => {
    database = db();
    await expect(createAcquisitionChannel(database, {
      code: 'FORBIDDEN_CHANNEL', channelType: 'OTHER', displayName: '无权渠道',
    }, command(preSales(), 'forbidden-channel-0001', JAN_1_2025)))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'missing_channel', displayName: null, note: null,
    }, command(preSales(), 'missing-channel-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'CHANNEL_CONFIGURATION_MISSING' });

    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    await expect(createAcquisitionAssignment(database, {
      staffId: 'staff-pre', leadType: 'BUYER', channelId: channel.channel.channel_id,
      effectiveFrom: JAN_1_2025 + 1, effectiveUntil: null,
    }, command(owner(), 'assignment-overlap-0001', JAN_1_2025)))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(createAcquisitionAssignment(database, {
      staffId: 'staff-seller', leadType: 'SELLER', channelId: channel.channel.channel_id,
      effectiveFrom: 0, effectiveUntil: null,
    }, command(owner(), 'assignment-cross-type-0001', JAN_1_2025)))
      .rejects.toMatchObject({ code: 'CONFLICT' });

    await expect(createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'refund_forbidden', displayName: null, note: null,
    }, command(buyerRefund(), 'refund-forbidden-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createAcquisitionLead(database, {
      leadType: 'SELLER', wechatId: 'wrong_duty', displayName: null, note: null,
    }, command(preSales(), 'wrong-duty-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('acquisition automatic linking and retention', () => {
  it('links an existing Buyer identity and permanently exits 未参加 after a reservation link', async () => {
    database = db();
    seedBuyerIdentity(database, 'linked_wx');
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    const result = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'linked_wx', displayName: null, note: null,
    }, command(preSales(), 'linked-lead-0001', JAN_1_2025), SECRET);
    expect(result.lead.registered).toBe(true);
    expect(result.lead.no_participation).toBe(true);
    database.raw.prepare(`INSERT INTO acquisition_lead_links (
      id,lead_id,link_type,target_id,linked_at
    ) VALUES ('reservation-link-test',?,'RESERVATION','reservation-ever',?)`)
      .run(result.lead.lead_id, JAN_1_2025 + 2 * 24 * 60 * 60 * 1000);
    const after = await import('./leads').then((module) => module.readAcquisitionLead(
      database!, preSales(), result.lead.lead_id,
    ));
    expect(after.reservation_submitted).toBe(true);
    expect(after.no_participation).toBe(false);
    expect(after.created_business_date).toBe('2025-01-01');
  });

  it('records Seller cooperation when the linked identity first becomes an ACTIVE member', async () => {
    database = db();
    seedSellerIdentity(database, 'seller_linked_wx');
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-seller', 'SELLER', channel.channel.channel_id);
    const result = await createAcquisitionLead(database, {
      leadType: 'SELLER', wechatId: 'seller_linked_wx', displayName: null, note: null,
    }, command(sellerOps(), 'seller-linked-0001', JAN_1_2025), SECRET);
    expect(result.lead.seller_cooperation).toBe(false);

    database.raw.prepare(`UPDATE seller_organization_members SET
      status='ACTIVE',version=version+1,activated_at=?,disabled_at=NULL,updated_at=?
      WHERE id='seller-member-linked'`).run(JAN_1_2025 + 1, JAN_1_2025 + 1);
    await runAcquisitionMaintenance(database, {
      identitySecret: SECRET, now: JAN_1_2025 + 2,
    });
    const after = await import('./leads').then((module) => module.readAcquisitionLead(
      database!, sellerOps(), result.lead.lead_id,
    ));
    expect(after.seller_cooperation).toBe(true);

    database.raw.prepare(`UPDATE seller_organization_members SET
      status='DISABLED',version=version+1,disabled_at=?,updated_at=?
      WHERE id='seller-member-linked'`).run(JAN_1_2025 + 3, JAN_1_2025 + 3);
    const historical = await import('./leads').then((module) => module.readAcquisitionLead(
      database!, sellerOps(), result.lead.lead_id,
    ));
    expect(historical.seller_cooperation).toBe(true);
  });

  it('attributes a shared order profit once to Buyer origin and never to Seller funnel', async () => {
    database = db();
    const channel = await seedChannel(database, 'XHS_BUYER');
    const sellerChannel = await seedChannel(database, 'XHS_SELLER');
    await seedAssignment(database, 'staff-owner-acq', 'BUYER', channel.channel.channel_id);
    await seedAssignment(database, 'staff-owner-acq', 'SELLER', sellerChannel.channel.channel_id);
    const buyer = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'profit_buyer_wx', displayName: null, note: null,
    }, command(owner(), 'profit-buyer-0001', JAN_1_2025), SECRET);
    const seller = await createAcquisitionLead(database, {
      leadType: 'SELLER', wechatId: 'profit_seller_wx', displayName: null, note: null,
    }, command(owner(), 'profit-seller-0001', JAN_1_2025 + 1), SECRET);
    database.raw.prepare(`INSERT INTO acquisition_lead_links
      (id,lead_id,link_type,target_id,linked_at) VALUES
      ('profit-link-buyer',?,'FORMAL_ORDER','shared-order',?),
      ('profit-link-seller',?,'FORMAL_ORDER','shared-order',?)`)
      .run(buyer.lead.lead_id, JAN_1_2025 + 2,
        seller.lead.lead_id, JAN_1_2025 + 2);
    database.exec(`DROP VIEW internal_order_finance_positions;
      CREATE TABLE internal_order_finance_positions (
        formal_order_id TEXT PRIMARY KEY,
        projected_gross_profit_cny_fen TEXT,
        completed_gross_profit_cny_fen TEXT
      ) STRICT;
      INSERT INTO internal_order_finance_positions VALUES ('shared-order','2500','2100');`);

    const funnel = await readAcquisitionFunnel(database, owner(), {
      fromDate: '2025-01-01', toDate: '2025-01-01',
    });
    expect(funnel.buyer).toMatchObject({
      formal_order_count: 1,
      projected_gross_profit_cny_fen: '2500',
      completed_gross_profit_cny_fen: '2100',
    });
    expect(funnel.seller).toEqual({
      consultation_count: 0, wechat_added_count: 1, cooperation_count: 0,
    });
    expect(funnel.seller).not.toHaveProperty('projected_gross_profit_cny_fen');
    expect(funnel.seller).not.toHaveProperty('completed_gross_profit_cny_fen');
  });

  it('anonymizes only expired unconverted leads and is retry-safe', async () => {
    database = db();
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    const old = Date.UTC(2023,1,28,16);
    const preserved = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'old_preserved', displayName: null, note: null,
    }, command(preSales(), 'old-lead-0001', old), SECRET);
    const anonymous = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'old_unconverted', displayName: '应删除姓名', note: '应删除备注',
    }, command(preSales(), 'old-lead-0002', old + 1), SECRET);
    database.raw.prepare(`INSERT INTO acquisition_lead_links (
      id,lead_id,link_type,target_id,linked_at
    ) VALUES ('buyer-link-preserved',?,'BUYER_CUSTOMER','buyer-fact',?)`)
      .run(preserved.lead.lead_id, old + 2);

    const now = Date.UTC(2024,1,29,16) + 1;
    const run = await runAcquisitionMaintenance(database, {
      identitySecret: SECRET, now, limit: 1,
    });
    expect(run).toMatchObject({ outcome: 'SUCCEEDED', anonymized_count: 1, exempt_count: 1 });
    expect(database.raw.prepare(`SELECT status,identity_hash,identity_ciphertext,
      display_name,note FROM acquisition_leads WHERE id=?`)
      .get(anonymous.lead.lead_id)).toEqual({
        status: 'ANONYMIZED', identity_hash: null, identity_ciphertext: null,
        display_name: null, note: null,
      });
    expect(database.raw.prepare(`SELECT status FROM acquisition_leads WHERE id=?`)
      .get(preserved.lead.lead_id)).toEqual({ status: 'ACTIVE' });
    const replay = await runAcquisitionMaintenance(database, { identitySecret: SECRET, now: now + 1 });
    expect(replay.anonymized_count).toBe(0);
  });

  it('advances the identity-link cursor so a small batch cannot starve later claims', async () => {
    database = db();
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    const lead = await createAcquisitionLead(database, {
      leadType: 'BUYER', wechatId: 'late_link_wx', displayName: null, note: null,
    }, command(preSales(), 'late-link-lead-0001', JAN_1_2025), SECRET);
    database.exec(`
      INSERT INTO customer_identity_subjects (id,subject_type,created_at)
        VALUES ('subject-dummy','BUYER_CUSTOMER',1000);
      INSERT INTO wechat_identity_claims (id,identity_subject_id,display_wechat,
        normalized_wechat,status,version,acquired_at,reserved_at,released_at,
        created_at,updated_at) VALUES
        ('000-claim-dummy','subject-dummy','dummy_wx','dummy_wx','ACTIVE',1,
          1000,NULL,NULL,1000,1000);
    `);
    seedBuyerIdentity(database, 'late_link_wx');

    const first = await runAcquisitionMaintenance(database, {
      identitySecret: SECRET, now: JAN_1_2025 + 1, limit: 1,
    });
    expect(first.linked_count).toBe(0);
    const second = await runAcquisitionMaintenance(database, {
      identitySecret: SECRET, now: JAN_1_2025 + 2, limit: 1,
    });
    expect(second.linked_count).toBeGreaterThan(0);
    const after = await import('./leads').then((module) => module.readAcquisitionLead(
      database!, preSales(), lead.lead.lead_id,
    ));
    expect(after.registered).toBe(true);
  });

  it('uses twelve Shanghai calendar months and clamps leap day', () => {
    expect(addTwelveShanghaiMonths(Date.UTC(2024,1,29,4)))
      .toBe(Date.UTC(2025,1,28,4));
  });
});

function db(): SqliteDatabase {
  const value = createMigratedTestDatabase();
  value.exec(`
    INSERT INTO staff_users (id,display_name,status,authorization_version,version,
      created_at,updated_at,disabled_at,session_version) VALUES
      ('staff-owner-acq','总管理员','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-pre','售前','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-pre-other','售前乙','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-seller','卖家对接','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-refund','买家返款','ACTIVE',1,1,1000,1000,NULL,1);
    INSERT INTO staff_role_assignments (staff_id,role_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,created_at,updated_at) VALUES
      ('staff-owner-acq','owner','ACTIVE',NULL,1000,NULL,1000,1000),
      ('staff-pre','pre_sales','ACTIVE','staff-owner-acq',1000,NULL,1000,1000),
      ('staff-pre-other','pre_sales','ACTIVE','staff-owner-acq',1000,NULL,1000,1000),
      ('staff-seller','seller_ops','ACTIVE','staff-owner-acq',1000,NULL,1000,1000),
      ('staff-refund','buyer_refund','ACTIVE','staff-owner-acq',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (staff_id,team_id,status,joined_at,ended_at,
      created_at,updated_at) VALUES
      ('staff-pre','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-seller','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-refund','phase3h-test-team','ACTIVE',1000,NULL,1000,1000);
  `);
  return value;
}

async function seedChannel(db: SqliteDatabase, code = 'XHS_A') {
  return createAcquisitionChannel(db, {
    code, channelType: 'XIAOHONGSHU', displayName: `小红书账号 ${code}`,
  }, command(owner(), `channel-${crypto.randomUUID()}`, JAN_1_2025));
}
async function seedAssignment(
  db: SqliteDatabase,
  staffId: string,
  leadType: AcquisitionLeadType,
  channelId: string,
) {
  return createAcquisitionAssignment(db, {
    staffId, leadType, channelId, effectiveFrom: 0, effectiveUntil: null,
  }, command(owner(), `assignment-${crypto.randomUUID()}`, JAN_1_2025));
}
function command(actor: AssignmentStaffAuthorization, idempotencyKey: string, now: number) {
  return { actor, idempotencyKey, requestId: `request-${idempotencyKey}`, now };
}
function auth(role: StaffRoleCode, staffId: string): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]), grants: new Set<StaffPermissionCode>(),
    denies: new Set<StaffPermissionCode>(),
    memberTeamIds: role === 'owner' ? [] : ['phase3h-test-team'], leaderTeamIds: [],
  });
  return { staffId, displayName: staffId, staffStatus: 'ACTIVE',
    authorizationVersion: 1, ...effective };
}
function owner() { return auth('owner','staff-owner-acq'); }
function preSales() { return auth('pre_sales','staff-pre'); }
function sellerOps() { return auth('seller_ops','staff-seller'); }
function buyerRefund() { return auth('buyer_refund','staff-refund'); }

function seedBuyerIdentity(db: SqliteDatabase, wechat: string): void {
  db.exec(`
    INSERT INTO buyer_channels (id,code,name,status,next_sequence,version,
      created_at,updated_at,disabled_at) VALUES
      ('buyer-channel-linked','LNK','关联买家','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO customer_identity_subjects (id,subject_type,created_at)
      VALUES ('subject-linked','BUYER_CUSTOMER',1000);
    INSERT INTO buyer_customers (id,identity_subject_id,marketplace_code,
      buyer_channel_id,buyer_customer_no,buyer_sequence,
      first_valid_order_business_date,display_name,access_status,
      identity_review_status,version,created_at,updated_at,activated_at,disabled_at)
      VALUES ('buyer-linked','subject-linked','JP','buyer-channel-linked',
        NULL,NULL,NULL,'关联买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
    INSERT INTO wechat_identity_claims (id,identity_subject_id,display_wechat,
      normalized_wechat,status,version,acquired_at,reserved_at,released_at,
      created_at,updated_at) VALUES
      ('claim-linked','subject-linked','${wechat}','${wechat}','ACTIVE',1,
        1000,NULL,NULL,1000,1000);
  `);
}

function seedSellerIdentity(db: SqliteDatabase, wechat: string): void {
  db.exec(`
    INSERT INTO customer_identity_subjects (id,subject_type,created_at)
      VALUES ('subject-seller-linked','SELLER_ORG_MEMBER',1000);
    INSERT INTO seller_organizations (id,marketplace_code,seller_code,
      origin_channel_id,current_channel_id,seller_sequence,organization_name,status,
      version,created_at,updated_at,activated_at,disabled_at)
      VALUES ('seller-org-linked','JP','SELLER-LINKED','seller-channel-ido-mango',
        'seller-channel-ido-mango',999,'关联卖家','ACTIVE',1,1000,1000,1000,NULL);
    INSERT INTO seller_organization_members (id,identity_subject_id,organization_id,
      member_number,username_fallback,display_name,role,primary_owner,status,version,
      created_at,updated_at,activated_at,disabled_at)
      VALUES ('seller-member-linked','subject-seller-linked','seller-org-linked',1,
        'seller-linked-user','关联成员','OWNER',1,'DISABLED',1,1000,1000,NULL,1000);
    INSERT INTO wechat_identity_claims (id,identity_subject_id,display_wechat,
      normalized_wechat,status,version,acquired_at,reserved_at,released_at,
      created_at,updated_at) VALUES
      ('claim-seller-linked','subject-seller-linked','${wechat}','${wechat}',
        'ACTIVE',1,1000,NULL,NULL,1000,1000);
  `);
}
