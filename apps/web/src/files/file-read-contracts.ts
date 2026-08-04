import {
  FILE_PURPOSES,
  FILE_VISIBILITIES,
  type CreateFileReadIntentRequest,
} from '@ygb/contracts';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(120)
  .regex(/^[A-Za-z0-9._~-]+$/u);
const positiveSafeInteger = z.number().int().positive()
  .max(Number.MAX_SAFE_INTEGER);
const nonnegativeSafeInteger = z.number().int().nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const safeFileReferenceSchema = z.object({
  file_object_id: identifier,
  file_version: positiveSafeInteger,
  purpose: z.enum(FILE_PURPOSES),
  visibility: z.enum(FILE_VISIBILITIES),
}).strict();

export const createFileReadIntentRequestSchema = z.object({
  expected_file_version: positiveSafeInteger,
}).strict();

export const fileReadIntentResponseSchema = z.object({
  read_intent_id: identifier,
  file_object_id: identifier,
  access_token: z.string().min(32).max(512).nullable(),
  access_token_available: z.boolean(),
  expires_at: nonnegativeSafeInteger,
  replayed: z.boolean(),
}).strict();

export type SafeFileReference = z.output<typeof safeFileReferenceSchema>;
export type FileReadIntentResponse = z.output<
  typeof fileReadIntentResponseSchema
>;

export function fileReadIntentBody(
  reference: SafeFileReference,
): CreateFileReadIntentRequest {
  return createFileReadIntentRequestSchema.parse({
    expected_file_version: reference.file_version,
  });
}

