import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_HTTP_STATUS,
  FILE_HTTP_LIFECYCLE_PATHS,
  FILE_HTTP_PURPOSE_ROUTES,
} from '@ygb/contracts';

const root = path.resolve(process.cwd());
const source = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

describe('Wave 13 File HTTP contract and architecture', () => {
  it('freezes six purpose-bound intent routes and concrete lifecycle routes', () => {
    expect(Object.values(FILE_HTTP_PURPOSE_ROUTES)).toHaveLength(6);
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
    });
    for (const route of Object.values(FILE_HTTP_LIFECYCLE_PATHS)) {
      expect(route).toMatch(/^\/api\/(buyer-portal|seller-portal|staff)\//u);
      expect(route).not.toContain('{buyer-portal|seller-portal|staff}');
    }
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
    expect(read).toContain('authorization.assertCanRead');
    expect(read).toContain('authorizeExplicitFileAudience');
  });
});
