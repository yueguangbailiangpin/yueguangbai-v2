import { z } from 'zod';

export const successEnvelope = <T extends z.ZodType>(data: T) => z.object({
  data,
  meta: z.object({ request_id: z.string().min(1).max(200) }).strict(),
}).strict();

export const failureEnvelope = z.object({
  error: z.object({
    code: z.string().min(1).max(100),
    message: z.string().max(500),
    details: z.unknown().nullable(),
  }).strict(),
  meta: z.object({ request_id: z.string().min(1).max(200) }).strict(),
}).strict();

export function retryAfterMilliseconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 60 ? seconds * 1000 : null;
}
