import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { isFrontendApiError } from '../../api/errors';
import type { FileReadIntentProvider } from '../../files/file-read-providers';
import { consumeIdentityFileReadIntent } from '../../files/file-read-transport';
import { Alert, Button, RequestIdDisplay } from '../../ui/primitives';

export function ProtectedFileButton({ provider, label = '查看文件' }: {
  provider: FileReadIntentProvider;
  label?: string;
}): React.JSX.Element {
  const client = useQueryClient();
  const abort = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  function release(): void {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setUrl(null);
  }
  useEffect(() => () => {
    abort.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, [provider]);

  async function read(): Promise<void> {
    abort.current?.abort();
    release();
    setBusy(true);
    setMessage(null);
    setRequestId(null);
    setProgress(null);
    const current = new AbortController();
    abort.current = current;
    try {
      const intent = await provider.create(client, crypto.randomUUID(), current.signal);
      setRequestId(intent.requestId);
      if (intent.replayed === true || !intent.accessTokenAvailable || intent.accessToken === null) {
        setMessage('读取凭证已使用或不可用，请重新开始。');
        return;
      }
      const content = await consumeIdentityFileReadIntent({
        client,
        identity: 'buyer',
        readIntentId: intent.readIntentId,
        accessToken: intent.accessToken,
        signal: current.signal,
        onProgress: (value) => setProgress(value.percent),
      });
      const next = URL.createObjectURL(new Blob([content.bytes], { type: content.contentType }));
      objectUrl.current = next;
      setUrl(next);
      setProgress(100);
    } catch (error: unknown) {
      if (isFrontendApiError(error) && error.code === 'CANCELED') return;
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(isFrontendApiError(error) && error.httpStatus === 429
        ? '读取过于频繁，请稍后重试。'
        : '文件暂时无法读取，请重新开始。');
    } finally {
      setBusy(false);
      if (abort.current === current) abort.current = null;
    }
  }

  return <div className="protected-file-control">
    {url ? <a className="button secondary" href={url} target="_blank" rel="noreferrer">打开文件</a>
      : <Button loading={busy} loadingLabel={progress === null ? '正在准备' : `正在读取 ${progress}%`}
          onClick={() => { void read(); }}>{label}</Button>}
    {url ? <Button className="secondary" onClick={release}>关闭文件</Button> : null}
    {message ? <Alert tone="danger">{message}</Alert> : null}
    <RequestIdDisplay requestId={requestId} />
  </div>;
}
