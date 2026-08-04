import { useEffect, useSyncExternalStore } from 'react';
import type { RequestIdentity } from '../api/identity-request';
import type { FileReadController } from './file-read-controller';
import type { SafeFileReference } from './file-read-contracts';

export function FileReadTestHarness(props: Readonly<{
  controller: FileReadController;
  identity: RequestIdentity;
  reference: SafeFileReference;
}>): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
    props.controller.getSnapshot,
  );
  useEffect(() => () => props.controller.dispose(), [props.controller]);
  return <section>
    <p>{snapshot.state}</p>
    <p>{snapshot.progress.percent ?? '等待'}</p>
    {snapshot.ephemeralObjectUrl
      ? <a href={snapshot.ephemeralObjectUrl}>打开文件</a>
      : null}
    <button onClick={() => void props.controller.start(
      props.identity,
      props.reference,
    )}>读取文件</button>
    <button disabled={!snapshot.canRelease} onClick={() => {
      props.controller.release();
    }}>释放文件</button>
  </section>;
}
