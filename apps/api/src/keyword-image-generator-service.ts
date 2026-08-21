export interface KeywordFontObject {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface KeywordFontBucket {
  get(key: string): Promise<KeywordFontObject | null>;
}

export interface KeywordImageGeneratorServiceEnv {
  GENERATOR_SHARED_SECRET?: string;
  FONT_BUCKET?: KeywordFontBucket;
  FONT_SC_OBJECT_KEY?: string;
  FONT_JP_OBJECT_KEY?: string;
}

export interface KeywordPngRenderer {
  render(input: {
    keyword: string;
    position: number;
    renderProfile: string;
    fontBytes: readonly Uint8Array<ArrayBuffer>[];
  }): Promise<Uint8Array<ArrayBuffer>>;
}

interface RenderRequest {
  keyword: string;
  position: number;
  render_profile: string;
}

const GENERATOR_VERSION = 'YGB_KEYWORD_PNG_V1';
const MAX_BODY_BYTES = 8 * 1024;

export function createKeywordImageGeneratorService(
  renderer: KeywordPngRenderer,
): { fetch(request: Request, env: KeywordImageGeneratorServiceEnv): Promise<Response> } {
  return {
    async fetch(request, env): Promise<Response> {
      if (request.method !== 'POST'
        || new URL(request.url).pathname !== '/v1/render') {
        return response(404, 'NOT_FOUND');
      }
      if (!validSecret(
        request.headers.get('X-Internal-Authorization'),
        env.GENERATOR_SHARED_SECRET,
      )) {
        return response(403, 'FORBIDDEN');
      }
      if (!request.headers.get('Idempotency-Key')?.match(/^[0-9a-f]{64}$/u)) {
        return response(400, 'INVALID_IDEMPOTENCY_KEY');
      }
      const length = Number(request.headers.get('Content-Length') ?? '0');
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
        return response(413, 'BODY_TOO_LARGE');
      }
      const input = await parseInput(request);
      if (!input) return response(400, 'INVALID_REQUEST');
      const bucket = env.FONT_BUCKET;
      const fontKeys = [env.FONT_SC_OBJECT_KEY, env.FONT_JP_OBJECT_KEY];
      if (!bucket || fontKeys.some((key) => !key)) {
        return response(503, 'FONT_UNAVAILABLE');
      }
      const fonts = await Promise.all(fontKeys.map((key) => bucket.get(key!)));
      if (fonts.some((font) => !font)) return response(503, 'FONT_UNAVAILABLE');
      try {
        const png = await renderer.render({
          keyword: input.keyword,
          position: input.position,
          renderProfile: input.render_profile,
          fontBytes: await Promise.all(fonts.map(async (font) =>
            new Uint8Array(await font!.arrayBuffer()))),
        });
        return new Response(png, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Generator-Version': GENERATOR_VERSION,
          },
        });
      } catch {
        return response(503, 'RENDER_FAILED');
      }
    },
  };
}

async function parseInput(request: Request): Promise<RenderRequest | null> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) =>
      !['keyword', 'position', 'render_profile'].includes(key))) return null;
    const keyword = typeof record['keyword'] === 'string'
      ? record['keyword'].normalize('NFKC').trim()
      : '';
    const renderProfile = typeof record['render_profile'] === 'string'
      ? record['render_profile'].normalize('NFKC').trim()
      : '';
    if (keyword.length < 1 || keyword.length > 200
      || renderProfile !== 'ORDER_INSTRUCTION_V1'
      || !Number.isSafeInteger(record['position'])
      || Number(record['position']) < 1
      || Number(record['position']) > 100
      || /[\u0000-\u001f\u007f]/u.test(keyword)) return null;
    return {
      keyword,
      position: Number(record['position']),
      render_profile: renderProfile,
    };
  } catch {
    return null;
  }
}

function validSecret(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected || expected.length < 24 || actual.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < actual.length; index += 1) {
    mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function response(status: number, code: string): Response {
  return Response.json({ error: { code } }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
