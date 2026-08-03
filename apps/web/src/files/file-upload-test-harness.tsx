import { useSyncExternalStore } from 'react';
import type { FileUploadController } from './file-upload-controller';
import type { FileUploadWorkflowKey } from './file-purpose-config';

export function FileUploadTestHarness(props: {
  controller: FileUploadController;
  workflow: FileUploadWorkflowKey;
  files: readonly File[];
}) {
  const snapshot = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
    props.controller.getSnapshot,
  );
  return <section aria-label="文件上传测试">
    <p role="status">{snapshot.state}</p>
    <p>已完成 {snapshot.progress.completedSlots}/{snapshot.progress.totalSlots}</p>
    {snapshot.progress.percent === null ? null : <p>{snapshot.progress.percent.toFixed(0)}%</p>}
    {snapshot.error === null ? null : <p role="alert">
      {snapshot.error.code}{snapshot.error.requestId ? ` · ${snapshot.error.requestId}` : ''}
    </p>}
    {snapshot.manifest === null ? null : <output>VERIFIED {snapshot.manifest.files.length}</output>}
    <button type="button" onClick={() => { void props.controller.replaceFiles(props.workflow, props.files); }}>
      开始上传
    </button>
    <button type="button" disabled={!snapshot.canRetry} onClick={() => { void props.controller.retry(); }}>
      重试
    </button>
    <button type="button" disabled={!snapshot.restartRequired} onClick={() => { void props.controller.restart(); }}>
      重新开始
    </button>
    <button type="button" onClick={() => props.controller.cancel()}>取消</button>
  </section>;
}
