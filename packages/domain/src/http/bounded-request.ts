export type BoundedFormDataResult =
  | { ok: true; form: FormData }
  | {
      ok: false;
      error: 'request_too_large' | 'invalid_multipart_form_data';
    };

function declaredLength(request: Request): number | null {
  const raw = request.headers.get('Content-Length');
  if (!raw || !/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; tooLarge: boolean }
> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('invalid_request_size_limit');
  }

  const length = declaredLength(request);
  if (length !== null && length > maxBytes) {
    return { ok: false, tooLarge: true };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      size += result.value.byteLength;
      if (size > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size result remains authoritative.
        }
        return { ok: false, tooLarge: true };
      }
      chunks.push(result.value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function requestBodyIsEmpty(
  request: Request,
): Promise<boolean> {
  const body = await readBoundedBytes(request, 0);
  return body.ok && body.bytes.byteLength === 0;
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  if (!request.body) return {};

  const body = await readBoundedBytes(request, maxBytes);
  if (!body.ok) return null;

  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(body.bytes),
    );
    return parsed !== null
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<BoundedFormDataResult> {
  const length = declaredLength(request);
  if (length !== null && length > maxBytes) {
    return { ok: false, error: 'request_too_large' };
  }

  let size = 0;
  let exceeded = false;

  try {
    const headers = new Headers();
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);

    const body = request.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength;
          if (size > maxBytes) {
            exceeded = true;
            throw new Error('request_too_large');
          }
          controller.enqueue(chunk);
        },
      }),
    ) ?? null;

    const parsedRequest = new Request(request.url, {
      method: 'POST',
      headers,
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    return {
      ok: true,
      form: await parsedRequest.formData(),
    };
  } catch {
    return {
      ok: false,
      error: exceeded
        ? 'request_too_large'
        : 'invalid_multipart_form_data',
    };
  }
}
