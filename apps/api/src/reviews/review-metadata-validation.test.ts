import { describe, expect, it } from 'vitest';
import { hashCanonicalJson } from '@ygb/domain';
import {
  cleanReviewUrl,
  normalizeReviewFileInputs,
  ReviewError,
} from './review-shared';

function files(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    fileObjectId: `review-file-${index + 1}`,
    expectedFileVersion: 1,
  }));
}

describe('Wave 11 review metadata validation', () => {
  it('accepts exactly one, two or three distinct screenshots', () => {
    for (const count of [1, 2, 3]) {
      expect(normalizeReviewFileInputs(files(count))).toHaveLength(count);
    }
  });

  it('rejects zero or four screenshots', () => {
    for (const count of [0, 4]) {
      expect(() => normalizeReviewFileInputs(files(count)))
        .toThrow(ReviewError);
    }
  });

  it('rejects a reused screenshot inside one submission', () => {
    try {
      normalizeReviewFileInputs([
        { fileObjectId: 'same-file', expectedFileVersion: 1 },
        { fileObjectId: 'same-file', expectedFileVersion: 1 },
      ]);
      throw new Error('expected duplicate rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'REVIEW_FILE_CONFLICT' });
    }
  });

  it('allows null only for rating and canonicalizes valid review URLs', () => {
    expect(cleanReviewUrl('RATING', null)).toBeNull();
    expect(cleanReviewUrl('TEXT', ' https://EXAMPLE.com/r#fragment '))
      .toBe('https://example.com/r');
    for (const type of ['TEXT', 'IMAGE', 'VIDEO'] as const) {
      expect(() => cleanReviewUrl(type, null))
        .toThrow(ReviewError);
    }
  });

  it('changes the request hash when only review_url changes', async () => {
    const common = {
      action: 'SUBMIT_REVIEW_EVIDENCE',
      formal_order_id: 'formal-order-1',
      expected_version: 0,
      review_type: 'TEXT',
      evidence_files: [{
        file_object_id: 'review-file-1',
        expected_file_version: 1,
      }],
      buyer_note: null,
    };
    const first = await hashCanonicalJson({
      ...common,
      review_url: 'https://example.com/review/1',
    });
    const second = await hashCanonicalJson({
      ...common,
      review_url: 'https://example.com/review/2',
    });
    expect(first).not.toBe(second);
  });
});