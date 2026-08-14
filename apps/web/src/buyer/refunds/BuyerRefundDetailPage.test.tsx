// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({ buyerApi: { refund: vi.fn(), remindRefund: vi.fn() } }));
import { buyerApi } from '../api/client';
import { BuyerRefundDetailPage } from './BuyerRefundDetailPage';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BuyerRefundDetailPage reminders', () => {
  it('shows and submits a reminder only while the refund remains due', async () => {
    vi.mocked(buyerApi.refund).mockResolvedValue({ data: { refund: refund('DUE') } } as never);
    vi.mocked(buyerApi.remindRefund).mockResolvedValue({ data: { reminder: { refund_obligation_id: 'refund-1', reminder_count: 1, last_reminded_at: 2000, next_reminder_at: 86_402_000 }, replayed: false } } as never);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '催返款' }));
    await waitFor(() => expect(buyerApi.remindRefund).toHaveBeenCalledWith(expect.anything(), 'refund-1', expect.any(String)));
  });

  it('hides the reminder control after payment', async () => {
    vi.mocked(buyerApi.refund).mockResolvedValue({ data: { refund: refund('PAID') } } as never);
    renderPage();
    await screen.findByText('已返款');
    expect(screen.queryByRole('button', { name: '催返款' })).not.toBeInTheDocument();
  });
});

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={['/buyer/refunds/refund-1']}><QueryClientProvider client={client}><Routes><Route path="/buyer/refunds/:refundId" element={<BuyerRefundDetailPage />} /></Routes></QueryClientProvider></MemoryRouter>);
}

function refund(status: 'DUE' | 'PAID') {
  return {
    refund_obligation_id: 'refund-1', due_amount_cny_fen: '100', net_paid_cny_fen: status === 'PAID' ? '100' : '0',
    remaining_amount_cny_fen: status === 'PAID' ? '0' : '100', overpaid_amount_cny_fen: '0', status,
    order: { formal_order_id: 'order-1', marketplace: 'JP', amazon_order_number: '123-1234567-1234567', product_name: '返款产品', review_type: 'IMAGE', status: 'CONFIRMED' },
    reminder: { reminder_count: 0, last_reminded_at: null, next_reminder_at: null }, allowed_actions: [], activities: [],
  };
}
