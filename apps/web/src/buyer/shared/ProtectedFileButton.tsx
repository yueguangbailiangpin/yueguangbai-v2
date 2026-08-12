import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FileReadController } from '../../files/file-read-controller';
import type { FileReadIntentProvider } from '../../files/file-read-providers';
import { Alert, Button, RequestIdDisplay } from '../../ui/primitives';

export function ProtectedFileButton({ provider, label = '查看文件' }: {
  provider: FileReadIntentProvider;
  label?: string;
}): React.JSX.Element {
  const client = useQueryClient();
  const controller = useMemo(() => new FileReadController(client), [client, provider]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => () => controller.dispose(), [controller]);
  const busy = snapshot.state === 'VALIDATING_REFERENCE'
    || snapshot.state === 'CREATING_READ_INTENT'
    || snapshot.state === 'READ_READY'
    || snapshot.state === 'DOWNLOADING';
  const progress = snapshot.progress.percent;
  const message = fileReadMessage(snapshot.state, snapshot.safeError?.httpStatus ?? null);

  return <div className="protected-file-control">
    {snapshot.ephemeralObjectUrl ? <a className="button secondary" href={snapshot.ephemeralObjectUrl} target="_blank" rel="noreferrer">打开文件</a>
      : <Button loading={busy} loadingLabel={progress === null ? '准备中…' : `读取中 ${progress}%`}
          onClick={() => { void controller.startWithProvider(provider); }}>{label}</Button>}
    {snapshot.canRetry ? <Button className="secondary" onClick={() => { void controller.retry(); }}>重试</Button> : null}
    {snapshot.restartRequired ? <Button className="secondary" onClick={() => { void controller.restart(); }}>重新开始</Button> : null}
    {snapshot.canCancel ? <Button className="secondary" onClick={() => controller.cancel()}>取消</Button> : null}
    {snapshot.canRelease ? <Button className="secondary" onClick={() => controller.release()}>关闭</Button> : null}
    {message ? <Alert tone="danger">{message}</Alert> : null}
    <RequestIdDisplay requestId={snapshot.requestId} />
  </div>;
}

function fileReadMessage(state: string, status: number | null): string | null {
  if (state === 'DEPENDENCY_UNAVAILABLE') return status === 429
    ? '读取过于频繁，请等待后重试，或重新开始。'
    : '文件服务暂时不可用，可以重试本次读取。';
  if (state === 'RESTART_REQUIRED') return '本次读取凭证不能继续使用，请重新开始。';
  if (state === 'FILE_STORAGE_CONFLICT') return '文件版本已变化，请刷新页面后再试。';
  if (state === 'ERROR') return '文件暂时无法读取。';
  return null;
}
