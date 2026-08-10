import { describe, expect, it } from 'vitest';
import {
  acquisitionHandoffSchema,
  acquisitionLeadSchema,
  acquisitionStaffChannelViewSchema,
} from './runtime';

describe('获客来源隐私 DTO', () => {
  it('普通员工渠道只接受匿名渠道编号，不接受真实平台或真实渠道名称', () => {
    const safe = {
      visibility: 'STAFF' as const,
      channel_id: 'channel-1',
      staff_label: '渠道1',
      lead_type: 'BUYER' as const,
      marketplace_code: 'AMAZON_JP',
      status: 'ACTIVE' as const,
      version: 1,
    };
    expect(acquisitionStaffChannelViewSchema.parse(safe)).toEqual(safe);
    expect(() => acquisitionStaffChannelViewSchema.parse({
      ...safe,
      platform_name: '小红书',
    })).toThrow();
    expect(() => acquisitionStaffChannelViewSchema.parse({
      ...safe,
      display_name: '小红书买家推广一组',
    })).toThrow();
  });

  it('交接给售前/卖家对接时拒绝来源链接、开发方式、评分和开发信号', () => {
    const safe = {
      prospect_id: 'prospect-1',
      lead_type: 'SELLER' as const,
      marketplace_code: 'AMAZON_JP',
      origin_channel_id: 'channel-2',
      channel_label: '渠道2',
      display_name: '示例卖家',
      contact_value: null,
      status: 'HUMAN_HANDOFF' as const,
      version: 1,
      created_at: 1,
      updated_at: 1,
    };
    expect(acquisitionHandoffSchema.parse(safe)).toEqual(safe);
    for (const privateField of [
      ['source_url', 'https://example.invalid'],
      ['origin_mode', 'CODEX'],
      ['ai_score', 92],
      ['signal_content', '招聘日本站运营'],
    ] as const) {
      expect(() => acquisitionHandoffSchema.parse({
        ...safe,
        [privateField[0]]: privateField[1],
      })).toThrow();
    }
  });

  it('正式线索拒绝真实来源、发现方式、发现人和潜在线索编号', () => {
    const safe = {
      lead_id: 'lead-1',
      lead_type: 'BUYER' as const,
      marketplace_code: 'AMAZON_JP',
      wechat_masked: 'wx***123',
      display_name: '示例买家',
      note: null,
      origin_channel_id: 'channel-1',
      channel_label: '渠道1',
      current_owner_staff_id: 'staff-1',
      status: 'ACTIVE' as const,
      version: 1,
      created_business_date: '2026-08-11',
      latest_followup_at: 1,
      retention_due_at: 2,
      retention_hold_reason: null,
      registered: false,
      reservation_submitted: false,
      no_participation: true,
      formal_order_count: 0,
      seller_cooperation: false,
      created_at: 1,
      updated_at: 1,
    };
    expect(acquisitionLeadSchema.parse(safe)).toEqual(safe);
    for (const privateField of [
      ['origin_source_url', 'https://example.invalid'],
      ['origin_mode', 'CODEX'],
      ['origin_channel_name', '小红书广告'],
      ['origin_staff_id', 'acquisition-staff'],
      ['prospect_id', 'prospect-1'],
    ] as const) {
      expect(() => acquisitionLeadSchema.parse({
        ...safe,
        [privateField[0]]: privateField[1],
      })).toThrow();
    }
  });
});
