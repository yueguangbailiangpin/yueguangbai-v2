import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_HTTP_STATUS,
  FILE_HTTP_LIFECYCLE_PATHS,
  FILE_HTTP_PURPOSE_ROUTES,
  WAVE13_DEFERRED_FILE_PURPOSES,
  type FileActor,
  type SqlAllResult,
  type SqlDatabase,
  type SqlRunResult,
  type SqlStatement,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import type { FileAuthorizationResource } from './authorization';
import { RouteBoundFileAuthorizationService } from './route-authorization';

const root = path.resolve(process.cwd());
const source = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

describe('Wave 13 File HTTP contract and architecture', () => {
  it('freezes five active purpose-bound intent routes', () => {
    expect(Object.values(FILE_HTTP_PURPOSE_ROUTES)).toHaveLength(5);
    expect(FILE_HTTP_PURPOSE_ROUTES).toMatchObject({
      buyerOrderEvidence: {
        purpose: 'ORDER_EVIDENCE',
        visibility: 'BUYER_VISIBLE',
      },
      buyerReviewEvidence: {
        purpose: 'REVIEW_EVIDENCE',
        visibility: 'SELLER_VISIBLE',
      },
      sellerProductApplicationImage: {
        purpose: 'PRODUCT_APPLICATION_IMAGE',
        visibility: 'SELLER_VISIBLE',
      },
      staffBuyerRefundProof: {
        purpose: 'BUYER_REFUND_PROOF',
        visibility: 'INTERNAL_ONLY',
      },
      staffSellerSettlementProof: {
        purpose: 'SELLER_SETTLEMENT_PROOF',
        visibility: 'INTERNAL_ONLY',
      },
    });
    expect(WAVE13_DEFERRED_FILE_PURPOSES).toEqual([
      'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
    ]);
    expect(JSON.stringify(FILE_HTTP_PURPOSE_ROUTES)).not.toContain(
      'ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
    );
    for (const route of Object.values(FILE_HTTP_LIFECYCLE_PATHS)) {
      expect(route).toMatch(/^\/api\/(buyer-portal|seller-portal|staff)\//u);
      expect(route).not.toContain('{buyer-portal|seller-portal|staff}');
    }
  });

  it('keeps the historical global purpose but does not register a Wave 13 endpoint', () => {
    const storage = source('packages/contracts/src/file-storage.ts');
    const routes = source('apps/api/src/files/routes.ts');
    expect(storage).toContain("'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'");
    expect(routes).not.toContain(
      'staffOrderEvidenceInternalCommunication',
    );
    expect(routes).not.toContain(
      "['ORDER_EVIDENCE_INTERNAL_COMMUNICATION', 'INTERNAL_ONLY']",
    );
    expect(routes).not.toContain(
      '/api/staff/file-uploads/order-evidence-internal-communication/intents',
    );
  });

  it('keeps File authority out of public request contracts and DTOs', () => {
    const contract = source('packages/contracts/src/file-http.ts');
    for (const forbidden of [
      'object_key:',
      'permanent_url:',
      'owner_id:',
      'buyer_id:',
      'seller_id:',
      'staff_id:',
      'organization_id:',
      'audience:',
    ]) expect(contract).not.toContain(forbidden);
    expect(contract).toContain('expected_file_version');
    expect(contract).toContain('upload_token_available');
    expect(contract).toContain('access_token_available');
  });

  it('uses one multipart part, upload/read tokens, and existing compensation error', () => {
    const routes = source('apps/api/src/files/routes.ts');
    expect(routes).toContain("keys.length !== 1 || keys[0] !== 'file'");
    expect(routes).toContain("'X-Upload-Token'");
    expect(routes).toContain("'X-File-Read-Token'");
    expect(routes).toContain("'Idempotency-Key'");
    expect(routes).not.toContain('/api/files/link');
    expect(routes).not.toContain('/api/files/grant');
    expect(API_ERROR_HTTP_STATUS.FILE_COMPENSATION_REQUIRED).toBe(503);
    const upload = source('apps/api/src/files/upload-file-object.ts');
    const complete = source('apps/api/src/files/complete-upload-intent.ts');
    expect(`${upload}\n${complete}`).toContain('FILE_COMPENSATION_REQUIRED');
  });

  it('does not expose R2 storage authority from HTTP projections', () => {
    const routes = source('apps/api/src/files/routes.ts');
    for (const forbidden of ['object_key', 'permanent_url', 'signed_url']) {
      expect(routes).not.toContain(forbidden);
    }
    const read = source('apps/api/src/files/file-read-service.ts');
    expect(read.match(/\bauthorizeFileRead\(/gu)).toHaveLength(2);
    expect(read).toContain('export async function createFileReadIntent');
    expect(read).toContain('export async function consumeFileReadIntent');
    expect(read).toContain('requireDynamicInstructionReadAuthorization');
  });

  it('rejects missing permission and out-of-scope reads at runtime', async () => {
    const actor: FileActor = {
      type: 'STAFF',
      id: 'wave13-file-reader',
      roles: ['pre_sales'],
    };
    const resource: FileAuthorizationResource = {
      uploadIntentId: 'wave13-file-intent',
      fileObjectId: 'wave13-file-object',
      ownerActorType: 'STAFF',
      ownerActorId: 'another-staff',
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
      entityType: 'ORDER_EVIDENCE_SUBMISSION',
      entityId: 'wave13-evidence-out-of-scope',
      linkRevokedAt: null,
      linkExpiresAt: null,
    };
    const missingPermission = authorization(new Set());
    const globalScope = {
      type: 'GLOBAL',
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    } as const;
    await expect(new RouteBoundFileAuthorizationService(
      authorityDatabase,
      actor,
      new Map(),
      { type: 'STAFF_SESSION', staffId: actor.id },
      missingPermission,
      globalScope,
    ).assertCanRead(actor, resource)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    const scoped = {
      type: 'ASSIGNED_BUYERS',
      buyerCustomerIds: ['buyer-in-scope'],
      sellerOrganizationIds: [],
      teamIds: [],
    } as const;
    await expect(new RouteBoundFileAuthorizationService(
      authorityDatabase,
      actor,
      new Map(),
      { type: 'STAFF_SESSION', staffId: actor.id },
      authorization(new Set(['ORDER_VIEW'])),
      scoped,
    ).assertCanRead(actor, resource)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

const authorityStatement: SqlStatement = {
  bind: () => authorityStatement,
  first: async <T>() => ({
    buyer_customer_id: 'buyer-out-of-scope',
    seller_organization_id: 'seller-out-of-scope',
  }) as unknown as T,
  all: async <T>(): Promise<SqlAllResult<T>> => ({ results: [] }),
  run: async (): Promise<SqlRunResult> => ({ meta: { changes: 0 } }),
};

const authorityDatabase: SqlDatabase = {
  prepare: () => authorityStatement,
  batch: async () => [],
};

function authorization(
  permissions: AssignmentStaffAuthorization['permissions'],
): AssignmentStaffAuthorization {
  return {
    staffId: 'wave13-file-reader',
    displayName: 'Wave 13 File Reader',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['pre_sales']),
    permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}
