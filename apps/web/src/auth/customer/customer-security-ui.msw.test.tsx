// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
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
            next_path: '/seller/login',
          },
          meta: { request_id: 'request-reset-ui' },
        });
      }));
    render(<MemoryRouter initialEntries={['/customer/reset-password?token=reset-token']}>
      <Routes>
        <Route path="/customer/reset-password" element={<CustomerPasswordResetPage />} />
        <Route path="/seller/login" element={<div>SELLER LOGIN</div>} />
      </Routes>
    </MemoryRouter>);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('新密码'), 'New-Password-2026!');
    await user.type(screen.getByLabelText('确认新密码'), 'New-Password-2026!');
    await user.click(screen.getByRole('button', { name: '更新密码' }));
    expect(await screen.findByText('密码已更新，所有旧会话均已失效。'))
      .toBeVisible();
    expect(body).toEqual({
      token: 'reset-token', new_password: 'New-Password-2026!',
      password_confirmation: 'New-Password-2026!',
    });
    expect(key).toMatch(/^customer-reset:/u);
    await user.click(screen.getByRole('button', { name: '去登录' }));
    expect(await screen.findByText('SELLER LOGIN')).toBeVisible();
  });

});
