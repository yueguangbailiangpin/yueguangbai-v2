// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { AcquisitionCoreWorkbench } from './AcquisitionCoreWorkbench';

afterEach(cleanup);

describe('canonical Staff acquisition workbench', () => {
  it('keeps real acquisition source data closed to pre-sales', async () => {
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('pre_sales'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });
    expect(await screen.findByText('当前岗位不使用客户开发中心。')).toBeVisible();
    expect(screen.queryByText('真实来源渠道')).not.toBeInTheDocument();
    expect(screen.queryByText('Codex 接入')).not.toBeInTheDocument();
  });

  it('keeps every acquisition control closed to buyer refund staff', async () => {
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('buyer_refund'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });
    expect(await screen.findByText('当前岗位不使用客户开发中心。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '新增潜在线索' })).not.toBeInTheDocument();
  });

  it('shows owner the real channel and Beijing daily operations', async () => {
    installOwnerHandlers();
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    expect(await screen.findByRole('heading', { name: '客户开发中心' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Codex 接入' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '每日渠道数据' }));
    expect(await screen.findByRole('heading', { name: '今天的渠道数据' })).toBeVisible();
    expect(screen.getByText('小红书买家推广一组')).toBeVisible();
    expect(screen.getByRole('heading', { name: '填写 / 更正今天数据' })).toBeVisible();
    expect(screen.getByRole('button', { name: '保存' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '渠道管理' }));
    expect(await screen.findByRole('table', { name: '真实渠道与员工匿名编号' })).toBeVisible();
    expect(screen.getByText('渠道1')).toBeVisible();
    expect(screen.getByText('小红书')).toBeVisible();
    expect(screen.getByText('买家微信1')).toBeVisible();
  });

  it('keeps acquisition scoped Prospect workflow but makes daily consultation read-only', async () => {
    installOwnerHandlers();
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('acquisition'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    expect(await screen.findByRole('heading', { name: '客户开发中心' })).toBeVisible();
    expect(screen.getByRole('button', { name: '潜在线索' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '每日渠道数据' }));
    expect(await screen.findByRole('heading', { name: '今天的渠道数据' })).toBeVisible();
    expect(screen.getByText('小红书买家推广一组')).toBeVisible();
    expect(screen.getByRole('heading', { name: '日咨询只读' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '填写 / 更正今天数据' })).not.toBeInTheDocument();
  });

  it('hides channel profit from acquisition staff even when a response contains it', async () => {
    installOwnerHandlers([channelStat()]);
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('acquisition'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await user.click(await screen.findByRole('button', { name: '渠道统计' }));
    expect(await screen.findByRole('table', { name: '渠道统计' })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: '来源利润' })).not.toBeInTheDocument();
    expect(screen.queryByText('¥2865.00')).not.toBeInTheDocument();
  });

  it('shows channel profit to an owner with FINANCIAL_VIEW', async () => {
    installOwnerHandlers([channelStat()]);
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await user.click(await screen.findByRole('button', { name: '渠道统计' }));
    expect(await screen.findByRole('columnheader', { name: '来源利润' })).toBeVisible();
    expect(screen.getByText('¥2865.00')).toBeVisible();
  });

  it('keeps a Personal-DENY owner on read surfaces without admin forms', async () => {
    installOwnerHandlers();
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner', false))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    expect(await screen.findByRole('heading', { name: '客户开发中心' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Codex 接入' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '每日渠道数据' }));
    expect(await screen.findByText('小红书买家推广一组')).toBeVisible();
    expect(screen.getByRole('heading', { name: '日咨询只读' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '填写 / 更正今天数据' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '渠道管理' }));
    expect(await screen.findByRole('table', { name: '真实渠道与员工匿名编号' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '新增真实渠道' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '配置接待微信' })).not.toBeInTheDocument();
  });
});

