// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffBindingPage } from './StaffBindingPage';

afterEach(cleanup);

describe('员工飞书绑定页', () => {
  it('rejects malformed invitation tokens without calling the API', async () => {
    let requested = false;
    server.use(http.post(apiUrl('/api/staff-auth/binding/start'), () => {
      requested = true;
      return HttpResponse.json({});
    }));
    renderWithMsw(<StaffBindingPage />, { route: '/staff/bind?invite=short' });
    expect(await screen.findByText(/邀请链接不完整/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '使用飞书完成绑定' })).toBeDisabled();
    expect(requested).toBe(false);
  });

  it('posts only the invitation token and refuses a non-Feishu authorization origin', async () => {
    const token = 'a'.repeat(43);
    let submitted: unknown = null;
    server.use(http.post(apiUrl('/api/staff-auth/binding/start'), async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({
        data: {
          provider: 'FEISHU',
          authorization_url: 'https://attacker.example/authorize',
          expires_at: Date.now() + 60_000,
        },
        meta: { request_id: 'binding-start' },
      });
    }));
    const user = userEvent.setup();
    renderWithMsw(<StaffBindingPage />, {
      route: `/staff/bind?invite=${token}`,
    });
    await user.click(await screen.findByRole('button', {
      name: '使用飞书完成绑定',
    }));
    await waitFor(() => expect(submitted).toEqual({ invite_token: token }));
    expect(await screen.findByText(/邀请无效、已过期或暂时无法绑定/u))
      .toBeVisible();
  });
});
