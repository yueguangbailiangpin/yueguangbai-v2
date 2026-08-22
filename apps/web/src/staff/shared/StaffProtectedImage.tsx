import { ProtectedImagePreview } from '../../files/ProtectedImagePreview';

export function StaffProtectedImage({
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
  return <ProtectedImagePreview
    identity="staff"
    reference={reference}
    alt={alt}
    {...(className ? { className } : {})}
    fallback={fallback}
  />;
}