function installOwnerHandlers(stats:readonly ReturnType<typeof channelStat>[]=[]): void {  server.use(
    http.get(apiUrl('/api/staff/acquisition/channels'), () => HttpResponse.json({
      data: { channels: [channel()] }, meta: { request_id: 'channels' },
    })),
    http.get(apiUrl('/api/staff/acquisition/prospects'), () => HttpResponse.json({
      data: { items: [], next_cursor: null }, meta: { request_id: 'prospects' },
    })),
    http.get(apiUrl('/api/staff/acquisition/consultations'), () => HttpResponse.json({
      data: { consultations: [] }, meta: { request_id: 'consultations' },
    })),
    http.get(apiUrl('/api/staff/acquisition/channel-stats'), () => HttpResponse.json({
      data: { channels: stats }, meta: { request_id: 'stats' },
    })),
    http.get(apiUrl('/api/staff/acquisition/source-corrections/candidates'), () => HttpResponse.json({
      data: { items: [] }, meta: { request_id: 'corrections' },
    })),
  );
}

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    bootstrap: async () => ({ data: { session: value, access_email: 'staff@example.com' }, requestId: 'bootstrap' }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({ data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout' }),
    logoutAll: async () => ({ data: { logged_out: true, all_devices_logged_out: true, session_version: 2 }, requestId: 'logout-all' }),
  };
}

function session(
  role: 'owner'|'acquisition'|'pre_sales'|'buyer_refund',
  acquisitionAdmin = role === 'owner',
): StaffSession {
  const roleValue: StaffSession['role'] = role === 'owner'
    ? { code: 'owner', display_name: '总管理员' }
    : role === 'acquisition'
      ? { code: 'acquisition', display_name: '获客' }
    : role === 'pre_sales'
      ? { code: 'pre_sales', display_name: '售前' }
      : { code: 'buyer_refund', display_name: '买家返款' };
  return {
    staff_id: 'staff-1', display_name: '测试员工', role: roleValue,
    permissions: [...(acquisitionAdmin ? ['ACQUISITION_ADMIN' as const] : []),
      ...(role === 'owner' ? ['FINANCIAL_VIEW' as const] : [])],
    data_scope: { type: role === 'owner' ? 'GLOBAL' : role === 'acquisition' ? 'MARKETPLACE' : 'ASSIGNED_BUYERS',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'],
      buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] },
    authorization_version: 1, session_version: 1, expires_at: Date.now() + 100_000,
  };
}

function channelStat() {
  return {
    channel_id: 'channel-1', channel_name: '小红书买家推广一组', platform_name: '小红书',
    channel_status: 'ACTIVE' as const, lead_type: 'BUYER' as const, marketplace_code: 'AMAZON_JP',
    consultation_count: 10, consultation_data_complete: true, consultation_days_recorded: 1,
    consultation_days_expected: 1, prospect_count: 2, codex_prospect_count: 0, lead_count: 1,
    registered_count: 1, reservation_submitted_count: 1, cooperation_count: 0,
    formal_order_count: 1, buyer_formal_order_count: 1, seller_formal_order_count: 0,
    buyer_projected_gross_profit_cny_fen: '286500', buyer_completed_gross_profit_cny_fen: '168800',
    seller_projected_gross_profit_cny_fen: null, seller_completed_gross_profit_cny_fen: null,
  };
}

function channel() {
  return {
    visibility: 'INTERNAL', channel_id: 'channel-1', code: 'XHS_BUYER',
    channel_type: 'XIAOHONGSHU', platform_name: '小红书', lead_type: 'BUYER',
    marketplace_code: 'AMAZON_JP', display_name: '小红书买家推广一组',
    staff_label: '渠道1', intake_wechat_label: '买家微信1', status: 'ACTIVE',
    version: 1, profile_version: 1, created_at: 1, updated_at: 1,
  };
}


