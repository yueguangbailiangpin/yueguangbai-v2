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
  it('mounts the approved Staff seller-principal rate policy workspace', async () => {
    server.use(http.get(apiUrl('/api/staff-auth/session'), () => HttpResponse.json(
      staffSessionEnvelopeFixture({
        ...staffSessionFixture,
        permissions: ['SELLER_MANAGE', 'FINANCIAL_CORRECT'],
      }, 'request-staff-principal-rate-route'),
    )));

    renderWithMsw(<AppRoutes />, { route: '/staff/seller-principal-rate-policies' });

    expect(await screen.findByRole('heading', {
      level: 2,
      name: '卖家本金汇率策略',
    })).toBeVisible();
  });
});
