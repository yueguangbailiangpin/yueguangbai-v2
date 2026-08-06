import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { FileUploadController } from '../../files/file-upload-controller';

export function useFileUpload(): readonly [
  FileUploadController,
  ReturnType<FileUploadController['getSnapshot']>,
] {
  const client = useQueryClient();
  const controller = useRef<FileUploadController | null>(null);
  controller.current ??= new FileUploadController(client);
  const snapshot = useSyncExternalStore(
    controller.current.subscribe,
    controller.current.getSnapshot,
    controller.current.getSnapshot,
  );
  useEffect(() => () => controller.current?.cancel(), []);
  return [controller.current, snapshot] as const;
}