describe('precise acquisition invalidation after mutations', () => {
  it('updateProspect refetches only prospects', async () => {
    const counters = installCountingHandlers({
      prospects: [prospect()],
      channels: [channel(), channelTwo()],
    });
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await waitFor(() => expect(counters.get('prospects')).toBe(1));
    await user.click(screen.getByRole('button', { name: '潜在线索' }));
    await user.click(await screen.findByRole('button', { name: '交给业务员工' }));

    await waitFor(() => expect(counters.get('prospects')).toBe(2));
    expect(counters.get('channels')).toBe(1);
    expect(counters.get('stats')).toBe(0);
    expect(counters.get('consultations')).toBe(0);
    expect(counters.get('corrections')).toBe(0);
  });

  it('createProspect refetches prospects and stats only', async () => {
    const counters = installCountingHandlers({
      prospects: [],
      channels: [channel(), channelTwo()],
    });
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await waitFor(() => expect(counters.get('prospects')).toBe(1));
    await user.click(screen.getByRole('button', { name: '潜在线索' }));
    await user.click(screen.getByRole('button', { name: '新增线索' }));
    await user.type(await screen.findByLabelText('客户 / 公司名称'), '新线索');
    await user.selectOptions(screen.getByLabelText('真实来源渠道'), 'channel-1');
    await user.click(screen.getByRole('button', { name: '保存线索' }));

    await waitFor(() => expect(counters.get('prospects')).toBe(2));
    await user.click(screen.getByRole('button', { name: '渠道统计' }));
    await waitFor(() => expect(counters.get('stats')).toBe(1));
    expect(counters.get('channels')).toBe(1);
    expect(counters.get('consultations')).toBe(0);
    expect(counters.get('corrections')).toBe(0);
  });

  it('recordConsultation refetches consultations and stats only', async () => {
    const counters = installCountingHandlers({
      channels: [channel(), channelTwo()],
    });
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await waitFor(() => expect(counters.get('channels')).toBe(1));
    await user.click(screen.getByRole('button', { name: '每日渠道数据' }));
    await waitFor(() => expect(counters.get('consultations')).toBe(1));
    await user.selectOptions(await screen.findByLabelText('真实渠道'), 'channel-1');
    await user.type(screen.getByLabelText('咨询人数'), '3');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(counters.get('consultations')).toBe(2));
    await user.click(screen.getByRole('button', { name: '渠道统计' }));
    await waitFor(() => expect(counters.get('stats')).toBe(1));
    expect(counters.get('channels')).toBe(1);
    expect(counters.get('prospects')).toBe(1);
    expect(counters.get('corrections')).toBe(0);
  });

  it('updateChannelPrivacy refetches channels only', async () => {
    const counters = installCountingHandlers({
      channels: [channel(), channelTwo()],
    });
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await waitFor(() => expect(counters.get('channels')).toBe(1));
    await user.click(screen.getByRole('button', { name: '渠道管理' }));
    await user.click((await screen.findAllByRole('button', { name: '配置接待微信' }))[0]!);
    const wechat = await screen.findByLabelText('对应接待微信');
    await user.clear(wechat);
    await user.type(wechat, '买家微信2');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(counters.get('channels')).toBe(2));
    expect(counters.get('stats')).toBe(0);
    expect(counters.get('prospects')).toBe(1);
    expect(counters.get('consultations')).toBe(0);
    expect(counters.get('corrections')).toBe(0);
  });

  it('disableChannel refetches channels and stats only', async () => {
    const counters = installCountingHandlers({
      channels: [channel(), channelTwo()],
    });
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await waitFor(() => expect(counters.get('channels')).toBe(1));
    await user.click(screen.getByRole('button', { name: '渠道管理' }));
    await user.click((await screen.findAllByRole('button', { name: '停用' }))[0]!);

    await waitFor(() => expect(counters.get('channels')).toBe(2));
    await user.click(screen.getByRole('button', { name: '渠道统计' }));
    await waitFor(() => expect(counters.get('stats')).toBe(1));
    expect(counters.get('prospects')).toBe(1);
    expect(counters.get('consultations')).toBe(0);
    expect(counters.get('corrections')).toBe(0);
  });

  it('createChannel refetches channels and stats only', async () => {
    const counters = installCountingHandlers({
      channels: [channel(), channelTwo()],
    });
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await waitFor(() => expect(counters.get('channels')).toBe(1));
    await user.click(screen.getByRole('button', { name: '渠道管理' }));
    await user.click(await screen.findByRole('button', { name: '新增真实渠道' }));
    await user.type(await screen.findByLabelText('真实平台'), '小红书');
    await user.type(screen.getByLabelText('真实渠道名称'), '测试渠道');
    await user.click(screen.getByRole('button', { name: '建立渠道' }));

    await waitFor(() => expect(counters.get('channels')).toBe(2));
    await user.click(screen.getByRole('button', { name: '渠道统计' }));
    await waitFor(() => expect(counters.get('stats')).toBe(1));
    expect(counters.get('prospects')).toBe(1);
    expect(counters.get('consultations')).toBe(0);
    expect(counters.get('corrections')).toBe(0);
  });

  it('correctSource refetches stats and corrections only', async () => {
    const counters = installCountingHandlers({
      channels: [channel(), channelTwo()],
      candidates: [candidate()],
    });
    const user = userEvent.setup();
    renderWithMsw(<StaffSessionBoundary adapter={adapter(session('owner'))}>
      <AcquisitionCoreWorkbench />
    </StaffSessionBoundary>, { route: '/staff/acquisition' });

    await waitFor(() => expect(counters.get('channels')).toBe(1));
    await user.click(screen.getByRole('button', { name: '来源纠错' }));
    await waitFor(() => expect(counters.get('corrections')).toBe(1));
    await user.click(await screen.findByRole('button', { name: '修正' }));
    await user.selectOptions(await screen.findByLabelText('新的真实渠道'), 'channel-2');
    await user.type(screen.getByLabelText('更正原因'), '确认纠错');
    await user.click(screen.getByRole('button', { name: '确认追加更正' }));

    await waitFor(() => expect(counters.get('corrections')).toBe(2));
    await user.click(screen.getByRole('button', { name: '渠道统计' }));
    await waitFor(() => expect(counters.get('stats')).toBe(1));
    expect(counters.get('channels')).toBe(1);
    expect(counters.get('prospects')).toBe(1);
    expect(counters.get('consultations')).toBe(0);
  });
});

