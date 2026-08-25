import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type {
  AcquisitionLeadType,
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import {
  createAcquisitionAssignment,
  createAcquisitionChannel,
  disableAcquisitionChannel,
  listAcquisitionConsultationHistory,
  listAcquisitionConsultations,
  recordAcquisitionConsultation,
} from './admin';
import {
  createAcquisitionLead,
  followUpAcquisitionLead,
  invalidateAcquisitionLead,
  listAcquisitionLeads,
  transferAcquisitionLead,
} from './leads';
import { runAcquisitionMaintenance } from './maintenance';
import { channelProfitForActor } from './channel-stats';
import { createAcquisitionProspect } from './prospects';
import { addTwelveShanghaiMonths } from './time';

const SECRET = 'acquisition-test-secret-with-at-least-thirty-two-bytes';
const JAN_1_2025 = Date.UTC(2025,0,1,4);
let database: SqliteDatabase|null = null;

afterEach(() => { database?.close(); database = null; });

describe('staff acquisition funnel commands', () => {
  it('exposes channel profit only to an owner with FINANCIAL_VIEW', () => {
    const rows = [{ formal_order_id: 'order-1', projected: '2500', completed: '2100' }];
    expect(channelProfitForActor(owner(), rows)).toEqual({ projected: '2500', completed: '2100' });
    expect(channelProfitForActor(acquisition(), rows)).toEqual({ projected: null, completed: null });
    const deniedOwner = calculateEffectiveStaffAuthorization({
      roles: new Set<StaffRoleCode>(['owner']), grants: new Set<StaffPermissionCode>(),
      denies: new Set<StaffPermissionCode>(['FINANCIAL_VIEW']), memberTeamIds: [], leaderTeamIds: [],
    });
    expect(channelProfitForActor(deniedOwner, rows)).toEqual({ projected: null, completed: null });
  });

  it('accepts an explicit legal direct source, protects WeChat, freezes origin and deduplicates per type', async () => {
    database = db();
    const channel = await seedChannel(database, 'XHS_BUYER');
    const sellerChannel = await seedChannel(database, 'XHS_SELLER');
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    await seedAssignment(database, 'staff-seller', 'SELLER', sellerChannel.channel.channel_id);

    const buyer = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: '  ＹＧＢ_Test-01  ',
      displayName: '买家甲', note: '已添加私人微信',
    }), command(preSales(), 'lead-create-0001', JAN_1_2025), SECRET);
    expect(buyer.lead).toMatchObject({
      lead_type: 'BUYER', origin_channel_id: channel.channel.channel_id,
      current_owner_staff_id: 'staff-pre',
      wechat_masked: 'YGB_Test-01', no_participation: true,
    });
    expect(buyer.lead).not.toHaveProperty('origin_staff_id');

    await expect(createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'ygb_test-01', displayName: null, note: null,
    }), command(preSales(), 'lead-create-0002', JAN_1_2025 + 1), SECRET))
      .rejects.toMatchObject({ code: 'DUPLICATE_LEAD' });

    const seller = await createAcquisitionLead(database, leadInput(sellerChannel.channel.channel_id, {
      leadType: 'SELLER', wechatId: 'ygb_test-01', displayName: null, note: null,
    }), command(sellerOps(), 'lead-create-0003', JAN_1_2025 + 2), SECRET);
    expect(seller.lead.lead_type).toBe('SELLER');

    // The new seller organization is born with the business-default service
    // fees (评分35/文字60/图片70/视频85), already CONFIRMED in the same
    // transaction, so order approval is never blocked by a fresh org.
    const organizationId = (database.raw.prepare(
      `SELECT target_id AS id FROM acquisition_lead_links
       WHERE lead_id=? AND link_type='SELLER_ORGANIZATION'`,
    ).get(seller.lead.lead_id) as { id: string })['id'];
    const seededFees = database.raw.prepare(
      `SELECT review_type, version_no, status, fee_cny_fen, effective_from
       FROM seller_service_fee_versions WHERE organization_id=? ORDER BY review_type`,
    ).all(organizationId) as unknown as Record<string, unknown>[];
    expect(seededFees).toEqual([
      { review_type: 'IMAGE', version_no: 1, status: 'CONFIRMED', fee_cny_fen: 7000, effective_from: JAN_1_2025 + 2 + 60_000 },
      { review_type: 'RATING', version_no: 1, status: 'CONFIRMED', fee_cny_fen: 3500, effective_from: JAN_1_2025 + 2 + 60_000 },
      { review_type: 'TEXT', version_no: 1, status: 'CONFIRMED', fee_cny_fen: 6000, effective_from: JAN_1_2025 + 2 + 60_000 },
      { review_type: 'VIDEO', version_no: 1, status: 'CONFIRMED', fee_cny_fen: 8500, effective_from: JAN_1_2025 + 2 + 60_000 },
    ]);

    const stored = database.raw.prepare(`SELECT identity_hash,identity_ciphertext,
      identity_iv,origin_staff_id,origin_channel_id FROM acquisition_leads
      WHERE id=?`).get(buyer.lead.lead_id)!;
    expect(stored['identity_hash']).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(stored)).not.toContain('ygb_test-01');
    await expect(import('./leads').then((module) => module.readAcquisitionLead(
      database!, auth('pre_sales','staff-pre-other'), buyer.lead.lead_id,
    ))).resolves.toMatchObject({lead_id:buyer.lead.lead_id,marketplace_code:'AMAZON_JP'});
    expect(() => database!.raw.prepare(`UPDATE acquisition_leads
      SET origin_staff_id='staff-seller',version=version+1,updated_at=updated_at+1
      WHERE id=?`).run(buyer.lead.lead_id)).toThrow(/immutable_origin/iu);
  });

  it('fails closed for disabled, wrong-audience, wrong-market and out-of-scope declared channels', async () => {
    database = db();
    const activeBuyer = await seedChannel(database, 'SOURCE_ACTIVE');
    const disabledBuyer = await seedChannel(database, 'SOURCE_DISABLED');
    const seller = await seedChannel(database, 'SOURCE_SELLER');
    const usBuyer = await seedChannel(database, 'SOURCE_US', 'BUYER', 'AMAZON_US');
    await disableAcquisitionChannel(database, {
      channelId: disabledBuyer.channel.channel_id, expectedVersion: 1, reason: '渠道已停用',
    }, command(owner(), 'disable-source-0001', JAN_1_2025));

    await expect(createAcquisitionLead(database, leadInput(disabledBuyer.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'disabled_source_wx', displayName: null, note: null,
    }), command(preSales(), 'disabled-source-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(createAcquisitionLead(database, leadInput(seller.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'wrong_audience_wx', displayName: null, note: null,
    }), command(preSales(), 'wrong-audience-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(createAcquisitionLead(database, leadInput(activeBuyer.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'wrong_market_wx', displayName: null, note: null,
    }, 'AMAZON_US'), command(preSales(), 'wrong-market-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createAcquisitionLead(database, leadInput(usBuyer.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'out_of_scope_wx', displayName: null, note: null,
    }, 'AMAZON_US'), command(preSales(), 'out-of-scope-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('inherits a Prospect exact origin and rejects a mismatched declared channel', async () => {
    database = db();
    const prospectChannel = await seedChannel(database, 'SOURCE_PROSPECT');
    const otherChannel = await seedChannel(database, 'SOURCE_OTHER');
    const prospect = await createAcquisitionProspect(database, {
      leadType: 'BUYER', marketplaceCode: 'AMAZON_JP', channelId: prospectChannel.channel.channel_id,
      displayName: '待转买家', contactValue: null, sourceUrl: 'https://example.test/prospect',
      note: null,
    }, command(owner(), 'prospect-source-0001', JAN_1_2025));

    await expect(createAcquisitionLead(database, {
      leadType: 'BUYER', marketplaceCode: 'AMAZON_JP', channelId: otherChannel.channel.channel_id,
      prospectId: prospect.prospect.prospect_id, wechatId: 'mismatched_prospect_wx', displayName: null, note: null,
    }, command(preSales(), 'prospect-source-mismatch-0001', JAN_1_2025 + 1), SECRET))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const inherited = await createAcquisitionLead(database, {
      leadType: 'BUYER', marketplaceCode: 'AMAZON_JP', channelId: prospectChannel.channel.channel_id,
      prospectId: prospect.prospect.prospect_id, wechatId: 'inherited_prospect_wx', displayName: null, note: null,
    }, command(preSales(), 'prospect-source-inherit-0001', JAN_1_2025 + 2), SECRET);
    expect(inherited.lead).toMatchObject({ origin_channel_id: prospectChannel.channel.channel_id });
    expect(database.raw.prepare(`SELECT prospect_id,origin_channel_id,origin_source_url FROM acquisition_leads WHERE id=?`)
      .get(inherited.lead.lead_id)).toEqual({
        prospect_id: prospect.prospect.prospect_id,
        origin_channel_id: prospectChannel.channel.channel_id,
        origin_source_url: 'https://example.test/prospect',
      });
  });

  it('replays identical commands, rejects hash reuse and enforces versions', async () => {
    database = db();
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    const first = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'replay_wx', displayName: null, note: null,
    }), command(preSales(), 'lead-replay-0001', JAN_1_2025), SECRET);
    const replay = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'replay_wx', displayName: null, note: null,
    }), command(preSales(), 'lead-replay-0001', JAN_1_2025), SECRET);
    expect(replay.replayed).toBe(true);
    expect(replay.lead.lead_id).toBe(first.lead.lead_id);

    await expect(createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'different_wx', displayName: null, note: null,
    }), command(preSales(), 'lead-replay-0001', JAN_1_2025), SECRET))
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
    const otherChannel = await seedChannel(database, 'XHS_OTHER', 'BUYER', 'AMAZON_US');
    await seedAssignment(database, 'staff-pre', 'BUYER', ownChannel.channel.channel_id);
    await seedAssignment(database, 'staff-pre-other', 'BUYER', otherChannel.channel.channel_id);
    const own = await createAcquisitionLead(database, leadInput(ownChannel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'own_page_wx', displayName: null, note: null,
    }), command(preSales(), 'page-own-0001', JAN_1_2025), SECRET);
    for (const [index, wechat] of ['other_page_1','other_page_2'].entries()) {
      await createAcquisitionLead(database, leadInput(otherChannel.channel.channel_id, {
        leadType: 'BUYER', wechatId: wechat, displayName: null, note: null,
      }, 'AMAZON_US'), command(auth('pre_sales','staff-pre-other'), `page-other-000${index + 1}`,
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
    expect(transferred.lead).toMatchObject({ current_owner_staff_id: 'staff-pre-other' });
    expect(database.raw.prepare(`SELECT origin_staff_id FROM acquisition_leads WHERE id=?`)
      .get(own.lead.lead_id)).toEqual({ origin_staff_id: 'staff-pre' });
  });

  it('lets only owner record, replay and correct consultation counts with complete integrity facts', async () => {
    database = db();
    const channel = await seedChannel(database, 'XHS_BUYER');
    const recordInput = {
      channelId: channel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 12, expectedVersion: 0, reason: '每日汇总',
    };
    const first = await recordAcquisitionConsultation(database, recordInput,
      command(owner(), 'consultation-0001', JAN_1_2025));
    const replay = await recordAcquisitionConsultation(database, recordInput,
      command(owner(), 'consultation-0001', JAN_1_2025 + 1));
    expect(replay).toMatchObject({ replayed: true,
      consultation: { consultation_id: first.consultation.consultation_id, version: 1 } });
    await expect(recordAcquisitionConsultation(database, {
      ...recordInput, personCount: 13,
    }, command(owner(), 'consultation-0001', JAN_1_2025 + 2)))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const corrected = await recordAcquisitionConsultation(database, {
      channelId: channel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 11, expectedVersion: 1, reason: '去除渠道内重复咨询',
    }, command(owner(), 'consultation-0002', JAN_1_2025 + 1000));
    expect(corrected.consultation).toMatchObject({
      lead_type: 'BUYER', person_count: 11, version: 2,
    });
    await expect(recordAcquisitionConsultation(database, {
      channelId: channel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 10, expectedVersion: 1, reason: '过期版本',
    }, command(owner(), 'consultation-0003', JAN_1_2025 + 2000)))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

    const forgedAcquisitionAdmin = { ...acquisition(),
      permissions: new Set<StaffPermissionCode>(['ACQUISITION_ADMIN']) };
    for (const [index, actor] of [acquisition(), forgedAcquisitionAdmin,
      preSales(), sellerOps(), buyerRefund()].entries()) {
      await expect(recordAcquisitionConsultation(database, {
        ...recordInput, businessDate: `2025-01-${String(index + 2).padStart(2, '0')}`,
      }, command(actor, `consultation-forbidden-${index}`, JAN_1_2025 + 3000 + index)))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
    }

    expect(database.raw.prepare(`SELECT previous_count,next_count
      FROM acquisition_daily_consultation_events ORDER BY created_at`).all())
      .toEqual([{ previous_count: null, next_count: 12 }, { previous_count: 12, next_count: 11 }]);
    expect(database.raw.prepare(`SELECT event_type,previous_state_json,next_state_json
      FROM audit_events WHERE aggregate_type='ACQUISITION_DAILY_CONSULTATION'
      ORDER BY created_at`).all()).toEqual([
      { event_type: 'ACQUISITION_CONSULTATION_RECORDED', previous_state_json: null,
        next_state_json: expect.stringContaining('"person_count":12') },
      { event_type: 'ACQUISITION_CONSULTATION_CORRECTED',
        previous_state_json: expect.stringContaining('"person_count":12'),
        next_state_json: expect.stringContaining('"person_count":11') },
    ]);
    expect(database.raw.prepare(`SELECT status,error_code,COUNT(*) AS count
      FROM command_idempotency_records WHERE action='RECORD_ACQUISITION_CONSULTATION'
      GROUP BY status,error_code ORDER BY status`).all()).toEqual([
      { status: 'COMMITTED', error_code: null, count: 2 },
      { status: 'FAILED', error_code: 'ACQUISITION_COMMAND_FAILED', count: 1 },
    ]);
  });

  it('rolls back consultation facts and cleans idempotency when the final assertion fails', async () => {
    database = db();
    const channel = await seedChannel(database, 'XHS_ASSERTION');
    database.exec(`CREATE TRIGGER test_corrupt_consultation_after_insert
      AFTER INSERT ON acquisition_daily_consultations
      BEGIN
        UPDATE acquisition_daily_consultations
        SET person_count=NEW.person_count+1 WHERE id=NEW.id;
      END;`);

    let failure: unknown;
    try {
      await recordAcquisitionConsultation(database, {
        channelId: channel.channel.channel_id, businessDate: '2025-01-01',
        personCount: 12, expectedVersion: 0, reason: '锁定事务最终断言',
      }, command(owner(), 'consultation-assertion-0001', JAN_1_2025));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toMatchObject({ code: 'VERSION_CONFLICT' });

    expect(database.raw.prepare(`SELECT
      (SELECT COUNT(*) FROM acquisition_daily_consultations) AS consultations,
      (SELECT COUNT(*) FROM acquisition_daily_consultation_events) AS events,
      (SELECT COUNT(*) FROM audit_events
        WHERE aggregate_type='ACQUISITION_DAILY_CONSULTATION') AS audits,
      (SELECT COUNT(*) FROM command_idempotency_records
        WHERE action='RECORD_ACQUISITION_CONSULTATION' AND status='COMMITTED') AS committed`).get())
      .toEqual({ consultations: 0, events: 0, audits: 0, committed: 0 });
    expect(database.raw.prepare(`SELECT status,error_code,response_json
      FROM command_idempotency_records
      WHERE action='RECORD_ACQUISITION_CONSULTATION'`).get())
      .toEqual({ status: 'FAILED', error_code: 'ACQUISITION_COMMAND_FAILED', response_json: null });
  });

  it('rejects a stale same-target correction in the commit window without ghost facts', async () => {
    database = db();
    const channel = await seedChannel(database, 'XHS_COMMIT_RACE');
    const initial = await recordAcquisitionConsultation(database, {
      channelId: channel.channel.channel_id, businessDate: '2025-01-01',
      personCount: 12, expectedVersion: 0, reason: '初始咨询人数',
    }, command(owner(), 'consultation-race-initial', JAN_1_2025));
    const targetCount = 15;
    const winnerKey = 'consultation-race-winner';
    const loserKey = 'consultation-race-loser';
    const racingDatabase = new ConsultationCommitWindowRaceDatabase(
      database,
      async () => recordAcquisitionConsultation(database!, {
        channelId: channel.channel.channel_id, businessDate: '2025-01-01',
        personCount: targetCount, expectedVersion: 1, reason: '竞争胜出请求',
      }, command(owner(), winnerKey, JAN_1_2025 + 1)),
    );

    let failure: unknown;
    try {
      await recordAcquisitionConsultation(racingDatabase, {
        channelId: channel.channel.channel_id, businessDate: '2025-01-01',
        personCount: targetCount, expectedVersion: 1, reason: '竞争落败请求',
      }, command(owner(), loserKey, JAN_1_2025 + 2));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(database.raw.prepare(`SELECT person_count,version
      FROM acquisition_daily_consultations WHERE id=?`)
      .get(initial.consultation.consultation_id)).toEqual({ person_count: targetCount, version: 2 });
    expect(database.raw.prepare(`SELECT idempotency_key,COUNT(*) AS count
      FROM acquisition_daily_consultation_events
      WHERE consultation_id=? GROUP BY idempotency_key ORDER BY idempotency_key`)
      .all(initial.consultation.consultation_id)).toEqual([
      { idempotency_key: 'consultation-race-initial', count: 1 },
      { idempotency_key: winnerKey, count: 1 },
    ]);
    expect(database.raw.prepare(`SELECT idempotency_key,COUNT(*) AS count
      FROM audit_events WHERE aggregate_type='ACQUISITION_DAILY_CONSULTATION'
      GROUP BY idempotency_key ORDER BY idempotency_key`).all()).toEqual([
      { idempotency_key: 'consultation-race-initial', count: 1 },
      { idempotency_key: winnerKey, count: 1 },
    ]);
    expect(database.raw.prepare(`SELECT idempotency_key,status,error_code,response_json
      FROM command_idempotency_records
      WHERE action='RECORD_ACQUISITION_CONSULTATION'
      ORDER BY idempotency_key`).all()).toEqual([
      { idempotency_key: 'consultation-race-initial', status: 'COMMITTED',
        error_code: null, response_json: expect.any(String) },
      { idempotency_key: loserKey, status: 'FAILED',
        error_code: 'ACQUISITION_COMMAND_FAILED', response_json: null },
      { idempotency_key: winnerKey, status: 'COMMITTED',
        error_code: null, response_json: expect.any(String) },
    ]);
  });

  it('keeps acquisition operator reads scoped and conceals cross-market consultation history', async () => {
    database = db();
    const jp = await seedChannel(database, 'XHS_JP');
    const us = await seedChannel(database, 'XHS_US', 'BUYER', 'AMAZON_US');
    const jpConsultation = await recordAcquisitionConsultation(database, {
      channelId: jp.channel.channel_id, businessDate: '2025-01-01',
      personCount: 12, expectedVersion: 0, reason: '日本站汇总',
    }, command(owner(), 'consultation-history-jp', JAN_1_2025));
    const usConsultation = await recordAcquisitionConsultation(database, {
      channelId: us.channel.channel_id, businessDate: '2025-01-01',
      personCount: 7, expectedVersion: 0, reason: '美国站汇总',
    }, command(owner(), 'consultation-history-us', JAN_1_2025 + 1));

    await expect(listAcquisitionConsultations(database, acquisition(),
      '2025-01-01', '2025-01-01')).resolves.toMatchObject([
      { consultation_id: jpConsultation.consultation.consultation_id, person_count: 12 },
    ]);
    await expect(listAcquisitionConsultationHistory(database, acquisition(),
      jpConsultation.consultation.consultation_id)).resolves.toMatchObject([
      { event_type: 'RECORDED', next_count: 12 },
    ]);
    await expect(listAcquisitionConsultationHistory(database, acquisition(),
      usConsultation.consultation.consultation_id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listAcquisitionConsultationHistory(database, acquisition(),
      'missing-consultation')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const prospect = await createAcquisitionProspect(database, {
      leadType: 'BUYER', marketplaceCode: 'AMAZON_JP', channelId: jp.channel.channel_id,
      displayName: '获客角色潜在线索', contactValue: null, sourceUrl: null,
      note: null,
    }, command(acquisition(), 'acquisition-prospect-0001', JAN_1_2025 + 2));
    expect(prospect.prospect.marketplace_code).toBe('AMAZON_JP');
    await expect(listAcquisitionLeads(database, acquisition(), {
      leadType: null, cursor: null, limit: 25,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('fails closed for missing/overlapping configuration and buyer_refund', async () => {
    database = db();
    await expect(createAcquisitionChannel(database, {
      code: 'FORBIDDEN_CHANNEL', platformName: '其他', leadType: 'BUYER',
      marketplaceCode: 'AMAZON_JP', displayName: '无权渠道',
    }, command(preSales(), 'forbidden-channel-0001', JAN_1_2025)))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createAcquisitionLead(database, leadInput('missing-channel', {
      leadType: 'BUYER', wechatId: 'missing_channel', displayName: null, note: null,
    }), command(preSales(), 'missing-channel-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

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

    await expect(createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'refund_forbidden', displayName: null, note: null,
    }), command(buyerRefund(), 'refund-forbidden-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'SELLER', wechatId: 'wrong_duty', displayName: null, note: null,
    }), command(preSales(), 'wrong-duty-0001', JAN_1_2025), SECRET))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('acquisition automatic linking and retention', () => {
  it('links an existing Buyer identity and permanently exits 未参加 after a reservation link', async () => {
    database = db();
    seedBuyerIdentity(database, 'linked_wx');
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    const result = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'linked_wx', displayName: null, note: null,
    }), command(preSales(), 'linked-lead-0001', JAN_1_2025), SECRET);
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

  it('records Seller cooperation when the Seller lead is formally provisioned', async () => {
    database = db();
    seedSellerIdentity(database, 'seller_linked_wx');
    const channel = await seedChannel(database, 'XHS_SELLER');
    await seedAssignment(database, 'staff-seller', 'SELLER', channel.channel.channel_id);
    const result = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'SELLER', wechatId: 'seller_linked_wx', displayName: null, note: null,
    }), command(sellerOps(), 'seller-linked-0001', JAN_1_2025), SECRET);
    expect(result.lead.seller_cooperation).toBe(true);

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

  it('anonymizes only expired unconverted leads and is retry-safe', async () => {
    database = db();
    const channel = await seedChannel(database);
    await seedAssignment(database, 'staff-pre', 'BUYER', channel.channel.channel_id);
    const old = Date.UTC(2023,1,28,16);
    const preserved = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'old_preserved', displayName: null, note: null,
    }), command(preSales(), 'old-lead-0001', old), SECRET);
    const anonymous = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'old_unconverted', displayName: '应删除姓名', note: '应删除备注',
    }), command(preSales(), 'old-lead-0002', old + 1), SECRET);
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
    const lead = await createAcquisitionLead(database, leadInput(channel.channel.channel_id, {
      leadType: 'BUYER', wechatId: 'late_link_wx', displayName: null, note: null,
    }), command(preSales(), 'late-link-lead-0001', JAN_1_2025), SECRET);
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
      ('staff-acquisition','获客','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-seller','卖家对接','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-refund','买家返款','ACTIVE',1,1,1000,1000,NULL,1);
    INSERT INTO staff_role_assignments (staff_id,role_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,created_at,updated_at) VALUES
      ('staff-owner-acq','owner','ACTIVE',NULL,1000,NULL,1000,1000),
      ('staff-pre','pre_sales','ACTIVE','staff-owner-acq',1000,NULL,1000,1000),
      ('staff-pre-other','pre_sales','ACTIVE','staff-owner-acq',1000,NULL,1000,1000),
      ('staff-acquisition','acquisition','ACTIVE','staff-owner-acq',1000,NULL,1000,1000),
      ('staff-seller','seller_ops','ACTIVE','staff-owner-acq',1000,NULL,1000,1000),
      ('staff-refund','buyer_refund','ACTIVE','staff-owner-acq',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (staff_id,team_id,status,joined_at,ended_at,
      created_at,updated_at) VALUES
      ('staff-pre','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-acquisition','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-seller','phase3h-test-team','ACTIVE',1000,NULL,1000,1000),
      ('staff-refund','phase3h-test-team','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES
      ('scope-test-pre-primary','staff-pre','pre_sales','AMAZON_JP','ACTIVE','staff-owner-acq',1000,NULL,'TEST',1000,1000,'PRIMARY'),
      ('scope-test-pre-support','staff-pre-other','pre_sales','AMAZON_JP','ACTIVE','staff-owner-acq',1000,NULL,'TEST',1000,1000,'SUPPORT'),
      ('scope-test-pre-us-primary','staff-pre-other','pre_sales','AMAZON_US','ACTIVE','staff-owner-acq',1000,NULL,'TEST',1000,1000,'PRIMARY'),
      ('scope-test-acquisition-primary','staff-acquisition','acquisition','AMAZON_JP','ACTIVE','staff-owner-acq',1000,NULL,'TEST',1000,1000,'PRIMARY'),
      ('scope-test-seller-primary','staff-seller','seller_ops','AMAZON_JP','ACTIVE','staff-owner-acq',1000,NULL,'TEST',1000,1000,'PRIMARY'),
      ('scope-test-refund-primary','staff-refund','buyer_refund','AMAZON_JP','ACTIVE','staff-owner-acq',1000,NULL,'TEST',1000,1000,'PRIMARY');
    UPDATE seller_channels SET created_at=1000,updated_at=1000
    WHERE id='seller-channel-portal-onboarding';
  `);
  return value;
}

async function seedChannel(
  db: SqliteDatabase,
  code = 'XHS_A',
  leadType: AcquisitionLeadType = code.includes('SELLER') ? 'SELLER' : 'BUYER',
  marketplaceCode = 'AMAZON_JP',
) {
  const result = await createAcquisitionChannel(db, {
    code, platformName: '小红书', leadType,
    marketplaceCode, displayName: `小红书账号 ${code}`,
  }, command(owner(), `channel-${crypto.randomUUID()}`, JAN_1_2025));
  db.raw.prepare(`UPDATE acquisition_channel_privacy_profiles
    SET intake_wechat_label=?,version=version+1,updated_at=? WHERE channel_id=?`)
    .run(`${code}-测试工作微信`, JAN_1_2025, result.channel.channel_id);
  return result;
}
function leadInput<T extends { leadType: AcquisitionLeadType; wechatId: string;
  displayName: string|null; note: string|null }>(
  channelId: string,
  input: T,
  marketplaceCode = 'AMAZON_JP',
) {
  return { ...input, marketplaceCode, channelId, prospectId: null };
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
function acquisition() { return auth('acquisition','staff-acquisition'); }
function preSales() { return auth('pre_sales','staff-pre'); }
function sellerOps() { return auth('seller_ops','staff-seller'); }
function buyerRefund() { return auth('buyer_refund','staff-refund'); }

class ConsultationCommitWindowRaceDatabase implements SqlDatabase {
  private injected = false;

  constructor(
    private readonly target: SqlDatabase,
    private readonly win: () => Promise<unknown>,
  ) {}

  prepare(sql: string): SqlStatement {
    return this.target.prepare(sql);
  }

  async batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    if (!this.injected) {
      this.injected = true;
      await this.win();
    }
    return this.target.batch(statements);
  }
}

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
      VALUES ('buyer-linked','subject-linked','AMAZON_JP','buyer-channel-linked',
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
      VALUES ('seller-org-linked','AMAZON_JP','SELLER-LINKED','seller-channel-ido-mango',
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
