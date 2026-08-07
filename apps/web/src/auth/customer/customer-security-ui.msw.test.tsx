// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { StaffCustomerSecurityPanel } from '../staff/StaffCustomerSecurityPanel';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { CustomerPasswordResetPage } from './CustomerPasswordResetPage';

afterEach(cleanup);

describe('客户邀请与密码恢复中文界面', () => {
  it('Customer 使用一次性凭证设置密码，并明确旧会话全部失效', async () => {
    let body: unknown;
    let key: string | null = null;
    server.use(http.post(apiUrl('/api/customer-auth/password-reset/complete'),
      async ({ request }) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          data: {
            password_reset: true,
            all_previous_sessions_revoked: true,
            next_path: '/customer/login',
          },
          meta: { request_id: 'request-reset-ui' },
        });
      }));
    render(<MemoryRouter initialEntries={['/customer/reset-password?token=reset-token']}>
      <CustomerPasswordResetPage />
    </MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('新密码'), 'New-Password-2026!');
    await user.type(screen.getByLabelText('确认新密码'), 'New-Password-2026!');
    await user.click(screen.getByRole('button', { name: '更新密码' }));
    expect(await screen.findByText('密码已更新，所有旧登录会话均已失效。'))
      .toBeVisible();
    expect(body).toEqual({
      token: 'reset-token', new_password: 'New-Password-2026!',
      password_confirmation: 'New-Password-2026!',
    });
    expect(key).toMatch(/^customer-reset:/u);
  });

  it('普通 Staff 签发绑定微信与 Marketplace 的七天邀请', async () => {
    let body: unknown;
    server.use(http.post(apiUrl('/api/staff/customer-security/buyer-invitations'),
      async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: { invitation: {
            invitation_id: 'invite-ui', registration_token: 'a'.repeat(43),
            registration_path: `/buyer/register?token=${'a'.repeat(43)}`,
            wechat_id: 'buyer_ui_wx', marketplace_code: 'AMAZON_US',
            status: 'ACTIVE', version: 1, expires_at: 1786176000000,
            replayed: false,
          } },
          meta: { request_id: 'request-invite-ui' },
        }, { status: 201 });
      }));
    render(<QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })}><StaffCustomerSecurityPanel /></QueryClientProvider>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('买家微信号'), 'buyer_ui_wx');
    await user.selectOptions(screen.getByLabelText('绑定站点'), 'AMAZON_US');
    await user.click(screen.getByRole('button', { name: '签发七天买家邀请' }));
    expect(await screen.findByText(/邀请已签发/u)).toBeVisible();
    expect(screen.getByLabelText('一次性链接')).toHaveValue(
      `${window.location.origin}/buyer/register?token=${'a'.repeat(43)}`,
    );
    expect(body).toEqual({
      wechat_id: 'buyer_ui_wx', marketplace_code: 'AMAZON_US',
    });
  });
});
