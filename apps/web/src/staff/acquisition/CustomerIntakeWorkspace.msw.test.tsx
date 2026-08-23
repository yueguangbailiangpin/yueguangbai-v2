// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { StaffPermissionCode } from '@ygb/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import { apiUrl } from '../../test/msw/handlers';
import { failureEnvelopeFixture } from '../../test/msw/fixtures';
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

  it('explains that a duplicate seller was already saved instead of reporting a generic failure', async () => {
    installHandlers([channel('seller-jp', 'AMAZON_JP', '渠道1')]);
    server.use(
      http.post(apiUrl('/api/staff/acquisition/leads'), () =>
        HttpResponse.json(
          failureEnvelopeFixture(
            'DUPLICATE_LEAD',
            'duplicate',
            null,
            'request-duplicate-seller-lead',
          ),
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWorkspace();

    const intakeChannel = await screen.findByRole('combobox', { name: '渠道' });
    await waitFor(() =>
      expect(within(intakeChannel).getByRole('option', { name: '渠道1' })).toBeVisible(),
    );
    const createCard = screen.getByRole('heading', { name: '新卖家客户' }).closest('section');
    expect(createCard).not.toBeNull();
    const createForm = within(createCard!);
    await user.selectOptions(intakeChannel, 'seller-jp');
    await user.type(createForm.getByRole('textbox', { name: '微信号' }), 'already_saved_wechat');
    await user.type(createForm.getByRole('textbox', { name: '客户编号' }), '已经保存的卖家');
    await user.click(createForm.getByRole('button', { name: '保存新卖家客户' }));

    expect(await screen.findByText(/已经保存过，不需要重复新增/u)).toBeVisible();
    expect(screen.queryByText(/保存未完成/u)).not.toBeInTheDocument();
  });

  it('generates a portal registration link for an unregistered seller from the directory', async () => {
    installHandlers([channel('seller-jp', 'AMAZON_JP', '渠道1')], [
      sellerDirectoryItem(),
    ]);
    let issuedBody: unknown;
    server.use(
      http.get(
        apiUrl('/api/staff/customer-security/seller-invitations/current'),
        ({ request }) => {
          expect(new URL(request.url).searchParams.get('seller_organization_id')).toBe(
            'seller-org-new',
          );
          return HttpResponse.json({
            data: { invitation: null },
            meta: { request_id: 'current-seller-invitation' },
          });
        },
      ),
      http.post(
        apiUrl('/api/staff/customer-security/seller-invitations'),
        async ({ request }) => {
          issuedBody = await request.json();
          return HttpResponse.json(
            {
              data: {
                invitation: {
                  invitation_id: 'invite-new',
                  registration_token: 'seller-token-new',
                  registration_path: '/seller/register?token=seller-token-new',
                  wechat_id: 'Johnwen7',
                  marketplace_code: 'AMAZON_JP',
                  seller_organization_id: 'seller-org-new',
                  seller_name: '咖啡秤',
                  onboarding_kind: 'NEW_CUSTOMER',
                  status: 'ACTIVE',
                  version: 1,
                  expires_at: 1_786_176_000_000,
                  replayed: false,
                },
              },
              meta: { request_id: 'issue-seller-invitation' },
            },
            { status: 201 },
          );
        },
      ),
    );
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(await screen.findByRole('button', { name: '生成卖家开通链接' }));

    expect(await screen.findByRole('textbox', { name: '卖家注册链接' })).toHaveValue(
      `${window.location.origin}/seller/register?token=seller-token-new`,
    );
    expect(issuedBody).toEqual({
      lead_id: null,
      seller_organization_id: 'seller-org-new',
      wechat_id: 'Johnwen7',
      marketplace_code: 'AMAZON_JP',
    });
  });

  it('replaces an active seller invitation whose original link cannot be recovered', async () => {
    installHandlers([channel('seller-jp', 'AMAZON_JP', '渠道1')], [
      sellerDirectoryItem(),
    ]);
    let activeInvitation = true;
    server.use(
      http.get(apiUrl('/api/staff/customer-security/seller-invitations/current'), () =>
        HttpResponse.json({
          data: {
            invitation: activeInvitation
              ? {
                  invitation_id: 'invite-old',
                  wechat_id: 'Johnwen7',
                  marketplace_code: 'AMAZON_JP',
                  seller_organization_id: 'seller-org-new',
                  seller_member_id: null,
                  onboarding_kind: 'NEW_CUSTOMER',
                  issued_by_staff_id: 'staff-owner',
                  status: 'ACTIVE',
                  version: 4,
                  issued_at: 1_786_000_000_000,
                  expires_at: 1_786_176_000_000,
                  consumed_at: null,
                  revoked_at: null,
                  registration_link_recoverable: false,
                }
              : null,
          },
          meta: { request_id: 'current-seller-invitation' },
        }),
      ),
      http.post(
        apiUrl('/api/staff/customer-security/seller-invitations/invite-old/revoke'),
        async ({ request }) => {
          expect(await request.json()).toEqual({ expected_version: 4 });
          activeInvitation = false;
          return HttpResponse.json({
            data: {
              invitation: {
                invitation_id: 'invite-old',
                status: 'REVOKED',
                version: 5,
                revoked_at: 1_786_000_100_000,
              },
            },
            meta: { request_id: 'revoke-seller-invitation' },
          });
        },
      ),
      http.post(apiUrl('/api/staff/customer-security/seller-invitations'), () =>
        HttpResponse.json(
          {
            data: {
              invitation: {
                invitation_id: 'invite-replacement',
                registration_token: 'replacement-token',
                registration_path: '/seller/register?token=replacement-token',
                wechat_id: 'Johnwen7',
                marketplace_code: 'AMAZON_JP',
                seller_organization_id: 'seller-org-new',
                seller_name: '咖啡秤',
                onboarding_kind: 'NEW_CUSTOMER',
                status: 'ACTIVE',
                version: 1,
                expires_at: 1_786_176_000_000,
                replayed: false,
              },
            },
            meta: { request_id: 'replace-seller-invitation' },
          },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWorkspace();

    const generate = await screen.findByRole('button', { name: '生成卖家开通链接' });
    await user.click(generate);
    expect(await screen.findByText(/原注册链接明文不会被保存/u)).toBeVisible();

    await user.click(screen.getByRole('button', { name: '撤销旧邀请' }));
    expect(await screen.findByText(/原注册链接已撤销/u)).toBeVisible();

    await user.click(generate);
    expect(await screen.findByRole('textbox', { name: '卖家注册链接' })).toHaveValue(
      `${window.location.origin}/seller/register?token=replacement-token`,
    );
  });
});

function renderWorkspace(
  permissions: readonly StaffPermissionCode[] = [],
): ReturnType<typeof renderWithMsw> {
  return renderWithMsw(
    <StaffSessionBoundary adapter={staffTestAdapter(staffTestSession('owner', [...permissions]))}>
      <SellerCustomersWorkspace />
    </StaffSessionBoundary>,
    { route: '/staff/seller-customers' },
  );
}

function installHandlers(
  channels: readonly ReturnType<typeof channel>[],
  sellers: readonly ReturnType<typeof sellerDirectoryItem>[] = [],
): void {
  server.use(
    http.get(apiUrl('/api/staff/acquisition/channels'), () =>
      HttpResponse.json({
        data: { channels },
        meta: { request_id: 'channels' },
      }),
    ),
    http.get(apiUrl('/api/staff/customer-onboarding/seller-directory'), () =>
      HttpResponse.json({ data: { items: sellers }, meta: { request_id: 'seller-directory' } }),
    ),
    http.get(apiUrl('/api/staff/acquisition/leads'), () =>
      HttpResponse.json({
        data: { items: [], next_cursor: null },
        meta: { request_id: 'leads' },
      }),
    ),
    http.get(apiUrl('/api/staff/acquisition/handoffs'), () =>
      HttpResponse.json({
        data: { items: [] },
        meta: { request_id: 'handoffs' },
      }),
    ),
  );
}

function sellerDirectoryItem() {
  return {
    seller_organization_id: 'seller-org-new',
    seller_code: 'portal-000001',
    display_name: '咖啡秤',
    wechat_masked: 'Johnwen7',
    marketplace_code: 'AMAZON_JP',
    source_status: 'CURRENT_OR_NEW' as const,
    source_file_count: 0,
    product_names: [],
    active_offering_count: 0,
    has_portal_account: false,
  };
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
