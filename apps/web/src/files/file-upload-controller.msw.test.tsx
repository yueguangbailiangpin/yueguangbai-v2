// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import '../test/msw/lifecycle';
import { establishFreshSessionCycle, captureSessionCycle } from '../auth/session-invalidation';
import { failureEnvelopeFixture } from '../test/msw/fixtures';
import { apiUrl } from '../test/msw/handlers';
import { createMswQueryClient } from '../test/msw/render';
import { server } from '../test/msw/server';
import { FileUploadController } from './file-upload-controller';
import { FileUploadTestHarness } from './file-upload-test-harness';
import {
  FILE_UPLOAD_WORKFLOW_KEYS,
  fileUploadWorkflows,
  type FileUploadWorkflowKey,
} from './file-purpose-config';

const digest = 'a'.repeat(64);
const file = (name = 'proof.png', modified = 1) => new File(['safe'], name, {
  type: 'image/png', lastModified: modified,
});
const success = (data: unknown, requestId: string) => ({
  data, meta: { request_id: requestId },
});
const tokenFor = (id: string) => `upload-token-${id}`.padEnd(40, 'x');

type Evidence = {
  intentBodies: unknown[];
  intentKeys: string[];
  uploadKeys: string[];
  uploadTokens: string[];
  uploadCredentials: RequestCredentials[];
  uploadContentTypes: (string | null)[];
  uploadParts: string[][];
  completeBodies: unknown[];
  completeKeys: string[];
};

function evidence(): Evidence {
  return {
    intentBodies: [], intentKeys: [], uploadKeys: [], uploadTokens: [],
    uploadCredentials: [], uploadContentTypes: [], uploadParts: [],
    completeBodies: [], completeKeys: [],
  };
}

