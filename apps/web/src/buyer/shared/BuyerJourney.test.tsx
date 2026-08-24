// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BuyerJourney,
  evidenceJourneyStep,
  reservationJourneyStep,
  reviewJourneyStep,
} from './BuyerJourney';

afterEach(cleanup);

function renderJourney(props: Parameters<typeof BuyerJourney>[number]): void {
  render(
    <MemoryRouter>
      <BuyerJourney {...props} />
    </MemoryRouter>,
  );
}

describe('BuyerJourney (P6 real-status steps)', () => {
  it('lights every step up to and including the current one', () => {
    renderJourney({ current: 'evidence' });
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(screen.getByText('待提交资料').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('已预约').closest('li')).toHaveClass('is-done');
    expect(screen.getByText('待下单').closest('li')).toHaveClass('is-done');
    expect(screen.getByText('审核中').closest('li')).not.toHaveClass('is-done');
    expect(screen.getByText('返款中').closest('li')).not.toHaveClass('is-done');
  });

  it('marks the whole journey settled with the completion note', () => {
    renderJourney({ current: 'refund', settled: true });
    for (const label of ['已预约', '待下单', '待提交资料', '审核中', '待评论', '返款中']) {
      expect(screen.getByText(label).closest('li')).toHaveClass('is-done');
    }
    expect(screen.getByText(/返款已完成，本次测评流程结束。/u)).toBeVisible();
  });

  it('shows the next-step action link when provided', () => {
    renderJourney({
      current: 'ordering',
      action: { label: '下一步：去查看下单指引', to: '/buyer/reservations/r1/instruction' },
    });
    expect(screen.getByRole('link', { name: '下一步：去查看下单指引' })).toHaveAttribute(
      'href',
      '/buyer/reservations/r1/instruction',
    );
  });

  it('derives steps from real entity statuses', () => {
    expect(reservationJourneyStep('PENDING_REVIEW')).toBe('reserved');
    expect(reservationJourneyStep('APPROVED')).toBe('ordering');
    expect(reservationJourneyStep('REJECTED')).toBeNull();
    expect(evidenceJourneyStep('PENDING_VERIFICATION')).toBe('verifying');
    expect(evidenceJourneyStep('CHANGES_REQUESTED')).toBe('evidence');
    expect(evidenceJourneyStep('VERIFIED')).toBe('review');
    expect(reviewJourneyStep('PENDING_REVIEW')).toBe('review');
    expect(reviewJourneyStep('APPROVED')).toBe('refund');
  });
});
