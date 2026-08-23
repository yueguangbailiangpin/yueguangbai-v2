import type { QueryClient } from '@tanstack/react-query';
import {
  SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS,
  type SellerOrderChatScreenshotReadIntentRequest,
} from '@ygb/contracts';
import { z } from 'zod';
import { FrontendApiError } from '../api/errors';
import { operationHeaders } from '../api/idempotency';
import { identityApiRequest } from '../api/identity-request';
import type { RequestIdentity } from '../api/identity-request';
import { createIdentityFileReadIntent } from './file-read-api';
import {
  fileReadIntentResponseSchema,
  safeFileReferenceSchema,
  type SafeFileReference,
} from './file-read-contracts';
import {
  sellerOrderChatScreenshotReadIntentResponseSchema,
} from '../seller/contracts/runtime';

export type CreatedFileReadIntent = Readonly<{
  readIntentId: string;
  accessToken: string | null;
  accessTokenAvailable: boolean;
  expiresAt: number;
  replayed: boolean | null;
  fileObjectId: string | null;
  authorityAssertion: 'VERIFIED' | 'UNVERIFIABLE_MISSING_FIELDS';
  requestId: string;
}>;

export interface FileReadIntentProvider {
  readonly identity: RequestIdentity;
  /**
   * Stable session-cache key for the underlying immutable bytes, or null
   * when the provider cannot prove content identity (no version pin).
   * Keys must scope by identity, entity and content version.
   */
  cacheKey?(): string | null;
  create(
    client: QueryClient,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<CreatedFileReadIntent>;
}

const trustedProviders = new WeakSet<object>();

function trustProvider(provider: object): void {
  trustedProviders.add(provider);
}

export function isTrustedFileReadIntentProvider(value: unknown): value is FileReadIntentProvider {
  return typeof value === 'object' && value !== null && trustedProviders.has(value);
}

export class GenericBuyerFileReadIntentAdapter implements FileReadIntentProvider {
  readonly identity = 'buyer' as const;
  private readonly reference: SafeFileReference;

  constructor(reference: unknown) {
    this.reference = safeFileReferenceSchema.parse(reference);
    trustProvider(this);
  }

  cacheKey(): string {
    return `provider:buyer:file:${this.reference.file_object_id}:${this.reference.file_version}`;
  }

