import { describe, expect, it } from 'vitest';
import {
  instructionCanReadImages,
  SIX_HOURS_MS,
  TWO_HOURS_MS,
} from './shared';

describe('order instruction deadline and file policy', () => {
  it('publishes a full six hour window', () => {
    expect(SIX_HOURS_MS).toBe(21_600_000);
  });

  it('grants a full two hour change window', () => {
    expect(TWO_HOURS_MS).toBe(7_200_000);
  });

  it('allows active before first submission', () => {
    expect(instructionCanReadImages({
      status: 'ACTIVE', evidenceStatus: null,
      resubmissionDeadlineAt: null, formalOrderId: null, now: 10,
    })).toBe(true);
  });

  it.each(['PENDING_VERIFICATION', 'VERIFIED'])(
    'keeps images readable while %s',
    (evidenceStatus) => expect(instructionCanReadImages({
      status: 'ACTIVE', evidenceStatus,
      resubmissionDeadlineAt: null, formalOrderId: null, now: 10,
    })).toBe(true),
  );

  it('allows CHANGES_REQUESTED before the deadline', () => {
    expect(instructionCanReadImages({
      status: 'ACTIVE', evidenceStatus: 'CHANGES_REQUESTED',
      resubmissionDeadlineAt: 11, formalOrderId: null, now: 10,
    })).toBe(true);
  });

  it('rejects CHANGES_REQUESTED at the deadline', () => {
    expect(instructionCanReadImages({
      status: 'ACTIVE', evidenceStatus: 'CHANGES_REQUESTED',
      resubmissionDeadlineAt: 10, formalOrderId: null, now: 10,
    })).toBe(false);
  });

  it.each(['EXPIRED', 'CANCELLED', 'COMPLETED'] as const)(
    'rejects terminal instruction %s',
    (status) => expect(instructionCanReadImages({
      status, evidenceStatus: null,
      resubmissionDeadlineAt: null, formalOrderId: null, now: 10,
    })).toBe(false),
  );

  it('rejects immediately after formal order creation', () => {
    expect(instructionCanReadImages({
      status: 'ACTIVE', evidenceStatus: 'VERIFIED',
      resubmissionDeadlineAt: null, formalOrderId: 'formal-1', now: 10,
    })).toBe(false);
  });
});
