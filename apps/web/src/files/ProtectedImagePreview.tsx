import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { RequestIdentity } from '../api/identity-request';
import { Alert, Button, Dialog, RequestIdDisplay } from '../ui/primitives';
import { FileReadController } from './file-read-controller';
import type { FileReadIntentProvider } from './file-read-providers';

type ProviderSource = Readonly<{
  provider: FileReadIntentProvider;
  identity?: never;
  reference?: never;
}>;

type IdentitySource = Readonly<{
  provider?: never;
  identity: RequestIdentity;
  reference: unknown;
}>;

export type ProtectedImagePreviewProps = (ProviderSource | IdentitySource) & Readonly<{
  alt: string;
  className?: string;
  fallback: React.ReactNode;
  dialogTitle?: string;
}>;

const BUSY_STATES = new Set([
  'VALIDATING_REFERENCE',
  'CREATING_READ_INTENT',
  'READ_READY',
  'DOWNLOADING',
]);

export function ProtectedImagePreview(
  props: ProtectedImagePreviewProps,
): React.JSX.Element {
  const client = useQueryClient();
  const provider = props.provider;
  const identity = props.identity;
  const reference = props.reference;
  const referenceKey = reference === undefined ? '' : JSON.stringify(reference);
  const latestReference = useRef(reference);
  latestReference.current = reference;
  const controller = useMemo(
    () => new FileReadController(client),
    [client, identity, provider, referenceKey],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const host = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [largeOpen, setLargeOpen] = useState(false);
  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    if (provider) void controller.startWithProvider(provider);
    else if (identity) void controller.start(identity, latestReference.current);
  }, [controller, identity, provider]);

  useEffect(() => {
    started.current = false;
    const node = host.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      start();
      return () => controller.dispose();
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        start();
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(node);
    return () => {
      observer.disconnect();
      controller.dispose();
    };
  }, [controller, start]);

  const busy = BUSY_STATES.has(snapshot.state);
  const message = imageReadMessage(
    snapshot.state,
    snapshot.safeError?.httpStatus ?? null,
  );
  const image = snapshot.ephemeralObjectUrl;

  return <div className="protected-image-preview" ref={host}>
    {image ? <button
      className="protected-image-thumbnail-button"
      type="button"
      aria-label={`查看大图：${props.alt}`}
      onClick={() => setLargeOpen(true)}
    >
      <img className={props.className} src={image} alt={props.alt} loading="lazy" />
    </button> : <div className="protected-image-fallback" aria-busy={busy || undefined}>
      {props.fallback}
      {busy ? <span className="protected-image-loading" role="status">图片加载中</span> : null}
    </div>}
    {message ? <div className="protected-image-error">
      <Alert tone="danger">{message}</Alert>
      {snapshot.canRetry ? <Button className="secondary" onClick={() => { void controller.retry(); }}>重试</Button> : null}
      {snapshot.restartRequired ? <Button className="secondary" onClick={() => { void controller.restart(); }}>重新读取</Button> : null}
      <RequestIdDisplay requestId={snapshot.requestId} />
    </div> : null}
    <Dialog
      open={largeOpen && image !== null}
      title={props.dialogTitle ?? props.alt}
      description="点击关闭后仍会保留当前页面中的安全缩略图。"
      onClose={() => setLargeOpen(false)}
    >
      {image ? <img className="protected-image-large" src={image} alt={props.alt} /> : null}
      <div className="entry-actions">
        <Button className="secondary" onClick={() => setLargeOpen(false)}>关闭大图</Button>
      </div>
    </Dialog>
  </div>;
}

function imageReadMessage(state: string, status: number | null): string | null {
  if (state === 'DEPENDENCY_UNAVAILABLE') return status === 429
    ? '图片读取过于频繁，请稍后重试。'
    : '图片服务暂时不可用，可以重试。';
  if (state === 'RESTART_REQUIRED') return '图片读取凭证已失效，请重新读取。';
  if (state === 'FILE_STORAGE_CONFLICT') return '图片版本已变化，请刷新页面后重试。';
  if (state === 'ERROR') return '图片暂时无法读取。';
  return null;
}
