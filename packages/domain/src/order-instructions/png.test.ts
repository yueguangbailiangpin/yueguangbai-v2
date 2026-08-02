import { describe, expect, it } from 'vitest';
import { validateKeywordPng } from './png';

function chunk(type: string, data: readonly number[]): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 255,
    (length >>> 16) & 255,
    (length >>> 8) & 255,
    length & 255,
    ...[...type].map((value) => value.charCodeAt(0)),
    ...data,
    0, 0, 0, 0,
  ];
}

function png(extra: readonly number[] = []): Uint8Array<ArrayBuffer> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = chunk('IHDR', [
    0, 0, 0, 16,
    0, 0, 0, 8,
    8, 6, 0, 0, 0,
  ]);
  return new Uint8Array([...signature, ...ihdr, ...extra, ...chunk('IEND', [])]);
}

describe('keyword PNG validation', () => {
  it('accepts a structurally valid PNG', () => {
    expect(validateKeywordPng(png())).toEqual({
      width: 16,
      height: 8,
      forbiddenChunkTypes: [],
    });
  });

  it.each(['tEXt', 'iTXt', 'zTXt', 'eXIf'])(
    'rejects %s metadata',
    (type) => expect(() => validateKeywordPng(png(chunk(type, [1])))).toThrow(
      'png_text_metadata_forbidden',
    ),
  );

  it('rejects an SVG payload', () => {
    expect(() => validateKeywordPng(new TextEncoder().encode('<svg/>'))).toThrow();
  });

  it('rejects trailing bytes', () => {
    const bytes = png();
    const trailing = new Uint8Array([...bytes, 1]);
    expect(() => validateKeywordPng(trailing)).toThrow('png_trailing_bytes');
  });

  it('rejects a missing IEND', () => {
    expect(() => validateKeywordPng(png().slice(0, -12))).toThrow();
  });

  it('rejects a duplicate IHDR', () => {
    const second = chunk('IHDR', [
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
    ]);
    expect(() => validateKeywordPng(png(second))).toThrow('invalid_png_ihdr');
  });

  it('rejects zero dimensions', () => {
    const bytes = png();
    bytes[19] = 0;
    expect(() => validateKeywordPng(bytes)).toThrow('invalid_png_dimensions');
  });
});
