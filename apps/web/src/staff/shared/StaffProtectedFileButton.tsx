import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FileReadController } from '../../files/file-read-controller';
import { Alert, Button, RequestIdDisplay } from '../../ui/primitives';

export function StaffProtectedFileButton({ reference, label = '查看受保护文件' }: { reference: unknown; label?: string }): React.JSX.Element {
  const client = useQueryClient();
  const controller = useMemo(() => new FileReadController(client), [client]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);
  const busy = ['VALIDATING_REFERENCE', 'CREATING_READ_INTENT', 'READ_READY', 'DOWNLOADING'].includes(state.state);
  return <div className="protected-file-control">
    {state.ephemeralObjectUrl
      ? <a className="button secondary" href={state.ephemeralObjectUrl} target="_blank" rel="noreferrer">打开文件</a>
      : <Button loading={busy} loadingLabel="正在安全读取" onClick={() => { void controller.start('staff', reference); }}>{label}</Button>}
    {state.canRetry ? <Button className="secondary" onClick={() => { void controller.retry(); }}>重试</Button> : null}
    {state.restartRequired ? <Button className="secondary" onClick={() => { void controller.restart(); }}>重新开始</Button> : null}
    {state.canRelease ? <Button className="secondary" onClick={() => controller.release()}>关闭文件</Button> : null}
    {['ERROR', 'FILE_STORAGE_CONFLICT', 'DEPENDENCY_UNAVAILABLE', 'RESTART_REQUIRED'].includes(state.state)
      ? <Alert tone="danger">当前无法读取文件，请按提示重试。</Alert> : null}
    <RequestIdDisplay requestId={state.requestId} />
  </div>;
}
