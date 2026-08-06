import type { StaffWorkItemStatus, StaffWorkItemType } from '@ygb/contracts';
import { StaffAssignmentError } from './errors';

export interface StaffWorkItemCursor {
  createdAt: number;
  id: string;
  status: StaffWorkItemStatus;
  workType: StaffWorkItemType | null;
}

export function encodeStaffWorkItemCursor(cursor: StaffWorkItemCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify({
    v: 1,
    kind: 'staff-work-item',
    at: cursor.createdAt,
    id: cursor.id,
    status: cursor.status,
    work_type: cursor.workType,
  }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeStaffWorkItemCursor(
  value: string | undefined,
  filters: { status: StaffWorkItemStatus; workType: StaffWorkItemType | null },
): StaffWorkItemCursor | null {
  if (value === undefined) return null;
  if (value.length < 1 || value.length > 1000) validation();
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isPayload(parsed)
      || parsed.status !== filters.status
      || parsed.work_type !== filters.workType) validation();
    return {
      createdAt: parsed.at,
      id: parsed.id,
      status: parsed.status,
      workType: parsed.work_type,
    };
  } catch (error) {
    if (error instanceof StaffAssignmentError) throw error;
    return validation();
  }
}

function isPayload(value: unknown): value is {
  v: 1; kind: 'staff-work-item'; at: number; id: string;
  status: StaffWorkItemStatus; work_type: StaffWorkItemType | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row['v'] === 1
    && row['kind'] === 'staff-work-item'
    && Number.isSafeInteger(row['at'])
    && Number(row['at']) >= 0
    && typeof row['id'] === 'string'
    && row['id'].length >= 1
    && row['id'].length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(row['id'])
    && ['OPEN', 'COMPLETED', 'CANCELLED'].includes(String(row['status']))
    && (row['work_type'] === null || [
      'PRODUCT_APPLICATION_REVIEW', 'DEMAND_REVIEW', 'RESERVATION_DECISION',
      'ORDER_INSTRUCTION_PUBLISH', 'ORDER_EVIDENCE_REVIEW', 'REVIEW_DECISION',
      'BUYER_REFUND_PROCESSING',
    ].includes(String(row['work_type'])));
}

function validation(): never {
  throw new StaffAssignmentError('VALIDATION_ERROR', 400);
}