  async create(client: QueryClient, idempotencyKey: string, signal: AbortSignal): Promise<CreatedFileReadIntent> {
    const result = await createIdentityFileReadIntent({
      client,
      identity: 'buyer',
      reference: this.reference,
      idempotencyKey,
      signal,
    });
    return verified(result.data, result.requestId);
  }
}

export class SellerOrderChatScreenshotReadIntentAdapter
implements FileReadIntentProvider {
  readonly identity = 'seller' as const;
  private readonly path: string;
  private readonly expectedVersion: number;

  constructor(formalOrderId: string, version: number) {
    this.path = SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.sellerReadIntent
      .replace(':id', encodeURIComponent(identifier(formalOrderId)));
    this.expectedVersion = positiveInteger(version);
    trustProvider(this);
  }

  cacheKey(): string {
    return `provider:seller:chat:${this.path}:${this.expectedVersion}`;
  }

  async create(client: QueryClient, idempotencyKey: string, signal: AbortSignal): Promise<CreatedFileReadIntent> {
    const body: SellerOrderChatScreenshotReadIntentRequest = {
      expected_file_version: this.expectedVersion,
    };
    const result = await identityApiRequest('seller', client, {
      path: this.path,
      method: 'POST',
      schema: sellerOrderChatScreenshotReadIntentResponseSchema,
      body,
      headers: operationHeaders({ key: idempotencyKey, body }),
      signal,
    });
    const intent = result.data.read_intent;
    assertTokenAvailability(intent, result.requestId);
    if (intent.replayed) malformed(result.requestId);
    return Object.freeze({
      readIntentId: intent.read_intent_id,
      accessToken: intent.access_token,
      accessTokenAvailable: intent.access_token_available,
      expiresAt: intent.expires_at,
      replayed: intent.replayed,
      fileObjectId: null,
      authorityAssertion: 'UNVERIFIABLE_MISSING_FIELDS',
      requestId: result.requestId,
    });
  }
}

const instructionResponseSchema = z.object({
  read_intent: z.object({
    read_intent_id: z.string().min(1).max(120),
    access_token: z.string().min(32).max(512).nullable(),
    access_token_available: z.boolean(),
    expires_at: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export class BuyerInstructionImageReadIntentAdapter implements FileReadIntentProvider {
  readonly identity = 'buyer' as const;
  private readonly path: string;

  constructor(
    reservationId: string,
    position: 'main' | number,
    dtoReadIntentPath: string,
  ) {
    const id = identifier(reservationId);
    const part = position === 'main' ? 'main' : positiveInteger(position);
    const expected = `/api/buyer-portal/reservations/${encodeURIComponent(id)}`
      + `/order-instruction/images/${part}/read-intent`;
    if (dtoReadIntentPath !== expected) throw new TypeError('instruction_read_path_mismatch');
    this.path = expected;
    trustProvider(this);
  }

  async create(client: QueryClient, idempotencyKey: string, signal: AbortSignal): Promise<CreatedFileReadIntent> {
    const result = await identityApiRequest('buyer', client, {
      path: this.path,
      method: 'POST',
      schema: instructionResponseSchema,
      body: undefined,
      headers: operationHeaders({ key: idempotencyKey, body: null }),
      signal,
    });
    const intent = result.data.read_intent;
    assertTokenAvailability(intent, result.requestId);
    return Object.freeze({
      readIntentId: intent.read_intent_id,
      accessToken: intent.access_token,
      accessTokenAvailable: intent.access_token_available,
      expiresAt: intent.expires_at,
      replayed: null,
      fileObjectId: null,
      authorityAssertion: 'UNVERIFIABLE_MISSING_FIELDS',
      requestId: result.requestId,
    });
  }
}

abstract class EntityFileReadIntentAdapter implements FileReadIntentProvider {
  readonly identity = 'buyer' as const;
  protected constructor(
    private readonly path: string,
    private readonly expectedFileObjectId: string,
    private readonly expectedVersion: number,
  ) {
    trustProvider(this);
  }

  cacheKey(): string {
    return `provider:buyer:entity:${this.path}:${this.expectedVersion}`;
  }

  async create(client: QueryClient, idempotencyKey: string, signal: AbortSignal): Promise<CreatedFileReadIntent> {
    const body = { expected_file_version: this.expectedVersion };
    const result = await identityApiRequest('buyer', client, {
      path: this.path,
      method: 'POST',
      schema: fileReadIntentResponseSchema,
      body,
      headers: operationHeaders({ key: idempotencyKey, body }),
      signal,
    });
    if (result.data.file_object_id !== this.expectedFileObjectId) malformed(result.requestId);
    return verified(result.data, result.requestId);
  }
}

export class BuyerReviewFileReadIntentAdapter extends EntityFileReadIntentAdapter {
  constructor(reviewId: string, fileLinkId: string, fileObjectId: string, version: number, allowedActions: readonly string[]) {
    requireReadAction(allowedActions);
    super(
      `/api/buyer-portal/reviews/${encodeURIComponent(identifier(reviewId))}`
        + `/files/${encodeURIComponent(identifier(fileLinkId))}/read-intent`,
      identifier(fileObjectId),
      positiveInteger(version),
    );
  }
}

export class BuyerOrderEvidenceFileReadIntentAdapter extends EntityFileReadIntentAdapter {
  constructor(submissionId: string, fileLinkId: string, fileObjectId: string, version: number, allowedActions: readonly string[]) {
    requireReadAction(allowedActions);
    super(
      `/api/buyer-portal/order-evidence/${encodeURIComponent(identifier(submissionId))}`
        + `/files/${encodeURIComponent(identifier(fileLinkId))}/read-intent`,
      identifier(fileObjectId),
      positiveInteger(version),
    );
  }
}

function verified(
  data: z.output<typeof fileReadIntentResponseSchema>,
  requestId: string,
): CreatedFileReadIntent {
  assertTokenAvailability(data, requestId);
  if (data.replayed === data.access_token_available) malformed(requestId);
  return Object.freeze({
    readIntentId: data.read_intent_id,
    accessToken: data.access_token,
    accessTokenAvailable: data.access_token_available,
    expiresAt: data.expires_at,
    replayed: data.replayed,
    fileObjectId: data.file_object_id,
    authorityAssertion: 'VERIFIED',
    requestId,
  });
}

function assertTokenAvailability(
  data: { access_token: string | null; access_token_available: boolean },
  requestId: string,
): void {
  if (data.access_token_available !== (data.access_token !== null)) malformed(requestId);
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~-]{1,120}$/u.test(value)) {
    throw new TypeError('invalid_file_provider_identifier');
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError('invalid_file_version');
  return Number(value);
}

function requireReadAction(actions: readonly string[]): void {
  if (actions.length !== 1 || actions[0] !== 'CREATE_READ_INTENT') {
    throw new TypeError('file_read_action_not_allowed');
  }
}

function malformed(requestId: string): never {
  throw new FrontendApiError('MALFORMED_RESPONSE', 200, requestId, 'CONTRACT');
}
