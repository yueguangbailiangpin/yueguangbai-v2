// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { staffTestAdapter, staffTestSession } from '../test-fixtures';
import { SellerCustomersWorkspace } from './CustomerIntakeWorkspace';

afterEach(cleanup);

describe('seller customer intake channel selection', () => {
  it('explains why no site can be selected when no seller channel exists', async () => {
    installHandlers([]);
    renderWorkspace();

    const market = await screen.findByRole('combobox', { name: '站点' });
    expect(market).toBeDisabled();
    expect(within(market).getByRole('option', { name: '暂无可用站点' })).toBeVisible();
    expect(screen.getByText(/请先在“客户开发”配置渠道/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '保存新卖家客户' })).toBeDisabled();
  });

  it('only offers channels belonging to the selected site', async () => {
    installHandlers([
      channel('seller-jp', 'AMAZON_JP', '渠道1'),
      channel('seller-us', 'AMAZON_US', '渠道2'),
    ]);
    const user = userEvent.setup();
    renderWorkspace();

    const market = await screen.findByRole('combobox', { name: '站点' });
    await waitFor(() => expect(market).toHaveValue('AMAZON_JP'));
    const intakeChannel = screen.getByRole('combobox', { name: '渠道' });
    expect(within(intakeChannel).getByRole('option', { name: '渠道1' })).toBeVisible();
    expect(within(intakeChannel).queryByRole('option', { name: '渠道2' })).toBeNull();

    await user.selectOptions(market, 'AMAZON_US');
    expect(within(intakeChannel).getByRole('option', { name: '渠道2' })).toBeVisible();
    expect(within(intakeChannel).queryByRole('option', { name: '渠道1' })).toBeNull();
  });
});

function renderWorkspace(): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner', []))}>
      <SellerCustomersWorkspace />
    </StaffSessionBoundary>,
    { route: '/staff/seller-customers' },
  );
}

function installHandlers(channels: readonly ReturnType<typeof channel>[]): void {
  server.use(
    http.get(apiUrl('/api/staff/acquisition/channels'), () => HttpResponse.json({
      data: { channels }, meta: { request_id: 'channels' },
    })),
    http.get(apiUrl('/api/staff/customer-onboarding/seller-directory'), () =>
      HttpResponse.json({ data: { items: [] }, meta: { request_id: 'seller-directory' } })),
    http.get(apiUrl('/api/staff/acquisition/leads'), () => HttpResponse.json({
      data: { items: [], next_cursor: null }, meta: { request_id: 'leads' },
    })),
    http.get(apiUrl('/api/staff/acquisition/handoffs'), () => HttpResponse.json({
      data: { items: [] }, meta: { request_id: 'handoffs' },
    })),
  );
}

function channel(id: string, marketplace: string, label: string) {
  return {
    visibility: 'INTERNAL' as const,
    channel_id: id,
    code: id.toUpperCase(),
    channel_type: 'PRIVATE_WECHAT' as const,
    platform_name: '微信',
    lead_type: 'SELLER' as const,
    marketplace_code: marketplace,
    display_name: label,
    status: 'ACTIVE' as const,
    version: 1,
    created_at: 1,
    updated_at: 1,
    staff_label: label,
    intake_wechat_label: `${id}-wechat`,
    profile_version: 1,
  };
}
