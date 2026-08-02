import { apiFailure } from '@ygb/contracts';
import type { Context, MiddlewareHandler } from 'hono';

const BODY_LIMIT_BYTES = 16 * 1024;

/**
 * HTTP boundary guard for the frozen one-screenshot Order Evidence contract.
 * The Domain service independently enforces the same invariant.
 */
export function exactOneOrderEvidenceScreenshotGuard(): MiddlewareHandler<any> {
  return async (context, next) => {
    if (context.req.method !== 'POST') {
      await next();
      return;
    }
    try {
      const contentType = context.req.header('Content-Type') ?? '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        return failure(context);
      }
      const length = context.req.header('Content-Length');
      if (length && (!/^\d+$/u.test(length)
        || Number(length) > BODY_LIMIT_BYTES)) {
        return failure(context);
      }
      const clone = context.req.raw.clone();
      const text = await clone.text();
      if (new TextEncoder().encode(text).byteLength > BODY_LIMIT_BYTES) {
        return failure(context);
      }
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return failure(context);
      }
      const fileObjectIds = (parsed as Record<string, unknown>).file_object_ids;
      if (!Array.isArray(fileObjectIds)
        || fileObjectIds.length !== 1
        || typeof fileObjectIds[0] !== 'string'
        || fileObjectIds[0].length < 1
        || fileObjectIds[0].length > 120
        || /[\u0000-\u001f\u007f]/u.test(fileObjectIds[0])) {
        return failure(context);
      }
      await next();
    } catch {
      return failure(context);
    }
  };
}

function failure(context: Context<any>): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiFailure(
      'VALIDATION_ERROR',
      'VALIDATION_ERROR',
      String(context.get('requestId') ?? crypto.randomUUID()),
    ),
    400,
  );
}
