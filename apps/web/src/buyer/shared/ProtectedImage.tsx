import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FileReadController } from '../../files/file-read-controller';
import { GenericBuyerFileReadIntentAdapter } from '../../files/file-read-providers';

export function ProtectedImage({
  reference,
  alt,
  className,
  fallback,
}: {
  reference: unknown;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}): React.JSX.Element {
  const client = useQueryClient();
  const provider = useMemo(
    () => new GenericBuyerFileReadIntentAdapter(reference),
    [reference],
  );
  const controller = useMemo(
    () => new FileReadController(client),
    [client, provider],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.startWithProvider(provider);
    return () => controller.dispose();
  }, [controller, provider]);

  return snapshot.ephemeralObjectUrl
    ? <img className={className} src={snapshot.ephemeralObjectUrl} alt={alt} />
    : <>{fallback}</>;
}