function installCountingHandlers(fixtures: {
  prospects?: readonly unknown[];
  channels?: readonly unknown[];
  candidates?: readonly unknown[];
} = {}): { get: (key: 'channels' | 'prospects' | 'consultations' | 'stats' | 'corrections') => number } {
  const counts = { channels: 0, prospects: 0, consultations: 0, stats: 0, corrections: 0 };
  server.use(
    http.get(apiUrl('/api/staff/acquisition/channels'), () => {
      counts.channels += 1;
      return HttpResponse.json({ data: { channels: fixtures.channels ?? [] }, meta: { request_id: 'channels' } });
    }),
    http.get(apiUrl('/api/staff/acquisition/prospects'), () => {
      counts.prospects += 1;
      return HttpResponse.json({ data: { items: fixtures.prospects ?? [], next_cursor: null }, meta: { request_id: 'prospects' } });
    }),
    http.get(apiUrl('/api/staff/acquisition/consultations'), () => {
      counts.consultations += 1;
      return HttpResponse.json({ data: { consultations: [] }, meta: { request_id: 'consultations' } });
    }),
    http.get(apiUrl('/api/staff/acquisition/channel-stats'), () => {
      counts.stats += 1;
      return HttpResponse.json({ data: { channels: [channelStat()] }, meta: { request_id: 'stats' } });
    }),
    http.get(apiUrl('/api/staff/acquisition/source-corrections/candidates'), () => {
      counts.corrections += 1;
      return HttpResponse.json({ data: { items: fixtures.candidates ?? [] }, meta: { request_id: 'corrections' } });
    }),
    http.post(apiUrl('/api/staff/acquisition/prospects'), () => HttpResponse.json({
      data: { prospect: prospect(), replayed: false }, meta: { request_id: 'create-prospect' },
    })),
    http.post(apiUrl('/api/staff/acquisition/prospects/:id/update'), () => HttpResponse.json({
      data: { prospect: prospect(), replayed: false }, meta: { request_id: 'update-prospect' },
    })),
    http.post(apiUrl('/api/staff/acquisition/consultations'), () => HttpResponse.json({
      data: { consultation: consultation(), replayed: false }, meta: { request_id: 'consultation' },
    })),
    http.post(apiUrl('/api/staff/acquisition/channels'), () => HttpResponse.json({
      data: { channel: baseChannel(), replayed: false }, meta: { request_id: 'create-channel' },
    })),
    http.post(apiUrl('/api/staff/acquisition/channels/:id/privacy-profile'), () => HttpResponse.json({
      data: { channel: channel(), replayed: false }, meta: { request_id: 'privacy' },
    })),
    http.post(apiUrl('/api/staff/acquisition/channels/:id/disable'), () => HttpResponse.json({
      data: { channel: baseChannel(), replayed: false }, meta: { request_id: 'disable' },
    })),
    http.post(apiUrl('/api/staff/acquisition/source-corrections'), () => HttpResponse.json({
      data: { correction: correction(), replayed: false }, meta: { request_id: 'correction' },
    })),
  );
  return { get: (key) => counts[key] };
}

