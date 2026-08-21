import { describe, expect, it } from 'vitest';
import { createKeywordImageGeneratorService } from './keyword-image-generator-service';

const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

describe('keyword image generator service', () => {
  it('requires the internal secret and returns a versioned PNG', async () => {
    const service = createKeywordImageGeneratorService({
      render: async () => PNG,
    });
    const env = {
      GENERATOR_SHARED_SECRET: 'a'.repeat(32),
      FONT_SC_OBJECT_KEY: 'font-sc.otf',
      FONT_JP_OBJECT_KEY: 'font-jp.otf',
      FONT_BUCKET: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) },
    };
    const forbidden = await service.fetch(request('wrong-secret'), env);
    expect(forbidden.status).toBe(403);

    const result = await service.fetch(request('a'.repeat(32)), env);
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('image/png');
    expect(result.headers.get('X-Generator-Version')).toBe('YGB_KEYWORD_PNG_V1');
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(PNG);
  });

  it('rejects unknown fields, invalid profiles and missing fonts', async () => {
    const service = createKeywordImageGeneratorService({ render: async () => PNG });
    const secret = 'b'.repeat(32);
    const missingFont = await service.fetch(request(secret), {
      GENERATOR_SHARED_SECRET: secret,
      FONT_SC_OBJECT_KEY: 'missing-sc.otf',
      FONT_JP_OBJECT_KEY: 'missing-jp.otf',
      FONT_BUCKET: { get: async () => null },
    });
    expect(missingFont.status).toBe(503);

    const invalid = await service.fetch(request(secret, {
      keyword: '关键词', position: 1, render_profile: 'UNKNOWN', extra: true,
    }), {
      GENERATOR_SHARED_SECRET: secret,
      FONT_SC_OBJECT_KEY: 'font-sc.otf',
      FONT_JP_OBJECT_KEY: 'font-jp.otf',
      FONT_BUCKET: { get: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) },
    });
    expect(invalid.status).toBe(400);
  });
});

function request(secret: string, body: Record<string, unknown> = {
  keyword: 'サングラス', position: 1, render_profile: 'ORDER_INSTRUCTION_V1',
}): Request {
  return new Request('https://generator.internal/v1/render', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Authorization': secret,
      'Idempotency-Key': 'c'.repeat(64),
    },
    body: JSON.stringify(body),
  });
}
