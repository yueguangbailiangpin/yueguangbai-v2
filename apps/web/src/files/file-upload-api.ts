import type { QueryClient } from '@tanstack/react-query';
import { FrontendApiError } from '../api/errors';
import { operationHeaders } from '../api/idempotency';
import { identityApiRequest } from '../api/identity-request';
import {
  assertCompleteMatchesIntent,
  assertIntentMatchesWorkflow,
  completeUploadRequestSchema,
  completeUploadResponseSchema,
  uploadIntentBody,
  uploadIntentResponseSchema,
  type CompleteUploadResponse,
  type UploadIntentResponse,
} from './file-contracts';
import type { ValidatedFileSelection } from './file-descriptor';
import type { FileUploadWorkflow } from './file-purpose-config';

export async function createPurposeBoundUploadIntent(input: {
  client: QueryClient;
  workflow: FileUploadWorkflow;
  files: readonly ValidatedFileSelection[];
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<Readonly<{ data: UploadIntentResponse; requestId: string }>> {
  const result = await identityApiRequest(
    input.workflow.identity,
    input.client,
    {
      path: input.workflow.intentPath,
      method: 'POST',
      schema: uploadIntentResponseSchema,
      body: uploadIntentBody(input.files),
      headers: operationHeaders({ key: input.idempotencyKey, body: null }),
      signal: input.signal,
    },
  );
  try {
    assertIntentMatchesWorkflow(result.data, input.workflow, input.files.length);
  } catch {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', 200, result.requestId, 'CONTRACT',
    );
  }
  return result;
}

export async function completePurposeBoundUploadIntent(input: {
  client: QueryClient;
  workflow: FileUploadWorkflow;
  intentId: string;
  expectedVersion: number;
  fileObjectIds: ReadonlySet<string>;
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<Readonly<{ data: CompleteUploadResponse; requestId: string }>> {
  const path = `${input.workflow.lifecyclePrefix}/file-upload-intents/${input.intentId}/complete`;
  const body = completeUploadRequestSchema.parse({ expected_version: input.expectedVersion });
  const result = await identityApiRequest(
    input.workflow.identity,
    input.client,
    {
      path,
      method: 'POST',
      schema: completeUploadResponseSchema,
      body,
      headers: operationHeaders({ key: input.idempotencyKey, body }),
      signal: input.signal,
    },
  );
  try {
    assertCompleteMatchesIntent(result.data, {
      intentId: input.intentId,
      workflow: input.workflow,
      fileObjectIds: input.fileObjectIds,
    });
  } catch {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', 200, result.requestId, 'CONTRACT',
    );
  }
  return result;
}

