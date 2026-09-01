// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { createMswQueryClient } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { BuyerDemandDetailPage } from './BuyerDemandDetailPage';
import { BuyerDemandsPage } from './BuyerDemandsPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Buyer catalog main image and zero self-pay confirmation', () => {
  it('loads a catalog main image through the protected read lifecycle', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:catalog-main-image'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    server.use(
      http.get(apiUrl('/api/buyer-portal/demands'), () => HttpResponse.json({
        data: { items: [demand(0)], next_cursor: null },
        meta: { request_id: 'catalog-list' },
      })),
      http.post(apiUrl('/api/buyer-portal/files/product-main-image/read-intents'), () =>
        HttpResponse.json({
          data: {
            read_intent_id: 'catalog-image-intent',
            file_object_id: 'product-main-image',
            access_token: 'catalog-image-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: Date.now() + 60_000,
            replayed: false,
          },
          meta: { request_id: 'catalog-image-read' },
        }, { status: 201 })),
      http.get(apiUrl('/api/buyer-portal/file-read-intents/catalog-image-intent/content'), () =>
        new Response(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '4',
            'Cache-Control': 'private, max-age=300',
            'X-Content-Type-Options': 'nosniff',
          },
        })),
    );

    renderWithClient(<MemoryRouter><BuyerDemandsPage /></MemoryRouter>);

    await screen.findByRole('heading', { name: '咖啡秤' });
    await waitFor(() => expect(document.querySelector('.buyer-product-main-image'))
      .toHaveAttribute('src', 'blob:catalog-main-image'));
  });

  it('omits zero self-pay acceptance and submits the exact zero snapshot', async () => {
    let reservationBody: unknown = null;
    server.use(
      http.get(apiUrl('/api/buyer-portal/demands/demand-1'), () => HttpResponse.json({
        data: { demand: demand(0) }, meta: { request_id: 'catalog-detail' },
      })),
      http.post(apiUrl('/api/buyer-portal/demands/demand-1/reservations'), async ({ request }) => {
        reservationBody = await request.json();
        return HttpResponse.json({
          error: { code: 'VERSION_CONFLICT', message: 'VERSION_CONFLICT' },
          meta: { request_id: 'reservation-test-stop' },
        }, { status: 409 });
      }),
    );

    renderWithClient(
      <MemoryRouter initialEntries={['/buyer/demands/demand-1']}>
        <Routes>
          <Route path="/buyer/demands/:demandId" element={<BuyerDemandDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('该产品无需自费，确认后即可预约。')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: '确认并预约' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(reservationBody).toEqual({
      expected_demand_version: 2,
      accepted_buyer_self_pay_bps: 0,
    }));
  });

  it('still requires explicit confirmation for a positive self-pay ratio', async () => {
    server.use(
      http.get(apiUrl('/api/buyer-portal/demands/demand-1'), () => HttpResponse.json({
        data: { demand: demand(1000) }, meta: { request_id: 'catalog-detail-positive' },
      })),
    );
    renderWithClient(
      <MemoryRouter initialEntries={['/buyer/demands/demand-1']}>
        <Routes>
          <Route path="/buyer/demands/:demandId" element={<BuyerDemandDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('checkbox', {
      name: '我确认接受 10.00% 的自费比例',
    })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '确认并预约' })).toBeDisabled();
  });

  it('explains and disables booking when this store already has an active reservation', async () => {
    server.use(
      http.get(apiUrl('/api/buyer-portal/demands/demand-1'), () => HttpResponse.json({
        data: { demand: demand(0, 'INELIGIBLE_ACTIVE_STORE_RESERVATION') },
        meta: { request_id: 'catalog-detail-store-conflict' },
      })),
    );
    renderWithClient(
      <MemoryRouter initialEntries={['/buyer/demands/demand-1']}>
        <Routes>
          <Route path="/buyer/demands/:demandId" element={<BuyerDemandDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('当前店铺已有进行中的预约，请先完成或取消后再预约其他商品。')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认并预约' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

function renderWithClient(element: React.ReactElement) {
  const client = createMswQueryClient();
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

function demand(
  selfPayBps: number,
  reservationEligibility: 'ELIGIBLE' | 'INELIGIBLE_ACTIVE_STORE_RESERVATION' = 'ELIGIBLE',
) {
  const selfPay = Math.floor(2999 * selfPayBps / 10_000);
  return {
    demand_id: 'demand-1', demand_version: 2, marketplace_code: 'AMAZON_JP',
    product_name: '咖啡秤', main_image: {
      file_object_id: 'product-main-image', file_version: 3,
      purpose: 'PRODUCT_IMAGE', visibility: 'SELLER_VISIBLE',
    },
    reference_order_amount_jpy: '2999', buyer_self_pay_bps: selfPayBps,
    estimated_buyer_self_pay_jpy: String(selfPay),
    estimated_refundable_principal_jpy: String(2999 - selfPay),
    buyer_visible_notes: null, store_display_name: 'chyz', task_type: 'TEXT',
    target_quantity: 10, remaining_quantity: 10, open_at: 1,
    reservation_deadline: Date.now() + 60_000,
    order_deadline: Date.now() + 120_000,
    reservation_eligibility: reservationEligibility,
    reservation_ineligibility_reason: reservationEligibility === 'ELIGIBLE'
      ? null
      : 'ACTIVE_STORE_RESERVATION',
  };
}
