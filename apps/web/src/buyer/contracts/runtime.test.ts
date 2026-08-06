import { describe, expect, it } from 'vitest';
import {
  dateOnlySchema,
  evidenceFileSchema,
  identifierSchema,
  integerAmountSchema,
  reviewDetailValueSchema,
} from './runtime';

describe('Module 1 buyer strict runtime contracts', () => {
  it.each(['2024-02-29', '2026-08-06'])('accepts Gregorian date-only %s', (value) => {
    expect(dateOnlySchema.parse(value)).toBe(value);
  });

  it.each(['2023-02-29', '2024-02-30', '2024-00-01', '2024-13-01', '2024-01-00', ' 2024-01-01', '2024-01-01T00:00:00Z', '２０２４-０１-０１'])(
    'rejects malformed or non-Gregorian date %s',
    (value) => expect(dateOnlySchema.safeParse(value).success).toBe(false),
  );

  it('keeps financial integer strings out of floating point', () => {
    expect(integerAmountSchema.parse('900719925474099312345')).toBe('900719925474099312345');
    expect(integerAmountSchema.safeParse('1.25').success).toBe(false);
  });

  it('accepts exactly the readable evidence file authority tuple', () => {
    expect(evidenceFileSchema.parse({
      file_object_id: 'file-1', client_file_name: 'a.png', mime: 'image/png', byte_size: 2,
      status: 'VERIFIED', visibility: 'BUYER_VISIBLE', verified_at: 1,
      file_entity_link_id: 'link-1', version: 3, allowed_actions: ['CREATE_READ_INTENT'],
    })).toMatchObject({ version: 3 });
  });

  it('accepts historical metadata only without link, version, or action', () => {
    expect(evidenceFileSchema.parse({
      file_object_id: 'file-1', client_file_name: 'a.png', mime: 'image/png', byte_size: 2,
      status: 'VERIFIED', visibility: 'BUYER_VISIBLE', verified_at: 1,
      file_entity_link_id: null, version: null, allowed_actions: [],
    })).toMatchObject({ file_entity_link_id: null });
  });

  it.each([
    { file_entity_link_id: null, version: 1, allowed_actions: [] },
    { file_entity_link_id: 'link-1', version: null, allowed_actions: ['CREATE_READ_INTENT'] },
    { file_entity_link_id: 'link-1', version: 0, allowed_actions: ['CREATE_READ_INTENT'] },
  ])('rejects incoherent evidence file authority %#', (authority) => {
    expect(evidenceFileSchema.safeParse({
      file_object_id: 'file-1', client_file_name: 'a.png', mime: 'image/png', byte_size: 2,
      status: 'VERIFIED', visibility: 'BUYER_VISIBLE', verified_at: 1, ...authority,
    }).success).toBe(false);
  });

  it('rejects extra DTO fields recursively', () => {
    expect(identifierSchema.safeParse('safe-id').success).toBe(true);
    expect(reviewDetailValueSchema.safeParse({ surprise: true }).success).toBe(false);
  });
});
