// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerAuthApiAdapter, CustomerSession } from '../../auth/customer/customer-auth-api';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { BuyerRegistrationController } from './registration';

const buyerSession: CustomerSession = {
  account_id: 'buyer-account', identity_subject_id: 'buyer-subject', account_type: 'BUYER',
  session_version: 1, password_change_required: false, issued_at: 1, expires_at: 2,
};

describe('Module 1 registration transport transition', () => {
  it('does not authenticate from 201, clears both customer roots, then strictly reads Buyer session', async () => {
    const events: string[] = [];
    let body: unknown;
    server.use(http.post(apiUrl('/api/buyer-auth/register'), async ({ request }) => {
      events.push('register'); body = await request.json();
      return HttpResponse.json({ data: registration(), meta: { request_id: 'register-request' } }, { status: 201 });
    }));
    const client = queryClient();
    client.setQueryData(['buyer', 'private'], 'buyer-secret');
    client.setQueryData(['seller', 'private'], 'seller-secret');
    client.setQueryData(['staff', 'private'], 'staff-safe');
    const cancel = client.cancelQueries.bind(client);
    vi.spyOn(client, 'cancelQueries').mockImplementation(async (filters) => {
      events.push(`cancel:${String(filters?.queryKey?.[0])}`); return cancel(filters);
    });
    const controller = new BuyerRegistrationController(client, {
      token: async () => 'trusted-human-token',
    }, authAdapter(buyerSession, events));
    await expect(controller.register({
      wechat_id: 'buyer_wx', password: 'safe-password-123', password_confirmation: 'safe-password-123',
    }, new AbortController().signal)).resolves.toMatchObject({ kind: 'AUTHENTICATED' });
    expect(body).toEqual({ wechat_id: 'buyer_wx', password: 'safe-password-123',
      password_confirmation: 'safe-password-123', human_verification_token: 'trusted-human-token' });
    expect(events.indexOf('session')).toBeGreaterThan(events.indexOf('register'));
    expect(events).toContain('cancel:buyer'); expect(events).toContain('cancel:seller');
    expect(client.getQueryData(['buyer', 'private'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'private'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'private'])).toBe('staff-safe');
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });

  it('omits a human token when the production provider is disconnected', async () => {
    let body: any;
    server.use(http.post(apiUrl('/api/buyer-auth/register'), async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ data: registration(), meta: { request_id: 'register-no-human' } }, { status: 201 });
    }));
    await new BuyerRegistrationController(queryClient(), { token: async () => null }, authAdapter(buyerSession, []))
      .register({ wechat_id: 'buyer', password: 'safe-password-123', password_confirmation: 'safe-password-123' }, new AbortController().signal);
    expect(body).not.toHaveProperty('human_verification_token');
  });

  it('logs out and fails closed when the post-registration session is Seller', async () => {
    server.use(http.post(apiUrl('/api/buyer-auth/register'), () => HttpResponse.json({ data: registration(), meta: { request_id: 'register-mismatch' } }, { status: 201 })));
    const events: string[] = [];
    const seller = { ...buyerSession, account_type: 'SELLER_MEMBER' as const };
    await expect(new BuyerRegistrationController(queryClient(), { token: async () => null }, authAdapter(seller, events))
      .register({ wechat_id: 'buyer', password: 'safe-password-123', password_confirmation: 'safe-password-123' }, new AbortController().signal))
      .resolves.toEqual({ kind: 'MISMATCH_CLEANED' });
    expect(events).toContain('logout');
  });
});

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function authAdapter(session: CustomerSession, events: string[]): CustomerAuthApiAdapter {
  return {
    readSession: async () => { events.push('session'); return { data: { session }, requestId: 'session-request' }; },
    logout: async () => { events.push('logout'); return { data: { logged_out: true, all_devices_logged_out: false }, requestId: 'logout-request' }; },
    login: async () => { throw new Error('unexpected_login'); },
    changePassword: async () => { throw new Error('unexpected_change_password'); },
  };
}

function registration() {
  return { identity: { buyer_number: 'B-1', wechat_id: 'buyer' }, session_established: true,
    must_change_password: false, next_path: '/buyer' };
}