function installHappyChain(
  key: FileUploadWorkflowKey,
  record: Evidence,
  options: { files?: number; intentId?: string } = {},
) {
  const workflow = fileUploadWorkflows[key];
  const count = options.files ?? 1;
  const intentId = options.intentId ?? `intent-${key}`;
  const slots = Array.from({ length: count }, (_, index) => ({
    file_object_id: `file-${key}-${index + 1}`,
    slot_no: index + 1,
    upload_token: tokenFor(`${key}-${index + 1}`),
    upload_token_available: true,
    expires_at: 1_900_000_000_000,
  }));
  server.use(
    http.post(apiUrl(workflow.intentPath), async ({ request }) => {
      record.intentBodies.push(await request.json());
      record.intentKeys.push(request.headers.get('Idempotency-Key') ?? '');
      expect(request.credentials).toBe('include');
      return HttpResponse.json(success({
        upload_intent_id: intentId,
        purpose: workflow.purpose,
        visibility: workflow.visibility,
        status: 'ISSUED',
        version: 1,
        expires_at: 1_900_000_000_000,
        uploads: slots,
        replayed: false,
      }, `request-intent-${key}`));
    }),
    http.put(apiUrl(`${workflow.lifecyclePrefix}/file-uploads/:fileObjectId/content`), async ({ request, params }) => {
      record.uploadKeys.push(request.headers.get('Idempotency-Key') ?? '');
      record.uploadTokens.push(request.headers.get('X-Upload-Token') ?? '');
      record.uploadCredentials.push(request.credentials);
      record.uploadContentTypes.push(request.headers.get('Content-Type'));
      const multipart = new TextDecoder().decode(await request.arrayBuffer());
      record.uploadParts.push([...multipart.matchAll(/;\sname="([^"]+)"/gu)].map((match) => match[1]!));
      const slot = slots.find((candidate) => candidate.file_object_id === params['fileObjectId'])!;
      return HttpResponse.json(success({
        file_object_id: slot.file_object_id,
        upload_intent_id: intentId,
        status: 'UPLOADED',
        detected_mime: 'image/png',
        byte_size: 4,
        sha256: digest,
        version: 2,
        replayed: false,
      }, `request-upload-${String(params['fileObjectId'])}`));
    }),
    http.post(apiUrl(`${workflow.lifecyclePrefix}/file-upload-intents/:id/complete`), async ({ request }) => {
      record.completeBodies.push(await request.json());
      record.completeKeys.push(request.headers.get('Idempotency-Key') ?? '');
      expect(request.credentials).toBe('include');
      return HttpResponse.json(success({
        upload_intent_id: intentId,
        status: 'VERIFIED',
        version: 2,
        files: slots.map((slot) => ({
          file_object_id: slot.file_object_id,
          purpose: workflow.purpose,
          visibility: workflow.visibility,
          detected_mime: 'image/png',
          byte_size: 4,
          sha256: digest,
          version: 3,
        })),
        replayed: false,
      }, `request-complete-${key}`));
    }),
  );
  return { intentId, slots };
}

function controller(client = createMswQueryClient()) {
  let generated = 0;
  return new FileUploadController(client, () => `operation-key-${++generated}`);
}

function seed(client: QueryClient): void {
  client.setQueryData(['buyer', 'session'], 'buyer');
  client.setQueryData(['seller', 'session'], 'seller');
  client.setQueryData(['staff', 'session'], 'staff');
}

describe('formal MSW purpose-bound upload chain', () => {
  it.each(FILE_UPLOAD_WORKFLOW_KEYS)('%s traverses Controller to exact Intent/XHR/Complete routes', async (key) => {
    const record = evidence();
    installHappyChain(key, record);
    const client = createMswQueryClient();
    const target = controller(client);
    const observed: ReturnType<FileUploadController['getSnapshot']>[] = [];
    const unsubscribe = target.subscribe(() => observed.push(target.getSnapshot()));
    await target.start(key, [file()]);
    unsubscribe();
    const snapshot = target.getSnapshot();
    expect(snapshot.state).toBe('VERIFIED');
    expect(snapshot.manifest).toMatchObject({
      intent_version: 2,
      request_id: `request-complete-${key}`,
      files: [{ file_version: 3, purpose: fileUploadWorkflows[key].purpose }],
    });
    expect(record.intentBodies).toEqual([{ files: [{
      client_file_name: 'proof.png', extension: 'png', declared_mime: 'image/png', byte_size: 4,
    }] }]);
    expect(record.intentKeys[0]).toMatch(/^operation-key-/u);
    expect(record.uploadCredentials).toEqual(['include']);
    expect(record.uploadTokens).toEqual([tokenFor(`${key}-1`)]);
    expect(record.uploadParts).toEqual([['file']]);
    expect(record.uploadContentTypes[0]).toMatch(/^multipart\/form-data; boundary=/iu);
    expect(record.completeBodies).toEqual([{ expected_version: 1 }]);
    expect(record.completeKeys[0]).toMatch(/^operation-key-/u);
    expect(JSON.stringify(snapshot)).not.toMatch(/upload-token|operation-key|"upload_token"|Idempotency-Key/iu);
    expect(observed.some((value) => value.progress.mode === 'DETERMINATE'
      && value.progress.loadedBytes !== null
      && value.progress.totalBytes !== null)).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toMatch(/upload-token|operation-key/iu);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('uploads each multi-slot file separately, uses distinct keys, then completes once', async () => {
    const record = evidence();
    installHappyChain('buyerReviewEvidence', record, { files: 2 });
    const target = controller();
    await target.start('buyerReviewEvidence', [file('one.png', 1), file('two.png', 2)]);
    expect(target.getSnapshot().state).toBe('VERIFIED');
    expect(record.uploadParts).toEqual([['file'], ['file']]);
    expect(new Set(record.uploadKeys).size).toBe(2);
    expect(record.completeBodies).toHaveLength(1);
    expect(target.getSnapshot().progress).toMatchObject({ completedSlots: 2, totalSlots: 2 });
  });

  it('renders the verified Controller result through the component harness', async () => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    const target = controller();
    render(<FileUploadTestHarness
      controller={target}
      workflow="buyerOrderEvidence"
      files={[file()]}
    />);
    fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
    expect(await screen.findByText('VERIFIED 1')).toBeVisible();
    expect(screen.getByText('VERIFIED', { selector: 'p' })).toBeVisible();
  });

  it('rejects invalid selection without sending any network request', async () => {
    let requests = 0;
    server.events.on('request:start', () => { requests += 1; });
    try {
      const target = controller();
      await target.start('buyerOrderEvidence', [new File([], 'empty.png', { type: 'image/png' })]);
      expect(target.getSnapshot()).toMatchObject({
        state: 'ERROR', error: { code: 'VALIDATION_ERROR' },
      });
      expect(requests).toBe(0);
    } finally {
      server.events.removeAllListeners('request:start');
    }
  });

  it('file replacement aborts the old operation and creates a new Intent/key', async () => {
    const record = evidence();
    const { slots, intentId } = installHappyChain('buyerOrderEvidence', record);
    let uploads = 0;
    const uploadKeys: string[] = [];
    server.use(http.put(apiUrl('/api/buyer-portal/file-uploads/:id/content'), async ({ request }) => {
      uploads += 1;
      uploadKeys.push(request.headers.get('Idempotency-Key') ?? '');
      if (uploads === 1) await delay(80);
      return HttpResponse.json(success({
        file_object_id: slots[0]!.file_object_id, upload_intent_id: intentId,
        status: 'UPLOADED', detected_mime: 'image/png', byte_size: 4,
        sha256: digest, version: 2, replayed: false,
      }, `request-replaced-upload-${uploads}`));
    }));
    const target = controller();
    const first = target.start('buyerOrderEvidence', [file('old.png')]);
    await waitFor(() => expect(target.getSnapshot().state).toBe('UPLOADING'));
    await target.replaceFiles('buyerOrderEvidence', [file('new.png', 2)]);
    await first;
    expect(target.getSnapshot()).toMatchObject({
      state: 'VERIFIED', slots: [{ clientFileName: 'new.png' }],
    });
    expect(record.intentKeys).toHaveLength(2);
    expect(record.intentKeys[0]).not.toBe(record.intentKeys[1]);
    expect(uploadKeys[0]).not.toBe(uploadKeys[1]);
  });
});

describe('Intent contract, replay, and identity invalidation', () => {
  it.each([
    ['purpose', { purpose: 'REVIEW_EVIDENCE' }],
    ['visibility', { visibility: 'SELLER_VISIBLE' }],
    ['slot count', { uploads: [] }],
    ['duplicate slot', { uploads: [
      { file_object_id: 'file-a', slot_no: 1, upload_token: tokenFor('a'), upload_token_available: true, expires_at: 2 },
      { file_object_id: 'file-a', slot_no: 1, upload_token: tokenFor('b'), upload_token_available: true, expires_at: 2 },
    ] }],
  ])('rejects mismatched %s before upload', async (_label, override) => {
    let uploads = 0;
    const workflow = fileUploadWorkflows.buyerOrderEvidence;
    server.use(
      http.post(apiUrl(workflow.intentPath), () => HttpResponse.json(success({
        upload_intent_id: 'intent-bad', purpose: workflow.purpose,
        visibility: workflow.visibility, status: 'ISSUED', version: 1, expires_at: 2,
        uploads: [{ file_object_id: 'file-a', slot_no: 1, upload_token: tokenFor('a'), upload_token_available: true, expires_at: 2 }],
        replayed: false,
        ...override,
      }, 'request-bad-intent'))),
      http.put(apiUrl('/api/buyer-portal/file-uploads/:id/content'), () => {
        uploads += 1;
        return HttpResponse.error();
      }),
    );
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({ state: 'RESTART_REQUIRED', restartRequired: true });
    expect(uploads).toBe(0);
  });

  it('requires explicit restart for replay without a usable token and creates a new key', async () => {
    const keys: string[] = [];
    let calls = 0;
    const workflow = fileUploadWorkflows.buyerOrderEvidence;
    server.use(http.post(apiUrl(workflow.intentPath), ({ request }) => {
      calls += 1;
      keys.push(request.headers.get('Idempotency-Key') ?? '');
      return HttpResponse.json(success({
        upload_intent_id: `intent-replay-${calls}`, purpose: workflow.purpose,
        visibility: workflow.visibility, status: 'ISSUED', version: 1, expires_at: 2,
        uploads: [{ file_object_id: `file-replay-${calls}`, slot_no: 1, upload_token: null, upload_token_available: false, expires_at: 2 }],
        replayed: true,
      }, `request-replay-${calls}`));
    }));
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({ state: 'RESTART_REQUIRED', restartRequired: true });
    expect(calls).toBe(1);
    await target.restart();
    expect(calls).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(JSON.stringify(target.getSnapshot())).not.toContain('upload_token');
  });

  it.each([
    ['buyerOrderEvidence', ['buyer', 'seller'], ['staff']],
    ['staffBuyerRefundProof', ['staff'], ['buyer', 'seller']],
  ] as const)('%s Intent 401 clears only its identity roots', async (key, cleared, preserved) => {
    const client = createMswQueryClient();
    seed(client);
    const workflow = fileUploadWorkflows[key];
    server.use(http.post(apiUrl(workflow.intentPath), () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, `request-${key}-401`),
      { status: 401 },
    )));
    const target = controller(client);
    await target.start(key, [file()]);
    for (const root of cleared) expect(client.getQueriesData({ queryKey: [root] })).toEqual([]);
    for (const root of preserved) expect(client.getQueryData([root, 'session'])).toBe(root);
  });
});

