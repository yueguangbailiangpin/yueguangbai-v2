import {
  SUPPORTED_FILE_MIMES,
  type PurposeBoundFileUploadIntentRequest,
} from '@ygb/contracts';
import { z } from 'zod';
import type { FileUploadWorkflow } from './file-purpose-config';

const identifier = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._~-]+$/u);
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const supportedMime = z.enum(SUPPORTED_FILE_MIMES);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const uploadIntentRequestSchema = z.object({
  files: z.array(z.object({
    client_file_name: z.string().trim().min(3).max(180),
    extension: z.enum(['jpg', 'jpeg', 'png', 'webp', 'pdf']),
    declared_mime: supportedMime,
    byte_size: positiveSafeInteger,
  }).strict()).min(1).max(10),
}).strict();

export const uploadIntentResponseSchema = z.object({
  upload_intent_id: identifier,
  purpose: z.string().trim().min(1).max(80),
  visibility: z.string().trim().min(1).max(40),
  status: z.literal('ISSUED'),
  version: positiveSafeInteger,
  expires_at: nonnegativeSafeInteger,
  uploads: z.array(z.object({
    file_object_id: identifier,
    slot_no: positiveSafeInteger,
    upload_token: z.string().min(32).max(512).nullable(),
    upload_token_available: z.boolean(),
    expires_at: nonnegativeSafeInteger,
  }).strict()).min(1).max(10),
  replayed: z.boolean(),
}).strict();

export const uploadContentResponseSchema = z.object({
  file_object_id: identifier,
  upload_intent_id: identifier,
  status: z.literal('UPLOADED'),
  detected_mime: supportedMime,
  byte_size: positiveSafeInteger,
  sha256,
  version: positiveSafeInteger,
  replayed: z.boolean(),
}).strict();

export const completeUploadRequestSchema = z.object({
  expected_version: positiveSafeInteger,
}).strict();

export const completeUploadResponseSchema = z.object({
  upload_intent_id: identifier,
  status: z.literal('VERIFIED'),
  version: positiveSafeInteger,
  files: z.array(z.object({
    file_object_id: identifier,
    purpose: z.string().trim().min(1).max(80),
    visibility: z.string().trim().min(1).max(40),
    detected_mime: supportedMime,
    byte_size: positiveSafeInteger,
    sha256,
    version: positiveSafeInteger,
  }).strict()).min(1).max(10),
  replayed: z.boolean(),
}).strict();

export type UploadIntentResponse = z.output<typeof uploadIntentResponseSchema>;
export type UploadContentResponse = z.output<typeof uploadContentResponseSchema>;
export type CompleteUploadResponse = z.output<typeof completeUploadResponseSchema>;

export function uploadIntentBody(
  files: readonly { descriptor: PurposeBoundFileUploadIntentRequest['files'][number] }[],
): PurposeBoundFileUploadIntentRequest {
  return uploadIntentRequestSchema.parse({ files: files.map((entry) => entry.descriptor) });
}

export function assertIntentMatchesWorkflow(
  result: UploadIntentResponse,
  workflow: FileUploadWorkflow,
  expectedFileCount: number,
): void {
  if (result.purpose !== workflow.purpose
    || result.visibility !== workflow.visibility
    || result.uploads.length !== expectedFileCount) {
    throw new Error('upload_intent_contract_mismatch');
  }
  const slots = new Set<number>();
  const ids = new Set<string>();
  for (const upload of result.uploads) {
    if (upload.slot_no > expectedFileCount
      || slots.has(upload.slot_no)
      || ids.has(upload.file_object_id)) {
      throw new Error('upload_intent_slot_mismatch');
    }
    slots.add(upload.slot_no);
    ids.add(upload.file_object_id);
  }
}

export function assertCompleteMatchesIntent(
  result: CompleteUploadResponse,
  input: {
    intentId: string;
    workflow: FileUploadWorkflow;
    fileObjectIds: ReadonlySet<string>;
  },
): void {
  if (result.upload_intent_id !== input.intentId
    || result.files.length !== input.fileObjectIds.size) {
    throw new Error('complete_manifest_contract_mismatch');
  }
  const found = new Set<string>();
  for (const file of result.files) {
    if (file.purpose !== input.workflow.purpose
      || file.visibility !== input.workflow.visibility
      || !input.fileObjectIds.has(file.file_object_id)
      || found.has(file.file_object_id)) {
      throw new Error('complete_manifest_file_mismatch');
    }
    found.add(file.file_object_id);
  }
}
