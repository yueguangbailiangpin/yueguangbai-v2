import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_BUNDLE_STATES,
  ARCHIVE_BUNDLE_TRANSITIONS,
  ARCHIVE_BUNDLE_TYPES,
  COLD_ARCHIVE_PURPOSES,
  DriveArchiveClientError,
  isArchiveBundleTransition,
  isColdArchivePurpose,
  isRetryableArchiveFailure,
  parseArchiveQueueMessage,
  parseSafeFileArchiveStatusDto,
} from './cold-image-archive';

describe('cold image archive public contract', () => {
  it('publishes the five archive purposes including seller chat evidence', () => {
    expect(COLD_ARCHIVE_PURPOSES).toEqual([
      'ORDER_EVIDENCE',
      'REVIEW_EVIDENCE',
      'BUYER_REFUND_PROOF',
      'SELLER_SETTLEMENT_PROOF',
      'ORDER_COMMUNICATION_SCREENSHOT',
    ]);
    expect(COLD_ARCHIVE_PURPOSES.every(isColdArchivePurpose)).toBe(true);
    expect(isColdArchivePurpose('PRODUCT_IMAGE')).toBe(false);
    expect(isColdArchivePurpose('SUPPORT_ATTACHMENT')).toBe(false);
  });

  it('keeps the six D-055 bundle states with legal transitions only', () => {
    expect(ARCHIVE_BUNDLE_STATES).toEqual([
      'ONLINE',
      'ARCHIVED',
      'RESTORE_REQUESTED',
      'RESTORING',
      'RESTORED_TEMPORARILY',
      'RESTORE_FAILED',
    ]);
    for (const targets of Object.values(ARCHIVE_BUNDLE_TRANSITIONS)) {
      expect(targets).not.toContain('ONLINE');
    }
    expect(isArchiveBundleTransition('ONLINE', 'ARCHIVED')).toBe(true);
    expect(isArchiveBundleTransition('ARCHIVED', 'ONLINE')).toBe(false);
    expect(isArchiveBundleTransition('RESTORED_TEMPORARILY', 'ARCHIVED')).toBe(true);
    expect(isArchiveBundleTransition('RESTORE_FAILED', 'RESTORE_REQUESTED')).toBe(true);
    expect(ARCHIVE_BUNDLE_TYPES).toEqual([
      'ORDER',
      'BUYER_REFUND_PAYMENT',
      'SELLER_SETTLEMENT_PAYMENT',
    ]);
  });

  it('accepts only the four-field opaque queue message and nothing else', () => {
    const message = {
      bundle_id: 'archive-bundle-1234567890',
      bundle_version: 2,
      job_type: 'ARCHIVE_BUNDLE',
      trace_id: 'trace-1234567890',
    };
    expect(parseArchiveQueueMessage(message)).toEqual(message);
    expect(parseArchiveQueueMessage({ ...message, object_key: 'files/v1/x' })).toBe(null);
    expect(parseArchiveQueueMessage({ ...message, buyer_wechat: 'wxid_x' })).toBe(null);
    expect(parseArchiveQueueMessage({ ...message, job_type: 'CLEANUP_EXPIRED_RESTORE' })).toBe(null);
    expect(parseArchiveQueueMessage({ ...message, bundle_version: 0 })).toBe(null);
    expect(parseArchiveQueueMessage({ ...message, bundle_version: 1.5 })).toBe(null);
    expect(parseArchiveQueueMessage(null)).toBe(null);
    expect(parseArchiveQueueMessage('x')).toBe(null);
  });

  it('classifies retryable archive failures', () => {
    expect(isRetryableArchiveFailure('drive_rate_limited')).toBe(true);
    expect(isRetryableArchiveFailure('drive_unavailable')).toBe(true);
    expect(isRetryableArchiveFailure('file_integrity_mismatch')).toBe(false);
    expect(isRetryableArchiveFailure('drive_not_found')).toBe(false);
    expect(isRetryableArchiveFailure('manifest_superseded')).toBe(false);
  });

  it('keeps drive client errors free of leaked detail in the message', () => {
    const error = new DriveArchiveClientError('authorization_failed', 'Bearer ya29.secret-token');
    expect(error.message).toBe('drive_archive_authorization_failed');
    expect(error.message).not.toContain('secret-token');
  });

  it('accepts only identifier-free safe DTOs', () => {
    expect(parseSafeFileArchiveStatusDto({
      storage_state: 'ARCHIVED',
      archived_at: 123,
      time_basis: 'UTC_MS',
      display_timezone: 'Asia/Shanghai',
    })).toEqual({
      storage_state: 'ARCHIVED',
      archived_at: 123,
      time_basis: 'UTC_MS',
      display_timezone: 'Asia/Shanghai',
    });
    expect(() => parseSafeFileArchiveStatusDto({
      storage_state: 'ARCHIVED',
      archived_at: 123,
      time_basis: 'UTC_MS',
      display_timezone: 'Asia/Shanghai',
      drive_file_id: 'secret',
    })).toThrow();
  });
});