describe('XHR upload retry, cancel, errors, and stale 401 generation', () => {
  it('reuses the same upload key and token only after an explicit network retry', async () => {
    const record = evidence();
    const { slots, intentId } = installHappyChain('buyerOrderEvidence', record);
    let calls = 0;
    server.use(http.put(apiUrl('/api/buyer-portal/file-uploads/:fileObjectId/content'), async ({ request }) => {
      calls += 1;
      record.uploadKeys.push(request.headers.get('Idempotency-Key') ?? '');
      record.uploadTokens.push(request.headers.get('X-Upload-Token') ?? '');
      if (calls === 1) return HttpResponse.error();
      await request.arrayBuffer();
      return HttpResponse.json(success({
        file_object_id: slots[0]!.file_object_id, upload_intent_id: intentId,
        status: 'UPLOADED', detected_mime: 'image/png',
        byte_size: 4, sha256: digest, version: 2, replayed: false,
      }, 'request-upload-retry'));
    }));
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({ state: 'ERROR', canRetry: true });
    expect(calls).toBe(1);
    await target.retry();
    expect(target.getSnapshot().state).toBe('VERIFIED');
    expect(record.uploadKeys[0]).toBe(record.uploadKeys[1]);
    expect(record.uploadTokens[0]).toBe(record.uploadTokens[1]);
  });

  it('cancel aborts the active XHR, marks canceled, and never completes', async () => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    let completeCalls = 0;
    server.use(
      http.put(apiUrl('/api/buyer-portal/file-uploads/:id/content'), async () => {
        await delay(100);
        return HttpResponse.error();
      }),
      http.post(apiUrl('/api/buyer-portal/file-upload-intents/:id/complete'), () => {
        completeCalls += 1;
        return HttpResponse.error();
      }),
    );
    const target = controller();
    const running = target.start('buyerOrderEvidence', [file()]);
    await waitFor(() => expect(target.getSnapshot().state).toBe('UPLOADING'));
    target.cancel();
    await running;
    expect(target.getSnapshot()).toMatchObject({ state: 'CANCELED', canRetry: false });
    expect(completeCalls).toBe(0);
    expect(JSON.stringify(target.getSnapshot())).not.toMatch(/upload-token|operation-key/iu);
  });

  it.each([
    [410, 'FILE_UPLOAD_EXPIRED', 'RESTART_REQUIRED'],
    [422, 'FILE_VALIDATION_FAILED', 'ERROR'],
    [503, 'FILE_COMPENSATION_REQUIRED', 'FILE_COMPENSATION_REQUIRED'],
    [503, 'DEPENDENCY_UNAVAILABLE', 'DEPENDENCY_UNAVAILABLE'],
    [409, 'IDEMPOTENCY_CONFLICT', 'RESTART_REQUIRED'],
    [409, 'REQUEST_IN_PROGRESS', 'ERROR'],
  ] as const)('maps upload %s %s to %s without Complete', async (status, code, state) => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    let completeCalls = 0;
    server.use(
      http.put(apiUrl('/api/buyer-portal/file-uploads/:id/content'), () => HttpResponse.json(
        failureEnvelopeFixture(code, 'safe', null, `request-upload-${code}`), { status },
      )),
      http.post(apiUrl('/api/buyer-portal/file-upload-intents/:id/complete'), () => {
        completeCalls += 1;
        return HttpResponse.error();
      }),
    );
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({ state, error: { code } });
    expect(completeCalls).toBe(0);
  });

  it('a failed first slot stops later slots and Complete', async () => {
    const record = evidence();
    installHappyChain('buyerReviewEvidence', record, { files: 2 });
    let uploadCalls = 0;
    let completeCalls = 0;
    server.use(
      http.put(apiUrl('/api/buyer-portal/file-uploads/:id/content'), () => {
        uploadCalls += 1;
        return HttpResponse.json(failureEnvelopeFixture(
          'FILE_VALIDATION_FAILED', 'unsafe', null, 'request-first-slot-failed',
        ), { status: 422 });
      }),
      http.post(apiUrl('/api/buyer-portal/file-upload-intents/:id/complete'), () => {
        completeCalls += 1;
        return HttpResponse.error();
      }),
    );
    const target = controller();
    await target.start('buyerReviewEvidence', [file('one.png', 1), file('two.png', 2)]);
    expect(uploadCalls).toBe(1);
    expect(completeCalls).toBe(0);
    expect(target.getSnapshot().slots.map((slot) => slot.state)).toEqual(['FAILED', 'PENDING']);
  });

  it.each([
    ['buyerOrderEvidence', ['buyer', 'seller'], ['staff']],
    ['staffBuyerRefundProof', ['staff'], ['buyer', 'seller']],
  ] as const)('%s Upload 401 uses the existing identity cleanup cycle', async (key, cleared, preserved) => {
    const client = createMswQueryClient();
    seed(client);
    const record = evidence();
    installHappyChain(key, record);
    const workflow = fileUploadWorkflows[key];
    server.use(http.put(apiUrl(`${workflow.lifecyclePrefix}/file-uploads/:id/content`), () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, `request-${key}-upload-401`),
      { status: 401 },
    )));
    const target = controller(client);
    await target.start(key, [file()]);
    for (const root of cleared) expect(client.getQueriesData({ queryKey: [root] })).toEqual([]);
    for (const root of preserved) expect(client.getQueryData([root, 'session'])).toBe(root);
    expect(target.getSnapshot().error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a malformed Upload success envelope while preserving its trusted request_id', async () => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    server.use(http.put(apiUrl('/api/buyer-portal/file-uploads/:id/content'), () => HttpResponse.json({
      data: { file_object_id: 'wrong-only' },
      meta: { request_id: 'request-malformed-upload' },
    })));
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({
      state: 'ERROR',
      error: { code: 'MALFORMED_RESPONSE', requestId: 'request-malformed-upload' },
    });
  });

  it('an old upload 401 cannot clear a newer fresh Customer generation', async () => {
    const client = createMswQueryClient();
    seed(client);
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    let started = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.put(apiUrl('/api/buyer-portal/file-uploads/:id/content'), async () => {
      started = true;
      await gate;
      return HttpResponse.json(
        failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, 'request-old-upload-401'),
        { status: 401 },
      );
    }));
    const target = controller(client);
    const running = target.start('buyerOrderEvidence', [file()]);
    await waitFor(() => expect(started).toBe(true));
    const cycle = captureSessionCycle(client, 'buyer');
    expect(establishFreshSessionCycle(client, 'buyer', cycle)).not.toBeNull();
    client.setQueryData(['buyer', 'session'], 'buyer-fresh');
    client.setQueryData(['seller', 'session'], 'seller-fresh');
    release();
    await running;
    expect(client.getQueryData(['buyer', 'session'])).toBe('buyer-fresh');
    expect(client.getQueryData(['seller', 'session'])).toBe('seller-fresh');
    expect(target.getSnapshot().error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('Complete validation and explicit safe retry', () => {
  it('does not show VERIFIED after Upload until Complete succeeds', async () => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post(apiUrl('/api/buyer-portal/file-upload-intents/:id/complete'), async () => {
      await gate;
      return HttpResponse.json(success({
        upload_intent_id: 'intent-buyerOrderEvidence', status: 'VERIFIED', version: 2,
        files: [{ file_object_id: 'file-buyerOrderEvidence-1', purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE', detected_mime: 'image/png', byte_size: 4, sha256: digest, version: 3 }],
        replayed: false,
      }, 'request-complete-delayed'));
    }));
    const target = controller();
    const running = target.start('buyerOrderEvidence', [file()]);
    await waitFor(() => expect(target.getSnapshot().state).toBe('COMPLETING'));
    expect(target.getSnapshot().manifest).toBeNull();
    release();
    await running;
    expect(target.getSnapshot().state).toBe('VERIFIED');
  });

  it('reuses the Complete key after an explicit lost-response retry', async () => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    let calls = 0;
    server.use(http.post(apiUrl('/api/buyer-portal/file-upload-intents/:id/complete'), ({ request }) => {
      calls += 1;
      record.completeKeys.push(request.headers.get('Idempotency-Key') ?? '');
      if (calls === 1) return HttpResponse.error();
      return HttpResponse.json(success({
        upload_intent_id: 'intent-buyerOrderEvidence', status: 'VERIFIED', version: 2,
        files: [{ file_object_id: 'file-buyerOrderEvidence-1', purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE', detected_mime: 'image/png', byte_size: 4, sha256: digest, version: 3 }],
        replayed: true,
      }, 'request-complete-replay'));
    }));
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({ state: 'ERROR', canRetry: true });
    await target.retry();
    expect(target.getSnapshot().state).toBe('VERIFIED');
    expect(record.completeKeys[0]).toBe(record.completeKeys[1]);
  });

  it.each([
    [409, 'VERSION_CONFLICT', 'RESTART_REQUIRED', false],
    [409, 'IDEMPOTENCY_CONFLICT', 'RESTART_REQUIRED', false],
    [409, 'REQUEST_IN_PROGRESS', 'ERROR', true],
    [503, 'FILE_COMPENSATION_REQUIRED', 'FILE_COMPENSATION_REQUIRED', false],
    [503, 'DEPENDENCY_UNAVAILABLE', 'DEPENDENCY_UNAVAILABLE', true],
  ] as const)('maps Complete %s to distinct %s state', async (status, code, state, canRetry) => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    server.use(http.post(apiUrl('/api/buyer-portal/file-upload-intents/:id/complete'), () => HttpResponse.json(
      failureEnvelopeFixture(code, 'safe', null, `request-complete-${code}`), { status },
    )));
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({ state, canRetry, error: { code } });
  });

  it.each([
    ['wrong purpose', { files: [{ file_object_id: 'file-buyerOrderEvidence-1', purpose: 'REVIEW_EVIDENCE', visibility: 'BUYER_VISIBLE', detected_mime: 'image/png', byte_size: 4, sha256: digest, version: 3 }] }],
    ['unknown file', { files: [{ file_object_id: 'file-unknown', purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE', detected_mime: 'image/png', byte_size: 4, sha256: digest, version: 3 }] }],
    ['malformed envelope data', { status: 'UPLOADED' }],
  ])('rejects %s manifest and preserves trustworthy request_id', async (_label, override) => {
    const record = evidence();
    installHappyChain('buyerOrderEvidence', record);
    server.use(http.post(apiUrl('/api/buyer-portal/file-upload-intents/:id/complete'), () => HttpResponse.json(success({
      upload_intent_id: 'intent-buyerOrderEvidence', status: 'VERIFIED', version: 2,
      files: [{ file_object_id: 'file-buyerOrderEvidence-1', purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE', detected_mime: 'image/png', byte_size: 4, sha256: digest, version: 3 }],
      replayed: false,
      ...override,
    }, 'request-malformed-manifest'))));
    const target = controller();
    await target.start('buyerOrderEvidence', [file()]);
    expect(target.getSnapshot()).toMatchObject({
      state: 'ERROR',
      error: { code: 'MALFORMED_RESPONSE', requestId: 'request-malformed-manifest' },
      manifest: null,
    });
  });
});
