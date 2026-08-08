import { parseFeishuWorkbenchTaskSummaryDto, type FeishuWorkbenchAdapter, type FeishuWorkbenchTaskSummaryDto } from '@ygb/contracts';

export class FeishuWorkbenchAdapterError extends Error {
  constructor(public readonly code: 'RATE_LIMITED' | 'UNAVAILABLE' | 'CONTRACT') { super(code); this.name = 'FeishuWorkbenchAdapterError'; }
}

/** Local-only test substitute. It never performs network I/O. */
export class MockFeishuWorkbenchAdapter implements FeishuWorkbenchAdapter {
  readonly tasks = new Map<string, FeishuWorkbenchTaskSummaryDto>();
  readonly keys = new Map<string, string>();
  nextError: FeishuWorkbenchAdapterError | null = null;
  async upsertTask(input: FeishuWorkbenchTaskSummaryDto, previousMirrorKey: string | null, externalIdempotencyKey: string): Promise<{ mirror_key: string; adapter_version: number }> {
    if (this.nextError) { const error = this.nextError; this.nextError = null; throw error; }
    const summary = parseFeishuWorkbenchTaskSummaryDto(input);
    if (!/^[0-9a-f]{40}$/u.test(externalIdempotencyKey)) throw new FeishuWorkbenchAdapterError('CONTRACT');
    const mirrorKey = previousMirrorKey ?? this.keys.get(externalIdempotencyKey) ?? `local_feishu_${externalIdempotencyKey}`;
    this.keys.set(externalIdempotencyKey, mirrorKey);
    this.tasks.set(mirrorKey, summary);
    return { mirror_key: mirrorKey, adapter_version: summary.work_item_version };
  }
}
