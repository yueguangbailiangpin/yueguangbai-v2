import { useMemo } from 'react';
import { ProtectedImagePreview } from '../../files/ProtectedImagePreview';
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
  const provider = useMemo(
    () => new GenericBuyerFileReadIntentAdapter(reference),
    [reference],
  );
  return <ProtectedImagePreview
    provider={provider}
    alt={alt}
    {...(className ? { className } : {})}
    fallback={fallback}
  />;
}