function baseChannel() {
  return {
    channel_id: 'channel-1', code: 'XHS_BUYER', channel_type: 'XIAOHONGSHU' as const,
    platform_name: '小红书', lead_type: 'BUYER' as const, marketplace_code: 'AMAZON_JP',
    display_name: '小红书买家推广一组', status: 'ACTIVE' as const, version: 1,
    created_at: 1, updated_at: 1,
  };
}

function channelTwo() {
  return {
    visibility: 'INTERNAL' as const, channel_id: 'channel-2', code: 'XHS_BUYER_2',
    channel_type: 'XIAOHONGSHU' as const, platform_name: '小红书', lead_type: 'BUYER' as const,
    marketplace_code: 'AMAZON_JP', display_name: '小红书买家推广二组', staff_label: '渠道2',
    intake_wechat_label: '买家微信2', status: 'ACTIVE' as const, version: 1,
    profile_version: 1, created_at: 1, updated_at: 1,
  };
}

function prospect() {
  return {
    prospect_id: 'prospect-1', lead_type: 'BUYER' as const, marketplace_code: 'AMAZON_JP',
    origin_channel_id: 'channel-1', origin_channel_name: '小红书买家推广一组',
    display_name: '测试线索', contact_value: null, source_url: null,
    status: 'NEW' as const, note: null, discovered_at: 1,
    converted_lead_id: null, version: 1, created_at: 1, updated_at: 1,
  };
}

function consultation() {
  return {
    consultation_id: 'consultation-1', channel_id: 'channel-1', lead_type: 'BUYER' as const,
    business_date: '2026-08-11', person_count: 3, version: 1,
    updated_by_staff_id: 'staff-1', updated_at: 1,
  };
}

function correction() {
  return {
    correction_id: 'correction-1', lead_id: 'lead-1', previous_channel_id: 'channel-1',
    new_channel_id: 'channel-2', new_channel_name: '小红书买家推广二组', reason: '确认纠错',
    corrected_at: 1, correction_sequence: 1,
  };
}

function candidate() {
  return {
    lead_id: 'lead-1', lead_type: 'BUYER' as const, marketplace_code: 'AMAZON_JP',
    business_date: '2026-08-10', display_name: '测试客户', wechat_masked: 'wx***01',
    original_channel_id: 'channel-1', original_channel_name: '小红书买家推广一组',
    effective_channel_id: 'channel-1', effective_channel_name: '小红书买家推广一组',
    correction_count: 0,
  };
}
