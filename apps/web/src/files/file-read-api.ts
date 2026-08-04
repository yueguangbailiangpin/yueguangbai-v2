import type { QueryClient } from '@tanstack/react-query';
import { FrontendApiError } from '../api/errors';
import { operationHeaders } from '../api/idempotency';
import {
  identityApiRequest,
  type RequestIdentity,
} from '../api/identity-request';
import {
  fileReadIntentBody,
  fileReadIntentResponseSchema,
  type FileReadIntentResponse,
  type SafeFileReference,
} from './file-read-contracts';

const READ_PREFIX = Object.freeze({
  buyer: '/api/buyer-portal',
  seller: '/api/seller-portal',
  staff: '/api/staff',
} as const satisfies Record<RequestIdentity, string>);

export function fileReadLifecyclePrefix(identity: RequestIdentity):
  '/api/buyer-portal' | '/api/seller-portal' | '/api/staff' {
  return READ_PREFIX[identity];
}

export async function createIdentityFileReadIntent(input: {
  client: QueryClient;
  identity: RequestIdentity;
  reference: SafeFileReference;
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<Readonly<{ data: FileReadIntentResponse; requestId: string }>> {
  const body = fileReadIntentBody(input.reference);
  const result = await identityApiRequest(input.identity, input.client, {
    path: `${fileReadLifecyclePrefix(input.identity)}/files/${input.reference.file_object_id}/read-intents`,
    method: 'POST',
    schema: fileReadIntentResponseSchema,
    body,
    headers: operationHeaders({ key: input.idempotencyKey, body }),
    signal: input.signal,
  });
  if (result.data.file_object_id !== input.reference.file_object_id
    || result.data.replayed === result.data.access_token_available
    || (result.data.access_token_available
      ? result.data.access_token === null
      : result.data.access_token !== null)) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', 200, result.requestId, 'CONTRACT',
    );
  }
  return result;
}

