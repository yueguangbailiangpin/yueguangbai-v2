// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { staffSessionEnvelopeFixture, staffSessionFixture } from './test/msw/fixtures';
import { apiUrl } from './test/msw/handlers';
import './test/msw/lifecycle';
import { renderWithMsw } from './test/msw/render';
import { server } from './test/msw/server';

afterEach(cleanup);

describe('application route registration', () => {
  it('mounts the approved Staff rate center workspace', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(
            {
              ...staffSessionFixture,
              permissions: ['SELLER_MANAGE', 'FINANCIAL_CORRECT'],
            },
            'request-staff-rate-center-route',
          ),
        ),
      ),
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterFixture(),
          meta: { request_id: 'request-staff-rate-center-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), () =>
        HttpResponse.json({
          data: {
            policies: {
              source_currency_code: 'JPY',
              quote_currency_code: 'CNY',
              seller_organization_id: null,
              default_policy: null,
              seller_override_policy: null,
              default_pending_policy: null,
              seller_override_pending_policy: null,
              default_next_version: 1,
              seller_override_next_version: null,
              selected_policy: null,
            },
          },
          meta: { request_id: 'request-staff-rate-center-policies' },
        }),
      ),
    );

    renderWithMsw(<AppRoutes />, { route: '/staff/seller-principal-rate-policies' });

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '汇率中心',
      }),
    ).toBeVisible();
  });
});

function rateCenterFixture() {
  return {
    business_date: '2026-08-22',
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    base_rate: {
      business_date: '2026-08-22',
      confirmed_rate: null,
      pending_rate: null,
      next_version: 1,
    },
    seller_organizations: [],
    policies: {
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      seller_organization_id: null,
      default_policy: null,
      seller_override_policy: null,
      default_pending_policy: null,
      seller_override_pending_policy: null,
      default_next_version: 1,
      seller_override_next_version: null,
      selected_policy: null,
    },
  };
}
